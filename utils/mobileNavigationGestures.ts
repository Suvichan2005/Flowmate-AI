export const MOBILE_GESTURE_DISTANCE_PX = 96;
export const MOBILE_GESTURE_EDGE_PX = 28;

export function mobileGestureThreshold(width: number): number {
  return Math.max(68, Math.min(96, Math.round(width * 0.22)));
}

export function mobileSidebarOpenThreshold(width: number): number {
  return Math.max(56, Math.min(76, Math.round(width * 0.17)));
}

export function mobileSidebarCloseThreshold(width: number): number {
  return Math.max(64, Math.round(mobileGestureThreshold(width) * 0.72));
}

export type MobileGestureIntent = 'open-menu' | 'close-menu' | 'open-chat' | 'return-view' | 'refresh' | null;

export function resolveMobileGestureIntent(input: {
  deltaX: number;
  deltaY: number;
  startX: number;
  startedAtTop: boolean;
  canNavigateToChat: boolean;
  canReturnToView?: boolean;
  canOpenSidebar?: boolean;
  isSidebarOpen?: boolean;
  startedInSidebar?: boolean;
  distanceThresholdPx?: number;
}): MobileGestureIntent {
  const { deltaX, deltaY, startedAtTop, canNavigateToChat, canReturnToView = false, canOpenSidebar = true, isSidebarOpen = false, startedInSidebar = false } = input;
  const threshold = input.distanceThresholdPx ?? MOBILE_GESTURE_DISTANCE_PX;
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);

  if (isSidebarOpen) {
    return startedInSidebar && deltaX <= -threshold && horizontal > vertical * 1.35
      ? 'close-menu'
      : null;
  }

  if (
    deltaY >= threshold &&
    startedAtTop &&
    vertical > horizontal * 1.35
  ) {
    return 'refresh';
  }

  if (horizontal < threshold || horizontal < vertical * 1.35) {
    return null;
  }

  if (deltaX > 0 && canOpenSidebar) return 'open-menu';
  if (deltaX > 0 && canReturnToView) return 'return-view';
  if (deltaX < 0 && canNavigateToChat) return 'open-chat';
  return null;
}
