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

const limitCopy: Record<ManagedAiLimitCode, ManagedAiLimitCopy> = {
  GUEST_TURN_ALLOWANCE_EXHAUSTED: {
    title: 'Your guest AI turns are used',
    description: 'You have used this month’s 30 guest chat turns. Your current workspace stays on this device. Sign in for 150 included turns each month, or use your own Gemini key.',
    signInLabel: 'Sign in for more monthly chat',
  },
  TURN_ALLOWANCE_EXHAUSTED: {
    title: 'Your included AI turns are used',
    description: 'You have used this month’s 150 included chat turns. They reset next month; you can also use your own Gemini key.',
  },
  GUEST_BRIEFING_ALLOWANCE_EXHAUSTED: {
    title: 'Your guest briefings are used',
    description: 'You have used today’s guest briefing allowance. Sign in to unlock a larger daily allowance, or use your own Gemini key. Your current workspace stays on this device.',
    signInLabel: 'Sign in for more daily briefings',
  },
  BRIEFING_ALLOWANCE_EXHAUSTED: {
    title: 'Your included briefings are used',
    description: 'You have used today’s included briefing allowance. It resets at midnight IST; you can also use your own Gemini key.',
  },
};

export const getManagedAiLimitCopy = (code: ManagedAiLimitCode): ManagedAiLimitCopy => limitCopy[code];
