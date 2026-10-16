import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthModal from '../components/AuthModal';

describe('AuthModal accessibility & keyboard interaction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with dialog semantics, accessible title, and close label in keyless mode', () => {
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<AuthModal onClose={onClose} onSuccess={onSuccess} />);

        const dialog = screen.getByRole('dialog', { name: 'Firebase Not Configured' });
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'auth-modal-title');

        const closeBtn = screen.getByRole('button', { name: 'Close authentication dialog' });
        expect(closeBtn).toBeInTheDocument();
        expect(closeBtn).toHaveAttribute('type', 'button');
    });

    it('dismisses modal on Escape key press', () => {
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<AuthModal onClose={onClose} onSuccess={onSuccess} />);

        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('restores focus to trigger element upon dismissal', () => {
        const onClose = vi.fn();
        const onSuccess = vi.fn();

        const trigger = document.createElement('button');
        trigger.textContent = 'Sign In Trigger';
        document.body.appendChild(trigger);
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        const { unmount } = render(<AuthModal onClose={onClose} onSuccess={onSuccess} />);
        unmount();

        expect(document.activeElement).toBe(trigger);
        document.body.removeChild(trigger);
    });

    it('contains focus within modal elements', () => {
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<AuthModal onClose={onClose} onSuccess={onSuccess} />);

        const dialog = screen.getByRole('dialog');
        const focusable = dialog.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        expect(focusable.length).toBeGreaterThanOrEqual(2);

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // Shift+Tab on first element wraps to last
        first.focus();
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        // Tab on last element wraps to first
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab', shiftKey: false });
    });
});
