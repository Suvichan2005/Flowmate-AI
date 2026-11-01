/**
 * Flowmate WebSocket Realtime Relay Provider (P1-10)
 *
 * Provides bidirectional real-time delta synchronization across devices and tabs.
 * Standard WSS connection over HTTPS (port 443) bypasses ad-blockers and privacy shields.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  SyncRelayProvider,
  SyncRelayConnectionState,
  SyncEnvelope,
} from '../protocol';

const DEFAULT_RELAY_HTTP = 'https://managed-live-relay-preview-297013476805.asia-south1.run.app';
const CROSS_TAB_CHANNEL_NAME = 'flowmate_cross_device_relay_v2';
const PING_INTERVAL_MS = 25_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 16_000;

function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server-env';
  try {
    const existing = window.localStorage.getItem('flowmate_device_id');
    if (existing && typeof existing === 'string' && existing.length > 5) return existing;
    const generated = 'device_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));
    window.localStorage.setItem('flowmate_device_id', generated);
    return generated;
  } catch {
    return 'ephemeral_device';
  }
}

export class WebSocketRelayProvider implements SyncRelayProvider {
  private socket: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private state: SyncRelayConnectionState = 'disconnected';
  private activePeerCount = 0;
  private userId: string | null = null;
  private tokenGetter: (() => Promise<string | null>) | null = null;
  private envelopeListeners = new Set<(envelope: SyncEnvelope) => void>();
  private stateListeners = new Set<(state: SyncRelayConnectionState, peerCount: number) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_MS;
  private isExplicitlyDisconnected = false;
  readonly tabId = Math.random().toString(36).slice(2, 9);
  readonly deviceId: string;

  constructor() {
    this.deviceId = getDeviceId();
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (event: MessageEvent<unknown>) => {
          if (!event.data || typeof event.data !== 'object') return;
          const msg = event.data as Record<string, unknown>;
          if (msg.type === 'sync_envelope' && msg.envelope && typeof msg.envelope === 'object') {
            const envelope = msg.envelope as SyncEnvelope;
            // Ignore messages originating from this exact tab/sender session
            const isDifferentTab = (envelope.senderTabId && envelope.senderTabId !== this.tabId) || msg.tabSource !== this.tabId;
            const isDifferentDevice = envelope.senderDeviceId !== this.deviceId;
            if (isDifferentDevice || isDifferentTab) {
              this.notifyEnvelopeListeners(envelope);
            }
          }
        };
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  getConnectionState(): SyncRelayConnectionState {
    return this.state;
  }

  getActivePeerCount(): number {
    return this.activePeerCount;
  }

  connect(userId: string, tokenGetter: () => Promise<string | null>): void {
    if (!this.isAvailable()) {
      this.updateState('unavailable', 0);
      return;
    }
    this.userId = userId;
    this.tokenGetter = tokenGetter;
    this.isExplicitlyDisconnected = false;
    this.reconnectDelay = INITIAL_RECONNECT_MS;
    this.initiateSocketConnection();
  }

  private async initiateSocketConnection(): Promise<void> {
    if (this.isExplicitlyDisconnected || !this.userId || !this.tokenGetter) return;
    this.cleanupSocket();
    this.updateState('connecting', this.activePeerCount);

    let token: string | null = null;
    try {
      token = await this.tokenGetter();
    } catch {
      token = null;
    }

    if (!token) {
      // Re-attempt after delay if token could not be obtained yet
      this.scheduleReconnect();
      return;
    }

    const relayEndpoint = import.meta.env.VITE_MANAGED_LIVE_RELAY_ENDPOINT || DEFAULT_RELAY_HTTP;
    const wsUrl = relayEndpoint.replace(/^http/, 'ws') +
      `/sync-ws?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(this.deviceId)}`;

    try {
      const ws = new WebSocket(wsUrl);
      this.socket = ws;

      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.reconnectDelay = INITIAL_RECONNECT_MS;
        this.updateState('connected', this.activePeerCount);
        this.startHeartbeat();
      };

      ws.onmessage = (event: MessageEvent<unknown>) => {
        if (this.socket !== ws) return;
        try {
          if (typeof event.data !== 'string') return;
          const frame: unknown = JSON.parse(event.data);
          if (!frame || typeof frame !== 'object') return;
          const record = frame as Record<string, unknown>;

          if (record.type === 'sync_connected') {
            const peers = typeof record.activePeers === 'number' ? record.activePeers : 0;
            this.updateState('connected', peers);
          } else if (record.type === 'peer_joined') {
            this.updateState('connected', this.activePeerCount + 1);
          } else if (record.type === 'peer_left') {
            this.updateState('connected', Math.max(0, this.activePeerCount - 1));
          } else if (record.type === 'sync_envelope') {
            const envelope = record.envelope as SyncEnvelope | undefined;
            if (envelope && (envelope.senderDeviceId !== this.deviceId || (envelope.senderTabId && envelope.senderTabId !== this.tabId))) {
              this.notifyEnvelopeListeners(envelope);
            }
          }
        } catch {
          // Ignore malformed message frames
        }
      };

      ws.onclose = () => {
        if (this.socket !== ws) return;
        this.cleanupSocket();
        if (!this.isExplicitlyDisconnected) {
          this.updateState('disconnected', 0);
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        if (this.socket !== ws) return;
        this.cleanupSocket();
        if (!this.isExplicitlyDisconnected) {
          this.updateState('disconnected', 0);
          this.scheduleReconnect();
        }
      };
    } catch {
      this.cleanupSocket();
      this.updateState('disconnected', 0);
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch {
          // Socket write failed, will reconnect on error
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isExplicitlyDisconnected) return;
    const jitter = Math.random() * 500;
    const waitTime = this.reconnectDelay + jitter;
    this.reconnectDelay = Math.min(MAX_RECONNECT_MS, this.reconnectDelay * 1.6);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.initiateSocketConnection();
    }, waitTime);
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
          this.socket.close(1000, 'client-cleanup');
        }
      } catch {
        // Safe tear down
      }
      this.socket = null;
    }
  }

  disconnect(): void {
    this.isExplicitlyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.updateState('disconnected', 0);
  }

  broadcast(envelope: SyncEnvelope): boolean {
    let sentToRelay = false;

    const fullEnvelope: SyncEnvelope = envelope.senderTabId ? envelope : {
      ...envelope,
      senderTabId: this.tabId,
    };

    // 1. Send to WebSocket live relay for cross-device broadcast
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({
          type: 'sync_envelope',
          envelope: fullEnvelope,
        }));
        sentToRelay = true;
      } catch {
        sentToRelay = false;
      }
    }

    // 2. Broadcast locally across same-origin tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'sync_envelope',
          envelope: fullEnvelope,
          tabSource: this.tabId,
        });
      } catch {
        // Tab broadcast dropped
      }
    }

    return sentToRelay;
  }

  onRemoteEnvelope(listener: (envelope: SyncEnvelope) => void): () => void {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  onStateChange(listener: (state: SyncRelayConnectionState, peerCount: number) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private updateState(nextState: SyncRelayConnectionState, peerCount: number): void {
    this.state = nextState;
    this.activePeerCount = peerCount;
    for (const listener of this.stateListeners) {
      try {
        listener(nextState, peerCount);
      } catch {
        // Listener error suppressed
      }
    }
  }

  private notifyEnvelopeListeners(envelope: SyncEnvelope): void {
    for (const listener of this.envelopeListeners) {
      try {
        listener(envelope);
      } catch {
        // Listener error suppressed
      }
    }
  }
}

export const globalWebSocketRelayProvider = new WebSocketRelayProvider();
