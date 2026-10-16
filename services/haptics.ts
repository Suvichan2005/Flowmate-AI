/**
 * Flowmate Haptics Service (P1-08)
 *
 * Facade bridging application callers to the active Platform Haptics Adapter.
 * Pure delegation to getPlatform().haptics, keeping zero-any invariants.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { getPlatform } from './platform/registry';
import { HapticImpactStyle } from './platform/ports';

export type ImpactStyle = HapticImpactStyle;

export const haptics = {
  async impact(style: ImpactStyle = 'medium'): Promise<void> {
    return getPlatform().haptics.impact(style);
  },

  async success(): Promise<void> {
    return getPlatform().haptics.notification('success');
  },

  async warning(): Promise<void> {
    return getPlatform().haptics.notification('warning');
  },

  async error(): Promise<void> {
    return getPlatform().haptics.notification('error');
  },

  async selectionClick(): Promise<void> {
    return getPlatform().haptics.selectionClick();
  },
};
