import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryDetailView } from '../components/MemoryDetailView';
import EntityDetailPanel from '../components/EntityDetailPanel';
import { CommandPalette } from '../components/CommandPalette';
import Dashboard from '../components/Dashboard';
import { useStore } from '../store';
import type { Entity as KernelEntity } from '../services/kernel/types';
import { extractMemoryItem } from '../services/context/resolver';
import { ToonOperation } from '../types';

describe('Workflow 4: Preference & Decision Retrieval with Superseded Lineage', () => {
  afterEach(() => {
    cleanup();
  });

  const activeUserDecisionEntity: KernelEntity = {
    id: 'mem-user-decision-1',
    schema_id: 'system/memory_item',
    version: 2,
    title: 'Morning Deep Work Window',
    attributes: {
      category: 'routine',
      content: 'Reserve 08:00 to 11:00 for uninterrupted deep work. No morning meetings.',
      source_type: 'user_explicit',
      speaker: 'user',
      confidence: 1.0,
      status: 'active',
      epistemic_status: 'user_decision',
      privacy_tier: 'private',
      valid_from: '2026-10-01T00:00:00Z',
      supersedes: 'mem-superseded-1',
      tags: ['routine', 'deep-work', 'calendar'],
      source_excerpt: 'From now on I want my mornings strictly blocked for deep work.',
      source_turn: 14,
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-01T00:00:00Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  const supersededBeliefEntity: KernelEntity = {
    id: 'mem-superseded-1',
    schema_id: 'system/memory_item',
    version: 1,
    title: 'Flexible Morning Meetings',
    attributes: {
      category: 'routine',
      content: 'Available for morning syncs starting at 09:00.',
      source_type: 'user_explicit',
      speaker: 'user',
      confidence: 1.0,
      status: 'superseded',
      epistemic_status: 'user_decision',
      privacy_tier: 'private',
      valid_from: '2026-08-01T00:00:00Z',
      valid_until: '2026-10-01T00:00:00Z',
      superseded_by: 'mem-user-decision-1',
      reversal_reason: 'User switched to morning deep work routine on Oct 1',
      tags: ['routine', 'meetings'],
      source_excerpt: 'I can take calls starting around 9am.',
      source_turn: 3,
    },
    lifecycle: {
      status: 'superseded',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-08-01T00:00:00Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  const assistantProposalEntity: KernelEntity = {
    id: 'mem-proposal-1',
    schema_id: 'system/memory_item',
    version: 1,
    title: 'Suggested Break Interval',
    attributes: {
      category: 'wellness',
      content: 'Take a 10-minute walk after every 90 minutes of screen time.',
      source_type: 'inferred',
      speaker: 'assistant',
      confidence: 0.85,
      status: 'active',
      epistemic_status: 'assistant_proposal',
      privacy_tier: 'private',
      valid_from: '2026-10-10T00:00:00Z',
      tags: ['health', 'wellness', 'ergonomics'],
      source_excerpt: 'Notice fatigue patterns spiking during afternoon 3-hour sessions.',
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-10T00:00:00Z',
      updated_at: '2026-10-10T00:00:00Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'agent',
      observed_at: '2026-10-10T00:00:00Z',
      confidence: 0.85,
      is_inferred: true,
      user_confirmed: false,
    },
  };

  beforeEach(() => {
    useStore.setState({
      selectedEntityId: null,
      kernelEntities: {
        [activeUserDecisionEntity.id]: activeUserDecisionEntity,
        [supersededBeliefEntity.id]: supersededBeliefEntity,
        [assistantProposalEntity.id]: assistantProposalEntity,
      },
      entities: [],
      relationships: [],
      pendingOps: null,
    });
  });

  it('renders MemoryDetailView for active user explicit decision with canonical truth banner and lineage', () => {
    const memory = extractMemoryItem(activeUserDecisionEntity);
    const onNavigate = vi.fn();

    render(
      <MemoryDetailView
        memory={memory}
        kernelEntity={activeUserDecisionEntity}
        onClose={vi.fn()}
        onNavigateToEntity={onNavigate}
      />
    );

    // Epistemic badge
    expect(screen.getByText(/User Explicit Decision \(Canonical Truth\)/i)).toBeInTheDocument();
    expect(screen.getByText(/100% confidence weight/i)).toBeInTheDocument();

    // Stated content and source excerpt
    expect(
      screen.getByText(/Reserve 08:00 to 11:00 for uninterrupted deep work/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/From now on I want my mornings strictly blocked for deep work/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Observed in session turn #14/i)).toBeInTheDocument();

    // Lineage predecessor link
    expect(screen.getByText(/Lineage Predecessor/i)).toBeInTheDocument();
    expect(screen.getByText(/Supersedes: Flexible Morning Meetings/i)).toBeInTheDocument();

    // Click inspect prior belief
    fireEvent.click(screen.getByText(/Inspect prior belief/i));
    expect(onNavigate).toHaveBeenCalledWith('mem-superseded-1');
  });

  it('renders MemoryDetailView for superseded belief with historical banner and successor replacement link', () => {
    const memory = extractMemoryItem(supersededBeliefEntity);
    const onNavigate = vi.fn();

    render(
      <MemoryDetailView
        memory={memory}
        kernelEntity={supersededBeliefEntity}
        onClose={vi.fn()}
        onNavigateToEntity={onNavigate}
      />
    );

    // Superseded banner and reversal reason
    expect(screen.getByText(/SUPERSEDED BELIEF \(Historical Record\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/User switched to morning deep work routine on Oct 1/i)
    ).toBeInTheDocument();

    // Successor replacement button
    const inspectBtn = screen.getByText(/Inspect Active Replacement: Morning Deep Work Window/i);
    expect(inspectBtn).toBeInTheDocument();
    fireEvent.click(inspectBtn);
    expect(onNavigate).toHaveBeenCalledWith('mem-user-decision-1');
  });

  it('renders MemoryDetailView for assistant proposal with confidence and two-phase promote action', () => {
    const memory = extractMemoryItem(assistantProposalEntity);

    render(
      <MemoryDetailView
        memory={memory}
        kernelEntity={assistantProposalEntity}
        onClose={vi.fn()}
      />
    );

    // Assistant proposal banner and confidence
    expect(screen.getByText(/Assistant Inferred Proposal/i)).toBeInTheDocument();
    expect(screen.getByText(/85% Confidence/i)).toBeInTheDocument();

    // Stage promotion via two-phase confirmation
    const confirmBtn = screen.getByText(/Confirm as Permanent User Preference/i);
    fireEvent.click(confirmBtn);

    const pendingOps = useStore.getState().pendingOps;
    expect(pendingOps).toBeTruthy();
    expect(pendingOps!.ops).toHaveLength(1);
    expect(pendingOps!.ops[0].type).toBe('update_entity');
    const payload = pendingOps!.ops[0].payload as Record<string, unknown>;
    expect(payload.id).toBe('mem-proposal-1');
    const fields = payload.fields as Record<string, unknown>;
    expect(fields.user_confirmed).toBe(true);
    expect(fields.source_type).toBe('user_confirmed');
    expect(fields.epistemic_status).toBe('user_decision');
    expect(fields.confidence).toBe(1.0);
  });

  it('stages mark as superseded and delete tombstone operations via two-phase confirmation', () => {
    const memory = extractMemoryItem(activeUserDecisionEntity);

    render(
      <MemoryDetailView
        memory={memory}
        kernelEntity={activeUserDecisionEntity}
        onClose={vi.fn()}
      />
    );

    // Mark as superseded
    const supersedeBtn = screen.getByText(/Mark as Superseded \(Archive Belief\)/i);
    fireEvent.click(supersedeBtn);

    let pendingOps = useStore.getState().pendingOps;
    expect(pendingOps).toBeTruthy();
    expect(pendingOps!.ops).toHaveLength(1);
    expect(pendingOps!.ops[0].type).toBe('update_entity');
    let payload = pendingOps!.ops[0].payload as Record<string, unknown>;
    expect((payload.fields as Record<string, unknown>).status).toBe('superseded');

    // Delete with tombstone
    const deleteBtn = screen.getByText(/Delete with Tombstone/i);
    fireEvent.click(deleteBtn);

    pendingOps = useStore.getState().pendingOps;
    expect(pendingOps).toBeTruthy();
    expect(pendingOps!.ops).toHaveLength(1);
    expect(pendingOps!.ops[0].type).toBe('delete_entity');
    payload = pendingOps!.ops[0].payload as Record<string, unknown>;
    expect(payload.id).toBe('mem-user-decision-1');
  });

  it('renders MemoryDetailView inside EntityDetailPanel when system/memory_item is selected', () => {
    useStore.setState({
      selectedEntityId: 'mem-user-decision-1',
    });

    render(<EntityDetailPanel />);

    expect(screen.getByText(/Belief & Decision Inspector/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Reserve 08:00 to 11:00 for uninterrupted deep work/i)
    ).toBeInTheDocument();
  });

  it('searches and selects memory items within CommandPalette', () => {
    render(<CommandPalette onSendToChat={() => {}} />);

    // Open palette
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const searchInput = screen.getByLabelText(/Intention and search input/i);
    fireEvent.change(searchInput, { target: { value: 'deep work' } });

    // Verify memory search item matches
    expect(screen.getByText(/BELIEF • ROUTINE • USER DECISION/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Reserve 08:00 to 11:00 for uninterrupted deep/i)
    ).toBeInTheDocument();

    // Click item to select entity
    fireEvent.click(
      screen.getByText(/Reserve 08:00 to 11:00 for uninterrupted deep/i)
    );
    expect(useStore.getState().selectedEntityId).toBe('mem-user-decision-1');
  });

  it('renders Stated Decisions & Preferences section on Dashboard and enables inspection', () => {
    render(<Dashboard />);

    const beliefsSection = screen.getByTestId('dashboard-beliefs-section');
    expect(beliefsSection).toBeInTheDocument();
    expect(screen.getByText(/Stated Decisions & Preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/3 contextual beliefs tracked/i)).toBeInTheDocument();

    // Verify belief cards exist
    const activeCard = screen.getByTestId('belief-card-mem-user-decision-1');
    expect(activeCard).toBeInTheDocument();
    expect(activeCard).toHaveTextContent(/User Decision/i);

    const proposalCard = screen.getByTestId('belief-card-mem-proposal-1');
    expect(proposalCard).toBeInTheDocument();
    expect(proposalCard).toHaveTextContent(/85% Proposal/i);

    const supersededCard = screen.getByTestId('belief-card-mem-superseded-1');
    expect(supersededCard).toBeInTheDocument();
    expect(supersededCard).toHaveTextContent(/Superseded/i);

    // Clicking a card selects entity
    fireEvent.click(activeCard);
    expect(useStore.getState().selectedEntityId).toBe('mem-user-decision-1');
  });
});
