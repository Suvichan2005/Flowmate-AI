import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import KnowledgeView from '../components/KnowledgeView';
import { CommandPalette } from '../components/CommandPalette';
import { EntityKind, EntityStatus } from '../types';

describe('Public Library and command discovery', () => {
  beforeEach(() => {
    useStore.setState({
      entities: [{
        id: 'synthetic-task', kind: EntityKind.TASK, title: 'Synthetic user task',
        description: 'Test fixture', status: EntityStatus.ACTIVE, priority: 1,
        start_time: null, end_time: null, deadline: null, duration_minutes: null,
        recurrence: null, metadata: {}, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), canonical_tags: ['test'],
      }],
      relationships: [], pendingOps: null, knowledgeInitialFilters: null,
    });
  });

  it('renders the personal Library by default', () => {
    render(<KnowledgeView />);
    expect(screen.getByText('Library')).toBeDefined();
    expect(screen.getByText('Synthetic user task')).toBeDefined();
  });

  it('does not expose internal research prototypes as commands', () => {
    render(<CommandPalette onSendToChat={() => {}} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByLabelText(/Intention and search input/i), { target: { value: 'strategic' } });
    expect(screen.queryByText(/Go to Strategic Research Insights/i)).toBeNull();
    expect(screen.queryByTestId('inferred-intent-card')).toBeNull();
  });
});