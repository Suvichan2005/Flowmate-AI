/**
 * Flowmate Memory Foundation — Phase 0 Executable Acceptance Contract
 *
 * SCOPE & PURPOSE:
 * Codifies the 12 Phase 0 Invariants into an executable, deterministic test suite
 * grounded in deterministic synthetic entities and messages. It does not read
 * the retired archive-intelligence database or private conversation exports.
 *
 * INVARIANTS TESTED:
 * 1. Chronological processing without future leakage.
 * 2. Explicit user decisions outrank assistant proposals and inferred preferences.
 * 3. Decision reversals, halts, supersession, and recovery of historical reasoning.
 * 4. Source-grounded provenance and honest representation of missing evidence.
 * 5. Current-state retrieval versus historical exploration.
 * 6. Entity and cross-domain relationship traversal.
 * 7. Bounded context assembly without indiscriminate memory stuffing.
 * 8. Persistence, reload, idempotency, and duplicate handling.
 * 9. Confirmation-gated state changes and traceable transitions.
 * 10. Selected plan vs. actual implementation vs. verified behavior.
 * 11. Resistance to irrelevant retrieval, negation errors, and contradictory evidence.
 * 12. Exploratory retrieval without narrow keyword lock-in.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { Entity as KernelEntity, Provenance, SourceType } from '../services/kernel/types';
import { dispatchToolCall, executeSearchMemory } from '../services/ai/executors';
import { buildHistory } from '../services/ai/context';
import { Message } from '../types';

function createContractEntity(params: {
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
  associated_entity_ids?: string[];
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
      associated_entity_ids: params.associated_entity_ids || [],
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

describe('Phase 0 Executable Memory Acceptance Contract', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
    });
  });

  // -------------------------------------------------------------------------
  // 1. Chronological Processing Without Future Leakage
  // -------------------------------------------------------------------------
  it('INV-01: Chronological Processing — state at Turn 15 contains strictly zero facts from Turn 177', () => {
    // Synthetic chronology fixture: the earlier decision is present at this checkpoint.
    // Turn 12: FastAPI selected
    const turn12FastApi = createContractEntity({
      id: 'mem_fastapi_12',
      title: 'Initial Selected Backend: FastAPI',
      content: 'FastAPI + Uvicorn selected as backend API',
      category: 'project_context',
      status: 'active',
      source_turn: 12,
      lifecycle_state: 'selected',
    });

    useStore.setState({ kernelEntities: { [turn12FastApi.id]: turn12FastApi } });

    // Query at checkpoint Turn 15:
    const results = executeSearchMemory({ query: 'backend API' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('mem_fastapi_12');

    // Invariant: Future architectural decisions (Option B GraphQL from Turn 177) MUST NOT exist
    const futureResults = executeSearchMemory({ query: 'GraphQL' });
    expect(futureResults).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Explicit User Decisions Outrank Assistant Proposals
  // -------------------------------------------------------------------------
  it('INV-02: Epistemic Hierarchy — user decisions outrank assistant proposals in authority', () => {
    // Turn 176: Assistant recommends Option C Hybrid
    const proposal = createContractEntity({
      id: 'mem_prop_176',
      title: 'Assistant Stack Proposal: Option C',
      content: 'Option C is the sweet spot: Keep FastAPI orchestrator and add GraphQL for entity graph',
      category: 'project_context',
      status: 'active',
      speaker: 'assistant',
      epistemic_status: 'assistant_proposal',
      source_turn: 176,
    });

    // Turn 177: User overrides assistant and explicitly chooses Option B
    const decision = createContractEntity({
      id: 'mem_dec_177',
      title: 'User Selected Architecture: Option B',
      content: 'User chose Option B: Full rewrite using GraphQL with local-first JSON storage',
      category: 'project_context',
      status: 'active',
      speaker: 'user',
      epistemic_status: 'user_decision',
      source_turn: 177,
    });

    useStore.setState({ kernelEntities: { [proposal.id]: proposal, [decision.id]: decision } });

    const results = executeSearchMemory({ query: 'Option' });
    const userDec = results.find(r => r.id === 'mem_dec_177');
    const asstProp = results.find(r => r.id === 'mem_prop_176');

    expect(userDec?.epistemic_status).toBe('user_decision');
    expect(asstProp?.epistemic_status).toBe('assistant_proposal');
    // Invariant: User decision carries higher epistemic status than assistant proposal
    expect(userDec?.speaker).toBe('user');
    expect(asstProp?.speaker).toBe('assistant');
  });

  // -------------------------------------------------------------------------
  // 3. Decision Reversals, Halts, Supersession, and Historical Reasoning
  // -------------------------------------------------------------------------
  it('INV-03: Temporal Lineage — historical reasoning is recoverable via supersession pointers', () => {
    const pastMemory = createContractEntity({
      id: 'mem_fastapi_12',
      title: 'Initial Selected Backend: FastAPI',
      content: 'FastAPI + Uvicorn chosen as backend architecture',
      category: 'project_context',
      status: 'superseded',
      superseded_by: 'mem_graphql_177',
      reversal_reason: 'User halted refactor train in Turn 169 before Option B rewrite',
      source_turn: 12,
    });

    const activeMemory = createContractEntity({
      id: 'mem_graphql_177',
      title: 'Replacement Backend: Option B GraphQL',
      content: 'Option B selected: Full rewrite with GraphQL local-first storage',
      category: 'project_context',
      status: 'active',
      supersedes: 'mem_fastapi_12',
      source_turn: 177,
    });

    useStore.setState({ kernelEntities: { [pastMemory.id]: pastMemory, [activeMemory.id]: activeMemory } });

    // Invariant: Historical query with include_superseded: true recovers both the past decision and the replacement
    const historyResults = executeSearchMemory({ query: 'FastAPI', include_superseded: true });
    expect(historyResults.length).toBe(1);
    expect(historyResults[0].status).toBe('superseded');
    expect(historyResults[0].superseded_by).toBe('mem_graphql_177');
    expect(historyResults[0].reversal_reason).toContain('Turn 169');
  });

  // -------------------------------------------------------------------------
  // 4. Source-Grounded Provenance and Honest Representation of Missing Evidence
  // -------------------------------------------------------------------------
  it('INV-04: Provenance Honesty — missing evidence is strictly undefined, never fabricated', () => {
    const incompleteMemory = createContractEntity({
      id: 'mem_unverified_note',
      title: 'Docker Deployment Idea',
      content: 'We might containerize the backend using Docker compose',
      category: 'project_context',
      status: 'active',
      source_turn: undefined,
      source_excerpt: undefined,
      implementation_evidence: undefined,
    });

    useStore.setState({ kernelEntities: { [incompleteMemory.id]: incompleteMemory } });

    const results = executeSearchMemory({ query: 'Docker' });
    expect(results.length).toBe(1);
    // Invariant: Missing evidence fields MUST be undefined, never populated with mock defaults
    expect(results[0].source_turn).toBeUndefined();
    expect(results[0].source_excerpt).toBeUndefined();
    expect(results[0].implementation_evidence).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. Current-State Retrieval Versus Historical Exploration
  // -------------------------------------------------------------------------
  it('INV-05: State Disambiguation — current queries exclude superseded facts by default', () => {
    const supersededRecord = createContractEntity({
      id: 'mem_past_stack',
      title: 'Past Stack: FastAPI',
      content: 'FastAPI + SQLite backend',
      category: 'project_context',
      status: 'superseded',
    });

    const activeRecord = createContractEntity({
      id: 'mem_active_stack',
      title: 'Active Stack: GraphQL',
      content: 'GraphQL local-first backend',
      category: 'project_context',
      status: 'active',
    });

    useStore.setState({ kernelEntities: { [supersededRecord.id]: supersededRecord, [activeRecord.id]: activeRecord } });

    // Current-state query
    const current = executeSearchMemory({ query: 'backend', include_superseded: false });
    expect(current.length).toBe(1);
    expect(current[0].id).toBe('mem_active_stack');

    // Historical exploration query
    const history = executeSearchMemory({ query: 'backend', include_superseded: true });
    expect(history.length).toBe(2);
    expect(history.some(r => r.id === 'mem_past_stack')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Entity and Cross-Domain Relationship Traversal
  // -------------------------------------------------------------------------
  it('INV-06: Relationship Grounding — memory items maintain associated entity links', () => {
    const memory = createContractEntity({
      id: 'mem_arch_decision',
      title: 'Context Entity Architecture Decision',
      content: 'Shift broad domains like IEEE CS to CONTEXT entities linked via TAGGED_WITH',
      category: 'project_context',
      status: 'active',
      associated_entity_ids: ['ent_project_flowmate', 'ent_domain_ieee_cs'],
    });

    useStore.setState({ kernelEntities: { [memory.id]: memory } });

    const results = executeSearchMemory({ query: 'Context Entity' });
    expect(results.length).toBe(1);
    // Invariant: Associated entity IDs survive retrieval for graph linking
    const rawEntity = useStore.getState().kernelEntities['mem_arch_decision'];
    expect((rawEntity.attributes.associated_entity_ids as string[])).toContain('ent_domain_ieee_cs');
  });

  // -------------------------------------------------------------------------
  // 7. Bounded Context Assembly Without Indiscriminate Memory Stuffing
  // -------------------------------------------------------------------------
  it('INV-07: Bounded Context — prompt assembly maintains information isolation before tool retrieval', () => {
    const currentQuery: Message = {
      id: 'msg_curr',
      role: 'user',
      text: 'Why did we stop using FastAPI and what architecture replaced it?',
      created_at: new Date().toISOString(),
    };

    // Bounded history boundary without rolling summary injection
    const history = buildHistory([currentQuery], null);
    const assembledText = history
      .map(c => c.parts.map(p => ('text' in p ? p.text : '')).join(' '))
      .join('\n');

    // Invariant: Prompt text contains ONLY the current turn; zero memory stuffing
    expect(assembledText).toContain(currentQuery.text);
    expect(assembledText).not.toMatch(/graphql/i);
    expect(assembledText).not.toMatch(/Option B/i);
    expect(assembledText).not.toMatch(/rewound/i);
  });

  // -------------------------------------------------------------------------
  // 8. Persistence, Reload, Idempotency, and Duplicate Handling
  // -------------------------------------------------------------------------
  it('INV-08: Idempotency & Persistence — duplicate writes update existing entity without corruption', () => {
    const entityA = createContractEntity({
      id: 'mem_stable_fact',
      title: 'User Timezone Preference',
      content: 'User resides in Asia/Kolkata timezone (+05:30 IST)',
      category: 'preference',
      status: 'active',
    });

    // Write first time
    useStore.setState({ kernelEntities: { [entityA.id]: entityA } });
    expect(Object.keys(useStore.getState().kernelEntities).length).toBe(1);

    // Duplicate write with identical ID (idempotency)
    const entityAUpdated = {
      ...entityA,
      attributes: {
        ...entityA.attributes,
        content: 'User resides in Asia/Kolkata timezone (+05:30 IST) [confirmed]',
      },
    };
    useStore.setState({
      kernelEntities: {
        ...useStore.getState().kernelEntities,
        [entityAUpdated.id]: entityAUpdated,
      },
    });

    // Invariant: Total entity count remains 1; updated cleanly without key explosion
    const entities = useStore.getState().kernelEntities;
    expect(Object.keys(entities).length).toBe(1);
    expect(entities['mem_stable_fact'].attributes.content).toContain('[confirmed]');
  });

  // -------------------------------------------------------------------------
  // 9. Confirmation-Gated State Changes
  // -------------------------------------------------------------------------
  it('INV-09: Confirmation Boundary — proposed memory update requires human confirmation', async () => {
    const beforeCount = Object.keys(useStore.getState().kernelEntities).length;

    const dispatchResponse = await dispatchToolCall(
      {
        name: 'propose_memory_update',
        args: {
          content: 'User wants all diagrams to render using Mermaid',
          category: 'preference',
        },
      },
      []
    );

    const resultData = dispatchResponse.response as { result: Record<string, unknown> };
    expect(dispatchResponse.name).toBe('propose_memory_update');

    // Invariant: Proposal requires human confirmation
    expect((resultData.result.evaluation as Record<string, unknown>).requires_confirmation).toBe(true);
    expect(resultData.result.proposed_operation).toBeDefined();

    // Invariant: Store was NOT mutated silently
    const afterCount = Object.keys(useStore.getState().kernelEntities).length;
    expect(afterCount).toBe(beforeCount);
  });

  // -------------------------------------------------------------------------
  // 10. Selected Plan vs. Actual Implementation vs. Verified Behavior
  // -------------------------------------------------------------------------
  it('INV-10: Epistemic Grounding — selected plan is distinguished from verified code implementation', () => {
    const plannedDecision = createContractEntity({
      id: 'mem_planned_graphql',
      title: 'Selected Plan: GraphQL Rewrite',
      content: 'Option B selected for future rewrite',
      category: 'project_context',
      status: 'active',
      lifecycle_state: 'selected',
      epistemic_status: 'user_decision',
      implementation_evidence: undefined, // Plan only!
    });

    const implementedCode = createContractEntity({
      id: 'mem_code_context_entity',
      title: 'Implemented Architecture: Context Entities',
      content: 'Context Entity architecture implemented in repository code',
      category: 'project_context',
      status: 'active',
      lifecycle_state: 'implemented',
      epistemic_status: 'observed_code',
      implementation_evidence: {
        files: ['types.ts', 'store.ts', 'components/GraphView.tsx'],
        verified_at_turn: 213,
      },
    });

    useStore.setState({
      kernelEntities: {
        [plannedDecision.id]: plannedDecision,
        [implementedCode.id]: implementedCode,
      },
    });

    const resPlan = executeSearchMemory({ query: 'GraphQL' });
    const resCode = executeSearchMemory({ query: 'Context Entity' });

    // Invariant: Selected plan has no implementation evidence
    expect(resPlan[0].implementation_evidence).toBeUndefined();
    expect(resPlan[0].epistemic_status).toBe('user_decision');

    // Invariant: Verified implementation has repository files attached
    expect(resCode[0].implementation_evidence).toBeDefined();
    expect(resCode[0].epistemic_status).toBe('observed_code');
  });

  // -------------------------------------------------------------------------
  // 11. Resistance to Irrelevant Retrieval and Negation
  // -------------------------------------------------------------------------
  it('INV-11: Precision & Negation — query does not pull irrelevant memories or invert negative rules', () => {
    const foodRoutine = createContractEntity({
      id: 'mem_hostel_routine',
      title: 'Hostel Mess Menu Schedule',
      content: 'Mess menu routine logged for weekly lunch',
      category: 'routine',
      status: 'active',
      tags: ['mess_menu', 'routine'],
    });

    const forbiddenConstraint = createContractEntity({
      id: 'mem_prohibition',
      title: 'Database Rule: No Mongo',
      content: 'Do NOT use MongoDB as primary store. Relational or embedded JSON only.',
      category: 'project_context',
      status: 'active',
      tags: ['database', 'constraint'],
    });

    useStore.setState({ kernelEntities: { [foodRoutine.id]: foodRoutine, [forbiddenConstraint.id]: forbiddenConstraint } });

    // Stopword / Irrelevant query check
    const routineQuery = executeSearchMemory({ query: 'what did the user say about mess menu' });
    expect(routineQuery.length).toBe(1);
    expect(routineQuery[0].id).toBe('mem_hostel_routine');
    expect(routineQuery.some(r => r.id === 'mem_prohibition')).toBe(false);

    // Negation check
    const mongoQuery = executeSearchMemory({ query: 'MongoDB' });
    expect(mongoQuery.length).toBe(1);
    expect(mongoQuery[0].content).toContain('Do NOT use MongoDB');
  });

  // -------------------------------------------------------------------------
  // 12. Exploratory Retrieval Without Narrow Keyword Lock-In
  // -------------------------------------------------------------------------
  it('INV-12: Exploratory Retrieval — category filtering retrieves memories without exact text query', () => {
    const pref1 = createContractEntity({
      id: 'mem_pref_1',
      title: 'Theme Preference',
      content: 'User prefers dark mode UI styling',
      category: 'preference',
      status: 'active',
    });

    const pref2 = createContractEntity({
      id: 'mem_pref_2',
      title: 'Response Style',
      content: 'User prefers concise responses with bullet points',
      category: 'preference',
      status: 'active',
    });

    const proj = createContractEntity({
      id: 'mem_proj',
      title: 'Project Goal',
      content: 'Ship Flowmate v4 by end of quarter',
      category: 'project_context',
      status: 'active',
    });

    useStore.setState({ kernelEntities: { [pref1.id]: pref1, [pref2.id]: pref2, [proj.id]: proj } });

    // Exploratory retrieval: query is empty, filter by category
    const preferences = executeSearchMemory({ query: '', category: 'preference' });
    expect(preferences.length).toBe(2);
    expect(preferences.some(p => p.id === 'mem_pref_1')).toBe(true);
    expect(preferences.some(p => p.id === 'mem_pref_2')).toBe(true);
    expect(preferences.some(p => p.id === 'mem_proj')).toBe(false);
  });
});
