import { Entity, EntityKind, EntityStatus } from '../../types';

/** Read-only, deterministic workspace summaries. Never impersonates an AI response. */
export function describeLocalRequest(query: string, entities: Entity[], now = new Date()): string {
  const active = entities.filter(e => !e.metadata?.deleted && e.status !== EntityStatus.ARCHIVED);
  if (/\b(task|tasks|todo|due|briefing|summary)\b/i.test(query)) {
    const tasks = active.filter(e => e.kind === EntityKind.TASK && e.status === EntityStatus.ACTIVE);
    const overdue = tasks.filter(e => e.deadline && new Date(e.deadline) < now);
    return 'Local task summary: ' + tasks.length + ' active; ' + overdue.length + ' overdue.'
      + (tasks.length ? '\n\n' + tasks.slice(0, 10).map(e => '- ' + e.title).join('\n') : ' Create a task with New to start planning.')
      + '\n\nThis is calculated from your workspace. Gemini is not configured for an AI response.';
  }
  if (/\b(schedule|events|calendar)\b/i.test(query)) {
    const events = active.filter(e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time).toDateString() === now.toDateString());
    return 'Local schedule: ' + events.length + ' event(s) today.' + (events.length ? '\n\n' + events.map(e => '- ' + e.title).join('\n') : '')
      + '\n\nCalculated from saved events; no AI request was made.';
  }
  return 'Your message is saved in this conversation. Gemini is not configured, so no AI request was made. You can use New, search your workspace, or ask for a local task or schedule summary. Configure Gemini in Settings for AI assistance.';
}
