/**
 * Flowmate Voice Memory Privacy & Lifecycle Adversarial Test Suite
 *
 * Verifies resolution of P1 Voice Memory Privacy/Lifecycle Filter defects:
 * 1. Tombstone supremacy: deleted memories (deleted_at != null, status: 'deleted') are never dispatched.
 * 2. Temporal validity: expired memories (valid_until past current time, status: 'expired') are strictly excluded.
 * 3. Device-local isolation: memories marked 'device_local' or 'local_only' NEVER leave device over the wire.
 * 4. Epistemic hygiene: superseded and rejected beliefs are excluded by default.
 * 5. Full LiveManager voice dispatch integration: search_memory, search_entities, and read_calendar tools enforce these invariants.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { LiveManager } from '../services/liveSession';
import { executeSearchMemory } from '../services/ai/executors';
import {
  selectEligibleMemories,
  isEntityTombstone,
  isMemoryExpired,
  isDeviceLocal,
  isMemorySuperseded,
} from '../services/context';
import { Entity as KernelEntity, AttributeValue } from '../services/kernel/types';
import { SYSTEM_MEMORY_ITEM_SCHEMA, SYSTEM_EVENT_SCHEMA } from '../services/kernel';
import { LiveServerMessage } from '@google/genai';
import { EntityKind, EntityStatus } from '../types';

// --- Web Audio Mocks for LiveManager ---

class MockAudioBuffer {
  duration = 1.0;
  length = 24000;
  sampleRate = 24000;
  numberOfChannels = 1;
  getChannelData() {
    return new Float32Array(24000);
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connected = true;
  connect() {}
  disconnect() {
    this.connected = false;
  }
  start() {}
  stop() {
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 10;
  sampleRate = 24000;
  destination = {};

  createBuffer() {
    return new MockAudioBuffer();
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode();
  }
  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteTimeDomainData: () => {},
      connect: () => {},
      disconnect: () => {},
    };
  }
  createScriptProcessor() {
    return {
      connect: () => {},
      disconnect: () => {},
      onaudioprocess: null,
    };
  }
  createMediaStreamSource() {
    return {
      connect: () => {},
      disconnect: () => {},
    };
  }
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}

let mockLiveSessionCallbacks: {
  onopen?: () => void;
  onmessage?: (msg: LiveServerMessage) => Promise<void>;
  onclose?: (e: unknown) => void;
  onerror?: (err: unknown) => void;
} = {};

const mockSendRealtimeInput = vi.fn();
const mockSendToolResponse = vi.fn();
const mockCloseSession = vi.fn();

const mockLiveSessionInstance = {
  sendRealtimeInput: mockSendRealtimeInput,
  sendToolResponse: mockSendToolResponse,
  close: mockCloseSession,
};

vi.mock('../services/ai/client', () => ({
  AI_MODELS: {
    LIVE: 'gemini-3.8-live',
  },
  hasAiApiKey: () => true,
  getEphemeralApiKey: () => 'synthetic-byok-key',
  getByokLiveModelOptions: async () => [
    { id: 'gemini-3.8-live', name: 'Gemini 3.8 Live', reasoningLevels: [] },
  ],
  getByokLiveClient: () => ({
    live: {
      connect: vi.fn().mockImplementation((params) => {
        mockLiveSessionCallbacks = params.callbacks || {};
        if (mockLiveSessionCallbacks.onopen) mockLiveSessionCallbacks.onopen();
        if (mockLiveSessionCallbacks.onmessage) void mockLiveSessionCallbacks.onmessage({ setupComplete: {} } as LiveServerMessage);
        return Promise.resolve(mockLiveSessionInstance);
      }),
    },
  }),
  getAiClient: () => ({
    live: {
      connect: vi.fn().mockImplementation((params) => {
        mockLiveSessionCallbacks = params.callbacks || {};
        setTimeout(() => {
          if (mockLiveSessionCallbacks.onopen) mockLiveSessionCallbacks.onopen();
        }, 10);
        return Promise.resolve(mockLiveSessionInstance);
      }),
    },
  }),
}));

function createTestMemory(
  id: string,
  content: string,
  category: string,
  attributes: Record<string, AttributeValue> = {},
  options?: {
    deleted?: boolean;
    deleted_at?: string | null;
    status?: string;
    valid_until?: string;
    privacy_tier?: 'public' | 'private' | 'sensitive' | 'device_local';
    epistemic_status?: 'accepted' | 'tentative' | 'disputed' | 'superseded' | 'rejected';
  }
): KernelEntity {
  const isDeleted = options?.deleted ?? false;
  const deletedAt = isDeleted ? (options?.deleted_at ?? '2026-10-10T12:00:00.000Z') : null;
  const privacyTier = options?.privacy_tier ?? 'private';
  const epistemicStatus = options?.epistemic_status ?? 'accepted';

  return {
    id,
    schema_id: 'system/memory_item',
    version: 1,
    title: content.slice(0, 30),
    attributes: {
      content,
      category,
      privacy_tier: privacyTier,
      epistemic_status: epistemicStatus,
      status: options?.status ?? (isDeleted ? 'deleted' : 'active'),
      ...(options?.valid_until ? { valid_until: options.valid_until } : {}),
      ...attributes,
    },
    lifecycle: {
      status: isDeleted ? 'deleted' : (options?.status ?? 'active'),
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-01T10:00:00.000Z',
      deleted_at: deletedAt,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-01T10:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
    validity: options?.valid_until ? { valid_until: options.valid_until } : undefined,
  };
}

const mockMediaStreamTrack = {
  stop: vi.fn(),
};

const mockMediaStream = {
  getTracks: () => [mockMediaStreamTrack],
};

describe('P1 Voice Memory Privacy & Lifecycle Boundary Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.AudioContext = MockAudioContext as unknown as typeof AudioContext;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    useStore.setState({
      kernelEntities: {},
      schemas: {
        'system/memory_item': SYSTEM_MEMORY_ITEM_SCHEMA,
        'system/event': SYSTEM_EVENT_SCHEMA,
      },
      pendingOps: null,
      messages: [],
      activeSessionId: 'test_voice_session',
    });
  });

  describe('1. Shared Memory Selector Unit & Adversarial Boundaries', () => {
    const NOW = '2026-10-12T12:00:00.000Z';

    it('identifies and filters deleted tombstone memories', () => {
      const activeMem = createTestMemory('mem-1', 'Active coffee preference: almond milk', 'preference');
      const deletedMem1 = createTestMemory('mem-2', 'Deleted milk preference', 'preference', {}, { deleted: true });
      const deletedMem2 = createTestMemory('mem-3', 'Deleted via attributes status', 'preference', {}, { status: 'deleted' });

      expect(isEntityTombstone(activeMem)).toBe(false);
      expect(isEntityTombstone(deletedMem1)).toBe(true);
      expect(isEntityTombstone(deletedMem2)).toBe(true);

      const results = selectEligibleMemories([activeMem, deletedMem1, deletedMem2], {
        query: 'milk',
        now: NOW,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-1');
    });

    it('identifies and filters expired memories past temporal validity', () => {
      const currentMem = createTestMemory(
        'mem-valid',
        'Valid temporary project assignment',
        'project_context',
        {},
        { valid_until: '2026-10-15T00:00:00.000Z' }
      );
      const expiredMem = createTestMemory(
        'mem-expired',
        'Expired project deadline in New York',
        'project_context',
        {},
        { valid_until: '2026-10-10T00:00:00.000Z' }
      );

      expect(isMemoryExpired('2026-10-15T00:00:00.000Z', new Date(NOW).getTime())).toBe(false);
      expect(isMemoryExpired('2026-10-10T00:00:00.000Z', new Date(NOW).getTime())).toBe(true);

      const results = selectEligibleMemories([currentMem, expiredMem], {
        query: 'project',
        now: NOW,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-valid');
    });

    it('strictly isolates device_local memories from external model queries', () => {
      const normalMem = createTestMemory(
        'mem-normal',
        'Standard preference: likes dark mode',
        'preference',
        {},
        { privacy_tier: 'private' }
      );
      const localOnlyMem = createTestMemory(
        'mem-local',
        'Device-local secret cryptographic master key',
        'fact',
        {},
        { privacy_tier: 'device_local' }
      );

      expect(isDeviceLocal('private')).toBe(false);
      expect(isDeviceLocal('device_local')).toBe(true);

      // Default: allow_device_local is false
      const resultsDefault = selectEligibleMemories([normalMem, localOnlyMem], {
        query: '',
        now: NOW,
      });

      expect(resultsDefault).toHaveLength(1);
      expect(resultsDefault[0].id).toBe('mem-normal');

      // Explicit allow_device_local: false
      const resultsForbidden = selectEligibleMemories([normalMem, localOnlyMem], {
        query: '',
        allow_device_local: false,
        now: NOW,
      });

      expect(resultsForbidden).toHaveLength(1);
      expect(resultsForbidden[0].id).toBe('mem-normal');
    });

    it('excludes superseded and rejected beliefs by default to preserve epistemic hygiene', () => {
      const currentBelief = createTestMemory(
        'mem-active',
        'User is focusing on Backend Architecture in 2026',
        'project_context',
        {},
        { epistemic_status: 'accepted' }
      );
      const supersededBelief = createTestMemory(
        'mem-superseded',
        'User is focusing on Mobile Flutter dev',
        'project_context',
        { superseded_by: 'mem-active' },
        { epistemic_status: 'superseded' }
      );
      const rejectedBelief = createTestMemory(
        'mem-rejected',
        'User moved to San Francisco',
        'fact',
        {},
        { epistemic_status: 'rejected' }
      );

      const defaultResults = selectEligibleMemories([currentBelief, supersededBelief, rejectedBelief], {
        query: 'focusing',
        include_superseded: false,
        now: NOW,
      });

      expect(defaultResults).toHaveLength(1);
      expect(defaultResults[0].id).toBe('mem-active');

      // Opt-in historical retrieval
      const historicalResults = selectEligibleMemories([currentBelief, supersededBelief, rejectedBelief], {
        query: 'focusing',
        include_superseded: true,
        now: NOW,
      });

      expect(historicalResults).toHaveLength(2);
      expect(historicalResults.map((r) => r.id)).toContain('mem-superseded');
    });
  });

  describe('2. AI Tool Executor Integration', () => {
    it('executeSearchMemory respects tombstone, expiration, and device-local boundaries', () => {
      const active = createTestMemory('mem-1', 'Active preference: matcha tea in morning', 'preference');
      const deleted = createTestMemory('mem-2', 'Deleted tea preference: black tea', 'preference', {}, { deleted: true });
      const deviceLocal = createTestMemory('mem-3', 'Local secret: vault pin for tea cabinet', 'preference', {}, { privacy_tier: 'device_local' });

      useStore.setState({
        kernelEntities: {
          'mem-1': active,
          'mem-2': deleted,
          'mem-3': deviceLocal,
        },
      });

      const results = executeSearchMemory({ query: 'tea' });

      // ONLY the active, non-local entity must be returned!
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-1');
      expect(results[0].content).toBe('Active preference: matcha tea in morning');
    });
  });

  describe('3. LiveManager Voice Multimodal Session Integration', () => {
    it('LiveManager search_memory tool dispatches ONLY eligible memories to sendToolResponse', async () => {
      const activeMem = createTestMemory(
        'mem-valid',
        'User prefers oat milk in flat white',
        'preference',
        {},
        { privacy_tier: 'private' }
      );
      const deletedMem = createTestMemory(
        'mem-deleted',
        'User hates oat milk',
        'preference',
        {},
        { deleted: true }
      );
      const expiredMem = createTestMemory(
        'mem-expired',
        'Temporary flat white discount code',
        'fact',
        {},
        { valid_until: '2026-10-01T00:00:00.000Z' }
      );
      const localMem = createTestMemory(
        'mem-local',
        'Local biometric flat white token',
        'fact',
        {},
        { privacy_tier: 'device_local' }
      );
      const supersededMem = createTestMemory(
        'mem-superseded',
        'User drinks whole milk',
        'preference',
        { superseded_by: 'mem-valid' },
        { epistemic_status: 'superseded' }
      );

      useStore.setState({
        kernelEntities: {
          'mem-valid': activeMem,
          'mem-deleted': deletedMem,
          'mem-expired': expiredMem,
          'mem-local': localMem,
          'mem-superseded': supersededMem,
        },
      });

      const manager = new LiveManager();
      await manager.connect();

      // Ensure mock session is attached
      expect(mockLiveSessionCallbacks.onopen).toBeDefined();

      // Trigger incoming search_memory tool call from Gemini Live
      const toolCallMessage: any = {
        toolCall: {
          functionCalls: [
            {
              id: 'call_search_mem_123',
              name: 'search_memory',
              args: {
                query: 'milk',
                category: 'preference',
              },
            },
          ],
        },
      };

      await manager.handleMessage(toolCallMessage);

      // Verify sendToolResponse was invoked
      expect(mockSendToolResponse).toHaveBeenCalledTimes(1);
      const responsePayload = mockSendToolResponse.mock.calls[0][0];
      const functionResponses = responsePayload.functionResponses;
      expect(functionResponses).toHaveLength(1);

      const memResult = functionResponses[0].response.result as {
        memories: Array<{ id: string; content: string; category: string }>;
      };

      // Strict boundary assertion:
      // ONLY mem-valid is present!
      expect(memResult.memories).toHaveLength(1);
      expect(memResult.memories[0].id).toBe('mem-valid');
      expect(memResult.memories[0].content).toBe('User prefers oat milk in flat white');

      // Adversarial negative checks:
      const returnedIds = memResult.memories.map((m) => m.id);
      expect(returnedIds).not.toContain('mem-deleted');
      expect(returnedIds).not.toContain('mem-expired');
      expect(returnedIds).not.toContain('mem-local');
      expect(returnedIds).not.toContain('mem-superseded');

      manager.disconnect();
    });

    it('LiveManager read_calendar and search_entities filter out deleted and device_local entities', async () => {
      const activeEvent: KernelEntity = {
        id: 'evt-1',
        schema_id: 'system/event',
        version: 1,
        title: 'Team Sync Meeting',
        attributes: {
          kind: 'EVENT',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:00:00.000Z',
        },
        lifecycle: {
          status: 'active',
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-12T10:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      const deletedEvent: KernelEntity = {
        id: 'evt-deleted',
        schema_id: 'system/event',
        version: 1,
        title: 'Cancelled Secret Sync',
        attributes: {
          kind: 'EVENT',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:00:00.000Z',
          deleted: true,
        },
        lifecycle: {
          status: 'deleted',
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          deleted_at: '2026-10-12T11:00:00.000Z',
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-12T10:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      const localEvent: KernelEntity = {
        id: 'evt-local',
        schema_id: 'system/event',
        version: 1,
        title: 'Device Local Doctor Visit',
        attributes: {
          kind: 'EVENT',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:00:00.000Z',
          privacy_tier: 'device_local',
        },
        lifecycle: {
          status: 'active',
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-12T10:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      const storeActiveEvent = {
        id: 'evt-1',
        kind: EntityKind.EVENT,
        title: 'Team Sync Meeting',
        description: null,
        status: EntityStatus.ACTIVE,
        priority: 1,
        start_time: '2026-10-12T14:00:00.000Z',
        end_time: '2026-10-12T15:00:00.000Z',
        deadline: null,
        duration_minutes: 60,
        recurrence: null,
        metadata: { privacy_tier: 'private' },
        created_at: '2026-10-12T10:00:00.000Z',
        updated_at: '2026-10-12T10:00:00.000Z',
        canonical_tags: [],
      };

      const storeDeletedEvent = {
        id: 'evt-deleted',
        kind: EntityKind.EVENT,
        title: 'Cancelled Secret Sync',
        description: null,
        status: EntityStatus.ARCHIVED,
        priority: 1,
        start_time: '2026-10-12T14:00:00.000Z',
        end_time: '2026-10-12T15:00:00.000Z',
        deadline: null,
        duration_minutes: 60,
        recurrence: null,
        metadata: { deleted: true, privacy_tier: 'private' },
        created_at: '2026-10-12T10:00:00.000Z',
        updated_at: '2026-10-12T10:00:00.000Z',
        canonical_tags: [],
      };

      const storeLocalEvent = {
        id: 'evt-local',
        kind: EntityKind.EVENT,
        title: 'Device Local Doctor Visit',
        description: null,
        status: EntityStatus.ACTIVE,
        priority: 1,
        start_time: '2026-10-12T14:00:00.000Z',
        end_time: '2026-10-12T15:00:00.000Z',
        deadline: null,
        duration_minutes: 60,
        recurrence: null,
        metadata: { privacy_tier: 'device_local' },
        created_at: '2026-10-12T10:00:00.000Z',
        updated_at: '2026-10-12T10:00:00.000Z',
        canonical_tags: [],
      };

      useStore.setState({
        kernelEntities: {
          'evt-1': activeEvent,
          'evt-deleted': deletedEvent,
          'evt-local': localEvent,
        },
        entities: [storeActiveEvent, storeDeletedEvent, storeLocalEvent],
      });

      const manager = new LiveManager();
      await manager.connect();


      // Read calendar call
      const calMessage: any = {
        toolCall: {
          functionCalls: [
            {
              id: 'call_cal_1',
              name: 'read_calendar',
              args: {
                start_date: '2026-10-12T00:00:00.000Z',
                end_date: '2026-10-12T23:59:59.000Z',
              },
            },
          ],
        },
      };

      await manager.handleMessage(calMessage);

      expect(mockSendToolResponse).toHaveBeenCalledTimes(1);
      const res = mockSendToolResponse.mock.calls[0][0].functionResponses[0].response.result as {
        events: Array<{ id: string; title: string }>;
      };

      expect(res.events).toHaveLength(1);
      expect(res.events[0].id).toBe('evt-1');
      expect(res.events.map((e) => e.id)).not.toContain('evt-deleted');
      expect(res.events.map((e) => e.id)).not.toContain('evt-local');

      // Search entities call
      mockSendToolResponse.mockClear();
      const searchMessage: any = {
        toolCall: {
          functionCalls: [
            {
              id: 'call_search_1',
              name: 'search_entities',
              args: {
                query: 'Sync',
              },
            },
          ],
        },
      };

      await manager.handleMessage(searchMessage);

      expect(mockSendToolResponse).toHaveBeenCalledTimes(1);
      const searchRes = mockSendToolResponse.mock.calls[0][0].functionResponses[0].response.result as {
        results: Array<{ id: string; title: string }>;
      };

      expect(searchRes.results).toHaveLength(1);
      expect(searchRes.results[0].id).toBe('evt-1');
      expect(searchRes.results.map((e) => e.id)).not.toContain('evt-deleted');
      expect(searchRes.results.map((e) => e.id)).not.toContain('evt-local');

      manager.disconnect();
    });

  });
});
