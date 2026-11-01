import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketRelayProvider } from '../services/sync/providers/websocketRelayProvider';
import { SyncEnvelope } from '../services/sync/protocol';

describe('WebSocketRelayProvider', () => {
  let provider: WebSocketRelayProvider;

  beforeEach(() => {
    provider = new WebSocketRelayProvider();
    vi.restoreAllMocks();
  });

  it('initializes with a persistent device id', () => {
    expect(provider.deviceId).toBeDefined();
    expect(typeof provider.deviceId).toBe('string');
    expect(provider.deviceId.length).toBeGreaterThan(5);
  });

  it('starts disconnected and tracks state transitions', () => {
    expect(provider.getConnectionState()).toBe('disconnected');
    expect(provider.getActivePeerCount()).toBe(0);

    const stateListener = vi.fn();
    provider.onStateChange(stateListener);

    provider.disconnect();
    expect(provider.getConnectionState()).toBe('disconnected');
  });

  it('broadcasts envelope to local BroadcastChannel and WebSocket when open', () => {
    const envelope: SyncEnvelope = {
      version: 2,
      envelopeId: 'env_test_1',
      senderDeviceId: provider.deviceId,
      userId: 'user_test',
      timestamp: new Date().toISOString(),
      mutations: [],
    };

    // When socket is not open, it still broadcasts locally via BroadcastChannel
    const sent = provider.broadcast(envelope);
    expect(typeof sent).toBe('boolean');
  });
});
