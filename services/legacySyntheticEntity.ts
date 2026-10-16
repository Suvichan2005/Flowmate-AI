import { KernelEntity } from './kernel/types';

const LEGACY_SYNTHETIC_IDS = new Set([
  'goal-recruiter-portfolio', 'goal-distributed-kernel', 'project-flowmate-core',
  'project-agent-supervision', 'task-calendar-intervals', 'task-security-gate',
  'task-responsive-check', 'task-completed-baseline', 'event-recruiter-demo',
  'event-deep-work', 'habit-invariant-check', 'habit-code-review',
  'memory-safety-principle', 'memory-kernel-inversion',
]);

/** Keeps historical sample fixtures out of cloud writes after the sample UI is removed. */
export function isLegacySyntheticEntity(entity: { id?: string; metadata?: Record<string, unknown>; attributes?: KernelEntity['attributes'] }): boolean {
  if (!entity?.id) return false;
  return Boolean(
    LEGACY_SYNTHETIC_IDS.has(entity.id) ||
    entity.metadata?.is_demo ||
    entity.attributes?.is_demo ||
    entity.id.startsWith('recruiter-') ||
    entity.id.startsWith('demo-') ||
    entity.id.startsWith('goal-recruiter') ||
    entity.id.startsWith('task-recruiter')
  );
}
