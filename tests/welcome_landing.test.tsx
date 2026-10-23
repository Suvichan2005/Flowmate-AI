import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WelcomeLanding from '../components/WelcomeLanding';

describe('first-visit welcome', () => {
  it('offers local guest use, account creation, and sign-in as separate choices', () => {
    const onContinueAsGuest = vi.fn();
    const onCreateAccount = vi.fn();
    const onSignIn = vi.fn();
    const onPersonalize = vi.fn();
    render(<WelcomeLanding onContinueAsGuest={onContinueAsGuest} onPersonalize={onPersonalize} onCreateAccount={onCreateAccount} onSignIn={onSignIn} />);

    expect(screen.getByRole('heading', { name: /your ideas, plans and next steps/i })).toBeInTheDocument();
    expect(screen.getByText(/workspace stays in this browser unless you explicitly enable cloud sync/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /explore as a guest/i }));
    fireEvent.click(screen.getByRole('button', { name: /personalize first/i }));
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(onContinueAsGuest).toHaveBeenCalledOnce();
    expect(onPersonalize).toHaveBeenCalledOnce();
    expect(onCreateAccount).toHaveBeenCalledOnce();
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
