import { ToonOperation } from '../types';

export type InferredKind = 'TASK' | 'EVENT' | 'HABIT' | 'GOAL' | 'RESCHEDULE' | 'COMMITMENT';

export interface InferredIntent {
  raw: string;
  kind: InferredKind;
  title: string;
  timeSlot?: string;
  deadlineIso?: string;
  startTimeIso?: string;
  endTimeIso?: string;
  durationMinutes?: number;
  priority: number;
  priorityLabel: string;
  riskLevel: 'low' | 'medium' | 'high';
  diffSummary: string;
  sha256Fingerprint: string;
  operations: ToonOperation[];
}

export function pseudoSha256(input: string): string {
  let hash1 = 0x811c9dc5;
  let hash2 = 0x5a5a5a5a;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash1 ^= ch;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= (ch << 3);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const part1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  const part3 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
  const part4 = ((hash1 + hash2) >>> 0).toString(16).padStart(8, '0');
  return `sha256:${part1}${part2}${part3}${part4}`;
}

export function inferIntentFromQuery(query: string): InferredIntent | null {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;

  const lower = trimmed.toLowerCase();
  const now = new Date();

  const parseTimeParts = (str: string): { hour: number; minute: number } => {
    const clean = str.toLowerCase();
    const isPm = clean.includes('pm');
    const isAm = clean.includes('am');
    const parts = clean.replace(/[^\d:]/g, '').split(':');
    let h = parseInt(parts[0], 10) || 16;
    if (isPm && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    const m = parts[1] ? parseInt(parts[1], 10) : 0;
    return { hour: h, minute: m };
  };

  // 1. Time extraction
  const rangeMatch = trimmed.match(/\bfrom\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s+to\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\b/i);
  let startTimeIso: string;
  let endTimeIso: string;
  let durationMinutes = 60;
  let timeSlot: string | undefined;

  // 3. Date / Relative day extraction
  const isTomorrow = lower.includes('tomorrow');
  const targetDate = new Date(now);
  if (isTomorrow) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  let parsedHour = 16;
  let parsedMinute = 0;

  if (rangeMatch) {
    timeSlot = `${rangeMatch[1]} to ${rangeMatch[2]}`;
    const startP = parseTimeParts(rangeMatch[1]);
    const endP = parseTimeParts(rangeMatch[2]);
    parsedHour = startP.hour;
    parsedMinute = startP.minute;
    const startDate = new Date(targetDate);
    startDate.setHours(startP.hour, startP.minute, 0, 0);
    const endDate = new Date(targetDate);
    endDate.setHours(endP.hour, endP.minute, 0, 0);
    startTimeIso = startDate.toISOString();
    endTimeIso = endDate.toISOString();
    durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / (60 * 1000));
  } else {
    const timeMatch = trimmed.match(/\b(?:at\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)|\b(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\b|\b(\d{1,2}\s*(?:am|pm))\b)/i);
    timeSlot = timeMatch ? (timeMatch[1] || timeMatch[2] || timeMatch[3])?.trim() : undefined;

    // 2. Duration extraction (e.g., "for 90m", "45 mins", "1h", "2 hours")
    const durMatch = trimmed.match(/\b(?:for\s+)?(\d+)\s*(m|min|mins|minutes|h|hr|hours)\b/i);
    if (durMatch) {
      const val = parseInt(durMatch[1], 10);
      const unit = durMatch[2].toLowerCase();
      durationMinutes = unit.startsWith('h') ? val * 60 : val;
    }

    if (timeSlot) {
      const p = parseTimeParts(timeSlot);
      parsedHour = p.hour;
      parsedMinute = p.minute;
    }

    targetDate.setHours(parsedHour, parsedMinute, 0, 0);
    startTimeIso = targetDate.toISOString();
    const endDate = new Date(targetDate.getTime() + durationMinutes * 60 * 1000);
    endTimeIso = endDate.toISOString();
  }

  // 4. Priority detection
  let priority = 2;
  let priorityLabel = 'P2 / Normal';
  const priorityMatch = lower.match(/\b(?:p|priority\s*)([0-4])\b/i);
  if (priorityMatch) {
    const pVal = parseInt(priorityMatch[1], 10);
    priority = pVal === 0 ? 1 : pVal;
    priorityLabel = priority === 1 ? 'P1 / Critical' : priority === 2 ? 'P2 / Medium' : priority === 3 ? 'P3 / Low' : 'P4';
  } else if (lower.includes('critical') || lower.includes('urgent') || lower.includes('high priority')) {
    priority = 1;
    priorityLabel = 'P1 / Critical';
  } else if (lower.includes('low priority')) {
    priority = 3;
    priorityLabel = 'P3 / Low';
  }

  // 5. Intent Category Classification
  // A. Reschedule
  if (lower.includes('reschedule') || lower.includes('move') || lower.includes('postpone') || lower.includes('shift')) {
    let cleanTitle = trimmed.replace(/\b(reschedule|move|postpone|shift)\b/gi, '').trim();
    if (!cleanTitle) cleanTitle = 'Calendar Event';
    const title = `Reschedule: ${cleanTitle}`;
    const diff = `Shift time slot to ${timeSlot || '16:30'}. Reconcile with calendar commitments.`;
    const ops: ToonOperation[] = [{
      type: 'update_entity',
      payload: {
        title: cleanTitle,
        fields: {
          start_time: startTimeIso,
          end_time: endTimeIso
        }
      }
    }];

    return {
      raw: trimmed,
      kind: 'RESCHEDULE',
      title,
      timeSlot: timeSlot || 'Proposed 16:30 Slot',
      startTimeIso,
      endTimeIso,
      durationMinutes,
      priority,
      priorityLabel,
      riskLevel: 'medium',
      diffSummary: diff,
      sha256Fingerprint: pseudoSha256(trimmed + startTimeIso),
      operations: ops
    };
  }

  // B. Commitment / Recurring Target (Reference Workflow 1)
  const commitmentCadenceMatch = trimmed.match(
    /\b(\d+)\s*(times|sessions|hours|mins|minutes|pages|km)?\s*(?:per|a|every)\s*(day|week|month|year|daily|weekly|monthly)\b/i
  );
  const isExplicitCommitment = lower.includes('commitment') || Boolean(commitmentCadenceMatch);

  if (isExplicitCommitment) {
    let minCount = 1;
    let targetUnit = 'times';
    let period: 'day' | 'week' | 'month' | 'year' = 'week';

    if (commitmentCadenceMatch) {
      minCount = Math.max(1, parseInt(commitmentCadenceMatch[1], 10) || 1);
      targetUnit = commitmentCadenceMatch[2] ? commitmentCadenceMatch[2].toLowerCase() : 'times';
      const rawPeriod = commitmentCadenceMatch[3].toLowerCase();
      if (rawPeriod === 'day' || rawPeriod === 'daily') period = 'day';
      else if (rawPeriod === 'week' || rawPeriod === 'weekly') period = 'week';
      else if (rawPeriod === 'month' || rawPeriod === 'monthly') period = 'month';
      else if (rawPeriod === 'year' || rawPeriod === 'yearly') period = 'year';
    } else if (lower.includes('daily') || lower.includes('every day')) {
      period = 'day';
      minCount = 1;
    } else if (lower.includes('monthly')) {
      period = 'month';
      minCount = 1;
    }

    let cleanTitle = trimmed
      .replace(/\b(\d+)\s*(times|sessions|hours|mins|minutes|pages|km)?\s*(?:per|a|every)\s*(day|week|month|year|daily|weekly|monthly)\b/gi, '')
      .replace(/^(commitment:?|target:?)\s*/gi, '')
      .replace(/\b(commitment|routine|cadence)\b/gi, '')
      .trim();

    if (!cleanTitle) cleanTitle = 'Personal Commitment';
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const commitmentPayload = {
      min_count: minCount,
      period,
      target_unit: targetUnit
    };

    const diff = `+ 1 Commitment: "${cleanTitle}" [Target: ${minCount} ${targetUnit} per ${period}]`;
    const ops: ToonOperation[] = [{
      type: 'create_entity',
      payload: {
        title: cleanTitle,
        kind: 'HABIT',
        frequency: period === 'day' ? 'DAILY' : period === 'week' ? 'WEEKLY' : 'MONTHLY',
        priority,
        metadata: {
          commitment: commitmentPayload
        },
        attributes: {
          commitment: commitmentPayload
        }
      }
    }];

    return {
      raw: trimmed,
      kind: 'COMMITMENT',
      title: cleanTitle,
      durationMinutes,
      priority,
      priorityLabel,
      riskLevel: 'low',
      diffSummary: diff,
      sha256Fingerprint: pseudoSha256(trimmed + `${minCount}_${period}`),
      operations: ops
    };
  }

  // C. Event (e.g. meeting, sync, call, doctor, interview, class, or specified at time)
  const isEvent = lower.includes('meet') || lower.includes('sync') || lower.includes('call') ||
                  lower.includes('interview') || lower.includes('appointment') || lower.includes('session') ||
                  lower.includes('class') || lower.includes('doctor') || (Boolean(timeSlot) && !lower.includes('task') && !lower.includes('todo'));

  if (isEvent) {
    let cleanTitle = trimmed
      .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
      .replace(/\b(?:for\s+)?\d+\s*(?:m|min|mins|minutes|h|hr|hours)\b/gi, '')
      .replace(/\b(tomorrow|today|urgent|critical|high priority)\b/gi, '')
      .trim();
    if (!cleanTitle) cleanTitle = trimmed;
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const diff = `+ 1 Event: "${cleanTitle}" [${isTomorrow ? 'Tomorrow' : 'Today'} ${parsedHour.toString().padStart(2, '0')}:${parsedMinute.toString().padStart(2, '0')}, ${durationMinutes}m]`;
    const ops: ToonOperation[] = [{
      type: 'create_entity',
      payload: {
        title: cleanTitle,
        kind: 'EVENT',
        start_time: startTimeIso,
        end_time: endTimeIso,
        duration_minutes: durationMinutes,
        priority
      }
    }];

    return {
      raw: trimmed,
      kind: 'EVENT',
      title: cleanTitle,
      timeSlot: `${isTomorrow ? 'Tomorrow' : 'Today'}, ${parsedHour.toString().padStart(2, '0')}:${parsedMinute.toString().padStart(2, '0')}`,
      startTimeIso,
      endTimeIso,
      durationMinutes,
      priority,
      priorityLabel,
      riskLevel: priority === 1 ? 'medium' : 'low',
      diffSummary: diff,
      sha256Fingerprint: pseudoSha256(trimmed + startTimeIso),
      operations: ops
    };
  }

  // D. Habit
  if (lower.includes('daily') || lower.includes('every day') || lower.includes('habit')) {
    let cleanTitle = trimmed
      .replace(/\b(daily|every day|habit|routine)\b/gi, '')
      .trim();
    if (!cleanTitle) cleanTitle = trimmed;
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const diff = `+ 1 Habit: "${cleanTitle}" [Daily Cadence]`;
    const ops: ToonOperation[] = [{
      type: 'create_entity',
      payload: {
        title: cleanTitle,
        kind: 'HABIT',
        frequency: 'DAILY',
        priority
      }
    }];

    return {
      raw: trimmed,
      kind: 'HABIT',
      title: cleanTitle,
      durationMinutes,
      priority,
      priorityLabel,
      riskLevel: 'low',
      diffSummary: diff,
      sha256Fingerprint: pseudoSha256(trimmed),
      operations: ops
    };
  }

  // E. Goal
  if (lower.startsWith('goal:') || lower.includes('objective') || lower.includes('target:')) {
    let cleanTitle = trimmed
      .replace(/^(goal:|objective:|target:)\s*/gi, '')
      .trim();
    if (!cleanTitle) cleanTitle = trimmed;
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const diff = `+ 1 Goal: "${cleanTitle}"`;
    const ops: ToonOperation[] = [{
      type: 'create_entity',
      payload: {
        title: cleanTitle,
        kind: 'GOAL',
        priority,
        status: 'ACTIVE'
      }
    }];

    return {
      raw: trimmed,
      kind: 'GOAL',
      title: cleanTitle,
      durationMinutes,
      priority,
      priorityLabel,
      riskLevel: 'low',
      diffSummary: diff,
      sha256Fingerprint: pseudoSha256(trimmed),
      operations: ops
    };
  }

  // F. Task (Default)
  let cleanTitle = trimmed
    .replace(/\b(?:for\s+)?\d+\s*(?:m|min|mins|minutes|h|hr|hours)\b/gi, '')
    .replace(/\b(tomorrow|today|urgent|critical|high priority|todo|task:)\b/gi, '')
    .trim();
  if (!cleanTitle) cleanTitle = trimmed;
  cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

  const deadlineIso = startTimeIso;
  const diff = `+ 1 Task: "${cleanTitle}" [Deadline: ${isTomorrow ? 'Tomorrow' : 'Today'} ${parsedHour.toString().padStart(2, '0')}:${parsedMinute.toString().padStart(2, '0')}, Priority: ${priorityLabel}]`;
  const ops: ToonOperation[] = [{
    type: 'create_entity',
    payload: {
      title: cleanTitle,
      kind: 'TASK',
      deadline: deadlineIso,
      priority,
      status: 'ACTIVE'
    }
  }];

  return {
    raw: trimmed,
    kind: 'TASK',
    title: cleanTitle,
    deadlineIso,
    durationMinutes,
    priority,
    priorityLabel,
    riskLevel: priority === 1 ? 'medium' : 'low',
    diffSummary: diff,
    sha256Fingerprint: pseudoSha256(trimmed + deadlineIso),
    operations: ops
  };
}
