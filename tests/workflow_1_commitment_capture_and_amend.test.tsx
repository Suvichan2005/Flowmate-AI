import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, ToonOperation } from '../types';
import { inferIntentFromQuery } from '../utils/intentParser';
import { CommitmentCard } from '../components/CommitmentCard';
import EntityDetailPanel from '../components/EntityDetailPanel';
import Dashboard from '../components/Dashboard';

describe('Reference Workflow 1: Commitment Natural Language Capture, Inspection & Amendment', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useStore.setState({
      entities: [],
      kernelEntities: {},
      relationships: [],
      selectedEntityId: null,
      pendingOps: null,
      isHydrated: true,
      settings: {
        feature_toggles: {
          food_tracking: false,
          attendance_tracking: false,
          gamification: false,
          quick_streaks: true,
          people_tracking: true
        },
        productivity_calc_method: 'LOGGED_TIME'
      } as any
    });
  });

  it('accurately parses natural language commitment intentions with cadence and unit', () => {
    const input = 'Commitment: Read research papers 3 times per week';
    const intent = inferIntentFromQuery(input);

    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe('COMMITMENT');
    expect(intent?.title).toContain('Read research papers');
    expect(intent?.diffSummary).toContain('Target: 3 times per week');
    expect(intent?.sha256Fingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(intent?.operations.length).toBe(1);

    const op = intent?.operations[0];
    expect(op?.type).toBe('create_entity');
    expect(op?.payload.kind).toBe('HABIT');
    expect(op?.payload.metadata.commitment).toEqual({
      min_count: 3,
      period: 'week',
      target_unit: 'times'
    });
    expect(op?.payload.attributes.commitment).toEqual({
      min_count: 3,
      period: 'week',
      target_unit: 'times'
    });
  });

  it('correctly parses sessions and hours cadence variants into structured commitments', () => {
    const sessionInput = 'Deep work 4 sessions per week';
    const sessionIntent = inferIntentFromQuery(sessionInput);

    expect(sessionIntent).not.toBeNull();
    expect(sessionIntent?.kind).toBe('COMMITMENT');
    expect(sessionIntent?.title).toContain('Deep work');
    expect(sessionIntent?.diffSummary).toContain('Target: 4 sessions per week');
    expect(sessionIntent?.operations[0].payload.metadata.commitment).toEqual({
      min_count: 4,
      period: 'week',
      target_unit: 'sessions'
    });

    const dailyInput = 'Commitment: Morning Meditation daily';
    const dailyIntent = inferIntentFromQuery(dailyInput);

    expect(dailyIntent).not.toBeNull();
    expect(dailyIntent?.kind).toBe('COMMITMENT');
    expect(dailyIntent?.title).toContain('Morning Meditation');
    expect(dailyIntent?.diffSummary).toContain('Target: 1 times per day');
    expect(dailyIntent?.operations[0].payload.metadata.commitment.period).toBe('day');
  });

  it('renders captured commitment in Dashboard and supports 1-click selection into EntityDetailPanel', () => {
    const commitmentId = 'commit-reading-1';
    const nowIso = new Date().toISOString();

    const kernelCommitment = {
      id: commitmentId,
      schema_id: 'system/habit',
      version: 1,
      title: 'Read AI Research Papers',
      attributes: {
        kind: 'HABIT',
        commitment: {
          min_count: 3,
          period: 'week' as const,
          target_unit: 'papers'
        },
        evidence: []
      },
      lifecycle: {
        status: 'active' as const,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null
      },
      provenance: {
        source_type: 'user' as const,
        observed_at: nowIso,
        confidence: 1,
        is_inferred: false,
        user_confirmed: true
      }
    };

    const legacyCommitment: Entity = {
      id: commitmentId,
      title: 'Read AI Research Papers',
      description: null,
      kind: EntityKind.HABIT,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      created_at: nowIso,
      updated_at: nowIso,
      canonical_tags: ['research'],
      metadata: {
        commitment: {
          min_count: 3,
          period: 'week',
          target_unit: 'papers'
        },
        evidence: []
      }
    };

    useStore.setState({
      entities: [legacyCommitment],
      kernelEntities: { [commitmentId]: kernelCommitment }
    });

    render(<Dashboard />);

    // 1. Verify Active Commitments section renders in Dashboard
    expect(screen.getByTestId('dashboard-commitments-section')).toBeDefined();
    expect(screen.getByText('Read AI Research Papers')).toBeDefined();
    expect(screen.getByText('3 papers per week')).toBeDefined();

    // 2. Click the amend / inspect button on the commitment card
    const amendBtn = screen.getByTestId(`commitment-amend-btn-${commitmentId}`);
    fireEvent.click(amendBtn);

    // Verify entity selection was triggered
    expect(useStore.getState().selectedEntityId).toBe(commitmentId);
  });

  it('allows inspecting and amending commitment target cadence in EntityDetailPanel with zero inconsistent state', () => {
    const commitmentId = 'commit-running-1';
    const nowIso = new Date().toISOString();

    const kernelCommitment = {
      id: commitmentId,
      schema_id: 'system/habit',
      version: 1,
      title: 'Morning 5km Run',
      attributes: {
        kind: 'HABIT',
        commitment: {
          min_count: 3,
          period: 'week' as const,
          target_unit: 'runs'
        },
        evidence: []
      },
      lifecycle: {
        status: 'active' as const,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null
      },
      provenance: {
        source_type: 'user' as const,
        observed_at: nowIso,
        confidence: 1,
        is_inferred: false,
        user_confirmed: true
      }
    };

    const legacyCommitment: Entity = {
      id: commitmentId,
      title: 'Morning 5km Run',
      description: null,
      kind: EntityKind.HABIT,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      created_at: nowIso,
      updated_at: nowIso,
      canonical_tags: ['health'],
      metadata: {
        commitment: {
          min_count: 3,
          period: 'week',
          target_unit: 'runs'
        },
        evidence: []
      }
    };

    useStore.setState({
      entities: [legacyCommitment],
      kernelEntities: { [commitmentId]: kernelCommitment },
      selectedEntityId: commitmentId
    });

    render(<EntityDetailPanel />);

    // 1. Verify Commitment Policy card renders in inspector
    expect(screen.getByTestId('commitment-policy-card')).toBeDefined();
    const cadenceBadge = screen.getByTestId('commitment-cadence-badge');
    expect(cadenceBadge.textContent).toContain('3 runs / week');

    // 2. Toggle the inline amendment form
    const toggleBtn = screen.getByTestId('amend-commitment-toggle-btn');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('amend-commitment-form')).toBeDefined();

    // 3. Update target count to 5 and unit to 'sessions'
    const countInput = screen.getByTestId('amend-commitment-count-input') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '5' } });

    const unitInput = screen.getByTestId('amend-commitment-unit-input') as HTMLInputElement;
    fireEvent.change(unitInput, { target: { value: 'sessions' } });

    // 4. Save amendment
    const saveBtn = screen.getByTestId('amend-commitment-save-btn');
    fireEvent.click(saveBtn);

    // 5. Verify the updated commitment in store and on-screen badge
    const updatedEntity = useStore.getState().entities.find(e => e.id === commitmentId);
    expect(updatedEntity?.metadata.commitment).toEqual({
      min_count: 5,
      period: 'week',
      target_unit: 'sessions'
    });

    const updatedKernel = useStore.getState().kernelEntities[commitmentId];
    expect(updatedKernel?.attributes.commitment).toEqual({
      min_count: 5,
      period: 'week',
      target_unit: 'sessions'
    });

    // Verify UI reflects the amended target
    expect(screen.getByTestId('commitment-cadence-badge').textContent).toContain('5 sessions / week');
  });
});
