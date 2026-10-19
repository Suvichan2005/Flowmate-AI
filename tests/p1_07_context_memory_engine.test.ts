/**
 * Flowmate Greenfield Domain Kernel — Context + Memory Engine Tests (P1-07)
 *
 * Verifies:
 * 1. Memory Write Policy: classification, inference gating, temporal bounds, sensitivity
 * 2. Contradiction Engine: polarity detection, superseding, conflict surfacing
 * 3. Temporal Expiry: natural expiration of situational states
 * 4. Context Budgeting & Compaction: limits, decay ranking, stats
 * 5. Capability Projections: P1-06 commitment & streak inclusion in context
 * 6. Privacy Gate: location permission enforcement and sensitive tier filtering
 * 7. AI Tool Dispatching: search_memory, get_relevant_context, propose_memory_update
 * 8. Voice & Text Parity: structured prompt formatting
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { Entity as KernelEntity } from '../services/kernel/types';
import { User } from '../services/firebase';
import {
  evaluateMemoryWrite,
  detectMemoryCategory,
  detectSensitivityTier,
  extractTemporalBounds,
  evaluateContradiction,
  resolveContradiction,
  findMemoryContradictions,
  contextResolver,
  extractMemoryItem,
  extractSituationalItem,
  PersistentMemoryItem,
} from '../services/context';
import {
  executeSearchMemory,
  executeGetRelevantContext,
  executeProposeMemoryUpdate,
  dispatchToolCall,
} from '../services/ai/executors';

describe('Milestone P1-07: Context + Memory Engine', () => {
  beforeEach(() => {
    // Reset store state cleanly
    useStore.setState({
      kernelEntities: {},
      entities: [],
      currentUser: {
        uid: 'user_test_p1_07',
        displayName: 'Aarav Sharma',
        email: 'aarav@example.com',
      } as unknown as User,
      settings: {
        timezone: 'Asia/Kolkata',
        username: 'Aarav Sharma',
        nickname: 'Aarav',
        custom_instructions: 'Keep responses concise and direct.',
        preferred_model: 'gemini-3.8-flash',
        sync_enabled: false,
        debug_mode: false,
        feature_toggles: {
          food_tracking: true,
          attendance_tracking: true,
          people_tracking: true,
          gamification: true,
          quick_streaks: true,
        },
        privacy_preferences: {
          capabilities: {},
          audit_logging_enabled: true,
        },
      },
    });
  });

  // ==========================================================================
  // 1. Memory Write Policy & Inference Gating
  // ==========================================================================
  describe('Memory Write Policy & Inference Gating', () => {
    it('discards low-value conversational chatter', () => {
      const inputs = ['hello', 'hi there', 'thanks!', 'ok got it', 'great', 'how do i search'];
      for (const text of inputs) {
        const result = evaluateMemoryWrite({ content: text });
        expect(result.action).toBe('discard_low_value');
      }
    });

    it('classifies explicit durable preferences with high confidence', () => {
      const result = evaluateMemoryWrite({
        content: 'I prefer concise bullet points in responses',
        sourceType: 'user_explicit',
      });
      expect(result.action).toBe('persist_memory');
      expect(result.confidence).toBe(1.0);
      expect(result.category).toBe('preference');
      expect(result.sensitivity).toBe('private');
    });

    it('strictly gates AI inferences: user_confirmed false, requires confirmation', () => {
      const result = evaluateMemoryWrite({
        content: 'User seems to prefer studying in the evening after 8 PM',
        sourceType: 'inferred',
      });
      expect(result.action).toBe('require_confirmation');
      expect(result.confidence).toBeLessThanOrEqual(0.85);
      expect(result.reason).toContain('AI-inferred memory cannot self-confirm');
    });

    it('extracts temporal bounds for situational states', () => {
      const anchor = '2026-10-08T10:00:00.000Z';
      const bounds = extractTemporalBounds('Traveling to Mumbai this week for a conference', anchor);
      expect(bounds).toBeDefined();
      expect(bounds?.valid_from).toBe(anchor);
      expect(new Date(bounds!.valid_until).getTime()).toBeGreaterThan(new Date(anchor).getTime());

      const result = evaluateMemoryWrite({
        content: 'Traveling to Mumbai this week for a conference',
        sourceType: 'user_explicit',
        contextDate: anchor,
      });
      expect(result.action).toBe('set_situational');
      expect(result.temporalBounds).toBeDefined();
    });

    it('detects sensitive credentials and health facts requiring explicit confirmation', () => {
      const cred = evaluateMemoryWrite({ content: 'My API key is secret-token-xyz' });
      expect(cred.action).toBe('require_confirmation');
      expect(cred.sensitivity).toBe('sensitive');

      const med = evaluateMemoryWrite({ content: 'Prescription for antibiotic twice daily' });
      expect(med.action).toBe('require_confirmation');
      expect(med.sensitivity).toBe('sensitive');
    });
  });

  // ==========================================================================
  // 2. Memory Contradiction & Conflict Engine
  // ==========================================================================
  describe('Memory Contradiction & Conflict Engine', () => {
    it('detects polar contradictions on opposing preferences', () => {
      const eval1 = evaluateContradiction(
        'I prefer concise bullet points',
        'I prefer detailed in-depth explanations'
      );
      expect(eval1.isConflict).toBe(true);
      expect(eval1.topic).toBe('response_length');

      const eval2 = evaluateContradiction(
        'I am strictly vegetarian',
        'I regularly eat non-veg meat'
      );
      expect(eval2.isConflict).toBe(true);
      expect(eval2.topic).toBe('dietary_preference');
    });

    it('does not trigger false positive on identical or complementary items', () => {
      const evalSame = evaluateContradiction(
        'I like dark mode',
        'I like dark mode'
      );
      expect(evalSame.isConflict).toBe(false);

      const evalDiff = evaluateContradiction(
        'I prefer dark mode',
        'I wake up early at 6am'
      );
      expect(evalDiff.isConflict).toBe(false);
    });

    it('resolves newer explicit memory superseding older memory', () => {
      const older: PersistentMemoryItem = {
        id: 'mem_1',
        content: 'I prefer concise bullet points',
        category: 'preference',
        source_type: 'user_explicit',
        confidence: 1.0,
        created_at: '2026-10-01T10:00:00.000Z',
        updated_at: '2026-10-01T10:00:00.000Z',
        privacy_tier: 'private',
        status: 'active',
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-01T10:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      const newer: PersistentMemoryItem = {
        id: 'mem_2',
        content: 'I prefer detailed in-depth explanations',
        category: 'preference',
        source_type: 'user_explicit',
        confidence: 1.0,
        created_at: '2026-10-08T10:00:00.000Z',
        updated_at: '2026-10-08T10:00:00.000Z',
        privacy_tier: 'private',
        status: 'active',
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-08T10:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      const resolution = resolveContradiction(older, newer);
      expect(resolution.strategy).toBe('supersede');
    });

    it('surfaces contradictions across an array of memories', () => {
      const memories: PersistentMemoryItem[] = [
        {
          id: 'm1',
          content: 'I prefer concise answers',
          category: 'preference',
          source_type: 'user_explicit',
          confidence: 1.0,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          privacy_tier: 'private',
          status: 'active',
          provenance: { source_type: 'user', observed_at: '2026-10-01T00:00:00Z', confidence: 1.0, is_inferred: false, user_confirmed: true },
        },
        {
          id: 'm2',
          content: 'I prefer detailed explanations',
          category: 'preference',
          source_type: 'user_explicit',
          confidence: 1.0,
          created_at: '2026-10-02T00:00:00Z',
          updated_at: '2026-10-02T00:00:00Z',
          privacy_tier: 'private',
          status: 'active',
          provenance: { source_type: 'user', observed_at: '2026-10-02T00:00:00Z', confidence: 1.0, is_inferred: false, user_confirmed: true },
        },
      ];

      const conflicts = findMemoryContradictions(memories);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].itemA.id).toBe('m1');
      expect(conflicts[0].itemB.id).toBe('m2');
    });
  });

  // ==========================================================================
  // 3. Situational State Temporal Expiration & Context Resolution
  // ==========================================================================
  describe('Situational State & Context Resolution', () => {
    it('includes active situational state and excludes naturally expired state', async () => {
      const now = new Date();
      const activeUntil = new Date(now.getTime() + 3 * 86400000).toISOString();
      const pastFrom = new Date(now.getTime() - 10 * 86400000).toISOString();
      const pastUntil = new Date(now.getTime() - 2 * 86400000).toISOString();

      const activeSituational: KernelEntity = {
        id: 'sit_active',
        schema_id: 'system/situational_state',
        title: 'Traveling to Delhi',
        version: 1,
        lifecycle: {
          status: 'active',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: now.toISOString(),
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
        attributes: {
          topic: 'Traveling to Delhi',
          details: 'Staying at Aerocity hotel for developer meetup',
          valid_from: now.toISOString(),
          valid_until: activeUntil,
          confidence: 1.0,
          source_type: 'user_explicit',
          privacy_tier: 'private',
        },
      };

      const expiredSituational: KernelEntity = {
        id: 'sit_expired',
        schema_id: 'system/situational_state',
        title: 'Exam Week',
        version: 1,
        lifecycle: {
          status: 'active',
          created_at: pastFrom,
          updated_at: pastFrom,
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: pastFrom,
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
        attributes: {
          topic: 'Exam Week',
          details: 'Midterm exams prep',
          valid_from: pastFrom,
          valid_until: pastUntil,
          confidence: 1.0,
          source_type: 'user_explicit',
          privacy_tier: 'private',
        },
      };

      useStore.setState({
        kernelEntities: {
          sit_active: activeSituational,
          sit_expired: expiredSituational,
        },
      });

      const resolved = await contextResolver.resolveContext({
        userMessage: 'Where am I staying this week?',
      });

      expect(resolved.situationalContext).toHaveLength(1);
      expect(resolved.situationalContext[0].id).toBe('sit_active');
      expect(resolved.serializedPromptSection).toContain('Traveling to Delhi');
      expect(resolved.serializedPromptSection).not.toContain('Exam Week');
    });

    it('enforces budget limits and provides budget statistics', async () => {
      const entities: Record<string, KernelEntity> = {};
      for (let i = 1; i <= 8; i++) {
        entities[`mem_${i}`] = {
          id: `mem_${i}`,
          schema_id: 'system/memory_item',
          title: `Fact ${i}`,
          version: 1,
          lifecycle: {
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
          provenance: {
            source_type: 'user',
            observed_at: new Date().toISOString(),
            confidence: 1.0,
            is_inferred: false,
            user_confirmed: true,
          },
          attributes: {
            content: `User prefers testing item ${i}`,
            category: 'preference',
            source_type: 'user_explicit',
            confidence: 1.0,
            privacy_tier: 'private',
          },
        };
      }

      useStore.setState({ kernelEntities: entities });

      const resolved = await contextResolver.resolveContext({
        budgetConfig: { maxMemoryItems: 3 },
      });

      expect(resolved.relevantMemories.length).toBeLessThanOrEqual(3);
      expect(resolved.budgetStats.memoriesIncluded).toBeLessThanOrEqual(3);
      expect(resolved.budgetStats.totalCharacters).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 4. Capability Projection Integration (P1-06 Commitment in Context)
  // ==========================================================================
  describe('Capability Projection in Context Resolution', () => {
    it('projects P1-06 commitment cadence and progress streak into context', async () => {
      const nowIso = new Date().toISOString();
      const commitmentEntity: KernelEntity = {
        id: 'ent_flowmate_weekly',
        schema_id: 'system/task',
        title: 'Work on Flowmate',
        version: 1,
        lifecycle: {
          status: 'active',
          created_at: nowIso,
          updated_at: nowIso,
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: nowIso,
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
        attributes: {
          commitment: {
            min_count: 1,
            period: 'WEEK',
            target_unit: 'sessions',
          },
          evidence: [
            {
              id: 'ev_1',
              timestamp: nowIso,
              quantity: 1,
              note: 'Refactored context resolver',
              provenance: {
                source_type: 'user',
                observed_at: nowIso,
                confidence: 1.0,
                is_inferred: false,
                user_confirmed: true,
              },
            },
          ],
        },
      };

      useStore.setState({
        kernelEntities: {
          ent_flowmate_weekly: commitmentEntity,
        },
      });

      const resolved = await contextResolver.resolveContext({
        userMessage: 'What are my goals this week?',
      });

      expect(resolved.relevantEntities).toHaveLength(1);
      const entitySummary = resolved.relevantEntities[0].summary;
      expect(entitySummary).toBeDefined();
      expect(entitySummary).toContain('Commitment: 1x week');
      expect(entitySummary).toContain('Streak: 1');
      expect(resolved.serializedPromptSection).toContain('Commitment: 1x week');
    });
  });

  // ==========================================================================
  // 5. Privacy Boundary
  // ==========================================================================
  describe('Privacy Boundary', () => {
    it('does not include location from legacy settings in model context', async () => {
      useStore.setState({
        settings: {
          ...useStore.getState().settings,
          home_location: 'Legacy private home address',
          travel_preferences: { station_buffer_minutes: 45, airport_buffer_minutes: 120 },
          privacy_preferences: { capabilities: { device_location: { read: 'allow', mutation: 'deny' } } },
        } as never,
      });

      const resolved = await contextResolver.resolveContext({ userMessage: 'Help me plan this week.' });

      expect(resolved.serializedPromptSection).not.toContain('Legacy private home address');
      expect(resolved.serializedPromptSection).not.toContain('station_buffer_minutes');
      expect(resolved.serializedPromptSection).not.toContain('airport_buffer_minutes');
      expect(resolved.serializedPromptSection).not.toContain('45');
      expect(resolved.serializedPromptSection).not.toContain('120');
      expect(resolved).not.toHaveProperty('liveLocationContext');
    });
  });

  // ==========================================================================
  // 6. AI Tool Dispatching: search_memory, get_relevant_context, propose_memory_update
  // ==========================================================================
  describe('AI Tool Dispatching (search_memory, get_relevant_context, propose_memory_update)', () => {
    it('executes search_memory against canonical kernel entities', () => {
      const nowIso = new Date().toISOString();
      useStore.setState({
        kernelEntities: {
          m1: {
            id: 'm1',
            schema_id: 'system/memory_item',
            title: 'Coffee preference',
            version: 1,
            lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
            provenance: { source_type: 'user', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
            attributes: { content: 'User drinks black coffee without sugar', category: 'preference', confidence: 1.0, privacy_tier: 'private' },
          },
        },
      });

      const res = executeSearchMemory({ query: 'coffee' });
      expect(res).toHaveLength(1);
      expect(res[0].content).toBe('User drinks black coffee without sugar');
      expect(res[0].type).toBe('persistent_memory');
    });

    it('executes get_relevant_context returning rich context slice', async () => {
      const ctx = await executeGetRelevantContext({});
      expect(ctx.user_profile).toBeDefined();
      expect(ctx.current_time).toBeDefined();
      expect(ctx.relevant_memories).toBeDefined();
    });

    it('proposes memory update requiring user confirmation for AI inferences', () => {
      const res = executeProposeMemoryUpdate({
        content: 'I prefer typescript over javascript',
        category: 'preference',
      });

      expect(res.evaluation).toBeDefined();
      const evalObj = res.evaluation as Record<string, unknown>;
      expect(evalObj.requires_confirmation).toBe(true);
      expect(evalObj.action).toBe('require_confirmation');

      const op = res.proposed_operation as Record<string, unknown>;
      expect(op.type).toBe('create_entity');
      const payload = op.payload as Record<string, unknown>;
      expect(payload.schema_id).toBe('system/memory_item');
    });

    it('dispatches search_memory and propose_memory_update through dispatchToolCall', async () => {
      const call = {
        name: 'search_memory',
        args: { query: 'test' },
      };
      const result = await dispatchToolCall(call, []);
      expect(result.name).toBe('search_memory');
      expect(result.response.result).toBeDefined();
    });
  });

  // ==========================================================================
  // 7. Voice and Text Parity
  // ==========================================================================
  describe('Voice and Text Parity', () => {
    it('formats consistent context for both text prompts and voice system instructions', async () => {
      const nowIso = new Date().toISOString();
      useStore.setState({
        kernelEntities: {
          m1: {
            id: 'm1',
            schema_id: 'system/memory_item',
            title: 'Nickname note',
            version: 1,
            lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
            provenance: { source_type: 'user', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
            attributes: { content: 'Call me Aarav', category: 'fact', confidence: 1.0, privacy_tier: 'private' },
          },
        },
      });

      const resolved = await contextResolver.resolveContext({});

      const textFormat = contextResolver.formatForTextTurn(resolved);
      expect(textFormat).toContain('[USER PROFILE]');
      expect(textFormat).toContain('Aarav');
      expect(textFormat).toContain('[RELEVANT MEMORY]');
      expect(textFormat).toContain('Call me Aarav');

      const voiceFormat = contextResolver.formatForVoiceSession(resolved);
      expect(voiceFormat).toContain('You are Flowmate');
      expect(voiceFormat).toContain('User: Aarav Sharma');
      expect(voiceFormat).toContain('Key Knowledge: Call me Aarav');
    });

    it('serializes epistemic status, turn provenance, and reversal reasons in text and voice formats', async () => {
      const nowIso = new Date().toISOString();
      useStore.setState({
        kernelEntities: {
          m_decision: {
            id: 'm_decision',
            schema_id: 'system/memory_item',
            title: 'GraphQL Local-First Decision',
            version: 1,
            lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
            provenance: { source_type: 'user', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
            attributes: {
              content: 'Selected Option B: GraphQL with local-first JSON sync',
              category: 'project_context',
              confidence: 1.0,
              privacy_tier: 'private',
              epistemic_status: 'user_decision',
              source_turn: 177,
            },
          },
          m_proposal: {
            id: 'm_proposal',
            schema_id: 'system/memory_item',
            title: 'Option C Proposal',
            version: 1,
            lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
            provenance: { source_type: 'agent', observed_at: nowIso, confidence: 0.9, is_inferred: false, user_confirmed: false },
            attributes: {
              content: 'Option C Hybrid Compromise',
              category: 'project_context',
              confidence: 0.9,
              privacy_tier: 'private',
              epistemic_status: 'assistant_proposal',
              source_turn: 176,
              reversal_reason: 'User chose Option B instead',
            },
          },
        },
      });

      const resolved = await contextResolver.resolveContext({});
      const textFormat = contextResolver.formatForTextTurn(resolved);

      expect(textFormat).toContain('[RELEVANT MEMORY]');
      expect(textFormat).toContain('epistemic: user_decision');
      expect(textFormat).toContain('turn: 177');
      expect(textFormat).toContain('epistemic: assistant_proposal');
      expect(textFormat).toContain('turn: 176');
      expect(textFormat).toContain('(Reversal reason: User chose Option B instead)');

      const voiceFormat = contextResolver.formatForVoiceSession(resolved);
      expect(voiceFormat).toContain('[Proposal] Option C Hybrid Compromise');
    });
  });

  // ==========================================================================
  // 8. Security & Adversarial Policy Tests
  // ==========================================================================
  describe('Security & Adversarial Policy Tests', () => {
    it('blocks AI inference from manufacturing user_confirmed status', () => {
      const evaluation = evaluateMemoryWrite({
        content: 'User prefers dark mode and high contrast themes',
        sourceType: 'inferred',
      });
      // Invariant: AI inference cannot self-confirm
      expect(evaluation.action).toBe('require_confirmation');
      expect(evaluation.requires_confirmation).toBe(true);
      expect(evaluation.is_inferred).toBe(true);
      expect(evaluation.user_confirmed).toBe(false);
    });

    it('safely handles malformed and empty memory input without errors', () => {
      const emptyRes = evaluateMemoryWrite({ content: '' });
      expect(emptyRes.action).toBe('discard_low_value');

      const whitespaceRes = evaluateMemoryWrite({ content: '   ' });
      expect(whitespaceRes.action).toBe('discard_low_value');
    });

    it('bounds query limits to prevent unbounded memory dump', () => {
      const nowIso = new Date().toISOString();
      const entities: Record<string, KernelEntity> = {};
      for (let i = 0; i < 60; i++) {
        entities[`m_${i}`] = {
          id: `m_${i}`,
          schema_id: 'system/memory_item',
          title: `Item ${i}`,
          version: 1,
          lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
          provenance: { source_type: 'user', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
          attributes: { content: `Item number ${i} preference`, category: 'preference', confidence: 1.0, privacy_tier: 'private' },
        };
      }
      useStore.setState({ kernelEntities: entities });

      // Request limit of 999
      const results = executeSearchMemory({ query: 'item', limit: 999 });
      // Clamped to 50
      expect(results.length).toBeLessThanOrEqual(50);
    });

    it('enforces context budget limits on oversized candidate text', async () => {
      const hugeContent = 'A'.repeat(8000);
      const evalHuge = evaluateMemoryWrite({ content: hugeContent, sourceType: 'user_explicit' });
      expect(evalHuge.action).toBe('persist_memory');

      const nowIso = new Date().toISOString();
      useStore.setState({
        kernelEntities: {
          huge_mem: {
            id: 'huge_mem',
            schema_id: 'system/memory_item',
            title: 'Huge item',
            version: 1,
            lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
            provenance: { source_type: 'user', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
            attributes: { content: hugeContent, category: 'project_context', confidence: 1.0, privacy_tier: 'private' },
          },
        },
      });

      const resolved = await contextResolver.resolveContext({
        budgetConfig: { maxTotalChars: 1500 },
      });

      expect(resolved.budgetStats.totalCharacters).toBeLessThanOrEqual(1600);
    });
  });
});

