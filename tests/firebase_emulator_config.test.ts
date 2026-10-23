import { describe, expect, it } from 'vitest';
import { resolveFirebaseEmulatorMode } from '../services/firebaseEmulatorConfig';

const safeDemo = {
    requested: true,
    syncDemoRequested: true,
    isDevelopmentBuild: true,
    protocol: 'http:',
    hostname: '127.0.0.1',
    projectId: 'demo-flowmate-sync',
};

describe('Firebase emulator isolation', () => {
    it('allows only an explicitly requested demo project on a loopback development origin', () => {
        expect(resolveFirebaseEmulatorMode(safeDemo)).toBe(true);
        expect(resolveFirebaseEmulatorMode({ ...safeDemo, hostname: 'localhost' })).toBe(true);
    });

    it('leaves ordinary development and production builds on their configured Firebase services', () => {
        expect(resolveFirebaseEmulatorMode({ ...safeDemo, requested: false, syncDemoRequested: false, projectId: 'flowmate-ai' })).toBe(false);
    });

    it('fails closed if the dedicated sync demo loses its emulator opt-in', () => {
        expect(() => resolveFirebaseEmulatorMode({ ...safeDemo, requested: false }))
            .toThrow('Sync demo mode requires Firebase emulators.');
    });

    it.each([
        [{ ...safeDemo, isDevelopmentBuild: false }, 'development build'],
        [{ ...safeDemo, protocol: 'https:' }, 'loopback HTTP'],
        [{ ...safeDemo, hostname: 'flowmate-ai.web.app' }, 'loopback HTTP'],
        [{ ...safeDemo, projectId: 'flowmate-ai' }, 'demo-*'],
        [{ ...safeDemo, projectId: '' }, 'demo-*'],
    ])('fails closed for an unsafe requested emulator environment', (environment, reason) => {
        expect(() => resolveFirebaseEmulatorMode(environment)).toThrow(reason);
    });
});
