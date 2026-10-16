import { describe, expect, it } from 'vitest';
import { isLegacySyntheticEntity } from '../services/legacySyntheticEntity';

describe('legacy synthetic-record cloud exclusion', () => {
  it('continues to recognize every historically seeded ID after runtime demo removal', () => {
    const ids = [
      'goal-recruiter-portfolio', 'goal-distributed-kernel', 'project-flowmate-core',
      'project-agent-supervision', 'task-calendar-intervals', 'task-security-gate',
      'task-responsive-check', 'task-completed-baseline', 'event-recruiter-demo',
      'event-deep-work', 'habit-invariant-check', 'habit-code-review',
      'memory-safety-principle', 'memory-kernel-inversion',
    ];
    for (const id of ids) expect(isLegacySyntheticEntity({ id })).toBe(true);
  });

  it('recognizes persisted flags and leaves ordinary user records eligible for normal handling', () => {
    expect(isLegacySyntheticEntity({ id: 'old-flagged-item', metadata: { is_demo: true } })).toBe(true);
    expect(isLegacySyntheticEntity({ id: 'old-kernel-item', attributes: { is_demo: true } as any })).toBe(true);
    expect(isLegacySyntheticEntity({ id: 'user-created-project-9' })).toBe(false);
  });
});
