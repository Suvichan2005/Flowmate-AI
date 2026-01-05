import React, { useState, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

// Swipe gesture configuration
const SIDEBAR_WIDTH = 256; // w-64 = 256px
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms for quick swipe detection

export interface SwipeState {
    isActive: boolean;
    translateX: number;
    progress: number; // 0-1
    direction: 'left' | 'right' | null;
}

/**
 * Premium swipe-to-open/close sidebar gesture hook
 * - Swipe right from left half of screen to OPEN
 * - Swipe left anywhere to CLOSE (when open)
 * - Sidebar follows finger precisely
 */
export const useSwipeSidebar = (
    isOpen: boolean,
    onOpen: () => void,
    onClose: () => void
) => {
    const [swipeState, setSwipeState] = useState<SwipeState>({
        isActive: false,
        translateX: 0,
        progress: 0,
        direction: null
    });

    const startX = useRef(0);
    const startY = useRef(0);
    const startTime = useRef(0);
    const isHorizontalSwipe = useRef<boolean | null>(null);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        const touch = e.touches[0];
        startX.current = touch.clientX;
        startY.current = touch.clientY;
        startTime.current = Date.now();
        isHorizontalSwipe.current = null;

        const screenWidth = window.innerWidth;
        const isLeftHalf = touch.clientX < screenWidth * 0.5;

        // Can start swipe if:
        // - Closed and touching left half (to open)
        // - Open (to close from anywhere)
        if (!isOpen && !isLeftHalf) {
            return;
        }

        setSwipeState({
            isActive: true,
            translateX: isOpen ? SIDEBAR_WIDTH : 0,
            progress: isOpen ? 1 : 0,
            direction: null
        });
    }, [isOpen]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!swipeState.isActive) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - startX.current;
        const deltaY = touch.clientY - startY.current;

        // First move: determine if horizontal or vertical
        if (isHorizontalSwipe.current === null) {
            if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY);
                if (!isHorizontalSwipe.current) {
                    // Vertical scroll - cancel swipe
                    setSwipeState({ isActive: false, translateX: 0, progress: 0, direction: null });
                    return;
                }
            }
            return;
        }

        if (!isHorizontalSwipe.current) return;

        // Determine direction
        const direction = deltaX > 0 ? 'right' : 'left';

        // Calculate new position
        let newTranslateX: number;
        if (isOpen) {
            // Already open: can only close (swipe left)
            newTranslateX = Math.max(0, Math.min(SIDEBAR_WIDTH, SIDEBAR_WIDTH + deltaX));
        } else {
            // Closed: can only open (swipe right)
            newTranslateX = Math.max(0, Math.min(SIDEBAR_WIDTH, deltaX));
        }

        const progress = newTranslateX / SIDEBAR_WIDTH;
        setSwipeState({ isActive: true, translateX: newTranslateX, progress, direction });

        // Prevent page scroll during horizontal swipe
        e.preventDefault();
    }, [swipeState.isActive, isOpen]);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        if (!swipeState.isActive) return;

        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - startX.current;
        const duration = Date.now() - startTime.current;
        const velocity = Math.abs(deltaX) / duration;

        // Quick swipe detection (flick)
        const isQuickSwipe = velocity > SWIPE_VELOCITY_THRESHOLD && Math.abs(deltaX) > 30;

        let shouldOpen: boolean;
        if (isQuickSwipe) {
            // Quick swipe: direction determines outcome
            shouldOpen = deltaX > 0;
        } else {
            // Slow swipe: progress determines outcome
            shouldOpen = swipeState.progress > 0.35;
        }

        setSwipeState({ isActive: false, translateX: 0, progress: 0, direction: null });

        if (shouldOpen && !isOpen) {
            onOpen();
        } else if (!shouldOpen && isOpen) {
            onClose();
        }
    }, [swipeState, isOpen, onOpen, onClose]);

    return {
        swipeState,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
        }
    };
};

// Pull-to-refresh configuration
const PULL_THRESHOLD = 70; // px to trigger refresh
const MAX_PULL = 100; // max pull distance

export interface PullState {
    isPulling: boolean;
    isRefreshing: boolean;
    pullDistance: number;
    progress: number; // 0-1
}

/**
 * Premium pull-to-refresh hook with rubber-band physics
 */
export const usePullToRefresh = (
    scrollRef: React.RefObject<HTMLElement>,
    onRefresh: () => Promise<void>
) => {
    const [pullState, setPullState] = useState<PullState>({
        isPulling: false,
        isRefreshing: false,
        pullDistance: 0,
        progress: 0
    });

    const startY = useRef(0);
    const isPulling = useRef(false);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        if (pullState.isRefreshing) return;

        const scrollTop = scrollRef.current?.scrollTop || 0;
        if (scrollTop > 5) return;

        startY.current = e.touches[0].clientY;
        isPulling.current = false;
    }, [pullState.isRefreshing, scrollRef]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (pullState.isRefreshing) return;

        const scrollTop = scrollRef.current?.scrollTop || 0;
        if (scrollTop > 5) return;

        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY.current;

        if (deltaY > 10 && !isPulling.current) {
            isPulling.current = true;
        }

        if (isPulling.current && deltaY > 0) {
            // Rubber band physics: diminishing returns as you pull further
            const pullDistance = Math.min(MAX_PULL, deltaY * 0.4);
            const progress = Math.min(1, pullDistance / PULL_THRESHOLD);

            setPullState(prev => ({
                ...prev,
                isPulling: true,
                pullDistance,
                progress
            }));

            e.preventDefault();
        }
    }, [pullState.isRefreshing, scrollRef]);

    const handleTouchEnd = useCallback(async () => {
        if (!pullState.isPulling) return;

        if (pullState.progress >= 1) {
            setPullState(prev => ({ ...prev, isRefreshing: true, pullDistance: 50 }));

            try {
                await onRefresh();
            } finally {
                // Animate out
                setPullState({
                    isPulling: false,
                    isRefreshing: false,
                    pullDistance: 0,
                    progress: 0
                });
            }
        } else {
            setPullState({
                isPulling: false,
                isRefreshing: false,
                pullDistance: 0,
                progress: 0
            });
        }
    }, [pullState, onRefresh]);

    return {
        pullState,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
        }
    };
};

/**
 * Premium pull-to-refresh indicator with smooth animations
 */
export const PullToRefreshIndicator: React.FC<{ state: PullState }> = ({ state }) => {
    if (!state.isPulling && !state.isRefreshing) return null;

    return (
        <div
            className="absolute left-0 right-0 flex items-center justify-center z-20 pointer-events-none"
            style={{
                top: 0,
                transform: `translateY(${state.pullDistance - 30}px)`,
                opacity: Math.min(1, state.progress * 1.5),
                transition: !state.isPulling ? 'transform 0.3s ease-out, opacity 0.2s ease-out' : 'none'
            }}
        >
            <div
                className={`w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30`}
                style={{
                    transform: `scale(${0.8 + state.progress * 0.2})`,
                    transition: !state.isPulling ? 'transform 0.2s ease-out' : 'none'
                }}
            >
                <RefreshCw
                    size={20}
                    className={`text-white ${state.isRefreshing ? 'animate-spin' : ''}`}
                    style={{
                        transform: !state.isRefreshing ? `rotate(${state.progress * 360}deg)` : undefined,
                        transition: !state.isPulling && !state.isRefreshing ? 'transform 0.2s ease-out' : 'none'
                    }}
                />
            </div>
        </div>
    );
};

export default { useSwipeSidebar, usePullToRefresh, PullToRefreshIndicator };
