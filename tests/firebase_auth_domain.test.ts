import { describe, expect, it } from 'vitest';
import { resolveFirebaseAuthDomain } from '../services/firebaseAuthDomain';

describe('Firebase Hosting Auth domain', () => {
    it('uses the production Hosting origin as its Auth helper domain', () => {
        expect(resolveFirebaseAuthDomain('flowmate-ai.web.app', 'flowmate-ai.firebaseapp.com'))
            .toBe('flowmate-ai.web.app');
    });

    it('uses the preview Hosting origin as its Auth helper domain', () => {
        expect(resolveFirebaseAuthDomain('flowmate-ai--managed-ai-preview-8jatmmwd.web.app', 'flowmate-ai.firebaseapp.com'))
            .toBe('flowmate-ai--managed-ai-preview-8jatmmwd.web.app');
    });

    it('does not trust an arbitrary web.app host as an Auth helper origin', () => {
        expect(resolveFirebaseAuthDomain('flowmate-impostor.web.app', 'flowmate-ai.firebaseapp.com'))
            .toBe('flowmate-ai.firebaseapp.com');
        expect(resolveFirebaseAuthDomain('localhost', 'flowmate-ai.firebaseapp.com'))
            .toBe('flowmate-ai.firebaseapp.com');
    });
});
