import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const authMocks = vi.hoisted(() => ({
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithGoogle: vi.fn(),
    isFirebaseConfigured: vi.fn(),
    resendVerificationEmail: vi.fn(),
    refreshEmailVerification: vi.fn(),
}));

vi.mock('../services/firebase', () => authMocks);

import AuthModal from '../components/AuthModal';

describe('AuthModal email verification flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authMocks.isFirebaseConfigured.mockReturnValue(true);
        authMocks.signUpWithEmail.mockResolvedValue({ user: { uid: 'synthetic-user' }, error: null });
        authMocks.resendVerificationEmail.mockResolvedValue({ error: null });
        authMocks.refreshEmailVerification
            .mockResolvedValueOnce({ verified: false, error: null })
            .mockResolvedValueOnce({ verified: true, error: null });
    });

    it('keeps signup pending until Firebase confirms the email and supports resend', async () => {
        const onSuccess = vi.fn();
        render(<AuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

        fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
        fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'synthetic@example.test' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'test-only-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

        expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
        expect(authMocks.signUpWithEmail).toHaveBeenCalledWith('synthetic@example.test', 'test-only-password');
        expect(screen.getByText(/A verification link was sent/)).toBeInTheDocument();
        expect(onSuccess).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
        expect(await screen.findByText(/A new verification link was sent/)).toBeInTheDocument();
        expect(authMocks.resendVerificationEmail).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: "I've verified my email" }));
        expect(await screen.findByText(/has not confirmed this email yet/)).toBeInTheDocument();
        expect(onSuccess).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: "I've verified my email" }));
        expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
        expect(authMocks.refreshEmailVerification).toHaveBeenCalledTimes(2);
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });
});
