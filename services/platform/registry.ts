/**
 * Flowmate Greenfield Platform Core — Registry (P1-08)
 *
 * Provides central access to the active platform adapter.
 * Defaults to NullPlatformAdapter in headless/Node/test environments.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { PlatformPort } from './ports';
import { NullPlatformAdapter } from './nullAdapter';

let activePlatform: PlatformPort = new NullPlatformAdapter();

/**
 * Returns the currently active platform implementation.
 */
export function getPlatform(): PlatformPort {
  return activePlatform;
}

/**
 * Sets the active platform implementation.
 * Invoked by host shell (e.g. Web bootstrap) during startup.
 */
export function setPlatform(platform: PlatformPort): void {
  activePlatform = platform;
}

/**
 * Resets the active platform back to NullPlatformAdapter.
 * Useful for test teardowns.
 */
export function resetPlatform(): void {
  activePlatform = new NullPlatformAdapter();
}
