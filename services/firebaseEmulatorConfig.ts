export interface FirebaseEmulatorEnvironment {
    requested: boolean;
    syncDemoRequested?: boolean;
    isDevelopmentBuild: boolean;
    protocol: string;
    hostname: string;
    projectId: string;
}

/**
 * Resolve the emulator opt-in before initializing any Firebase service.
 * An explicit emulator request must never fall through to the configured
 * production project if its build, origin, or project identity is unsafe.
 */
export const resolveFirebaseEmulatorMode = (environment: FirebaseEmulatorEnvironment): boolean => {
    if (environment.syncDemoRequested && !environment.requested) {
        throw new Error('Sync demo mode requires Firebase emulators.');
    }
    if (!environment.requested) return false;

    if (!environment.isDevelopmentBuild) {
        throw new Error('Firebase emulator mode requires a development build.');
    }
    if (environment.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(environment.hostname)) {
        throw new Error('Firebase emulator mode requires a loopback HTTP origin.');
    }
    if (!/^demo-[a-z0-9-]+$/.test(environment.projectId)) {
        throw new Error('Firebase emulator mode requires a demo-* Firebase project ID.');
    }

    return true;
};
