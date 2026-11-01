import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GoogleDriveProvider,
  setGoogleDriveAccessToken,
  getGoogleDriveAccessToken,
} from '../services/sync/providers/googleDriveProvider';
import { FullWorkspaceSnapshot } from '../services/sync/protocol';

describe('GoogleDriveProvider (BYOS - Bring Your Own Storage)', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    provider = new GoogleDriveProvider();
    setGoogleDriveAccessToken(null);
    vi.restoreAllMocks();
  });

  it('manages OAuth access tokens in memory and sessionStorage', () => {
    expect(provider.isAvailable()).toBe(false);
    expect(getGoogleDriveAccessToken()).toBeNull();

    setGoogleDriveAccessToken('valid_mock_token_123', 3600);
    expect(provider.isAvailable()).toBe(true);
    expect(getGoogleDriveAccessToken()).toBe('valid_mock_token_123');

    setGoogleDriveAccessToken(null);
    expect(provider.isAvailable()).toBe(false);
    expect(getGoogleDriveAccessToken()).toBeNull();
  });

  it('loads workspace from Google Drive appDataFolder', async () => {
    setGoogleDriveAccessToken('test_drive_token');

    const mockSnapshot: FullWorkspaceSnapshot = {
      schemaVersion: 2,
      exportedAt: '2026-11-01T12:00:00.000Z',
      deviceId: 'device_a',
      userId: 'user_drive',
      entities: [],
      relationships: [],
      messages: [],
      chatSessions: [],
      conversationBranches: [],
      universalTags: [],
      foodLogs: [],
      attendance: { subjects: [], classSchedule: [], holidays: [], attendanceLogs: [] },
    };

    // Mock fetch for find file query + download
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ files: [{ id: 'file_id_999', name: 'flowmate_workspace_v2.json' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSnapshot,
      });

    vi.stubGlobal('fetch', fetchMock);

    const loaded = await provider.loadWorkspace();
    expect(loaded).toEqual(mockSnapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('spaces=appDataFolder');
    expect(fetchMock.mock.calls[1][0]).toContain('/files/file_id_999?alt=media');
  });

  it('saves workspace via multipart create when file does not exist yet', async () => {
    setGoogleDriveAccessToken('test_drive_token');

    const mockSnapshot: FullWorkspaceSnapshot = {
      schemaVersion: 2,
      exportedAt: '2026-11-01T12:00:00.000Z',
      deviceId: 'device_a',
      userId: 'user_drive',
      entities: [],
      relationships: [],
      messages: [],
      chatSessions: [],
      conversationBranches: [],
      universalTags: [],
      foodLogs: [],
      attendance: { subjects: [], classSchedule: [], holidays: [], attendanceLogs: [] },
    };

    // Find file returns empty files array -> creates new file
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ files: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new_created_file_id' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const saved = await provider.saveWorkspace(mockSnapshot);
    expect(saved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('uploadType=multipart');
  });
});
