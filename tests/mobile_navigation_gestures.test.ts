import { describe, expect, it } from 'vitest';
import {
  MOBILE_GESTURE_DISTANCE_PX,
  resolveMobileGestureIntent,
} from '../utils/mobileNavigationGestures';

describe('mobile navigation gesture intent', () => {
  it('requires a deliberate horizontal drag before changing screens', () => {
    expect(resolveMobileGestureIntent({
      deltaX: -MOBILE_GESTURE_DISTANCE_PX + 1,
      deltaY: 2,
      startX: 180,
      startedAtTop: true,
      canNavigateToChat: true,
    })).toBeNull();

    expect(resolveMobileGestureIntent({
      deltaX: -120,
      deltaY: 12,
      startX: 180,
      startedAtTop: true,
      canNavigateToChat: true,
    })).toBe('open-chat');
  });

  it('opens the side menu only for a rightward edge drag', () => {
    const fromEdge = resolveMobileGestureIntent({
      deltaX: 120,
      deltaY: 4,
      startX: 12,
      startedAtTop: true,
      canNavigateToChat: true,
    });
    const fromMiddle = resolveMobileGestureIntent({
      deltaX: 120,
      deltaY: 4,
      startX: 100,
      startedAtTop: true,
      canNavigateToChat: true,
    });
    expect(fromEdge).toBe('open-menu');
    expect(fromMiddle).toBeNull();
  });

  it('pulls to refresh only with a downward gesture at the top of a scroller', () => {
    const atTop = resolveMobileGestureIntent({
      deltaX: 5,
      deltaY: 125,
      startX: 150,
      startedAtTop: true,
      canNavigateToChat: true,
    });
    const scrolled = resolveMobileGestureIntent({
      deltaX: 5,
      deltaY: 125,
      startX: 150,
      startedAtTop: false,
      canNavigateToChat: true,
    });
    const diagonal = resolveMobileGestureIntent({
      deltaX: 110,
      deltaY: 120,
      startX: 150,
      startedAtTop: true,
      canNavigateToChat: true,
    });
    expect(atTop).toBe('refresh');
    expect(scrolled).toBeNull();
    expect(diagonal).toBeNull();
  });

  it('does not navigate to Chat when already there', () => {
    expect(resolveMobileGestureIntent({
      deltaX: -140,
      deltaY: 0,
      startX: 180,
      startedAtTop: true,
      canNavigateToChat: false,
    })).toBeNull();
  });
});
