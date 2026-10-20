export type ManagedAiLimitCode =
  | 'GUEST_TURN_ALLOWANCE_EXHAUSTED'
  | 'TURN_ALLOWANCE_EXHAUSTED'
  | 'GUEST_BRIEFING_ALLOWANCE_EXHAUSTED'
  | 'BRIEFING_ALLOWANCE_EXHAUSTED';

export interface ManagedAiLimitCopy {
  title: string;
  description: string;
  signInLabel?: string;
}

export function formatManagedAiResetAt(period: 'day' | 'month', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const resetAt = period === 'month'
    ? Date.UTC(year, month, 1) - 330 * 60_000
    : Date.UTC(year, month - 1, day + 1) - 330 * 60_000;
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(resetAt)} IST`;
}

const limitCopy: Record<ManagedAiLimitCode, {
  title: (now: Date) => string;
  description: (now: Date) => string;
  signInLabel?: (now: Date) => string;
}> = {
  GUEST_TURN_ALLOWANCE_EXHAUSTED: {
    title: () => 'Your guest AI turns are used',
    description: now => `You have used this month’s 30 guest chat turns. They reset ${formatManagedAiResetAt('month', now)}. Your workspace stays on this device. Sign in for 150 included turns each month, or use your own Gemini key.`,
    signInLabel: () => 'Sign in for more monthly chat',
  },
  TURN_ALLOWANCE_EXHAUSTED: {
    title: () => 'Your included AI turns are used',
    description: now => `You have used this month’s 150 included chat turns. They reset ${formatManagedAiResetAt('month', now)}. You can also use your own Gemini key.`,
  },
  GUEST_BRIEFING_ALLOWANCE_EXHAUSTED: {
    title: () => 'Your guest briefings are used',
    description: now => `You have used today’s guest briefing allowance. It resets ${formatManagedAiResetAt('day', now)}. Sign in for a larger daily allowance, or use your own Gemini key. Your workspace stays on this device.`,
    signInLabel: () => 'Sign in for more daily briefings',
  },
  BRIEFING_ALLOWANCE_EXHAUSTED: {
    title: () => 'Your included briefings are used',
    description: now => `You have used today’s included briefing allowance. It resets ${formatManagedAiResetAt('day', now)}. You can also use your own Gemini key.`,
  },
};

export const getManagedAiLimitCopy = (code: ManagedAiLimitCode, now = new Date()): ManagedAiLimitCopy => {
  const copy = limitCopy[code];
  return {
    title: copy.title(now),
    description: copy.description(now),
    ...(copy.signInLabel ? { signInLabel: copy.signInLabel(now) } : {}),
  };
};
