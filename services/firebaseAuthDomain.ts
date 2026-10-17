/**
 * Firebase redirect auth must share the app's origin on browsers that partition
 * third-party storage. Keep the override to Flowmate's known Hosting origins;
 * never derive an auth helper origin from an arbitrary Host header.
 */
const FLOWMATE_HOSTING_AUTH_ORIGINS = new Set([
    'flowmate-ai.web.app',
    'flowmate-ai--managed-ai-preview-8jatmmwd.web.app',
]);

export const resolveFirebaseAuthDomain = (hostname: string, configuredDomain: string): string => {
    const normalizedHost = hostname.trim().toLowerCase();
    return FLOWMATE_HOSTING_AUTH_ORIGINS.has(normalizedHost) ? normalizedHost : configuredDomain;
};
