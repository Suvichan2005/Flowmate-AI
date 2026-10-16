/**
 * Flowmate Web Platform — Haptics Adapter (P1-08)
 *
 * Implements HapticsPort using the HTML5 Vibration API.
 * Safely no-ops in desktop environments or unsupported browsers.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  HapticsPort,
  HapticImpactStyle,
  HapticNotificationType,
} from '../ports';

export class WebHapticsAdapter implements HapticsPort {
  async impact(style: HapticImpactStyle = 'medium'): Promise<void> {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    const durations: Record<HapticImpactStyle, number> = {
      light: 10,
      medium: 20,
      heavy: 40,
    };
    navigator.vibrate(durations[style]);
  }

  async notification(type: HapticNotificationType = 'success'): Promise<void> {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    const patterns: Record<HapticNotificationType, number[]> = {
      success: [10, 30, 10],
      warning: [30, 20, 30],
      error: [50, 30, 50],
    };
    navigator.vibrate(patterns[type]);
  }

  async selectionClick(): Promise<void> {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    navigator.vibrate(5);
  }
}
