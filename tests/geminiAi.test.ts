/**
 * Gemini AI Integration Architecture Tests
 * 
 * Regression protection tests for:
 * 1. Default model configuration (Gemini 3.8 Flash)
 * 2. Real-time Live model configuration (Gemini 3.8 Live)
 * 3. Tool schemas and FLOWMATE_TOOLS function declarations
 * 4. Tool executor dispatch for read tools
 * 5. Prompt builders (briefing, text improvement)
 * 6. Multi-modal and rolling history context creation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { User } from '../services/firebase';
import { DEFAULT_MODEL, AI_MODELS, GEMINI_RETRY_CONFIG, HISTORY_WINDOW } from '../services/ai/client';
import { FLOWMATE_TOOLS } from '../services/ai/tools';
import { dispatchToolCall, calculateRelevance } from '../services/ai/executors';
import { buildBriefingPrompt, IMPROVEMENT_INSTRUCTIONS } from '../services/ai/prompts';
import { buildHistory, summarizeOlderMessages, buildEntityContext } from '../services/ai/context';
import { EntityKind, EntityStatus, Entity, Message } from '../types';

describe('Gemini AI Model Configurations', () => {
    it('uses gemini-3.8-flash as the default text and tool orchestration model', () => {
        expect(DEFAULT_MODEL).toBe('gemini-3.8-flash');
        expect(AI_MODELS.BALANCED).toBe('gemini-3.8-flash');
    });

    it('defines authoritative model IDs for all tiers', () => {
        expect(AI_MODELS.FAST_LITE).toBe('gemini-3.5-flash-lite');
        expect(AI_MODELS.BALANCED).toBe('gemini-3.8-flash');
        expect(AI_MODELS.REASONING).toBe('gemini-3.1-pro-preview');
        expect(AI_MODELS.LIVE).toBe('gemini-3.8-live');
    });

    it('has standard retry configuration with jitter and exponential backoff', () => {
        expect(GEMINI_RETRY_CONFIG.maxRetries).toBe(3);
        expect(GEMINI_RETRY_CONFIG.retryableStatusCodes).toContain(429);
        expect(GEMINI_RETRY_CONFIG.retryableStatusCodes).toContain(503);
    });
});

describe('Gemini Tool Declarations (FLOWMATE_TOOLS)', () => {
    it('bundles all 12 supported function declarations including greenfield query & reflect tools', () => {
        expect(FLOWMATE_TOOLS).toHaveLength(1);
        const decls = FLOWMATE_TOOLS[0].functionDeclarations;
        expect(decls).toBeDefined();
        expect(decls?.length).toBe(12);

        const names = decls?.map(d => d.name);
        expect(names).toContain('query_entities');
        expect(names).toContain('reflect_schemas');
        expect(names).toContain('query_commitment');
        expect(names).toContain('configure_commitment');
        expect(names).toContain('record_commitment_evidence');
        expect(names).toContain('read_calendar');
        expect(names).toContain('search_entities');
        expect(names).toContain('lookup_food_history');
        expect(names).toContain('get_productivity_stats');
        expect(names).toContain('lookup_goals');
        expect(names).toContain('lookup_habits');
        expect(names).not.toContain('lookup_travel_route');
        expect(names).toContain('apply_changes');
    });

    it('ensures apply_changes is configured with ops and explanation parameters', () => {
        const decls = FLOWMATE_TOOLS[0].functionDeclarations!;
        const applyTool = decls.find(d => d.name === 'apply_changes');
        expect(applyTool).toBeDefined();
        expect(applyTool?.parameters?.required).toContain('ops');
        expect(applyTool?.parameters?.required).toContain('explanation');
    });
});

describe('Tool Executors Dispatch', () => {
    const mockEntities: Entity[] = [
        {
            id: 'g-1',
            kind: EntityKind.GOAL,
            title: 'Learn AI Engineering',
            description: 'Master Gemini and Agentic systems',
            status: EntityStatus.ACTIVE,
            priority: 5,
            start_time: null,
            end_time: null,
            deadline: '2026-12-31T00:00:00Z',
            duration_minutes: null,
            recurrence: null,
            canonical_tags: ['ai', 'learning'],
            metadata: { progress: 45 },
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
        },
        {
            id: 'h-1',
            kind: EntityKind.HABIT,
            title: 'Daily Code Practice',
            description: null,
            status: EntityStatus.ACTIVE,
            priority: 3,
            start_time: null,
            end_time: null,
            deadline: null,
            duration_minutes: 30,
            recurrence: 'DAILY',
            canonical_tags: ['coding'],
            metadata: { streak_current: 14, last_completed_at: '2026-10-05T00:00:00Z' },
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-10-05T00:00:00Z',
        },
    ];

    beforeEach(() => {
        useStore.setState({
            currentUser: {
                uid: 'gemini-test-user',
                email: 'test@flowmate.ai',
                displayName: 'Gemini Tester',
            } as unknown as User,
        });
    });

    it('dispatches lookup_goals correctly against in-memory snapshot', async () => {
        const result = await dispatchToolCall({ name: 'lookup_goals', args: { status: 'ACTIVE' } }, mockEntities);
        expect(result.name).toBe('lookup_goals');
        expect(result.response.result).toHaveLength(1);
        expect(result.response.result[0].title).toBe('Learn AI Engineering');
        expect(result.response.result[0].progress).toBe(45);
    });

    it('dispatches lookup_habits correctly with streaks', async () => {
        const result = await dispatchToolCall({ name: 'lookup_habits', args: { include_streaks: true } }, mockEntities);
        expect(result.name).toBe('lookup_habits');
        expect(result.response.result).toHaveLength(1);
        expect(result.response.result[0].title).toBe('Daily Code Practice');
        expect(result.response.result[0].streak).toBe(14);
    });

    it('dispatches search_entities by query term', async () => {
        const result = await dispatchToolCall({ name: 'search_entities', args: { query: 'Engineering' } }, mockEntities);
        expect(result.name).toBe('search_entities');
        expect(result.response.result).toHaveLength(1);
        expect(result.response.result[0].id).toBe('g-1');
    });

    it('dispatches reflect_schemas correctly', async () => {
        const result = await dispatchToolCall({ name: 'reflect_schemas', args: { scope: 'system' } }, mockEntities);
        expect(result.name).toBe('reflect_schemas');
        expect(result.response.result).toBeDefined();
        const schemas = result.response.result?.schemas;
        expect(Array.isArray(schemas)).toBe(true);
        expect(schemas!.length).toBeGreaterThan(0);
        expect(schemas!.some((s: { id?: string }) => s.id === 'system/task')).toBe(true);
    });

    it('dispatches query_entities with query and schema filter', async () => {
        const result = await dispatchToolCall({ name: 'query_entities', args: { query: 'Engineering', schema_id: 'system/goal' } }, mockEntities);
        expect(result.name).toBe('query_entities');
        expect(result.response.result).toBeDefined();
        expect(result.response.result?.total_matched).toBe(1);
        const entities = result.response.result?.entities;
        expect(entities).toBeDefined();
        expect(entities![0].id).toBe('g-1');
        expect(entities![0].schema_id).toBe('system/goal');
    });

    it('returns error response for unregistered tools', async () => {
        const result = await dispatchToolCall({ name: 'unknown_tool', args: {} }, mockEntities);
        expect(result.name).toBe('unknown_tool');
        expect(result.response.error).toBeDefined();
    });
});

describe('AI Context & History Building', () => {
    it('builds Content array preserving user/assistant roles and attachment metadata', () => {
        const messages: Message[] = [
            { id: '1', role: 'user', text: 'Hello AI', created_at: '2026-10-06T10:00:00Z' },
            { id: '2', role: 'assistant', text: 'Hello User!', created_at: '2026-10-06T10:01:00Z' },
            { id: '3', role: 'user', text: 'Here is an image', created_at: '2026-10-06T10:02:00Z' },
        ];

        const history = buildHistory(messages, null, 'data:image/png;base64,iVBORw0KGgo=');
        expect(history).toHaveLength(3);
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('model');
        expect(history[2].role).toBe('user');
        // Last user message should include image attachment
        expect(history[2].parts).toHaveLength(2);
        expect((history[2].parts[1] as any).inlineData.mimeType).toBe('image/png');
    });

    it('prepends rolling conversation summary when available', () => {
        const messages: Message[] = [
            { id: '1', role: 'user', text: 'Recent message', created_at: '2026-10-06T10:00:00Z' },
        ];
        const summary = 'User previously worked on Machine Learning project.';
        const history = buildHistory(messages, summary);

        expect(history).toHaveLength(3);
        expect((history[0].parts[0] as any).text).toContain('[Previous conversation context]');
        expect(history[1].role).toBe('model');
        expect(history[2].role).toBe('user');
    });

    it('keeps rejected turns as transcript records without replaying them into later context', () => {
        const messages: Message[] = [
            { id: '1', role: 'user', text: 'Keep this successful context', status: 'completed', created_at: '2026-10-06T10:00:00Z' },
            { id: '2', role: 'assistant', text: 'This answer stays in context', status: 'completed', created_at: '2026-10-06T10:01:00Z' },
            { id: '3', role: 'user', text: 'Rejected prompt must remain visible but not be replayed', status: 'failed', turn_metadata: { managed_failure: { code: 'MODEL_CONTEXT_LIMIT', outcome: 'not_sent' } }, created_at: '2026-10-06T10:02:00Z' },
            { id: '4', role: 'assistant', text: '', status: 'failed', turn_metadata: { response_source: 'unavailable' }, created_at: '2026-10-06T10:03:00Z' },
            { id: '5', role: 'user', text: 'New question', status: 'in_flight', created_at: '2026-10-06T10:04:00Z' },
        ];

        const history = buildHistory(messages, null);
        const text = history.flatMap(entry => entry.parts || []).map(part => 'text' in part ? part.text : '').join('\n');
        expect(history.map(entry => entry.role)).toEqual(['user', 'model', 'user']);
        expect(text).toContain('Keep this successful context');
        expect(text).toContain('This answer stays in context');
        expect(text).toContain('New question');
        expect(text).not.toContain('Rejected prompt');
    });

    it('does not let rejected prompts contaminate rolling summaries', () => {
        const messages: Message[] = [
            { id: 'rejected', role: 'user', text: 'create task schedule food deadline', status: 'failed', turn_metadata: { managed_failure: { code: 'MODEL_CONTEXT_LIMIT', outcome: 'not_sent' } }, created_at: '2026-10-06T09:00:00Z' },
            ...Array.from({ length: HISTORY_WINDOW }, (_, index) => ({
                id: `ok-${index}`,
                role: 'user' as const,
                text: `Ordinary conversation ${index}`,
                status: 'completed' as const,
                created_at: new Date(Date.UTC(2026, 9, 6, 10, index)).toISOString(),
            })),
        ];
        expect(summarizeOlderMessages(messages)).toBeNull();
    });
});

describe('Prompts & Text Improvement Instructions', () => {
    it('defines text transformation instructions for all 4 improvement types', () => {
        expect(IMPROVEMENT_INSTRUCTIONS.fix_grammar).toBeDefined();
        expect(IMPROVEMENT_INSTRUCTIONS.make_professional).toBeDefined();
        expect(IMPROVEMENT_INSTRUCTIONS.expand).toBeDefined();
        expect(IMPROVEMENT_INSTRUCTIONS.summarize).toBeDefined();
    });

    it('builds motivating briefing prompt with time and timezone context', () => {
        const prompt = buildBriefingPrompt({
            timeContext: 'Tuesday, October 6, 2026 at 9:00 AM',
            timezone: 'Asia/Kolkata',
            activeTasks: [{ title: 'Code Review', priority: 4 }],
            eventsToday: [{ title: 'Team Standup', time: '10:00 AM' }],
        });

        expect(prompt).toContain('Tuesday, October 6, 2026 at 9:00 AM');
        expect(prompt).toContain('Asia/Kolkata');
        expect(prompt).toContain('Code Review');
        expect(prompt).toContain('Team Standup');
    });
});
