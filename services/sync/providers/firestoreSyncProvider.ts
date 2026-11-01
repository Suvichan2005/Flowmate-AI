/**
 * Flowmate Firestore Sync Provider (P1-10)
 *
 * Wraps Cloud Firestore sync operations with error containment and ad-blocker detection.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  SyncStorageProvider,
  FullWorkspaceSnapshot,
  SyncMutationPayload,
} from '../protocol';
import { isFirebaseConfigured } from '../../firebase';
import {
  saveUserData,
  loadUserData,
  saveMessage,
  saveFoodLogs,
  saveAttendanceData,
  saveChatSessions,
  saveChatBranches,
  deleteChannelMessages,
  syncEntities,
  syncRelationships,
} from '../../firestoreSync';
import { isDemoSyncBlocked } from '../../syncManager';

export class FirestoreSyncProvider implements SyncStorageProvider {
  readonly id = 'firestore';
  readonly name = 'Flowmate Cloud (Firebase)';
  private userId: string | null = null;
  private adBlockerDetected = false;

  isAvailable(): boolean {
    return isFirebaseConfigured() && !isDemoSyncBlocked() && !this.adBlockerDetected;
  }

  isAdBlockerActive(): boolean {
    return this.adBlockerDetected;
  }

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    this.adBlockerDetected = false;
    return this.isAvailable();
  }

  async disconnect(): Promise<void> {
    this.userId = null;
  }

  async loadWorkspace(): Promise<FullWorkspaceSnapshot | null> {
    if (!this.userId || !this.isAvailable()) return null;

    try {
      // First attempt default read (from server or persistent cache)
      const data = await loadUserData(this.userId, 'default');
      if (!data) return null;

      return {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        deviceId: 'firestore_cloud',
        userId: this.userId,
        entities: data.entities,
        relationships: data.relationships,
        messages: data.messages || [],
        chatSessions: data.chatSessions || [],
        conversationBranches: data.conversationBranches || [],
        universalTags: data.universalTags || [],
        settings: data.settings,
        foodLogs: data.foodLogs || [],
        attendance: {
          subjects: data.subjects || [],
          classSchedule: data.classSchedule || [],
          holidays: data.holidays || [],
          attendanceLogs: data.attendanceLogs || [],
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('ERR_BLOCKED_BY_CLIENT') || err.message.includes('unavailable'))) {
        this.adBlockerDetected = true;
      }
      return null;
    }
  }

  async saveWorkspace(snapshot: FullWorkspaceSnapshot): Promise<boolean> {
    if (!this.userId || !this.isAvailable()) return false;

    try {
      const ok = await saveUserData(this.userId, {
        entities: snapshot.entities,
        relationships: snapshot.relationships,
        universalTags: snapshot.universalTags,
        settings: snapshot.settings,
      });

      if (!ok) return false;

      // Save ancillary collections
      if (snapshot.chatSessions.length > 0) {
        await saveChatSessions(this.userId, snapshot.chatSessions);
      }
      if (snapshot.conversationBranches.length > 0) {
        await saveChatBranches(this.userId, snapshot.conversationBranches);
      }
      if (snapshot.foodLogs.length > 0) {
        await saveFoodLogs(this.userId, snapshot.foodLogs);
      }
      if (snapshot.attendance.subjects.length > 0 || snapshot.attendance.attendanceLogs.length > 0) {
        await saveAttendanceData(this.userId, snapshot.attendance);
      }

      return true;
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('ERR_BLOCKED_BY_CLIENT') || err.message.includes('unavailable'))) {
        this.adBlockerDetected = true;
      }
      return false;
    }
  }

  async saveMutation(mutation: SyncMutationPayload): Promise<boolean> {
    if (!this.userId || !this.isAvailable()) return false;

    try {
      switch (mutation.entityKind) {
        case 'entity': {
          if (!mutation.data) return false;
          return await syncEntities(this.userId, [mutation.data as unknown as FullWorkspaceSnapshot['entities'][0]]);
        }
        case 'relationship': {
          if (!mutation.data) return false;
          return await syncRelationships(this.userId, [mutation.data as unknown as FullWorkspaceSnapshot['relationships'][0]]);
        }
        case 'message': {
          if (!mutation.data) return false;
          return await saveMessage(this.userId, mutation.data as unknown as FullWorkspaceSnapshot['messages'][0]);
        }
        case 'chat_session': {
          if (!mutation.data || !Array.isArray(mutation.data.sessions)) return false;
          return await saveChatSessions(this.userId, mutation.data.sessions as FullWorkspaceSnapshot['chatSessions']);
        }
        case 'chat_branch': {
          if (!mutation.data || !Array.isArray(mutation.data.branches)) return false;
          return await saveChatBranches(this.userId, mutation.data.branches as FullWorkspaceSnapshot['conversationBranches']);
        }
        case 'food_logs': {
          if (!mutation.data || !Array.isArray(mutation.data.foodLogs)) return false;
          return await saveFoodLogs(this.userId, mutation.data.foodLogs as FullWorkspaceSnapshot['foodLogs']);
        }
        case 'attendance': {
          if (!mutation.data) return false;
          return await saveAttendanceData(this.userId, mutation.data as unknown as FullWorkspaceSnapshot['attendance']);
        }
        default:
          return false;
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('ERR_BLOCKED_BY_CLIENT') || err.message.includes('unavailable'))) {
        this.adBlockerDetected = true;
      }
      return false;
    }
  }
}

export const globalFirestoreSyncProvider = new FirestoreSyncProvider();
