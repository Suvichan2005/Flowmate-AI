import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncCoordinator } from '../services/sync/syncCoordinator';
import { WebSocketRelayProvider } from '../services/sync/providers/websocketRelayProvider';
import { FirestoreSyncProvider } from '../services/sync/providers/firestoreSyncProvider';
import { GoogleDriveProvider } from '../services/sync/providers/googleDriveProvider';
import { SyncEnvelope } from '../services/sync/protocol';

describe('SyncCoordinator (P1-10 Multi-Device Sync Architecture)', () => {
  let mockRelay: WebSocketRelayProvider;
  let mockFirestore: FirestoreSyncProvider;
  let mockDrive: GoogleDriveProvider;
  let coordinator: SyncCoordinator;

  beforeEach(() => {
    mockRelay = {
      deviceId: 'test_device_1',
      isAvailable: vi.fn().mockReturnValue(true),
      getConnectionState: vi.fn().mockReturnValue('connected'),
      getActivePeerCount: vi.fn().mockReturnValue(2),
      connect: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn().mockReturnValue(true),
      onRemoteEnvelope: vi.fn().mockReturnValue(() => {}),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    } as unknown as WebSocketRelayProvider;

    mockFirestore = {
      id: 'firestore',
      name: 'Flowmate Cloud (Firebase)',
      isAvailable: vi.fn().mockReturnValue(true),
      isAdBlockerActive: vi.fn().mockReturnValue(false),
      initialize: vi.fn().mockResolvedValue(true),
      loadWorkspace: vi.fn().mockResolvedValue(null),
      saveWorkspace: vi.fn().mockResolvedValue(true),
      saveMutation: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as FirestoreSyncProvider;

    mockDrive = {
      id: 'googledrive',
      name: 'Google Drive (BYOS)',
      isAvailable: vi.fn().mockReturnValue(false),
      initialize: vi.fn().mockResolvedValue(false),
      loadWorkspace: vi.fn().mockResolvedValue(null),
      saveWorkspace: vi.fn().mockResolvedValue(true),
      saveMutation: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      authorize: vi.fn().mockResolvedValue(true),
    } as unknown as GoogleDriveProvider;

    coordinator = new SyncCoordinator(mockRelay, mockFirestore, mockDrive);
  });

  it('initializes with default backend and connects relay', () => {
    coordinator.initialize('user_123');
    expect(mockRelay.connect).toHaveBeenCalledWith('user_123', expect.any(Function));
    expect(mockFirestore.initialize).toHaveBeenCalledWith('user_123');
  });

  it('switches between storage backends and updates status report', () => {
    coordinator.setStorageBackend('googledrive');
    expect(coordinator.getStorageBackend()).toBe('googledrive');

    const report = coordinator.getStatusReport();
    expect(report.storageBackend).toBe('googledrive');
    expect(report.relayState).toBe('connected');
    expect(report.activePeersCount).toBe(2);
  });

  it('broadcasts local mutations immediately over WebSocket relay', () => {
    coordinator.initialize('user_123');
    coordinator.enqueueMutation({
      entityKind: 'message',
      op: 'upsert',
      entityId: 'msg_999',
      data: { text: 'Hello from device 1' },
    });

    expect(mockRelay.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      senderDeviceId: 'test_device_1',
      userId: 'user_123',
      mutations: [expect.objectContaining({
        entityKind: 'message',
        op: 'upsert',
        entityId: 'msg_999',
      })],
    }));
  });

  it('never transmits network messages when in local vault mode', () => {
    coordinator.setStorageBackend('local_vault');
    coordinator.enqueueMutation({
      entityKind: 'entity',
      op: 'upsert',
      entityId: 'secret_task_1',
    });

    expect(mockRelay.broadcast).not.toHaveBeenCalled();
  });

  it('dispatches incoming remote mutations to registered listeners while ignoring own device echoes', () => {
    let capturedListener: ((envelope: SyncEnvelope) => void) | null = null;
    mockRelay.onRemoteEnvelope = vi.fn().mockImplementation((listener) => {
      capturedListener = listener;
      return () => {};
    });

    const coordinatorWithListener = new SyncCoordinator(mockRelay, mockFirestore, mockDrive);
    const mutationListener = vi.fn();
    coordinatorWithListener.onRemoteMutation(mutationListener);

    // 1. Remote message from peer device -> Dispatched
    capturedListener!({
      version: 2,
      envelopeId: 'env_remote_1',
      senderDeviceId: 'peer_phone_2',
      userId: 'user_123',
      timestamp: new Date().toISOString(),
      mutations: [{
        id: 'mut_1',
        entityKind: 'message',
        op: 'upsert',
        entityId: 'msg_peer',
        clientTimestamp: new Date().toISOString(),
        deviceId: 'peer_phone_2',
        data: { text: 'Synced from phone' },
      }],
    });

    expect(mutationListener).toHaveBeenCalledTimes(1);
    expect(mutationListener).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'msg_peer',
    }));

    // 2. Echo from same device -> Dropped
    capturedListener!({
      version: 2,
      envelopeId: 'env_echo',
      senderDeviceId: 'test_device_1',
      userId: 'user_123',
      timestamp: new Date().toISOString(),
      mutations: [{
        id: 'mut_echo',
        entityKind: 'message',
        op: 'upsert',
        entityId: 'msg_echo',
        clientTimestamp: new Date().toISOString(),
        deviceId: 'test_device_1',
      }],
    });

    expect(mutationListener).toHaveBeenCalledTimes(1);
  });
});
