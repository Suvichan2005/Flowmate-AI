import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingFlow, { targetedQuestion, targetedSupportQuestion } from '../components/OnboardingFlow';
import { hasCompletedOnboarding, readOnboardingDraft, readOnboardingProfile } from '../services/onboardingProfile';

describe('adaptive first-run onboarding', () => {
  beforeEach(() => localStorage.clear());
  it('offers an existing-account path without requiring sign-in for guests', () => {
    const signIn = vi.fn();
    render(<OnboardingFlow identity="guest" onClose={vi.fn()} onSignIn={signIn} onContinueInChat={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /make flowmate yours/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /already have an account/i }));
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('asks a role-specific follow-up and allows a natural chat continuation', () => {
    const continueInChat = vi.fn();
    render(<OnboardingFlow identity="guest" onClose={vi.fn()} onSignIn={vi.fn()} onContinueInChat={continueInChat} />);
    fireEvent.click(screen.getByRole('button', { name: /continue as a guest/i }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Student' }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.getByLabelText(/what are you studying/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.change(screen.getByLabelText(/what is one thing you want flowmate/i), { target: { value: 'Build a stronger portfolio' } });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue setup in chat/i }));
    expect(continueInChat).toHaveBeenCalledOnce();
  });

  it('branches follow-up questions on the selected context', () => {
    expect(targetedQuestion('Working professional').label).toMatch(/work or team/i);
    expect(targetedQuestion('Building something').label).toMatch(/building/i);
    expect(targetedQuestion('Other').label).toMatch(/typical week/i);
  });

  it('adapts the next prompt to the stated goal or obstacle without a hidden model call', () => {
    expect(targetedSupportQuestion({ role: 'Student', roleContext: '', currentGoal: 'Pass my final exam', currentFriction: '' }).label)
      .toMatch(/study week/i);
    expect(targetedSupportQuestion({ role: 'Building something', roleContext: '', currentGoal: 'Launch an app', currentFriction: '' }).label)
      .toMatch(/smallest milestone/i);
    expect(targetedSupportQuestion({ role: 'Other', roleContext: '', currentGoal: '', currentFriction: 'I get distracted in the evening' }).label)
      .toMatch(/pulls your attention away/i);
    expect(targetedSupportQuestion({ role: 'Student', roleContext: 'Classes and commuting fill my week', currentGoal: '', currentFriction: '' }).label)
      .toMatch(/realistically have a little room/i);
  });

  it('keeps a dismissed in-progress profile resumable without marking setup complete', () => {
    const close = vi.fn();
    render(<OnboardingFlow identity="guest" onClose={close} onSignIn={vi.fn()} onContinueInChat={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continue as a guest/i }));
    fireEvent.change(screen.getByLabelText(/what should flowmate call you/i), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /close onboarding/i }));
    expect(close).toHaveBeenCalledOnce();
    expect(readOnboardingDraft('guest')?.preferredName).toBe('Sam');
    expect(readOnboardingProfile('guest')).toBeNull();
    expect(hasCompletedOnboarding('guest')).toBe(false);
  });

  it('requires only role and current goal before continuing setup naturally in chat', () => {
    const continueInChat = vi.fn();
    render(<OnboardingFlow identity="guest" onClose={vi.fn()} onSignIn={vi.fn()} onContinueInChat={continueInChat} />);
    fireEvent.click(screen.getByRole('button', { name: /continue as a guest/i }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Student' }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.change(screen.getByLabelText(/what is one thing you want flowmate/i), { target: { value: 'Finish a portfolio project' } });
    fireEvent.click(screen.getByRole('button', { name: /continue setup in chat/i }));
    expect(continueInChat).toHaveBeenCalledOnce();
    expect(readOnboardingProfile('guest')?.role).toBe('Student');
    expect(readOnboardingProfile('guest')?.currentGoal).toBe('Finish a portfolio project');
  });
});
