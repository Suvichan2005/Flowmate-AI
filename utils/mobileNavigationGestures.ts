export const MOBILE_GESTURE_DISTANCE_PX = 96;
export const MOBILE_GESTURE_EDGE_PX = 28;

export type MobileGestureIntent = 'open-menu' | 'open-chat' | 'refresh' | null;

export function resolveMobileGestureIntent(input: {
  deltaX: number;
  deltaY: number;
  startX: number;
  startedAtTop: boolean;
  canNavigateToChat: boolean;
}): MobileGestureIntent {
  const { deltaX, deltaY, startX, startedAtTop, canNavigateToChat } = input;
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);

  if (
    deltaY >= MOBILE_GESTURE_DISTANCE_PX &&
    startedAtTop &&
    vertical > horizontal * 1.35
  ) {
    return 'refresh';
  }

  if (horizontal < MOBILE_GESTURE_DISTANCE_PX || horizontal < vertical * 1.35) {
    return null;
  }

  if (deltaX > 0 && startX <= MOBILE_GESTURE_EDGE_PX) return 'open-menu';
  if (deltaX < 0 && canNavigateToChat) return 'open-chat';
  return null;
}
