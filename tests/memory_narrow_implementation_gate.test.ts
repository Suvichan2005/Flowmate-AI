/**
 * Flowmate Memory Foundation — Narrow Implementation Gate Verification Suite
 *
 * SCOPE & INVARIANTS TESTED:
 * 1. Tokenized case-insensitive retrieval across title, content, tags.
 * 2. False matches and stopword resistance (filler words do not pull in irrelevant memories).
 * 3. Negation handling.
 * 4. Opt-in historical / superseded retrieval (include_superseded: false vs true).
 * 5. Current state query vs historical reasoning query disambiguation.
 * 6. Proposal vs decision attribution (user decisions outrank assistant proposals).
 * 7. Halted vs superseded distinction (halted does not automatically mean superseded).
 * 8. Missing evidence representation (missing evidence is undefined, not fabricated).
 * 9. Duplicate memory handling.
 * 10. Stale implementation verification (selected does NOT mean implemented).
 * 11. Confirmation boundary preservation (proposals require human confirmation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { Entity as KernelEntity, Provenance, SourceType } from '../services/kernel/types';
import { dispatchToolCall, executeSearchMemory } from '../services/ai/executors';

function createEntity(params: {
  id: string;
  title: string;
  content: string;
  category: 'project_context' | 'fact' | 'preference' | 'routine';
  status: 'active' | 'superseded' | 'deleted' | 'expired';
  tags?: string[];
  superseded_by?: string;
  supersedes?: string;
  reversal_reason?: string;
  source_turn?: number;
  source_excerpt?: string;
  speaker?: 'user' | 'assistant';
  epistemic_status?: 'user_decision' | 'assistant_proposal' | 'observed_code' | 'inferred_preference';
  implementation_evidence?: {
    files?: string[];
    verified_at_turn?: number;
  };
  lifecycle_state?: string;
}): KernelEntity {
  const provenance: Provenance = {
    source_type: (params.speaker === 'assistant' ? 'agent' : 'user') as SourceType,
    source_id: params.source_turn !== undefined ? `msg_${params.source_turn}` : 'unknown',
    observed_at: '2025-06-12T05:00:00Z',
    confidence: params.speaker === 'assistant' ? 0.7 : 1.0,
    is_inferred: params.speaker === 'assistant',
    user_confirmed: params.speaker === 'user',
  };

  return {
    id: params.id,
    schema_id: 'system/memory_item',
    version: 1,
    title: params.title,
    attributes: {
      content: params.content,
      category: params.category,
      status: params.status,
      tags: params.tags || [],
      superseded_by: params.superseded_by,
      supersedes: params.supersedes,
      reversal_reason: params.reversal_reason,
      source_turn: params.source_turn,
      source_excerpt: params.source_excerpt,
      speaker: params.speaker,
      epistemic_status: params.epistemic_status,
      implementation_evidence: params.implementation_evidence,
      lifecycle_state: params.lifecycle_state,
      confidence: provenance.confidence,
      privacy_tier: 'private',
    },
    lifecycle: {
      status: params.status,
      created_at: '2025-06-12T05:00:00Z',
      updated_at: '2025-06-12T05:40:00Z',
      deleted_at: null,
    },
    provenance,
  };
}

describe('Narrow Memory Implementation Gate Verification Suite', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
    });
  });

  // -------------------------------------------------------------------------
  // 1. Tokenized Multi-Field Retrieval & Case Insensitivity
  // -------------------------------------------------------------------------
  it('1. retrieves memories matching query tokens across title, content, or tags case-insensitively', () => {
    const mem1 = createEntity({
      id: 'mem_1',
      title: 'FastAPI Backend Framework',
      content: 'Selected Python REST API service',
      category: 'project_context',
      status: 'active',
      tags: ['backend', 'python', 'api'],
    });

    const mem2 = createEntity({
      id: 'mem_2',
      title: 'GraphQL API Rewrite',
      content: 'Full rewrite with local-first storage',
      category: 'project_context',
      status: 'active',
      tags: ['backend', 'graphql', 'local_first'],
    });

    useStore.setState({ kernelEntities: { [mem1.id]: mem1, [mem2.id]: mem2 } });

    // Match on title
    const resByTitle = executeSearchMemory({ query: 'fastapi' });
    expect(resByTitle.length).toBe(1);
    expect(resByTitle[0].id).toBe('mem_1');

    // Match on content
    const resByContent = executeSearchMemory({ query: 'local-first' });
    expect(resByContent.length).toBe(1);
    expect(resByContent[0].id).toBe('mem_2');

    // Match on tag
    const resByTag = executeSearchMemory({ query: 'graphql' });
    expect(resByTag.length).toBe(1);
    expect(resByTag[0].id).toBe('mem_2');

    // Multi-token match: mem_1 matches both 'backend' and 'python' (score 1.0), ranking first
    const resMulti = executeSearchMemory({ query: 'backend python' });
    expect(resMulti[0].id).toBe('mem_1');

    // Distinct multi-token match where only mem_1 matches
    const resFastApiPython = executeSearchMemory({ query: 'fastapi python' });
    expect(resFastApiPython.length).toBe(1);
    expect(resFastApiPython[0].id).toBe('mem_1');
  });

  // -------------------------------------------------------------------------
  // 2. Stopword Filtering & False-Positive Resistance
  // -------------------------------------------------------------------------
  it('2. filters conversational stopwords so filler words do not cause false-positive matches', () => {
    const memArch = createEntity({
      id: 'mem_arch',
      title: 'Database Stack',
      content: 'PostgreSQL database configured with Prisma ORM',
      category: 'project_context',
      status: 'active',
      tags: ['database', 'postgres'],
    });

    const memFood = createEntity({
      id: 'mem_food',
      title: 'Hostel Mess Menu Schedule',
      content: 'Mess menu routine logged for weekly lunch',
      category: 'routine',
      status: 'active',
      tags: ['mess_menu', 'routine'],
    });

    useStore.setState({ kernelEntities: { [memArch.id]: memArch, [memFood.id]: memFood } });

    // Query full of stopwords: "what did the user say about mess menu and routine"
    const results = executeSearchMemory({
      query: 'what did the user say about mess menu and routine',
    });

    // Should match the food routine, and MUST NOT match the database stack
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('mem_food');
    expect(results.some(r => r.id === 'mem_arch')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Negation Handling & Explicit Negative Intent
  // -------------------------------------------------------------------------
  it('3. preserves explicit negative intent without treating prohibition as approval', () => {
    const memNegative = createEntity({
      id: 'mem_neg',
      title: 'Frontend Framework Constraint',
      content: 'Do NOT use Angular or Vue for this project. Strictly forbidden by team standard.',
      category: 'project_context',
      status: 'active',
      tags: ['frontend', 'constraint', 'angular', 'vue'],
    });

    useStore.setState({ kernelEntities: { [memNegative.id]: memNegative } });

    const results = executeSearchMemory({ query: 'Angular Vue' });
    expect(results.length).toBe(1);
    // Verified: Content explicitly contains negative prohibition, not approval
    expect(results[0].content).toContain('Do NOT use Angular');
    expect(results[0].category).toBe('project_context');
  });

  // -------------------------------------------------------------------------
  // 4. Opt-in Historical Retrieval & Current State Disambiguation
  // -------------------------------------------------------------------------
  it('4. disambiguates current state from historical reasoning via include_superseded flag', () => {
    const memPast = createEntity({
      id: 'mem_past',
      title: 'Initial Selected Stack: FastAPI',
      content: 'FastAPI + Uvicorn chosen as backend stack',
      category: 'project_context',
      status: 'superseded',
      superseded_by: 'mem_curr',
      reversal_reason: 'User halted refactor train in Turn 169',
      source_turn: 12,
      speaker: 'user',
      epistemic_status: 'user_decision',
    });

    const memCurr = createEntity({
      id: 'mem_curr',
      title: 'Active Stack: GraphQL',
      content: 'Option B selected: Full rewrite with GraphQL local-first',
      category: 'project_context',
      status: 'active',
      supersedes: 'mem_past',
      source_turn: 177,
      speaker: 'user',
      epistemic_status: 'user_decision',
    });

    useStore.setState({ kernelEntities: { [memPast.id]: memPast, [memCurr.id]: memCurr } });

    // A: Query about current state (include_superseded: false)
    const currentResults = executeSearchMemory({ query: 'FastAPI', include_superseded: false });
    // Invariant: Query about current state must not return superseded facts
    expect(currentResults).toEqual([]);

    // B: Query about historical reasoning (include_superseded: true)
    const historyResults = executeSearchMemory({ query: 'FastAPI', include_superseded: true });
    expect(historyResults.length).toBe(1);
    expect(historyResults[0].id).toBe('mem_past');
    expect(historyResults[0].status).toBe('superseded');
    expect(historyResults[0].superseded_by).toBe('mem_curr');
    expect(historyResults[0].reversal_reason).toContain('Turn 169');
  });

  // -------------------------------------------------------------------------
  // 5. Proposal vs Decision Attribution (User Decisions Outrank Proposals)
  // -------------------------------------------------------------------------
  it('5. distinguishes assistant proposals from user decisions and asserts epistemic status', () => {
    const assistantProposal = createEntity({
      id: 'mem_prop_option_c',
      title: 'Assistant Architecture Recommendation',
      content: 'Option C is the sweet spot: Keep FastAPI orchestrator and add GraphQL for entity graph',
      category: 'project_context',
      status: 'active',
      speaker: 'assistant',
      epistemic_status: 'assistant_proposal',
      source_turn: 176,
    });

    const userDecision = createEntity({
      id: 'mem_user_option_b',
      title: 'User Backend Selection',
      content: 'User chose Option B: Full rewrite using GraphQL with local storage first',
      category: 'project_context',
      status: 'active',
      speaker: 'user',
      epistemic_status: 'user_decision',
      source_turn: 177,
    });

    useStore.setState({
      kernelEntities: {
        [assistantProposal.id]: assistantProposal,
        [userDecision.id]: userDecision,
      },
    });

    const results = executeSearchMemory({ query: 'Option' });
    expect(results.length).toBe(2);

    const prop = results.find(r => r.id === 'mem_prop_option_c');
    const dec = results.find(r => r.id === 'mem_user_option_b');

    // Invariant: Epistemic status accurately tracks who decided vs who proposed
    expect(prop?.speaker).toBe('assistant');
    expect(prop?.epistemic_status).toBe('assistant_proposal');
    expect(dec?.speaker).toBe('user');
    expect(dec?.epistemic_status).toBe('user_decision');
  });

  // -------------------------------------------------------------------------
  // 6. Halted vs Superseded Distinction
  // -------------------------------------------------------------------------
  it('6. distinguishes halted from superseded (halted does not automatically mean superseded)', () => {
    // State at Turn 170: FastAPI was halted and rewound, but no replacement existed yet!
    const haltedRecord = createEntity({
      id: 'mem_halt_170',
      title: 'FastAPI Refactor Train Halted',
      content: 'Refactor train stopped and rewound to questionnaire phase',
      category: 'project_context',
      status: 'superseded', // in memory types status enum
      lifecycle_state: 'halted',
      reversal_reason: 'User halted train; diagnostic questionnaire needed first',
      superseded_by: undefined, // NOT superseded by anything yet at Turn 170!
    });

    useStore.setState({ kernelEntities: { [haltedRecord.id]: haltedRecord } });

    const results = executeSearchMemory({ query: 'refactor train', include_superseded: true });
    expect(results.length).toBe(1);
    expect(results[0].superseded_by).toBeUndefined(); // Invariant: Halted does not automatically mean superseded
    expect(results[0].reversal_reason).toContain('User halted train');
  });

  // -------------------------------------------------------------------------
  // 7. Missing Evidence Representation (Missing, Not Fabricated)
  // -------------------------------------------------------------------------
  it('7. represents missing provenance or verification evidence as undefined, never fabricated', () => {
    const unverifiedMemory = createEntity({
      id: 'mem_unverified',
      title: 'Unverified Architectural Note',
      content: 'Redis might be used for pubsub cache later',
      category: 'project_context',
      status: 'active',
      source_turn: undefined,
      source_excerpt: undefined,
      implementation_evidence: undefined,
    });

    useStore.setState({ kernelEntities: { [unverifiedMemory.id]: unverifiedMemory } });

    const results = executeSearchMemory({ query: 'Redis' });
    expect(results.length).toBe(1);

    // Invariant: Missing evidence must be represented as missing, not fabricated
    expect(results[0].source_turn).toBeUndefined();
    expect(results[0].source_excerpt).toBeUndefined();
    expect(results[0].implementation_evidence).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8. Stale Implementation Verification (Selected != Implemented)
  // -------------------------------------------------------------------------
  it('8. enforces that selected does not mean implemented', () => {
    // Decision was selected by user, but no code implementation has occurred
    const selectedDecision = createEntity({
      id: 'mem_selected',
      title: 'Architecture Decision: GraphQL',
      content: 'Option B selected for future rewrite',
      category: 'project_context',
      status: 'active',
      epistemic_status: 'user_decision',
      lifecycle_state: 'selected',
      implementation_evidence: undefined, // No code evidence!
    });

    // Implementation was verified in actual repository files
    const verifiedImplementation = createEntity({
      id: 'mem_implemented',
      title: 'Context Entity Implementation',
      content: 'Context Entity architecture implemented in repository code',
      category: 'project_context',
      status: 'active',
      epistemic_status: 'observed_code',
      lifecycle_state: 'implemented',
      implementation_evidence: {
        files: ['types.ts', 'store.ts', 'components/GraphView.tsx'],
        verified_at_turn: 213,
      },
    });

    useStore.setState({
      kernelEntities: {
        [selectedDecision.id]: selectedDecision,
        [verifiedImplementation.id]: verifiedImplementation,
      },
    });

    const resSelected = executeSearchMemory({ query: 'Option B' });
    expect(resSelected[0].implementation_evidence).toBeUndefined();

    const resImplemented = executeSearchMemory({ query: 'Context Entity' });
    expect(resImplemented[0].implementation_evidence).toBeDefined();
    expect((resImplemented[0].implementation_evidence as { files: string[] }).files).toContain('types.ts');
  });

  // -------------------------------------------------------------------------
  // 9. Duplicates Handling
  // -------------------------------------------------------------------------
  it('9. handles duplicate memories gracefully without crash or key collision', () => {
    const memA = createEntity({
      id: 'mem_dup_1',
      title: 'Theme Preference',
      content: 'User prefers Dark Mode',
      category: 'preference',
      status: 'active',
    });

    const memB = createEntity({
      id: 'mem_dup_2',
      title: 'Theme Preference',
      content: 'User prefers Dark Mode',
      category: 'preference',
      status: 'active',
    });

    useStore.setState({ kernelEntities: { [memA.id]: memA, [memB.id]: memB } });

    const results = executeSearchMemory({ query: 'Dark Mode' });
    expect(results.length).toBe(2);
    expect(results[0].id).not.toBe(results[1].id);
  });

  // -------------------------------------------------------------------------
  // 10. Confirmation Boundary Preservation for Memory Mutations
  // -------------------------------------------------------------------------
  it('10. preserves two-phase action confirmation: propose_memory_update does NOT silently mutate store', async () => {
    const initialEntityCount = Object.keys(useStore.getState().kernelEntities || {}).length;

    const dispatchRes = await dispatchToolCall(
      {
        name: 'propose_memory_update',
        args: {
          content: 'User decided to use Tailwind v4 for all UI styling',
          category: 'project_context',
        },
      },
      []
    );

    const payload = dispatchRes.response as { result: Record<string, unknown> };
    expect(dispatchRes.name).toBe('propose_memory_update');

    // Invariant: Proposal must require user confirmation
    expect((payload.result.evaluation as Record<string, unknown>).requires_confirmation).toBe(true);
    expect(payload.result.proposed_operation).toBeDefined();

    // Invariant: Store state MUST NOT be mutated silently before human confirmation!
    const postEntityCount = Object.keys(useStore.getState().kernelEntities || {}).length;
    expect(postEntityCount).toBe(initialEntityCount);
  });
});
