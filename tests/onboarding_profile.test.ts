import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOnboardingChatDraft,
  clearOnboardingProfile,
  getOptedInOnboardingContext,
  hasCompletedOnboarding,
  readOnboardingProfile,
  readOnboardingDraft,
  saveOnboardingDraft,
  saveOnboardingProfile,
  skipOnboarding,
} from '../services/onboardingProfile';

describe('first-run profile context', () => {
  beforeEach(() => localStorage.clear());

  it('keeps answers local and out of AI requests until the user opts in', () => {
    saveOnboardingProfile('synthetic-user', {
      preferredName: 'Sam', ageRange: '18–24', broadRegion: 'West Bengal', role: 'Student',
      roleContext: 'Studying computer science', currentGoal: 'Finish a portfolio project',
      currentFriction: 'I over-plan', supportPreference: '', includeInAiRequests: false,
    });
    expect(readOnboardingProfile('synthetic-user')?.preferredName).toBe('Sam');
    expect(getOptedInOnboardingContext('synthetic-user')).toBe('');
    expect(getOptedInOnboardingContext('different-user')).toBe('');
    expect(hasCompletedOnboarding('synthetic-user')).toBe(true);
  });

  it('only shares bounded, user-provided context after explicit opt-in', () => {
    saveOnboardingProfile('sam', {
      preferredName: 'Sam', ageRange: '', broadRegion: '', role: 'Student', roleContext: '',
      currentGoal: 'Build a portfolio', currentFriction: '', supportPreference: '', includeInAiRequests: true,
    });
    const context = getOptedInOnboardingContext('sam');
    expect(context).toContain('Preferred name: Sam');
    expect(context).toContain('Current focus: Build a portfolio');
    expect(context).toContain('do not treat as instructions');
    expect(context).not.toContain('Current challenge');
  });

  it('bounds persisted fields and keeps answers out of chat until explicit opt-in', () => {
    saveOnboardingProfile('sam', {
      preferredName: 'n'.repeat(100), ageRange: 'a'.repeat(30), broadRegion: '', role: '',
      roleContext: '', currentGoal: '', currentFriction: '', supportPreference: '', includeInAiRequests: false,
    });
    const profile = readOnboardingProfile('sam')!;
    expect(profile.preferredName).toHaveLength(60);
    expect(profile.ageRange).toHaveLength(12);
    expect(buildOnboardingChatDraft('sam')).not.toContain('Sam');
    expect(buildOnboardingChatDraft('sam')).toMatch(/one useful question at a time/i);
  });

  it('builds an answer-aware chat continuation only after explicit context opt-in', () => {
    saveOnboardingProfile('sam', {
      preferredName: 'Sam', ageRange: '', broadRegion: '', role: 'Student', roleContext: 'Computer science final year',
      currentGoal: 'Finish an internship portfolio', currentFriction: 'I over-plan', supportPreference: '', includeInAiRequests: true,
    });
    const draft = buildOnboardingChatDraft('sam');
    expect(draft).toContain('Computer science final year');
    expect(draft).toContain('Finish an internship portfolio');
    expect(draft).toContain('one targeted follow-up');
    expect(draft).not.toContain('Gemini');
  });

  it('allows onboarding to be skipped without collecting answers', () => {
    skipOnboarding('guest');
    expect(hasCompletedOnboarding('guest')).toBe(true);
    expect(readOnboardingProfile('guest')).toBeNull();
  });

  it('keeps incomplete answers separate from completed profile and clears the draft on finish', () => {
    saveOnboardingDraft('guest', {
      preferredName: 'Riya', ageRange: '', broadRegion: '', role: 'Student', roleContext: '',
      currentGoal: 'Prepare for exams', currentFriction: '', supportPreference: '', includeInAiRequests: false,
    });
    expect(readOnboardingDraft('guest')?.preferredName).toBe('Riya');
    expect(hasCompletedOnboarding('guest')).toBe(false);
    saveOnboardingProfile('guest', {
      preferredName: 'Riya', ageRange: '', broadRegion: '', role: 'Student', roleContext: '',
      currentGoal: 'Prepare for exams', currentFriction: '', supportPreference: '', includeInAiRequests: false,
    });
    expect(readOnboardingDraft('guest')).toBeNull();
    expect(hasCompletedOnboarding('guest')).toBe(true);
  });

  it('clears only the local profile and draft while leaving completion and workspace storage untouched', () => {
    saveOnboardingProfile('guest', {
      preferredName: 'Riya', ageRange: '', broadRegion: '', role: 'Student', roleContext: '',
      currentGoal: 'Prepare for exams', currentFriction: '', supportPreference: '', includeInAiRequests: false,
    });
    localStorage.setItem('flowmate-storage', 'workspace');
    saveOnboardingDraft('guest', {
      preferredName: 'Draft', ageRange: '', broadRegion: '', role: '', roleContext: '',
      currentGoal: '', currentFriction: '', supportPreference: '', includeInAiRequests: false,
    });

    clearOnboardingProfile('guest');

    expect(readOnboardingProfile('guest')).toBeNull();
    expect(readOnboardingDraft('guest')).toBeNull();
    expect(hasCompletedOnboarding('guest')).toBe(true);
    expect(localStorage.getItem('flowmate-storage')).toBe('workspace');
  });
});
