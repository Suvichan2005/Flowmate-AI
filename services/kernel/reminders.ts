/**
 * Flowmate Greenfield Domain Kernel — Reusable Reminder Policy Engine (P1-06)
 *
 * Platform-independent, deterministic evaluation of reminder/notification policies.
 * Evaluates triggers, timing windows, suppression on completion, and idempotency.
 *
 * Pure service: does NOT mutate store or fire notifications directly.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { CommitmentProgress, evaluateEntityCommitment } from './commitment';
import { Entity } from './types';

export type ReminderTrigger =
  | 'period_end_approaching'
  | 'day_of_period'
  | 'fixed_time'
  | 'deadline_approaching';

export interface ReminderPolicy {
  id: string;
  enabled: boolean;
  trigger: ReminderTrigger;
  lead_time_hours?: number; // e.g. 24 hours before period window end
  preferred_time_of_day?: string; // e.g. '18:00'
  preferred_day_of_week?: number; // 0 = Sunday, ..., 6 = Saturday (e.g. 0 = Sunday evening)
  channel: 'in_app' | 'browser' | 'system';
  message_template?: string;
  suppress_when_completed: boolean; // default true
  last_fired_at?: string | null; // ISO 8601 UTC
}

export interface ReminderEvaluationResult {
  should_notify: boolean;
  scheduled_at: string | null; // ISO 8601 UTC
  reason:
    | 'incomplete_period_approaching'
    | 'scheduled_trigger'
    | 'suppressed_already_completed'
    | 'policy_disabled'
    | 'already_fired'
    | 'outside_notification_window';
  notification_payload?: {
    title: string;
    body: string;
    channel: string;
    entity_id: string;
    scheduled_at: string;
  };
}

export function parseReminderPolicy(raw: unknown): ReminderPolicy | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : `policy-${Date.now()}`;
  const enabled = obj.enabled !== false;
  const rawTrigger =
    typeof obj.trigger === 'string'
      ? obj.trigger
      : typeof obj.trigger_condition === 'string'
      ? obj.trigger_condition
      : 'period_end_approaching';

  let trigger: ReminderTrigger = 'period_end_approaching';
  if (rawTrigger === 'day_of_period') trigger = 'day_of_period';
  else if (rawTrigger === 'fixed_time') trigger = 'fixed_time';
  else if (rawTrigger === 'deadline_approaching') trigger = 'deadline_approaching';

  let leadTimeHours =
    typeof obj.lead_time_hours === 'number' && Number.isFinite(obj.lead_time_hours)
      ? Math.max(0, obj.lead_time_hours)
      : 24;

  if (obj.timing && typeof obj.timing === 'object') {
    const timing = obj.timing as Record<string, unknown>;
    const val = typeof timing.before_value === 'number' ? timing.before_value : 1;
    const unit = typeof timing.before_unit === 'string' ? timing.before_unit : 'days';
    leadTimeHours = unit === 'days' ? val * 24 : val;
  }

  const preferredTime =
    typeof obj.preferred_time_of_day === 'string' ? obj.preferred_time_of_day : '18:00';

  const preferredDay =
    typeof obj.preferred_day_of_week === 'number' && obj.preferred_day_of_week >= 0 && obj.preferred_day_of_week <= 6
      ? Math.floor(obj.preferred_day_of_week)
      : undefined;

  const rawChannel = typeof obj.channel === 'string' ? obj.channel : 'in_app';
  let channel: 'in_app' | 'browser' | 'system' = 'in_app';
  if (rawChannel === 'browser' || rawChannel === 'system') channel = rawChannel;

  const messageTemplate =
    typeof obj.message_template === 'string' ? obj.message_template : undefined;

  const suppressWhenCompleted = obj.suppress_when_completed !== false;
  const lastFiredAt = typeof obj.last_fired_at === 'string' ? obj.last_fired_at : null;

  return {
    id,
    enabled,
    trigger,
    lead_time_hours: leadTimeHours,
    preferred_time_of_day: preferredTime,
    preferred_day_of_week: preferredDay,
    channel,
    message_template: messageTemplate,
    suppress_when_completed: suppressWhenCompleted,
    last_fired_at: lastFiredAt,
  };
}

/**
 * Deterministically evaluates whether a reminder should be triggered or scheduled.
 */
export function evaluateReminderPolicy(
  policy: ReminderPolicy,
  progress: CommitmentProgress,
  entityTitle: string,
  entityId: string,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): ReminderEvaluationResult {
  if (!policy.enabled) {
    return {
      should_notify: false,
      scheduled_at: null,
      reason: 'policy_disabled',
    };
  }

  // 1. Suppression on completion
  if (policy.suppress_when_completed && progress.is_completed) {
    return {
      should_notify: false,
      scheduled_at: null,
      reason: 'suppressed_already_completed',
    };
  }

  const now = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
  const nowMs = now.getTime();
  const windowStartMs = new Date(progress.period_window.start).getTime();
  const windowEndMs = new Date(progress.period_window.end).getTime();

  // 2. Check if already fired in this active period window
  if (policy.last_fired_at) {
    const lastFiredMs = new Date(policy.last_fired_at).getTime();
    if (lastFiredMs >= windowStartMs && lastFiredMs <= windowEndMs) {
      return {
        should_notify: false,
        scheduled_at: null,
        reason: 'already_fired',
      };
    }
  }

  // 3. Evaluate trigger timing
  const leadHours = policy.lead_time_hours ?? 24;
  const targetTriggerMs = windowEndMs - leadHours * 3600 * 1000;
  const scheduledDate = new Date(targetTriggerMs);

  // Parse preferred time of day (e.g. '18:00')
  if (policy.preferred_time_of_day) {
    const [hoursStr, minutesStr] = policy.preferred_time_of_day.split(':');
    const h = parseInt(hoursStr, 10);
    const m = parseInt(minutesStr, 10);
    if (!isNaN(h) && !isNaN(m)) {
      scheduledDate.setUTCHours(h, m, 0, 0);
    }
  }

  // Check if preferred day of week matches (e.g. 0 = Sunday)
  if (typeof policy.preferred_day_of_week === 'number') {
    // Walk back or forward within period window to match the day of week
    const diff = (policy.preferred_day_of_week - scheduledDate.getUTCDay() + 7) % 7;
    scheduledDate.setUTCDate(scheduledDate.getUTCDate() + diff);
  }

  const scheduledIso = scheduledDate.toISOString();
  const isTimeForReminder = nowMs >= scheduledDate.getTime();

  const title = `Reminder: ${entityTitle}`;
  const remaining = progress.target_count - progress.current_count;
  const body = policy.message_template
    ? policy.message_template.replace('{remaining}', String(remaining)).replace('{title}', entityTitle)
    : `You have ${remaining} ${progress.unit} remaining for ${progress.period_window.label}.`;

  if (isTimeForReminder) {
    return {
      should_notify: true,
      scheduled_at: scheduledIso,
      reason: 'incomplete_period_approaching',
      notification_payload: {
        title,
        body,
        channel: policy.channel,
        entity_id: entityId,
        scheduled_at: scheduledIso,
      },
    };
  }

  return {
    should_notify: false,
    scheduled_at: scheduledIso,
    reason: 'outside_notification_window',
    notification_payload: {
      title,
      body,
      channel: policy.channel,
      entity_id: entityId,
      scheduled_at: scheduledIso,
    },
  };
}

/**
 * Convenience helper to evaluate reminder policy directly for an Entity.
 */
export function evaluateEntityReminder(
  entity: Entity,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): ReminderEvaluationResult | null {
  const rawReminder = entity.attributes.reminder_policy || entity.attributes.reminder;
  const reminderPolicy = parseReminderPolicy(rawReminder);
  if (!reminderPolicy) return null;

  const commitmentEval = evaluateEntityCommitment(entity, undefined, referenceDate, timezone);
  if (!commitmentEval) return null;

  return evaluateReminderPolicy(reminderPolicy, commitmentEval.progress, entity.title, entity.id, referenceDate, timezone);
}

