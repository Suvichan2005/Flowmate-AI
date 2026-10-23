import { describe, expect, it } from 'vitest';
import {
  MOBILE_GESTURE_DISTANCE_PX,
  mobileGestureThreshold,
  mobileSidebarCloseThreshold,
  mobileSidebarOpenThreshold,
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

  it('opens the side menu with a rightward drag from anywhere on a non-Chat page', () => {
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
    expect(fromMiddle).toBe('open-menu');
  });

  it('keeps Chat return swipes out of the sidebar gesture and uses a shorter deliberate edge threshold', () => {
    expect(resolveMobileGestureIntent({
      deltaX: 100, deltaY: 3, startX: 8, startedAtTop: false,
      canNavigateToChat: false, canReturnToView: true, canOpenSidebar: false,
    })).toBe('return-view');
    expect(mobileSidebarOpenThreshold(390)).toBeLessThan(mobileGestureThreshold(390));
    expect(mobileSidebarOpenThreshold(390)).toBe(66);
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

  it('returns from Chat to the prior view with a deliberate rightward drag', () => {
    expect(resolveMobileGestureIntent({
      deltaX: 120,
      deltaY: 0,
      startX: 150,
      startedAtTop: true,
      canNavigateToChat: false,
      canReturnToView: true,
      canOpenSidebar: false,
    })).toBe('return-view');
  });

  it('closes an open sidebar only after a deliberate leftward drag begun inside it', () => {
    const closeThreshold = mobileSidebarCloseThreshold(390);
    expect(resolveMobileGestureIntent({
      deltaX: -closeThreshold, deltaY: 2, startX: 100, startedAtTop: false,
      canNavigateToChat: false, isSidebarOpen: true, startedInSidebar: true,
      distanceThresholdPx: closeThreshold,
    })).toBe('close-menu');
    expect(resolveMobileGestureIntent({
      deltaX: -(closeThreshold - 1), deltaY: 2, startX: 100, startedAtTop: false,
      canNavigateToChat: false, isSidebarOpen: true, startedInSidebar: true,
      distanceThresholdPx: closeThreshold,
    })).toBeNull();
    expect(resolveMobileGestureIntent({
      deltaX: 120, deltaY: 2, startX: 10, startedAtTop: false,
      canNavigateToChat: false, isSidebarOpen: true, startedInSidebar: true,
    })).toBeNull();
    expect(resolveMobileGestureIntent({
      deltaX: -120, deltaY: 2, startX: 100, startedAtTop: false,
      canNavigateToChat: false, isSidebarOpen: true, startedInSidebar: false,
    })).toBeNull();
  });

  it('does not misfire a short return drag or override left-edge menu access', () => {
    expect(resolveMobileGestureIntent({
      deltaX: 40, deltaY: 2, startX: 140, startedAtTop: true,
      canNavigateToChat: false, canReturnToView: true,
    })).toBeNull();
    expect(resolveMobileGestureIntent({
      deltaX: 120, deltaY: 2, startX: 12, startedAtTop: true,
      canNavigateToChat: false, canReturnToView: true,
    })).toBe('open-menu');
  });
});
