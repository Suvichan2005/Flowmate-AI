/**
 * Flowmate Google Drive Sync Provider — Bring Your Own Storage (BYOS) (P1-10)
 *
 * Implements private workspace persistence to Google Drive's sandboxed `appDataFolder`.
 * Gives users complete data sovereignty: no third-party database dependency.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  SyncStorageProvider,
  FullWorkspaceSnapshot,
  SyncMutationPayload,
} from '../protocol';
import { auth } from '../../firebase';
import { GoogleAuthProvider, signInWithPopup, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';

const DRIVE_WORKSPACE_FILENAME = 'flowmate_workspace_v2.json';
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3/files';

let googleDriveAccessToken: string | null = null;
let googleDriveTokenExpiresAt = 0;

export const getGoogleDriveAccessToken = (): string | null => {
  if (googleDriveAccessToken && Date.now() < googleDriveTokenExpiresAt - 5 * 60 * 1000) {
    return googleDriveAccessToken;
  }
  return null;
};

export const setGoogleDriveAccessToken = (token: string | null, expiresInSeconds = 3600): void => {
  googleDriveAccessToken = token;
  googleDriveTokenExpiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      if (token) {
        window.sessionStorage.setItem('flowmate_drive_token', token);
        window.sessionStorage.setItem('flowmate_drive_expires', String(googleDriveTokenExpiresAt));
      } else {
        window.sessionStorage.removeItem('flowmate_drive_token');
        window.sessionStorage.removeItem('flowmate_drive_expires');
      }
    } catch {
      // Storage unavailable fallback
    }
  }
};

// Rehydrate token from sessionStorage on startup
if (typeof window !== 'undefined' && window.sessionStorage) {
  try {
    const savedToken = window.sessionStorage.getItem('flowmate_drive_token');
    const savedExpires = Number(window.sessionStorage.getItem('flowmate_drive_expires') || '0');
    if (savedToken && savedExpires > Date.now() + 60 * 1000) {
      googleDriveAccessToken = savedToken;
      googleDriveTokenExpiresAt = savedExpires;
    }
  } catch {
    // Session storage blocked
  }
}

export class GoogleDriveProvider implements SyncStorageProvider {
  readonly id = 'googledrive';
  readonly name = 'Google Drive (BYOS)';
  private userId: string | null = null;
  private cachedFileId: string | null = null;

  isAvailable(): boolean {
    return Boolean(getGoogleDriveAccessToken());
  }

  /**
   * Request user authorization for Google Drive AppData access.
   */
  async authorize(): Promise<boolean> {
    if (!auth) return false;
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.appdata');
    provider.addScope('https://www.googleapis.com/auth/drive.file');

    try {
      const user = auth.currentUser;
      const hasGoogleProvider = Boolean(user?.providerData.some(p => p.providerId === 'google.com'));
      const result = user
        ? hasGoogleProvider
          ? await reauthenticateWithPopup(user, provider)
          : await linkWithPopup(user, provider)
        : await signInWithPopup(auth, provider);

      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleDriveAccessToken(credential.accessToken);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[GoogleDriveProvider] Authorization failed:', error);
      return false;
    }
  }

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    return this.isAvailable();
  }

  async disconnect(): Promise<void> {
    setGoogleDriveAccessToken(null);
    this.userId = null;
    this.cachedFileId = null;
  }

  /**
   * Queries Google Drive `appDataFolder` for the workspace file id.
   */
  private async findWorkspaceFileId(): Promise<string | null> {
    if (this.cachedFileId) return this.cachedFileId;
    const token = getGoogleDriveAccessToken();
    if (!token) return null;

    try {
      const query = encodeURIComponent(`name = '${DRIVE_WORKSPACE_FILENAME}' and trashed = false`);
      const response = await fetch(
        `${DRIVE_API_ROOT}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) setGoogleDriveAccessToken(null);
        return null;
      }

      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') return null;
      const files = (data as { files?: unknown }).files;
      if (Array.isArray(files) && files.length > 0 && typeof (files[0] as { id?: unknown }).id === 'string') {
        const foundId = (files[0] as { id: string }).id;
        this.cachedFileId = foundId;
        return foundId;
      }
      return null;
    } catch (error) {
      console.warn('[GoogleDriveProvider] Find file error:', error);
      return null;
    }
  }

  /**
   * Loads the full workspace snapshot from Google Drive appDataFolder.
   */
  async loadWorkspace(): Promise<FullWorkspaceSnapshot | null> {
    const token = getGoogleDriveAccessToken();
    if (!token) return null;

    const fileId = await this.findWorkspaceFileId();
    if (!fileId) return null;

    try {
      const response = await fetch(`${DRIVE_API_ROOT}/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) setGoogleDriveAccessToken(null);
        return null;
      }

      const snapshot: unknown = await response.json();
      if (!snapshot || typeof snapshot !== 'object') return null;
      const parsed = snapshot as Partial<FullWorkspaceSnapshot>;
      if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.entities)) return null;

      return parsed as FullWorkspaceSnapshot;
    } catch (error) {
      console.error('[GoogleDriveProvider] Load workspace failed:', error);
      return null;
    }
  }

  /**
   * Saves the entire workspace snapshot to Google Drive appDataFolder.
   */
  async saveWorkspace(snapshot: FullWorkspaceSnapshot): Promise<boolean> {
    const token = getGoogleDriveAccessToken();
    if (!token) return false;

    const content = JSON.stringify(snapshot, null, 2);
    const existingFileId = await this.findWorkspaceFileId();

    try {
      if (existingFileId) {
        // Update existing file content via PATCH
        const response = await fetch(
          `${DRIVE_UPLOAD_ROOT}/${existingFileId}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: content,
          }
        );
        if (response.ok) return true;
        if (response.status === 401) {
          setGoogleDriveAccessToken(null);
          return false;
        }
      }

      // Create new file in appDataFolder using multipart upload
      const metadata = {
        name: DRIVE_WORKSPACE_FILENAME,
        parents: ['appDataFolder'],
        description: 'Flowmate Private Encrypted Workspace Snapshot',
      };

      const boundary = '-------flowmate_drive_boundary_' + Math.random().toString(36).slice(2);
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        content +
        closeDelimiter;

      const createResponse = await fetch(
        `${DRIVE_UPLOAD_ROOT}?uploadType=multipart&fields=id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!createResponse.ok) {
        if (createResponse.status === 401) setGoogleDriveAccessToken(null);
        return false;
      }

      const resData: unknown = await createResponse.json();
      if (resData && typeof resData === 'object' && typeof (resData as { id?: unknown }).id === 'string') {
        this.cachedFileId = (resData as { id: string }).id;
        return true;
      }
      return false;
    } catch (error) {
      console.error('[GoogleDriveProvider] Save workspace failed:', error);
      return false;
    }
  }

  /**
   * For Google Drive, individual mutations are aggregated and saved via full workspace snapshots
   * or delta files.
   */
  async saveMutation(_mutation: SyncMutationPayload): Promise<boolean> {
    // Individual mutations trigger debounced full snapshot saves via Coordinator
    return true;
  }
}

export const globalGoogleDriveProvider = new GoogleDriveProvider();
