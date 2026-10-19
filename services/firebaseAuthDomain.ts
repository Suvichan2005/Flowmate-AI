/**
 * Firebase's redirect helper must share the app's origin on web.app hosting so
 * browsers with partitioned third-party storage can complete sign-in. Keep the
 * override to the two verified Flowmate Hosting hosts; never trust arbitrary hosts.
 */
const FLOWMATE_HOSTING_AUTH_ORIGINS = new Set([
    'flowmate-ai.web.app',
    'flowmate-ai--managed-ai-preview-8jatmmwd.web.app',
]);

export const resolveFirebaseAuthDomain = (hostname: string, configuredDomain: string): string => {
    const normalizedHost = hostname.trim().toLowerCase();
    return FLOWMATE_HOSTING_AUTH_ORIGINS.has(normalizedHost) ? normalizedHost : configuredDomain;
};
