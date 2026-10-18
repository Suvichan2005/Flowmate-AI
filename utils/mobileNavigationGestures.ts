export const MOBILE_GESTURE_DISTANCE_PX = 96;
export const MOBILE_GESTURE_EDGE_PX = 28;

export function mobileGestureThreshold(width: number): number {
  return Math.max(76, Math.min(112, Math.round(width * 0.25)));
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
  isSidebarOpen?: boolean;
  startedInSidebar?: boolean;
  distanceThresholdPx?: number;
}): MobileGestureIntent {
  const { deltaX, deltaY, startX, startedAtTop, canNavigateToChat, canReturnToView = false, isSidebarOpen = false, startedInSidebar = false } = input;
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

  if (deltaX > 0 && startX <= MOBILE_GESTURE_EDGE_PX) return 'open-menu';
  if (deltaX > 0 && canReturnToView) return 'return-view';
  if (deltaX < 0 && canNavigateToChat) return 'open-chat';
  return null;
}
