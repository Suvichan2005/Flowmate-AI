export const MOBILE_GESTURE_DISTANCE_PX = 96;
export const MOBILE_GESTURE_EDGE_PX = 28;

export function mobileGestureThreshold(width: number): number {
  return Math.max(76, Math.min(112, Math.round(width * 0.25)));
}

export type MobileGestureIntent = 'open-menu' | 'open-chat' | 'refresh' | null;

export function resolveMobileGestureIntent(input: {
  deltaX: number;
  deltaY: number;
  startX: number;
  startedAtTop: boolean;
  canNavigateToChat: boolean;
  distanceThresholdPx?: number;
}): MobileGestureIntent {
  const { deltaX, deltaY, startX, startedAtTop, canNavigateToChat } = input;
  const threshold = input.distanceThresholdPx ?? MOBILE_GESTURE_DISTANCE_PX;
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);

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
  if (deltaX < 0 && canNavigateToChat) return 'open-chat';
  return null;
}
