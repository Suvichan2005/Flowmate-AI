import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { isFirebaseConfigured } from '../services/firebase';

/**
 * ConnectionStatus - Displays online/offline status and triggers auto-sync on reconnection
 * Shows a subtle indicator when online, and a more prominent banner when offline
 */
const ConnectionStatus: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [showReconnected, setShowReconnected] = useState(false);
    const { syncToCloud, currentUser } = useStore();

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const handleOnline = () => {
            setIsOnline(true);
            setShowReconnected(true);

            // Auto-sync when coming back online if user is logged in
            if (currentUser && isFirebaseConfigured()) void syncToCloud();

            // Hide the reconnected indicator after 3 seconds
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => setShowReconnected(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setShowReconnected(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [currentUser, syncToCloud]);

    // Only show when offline or just reconnected
    if (isOnline && !showReconnected) {
        return null;
    }

    return (
        <>
            {/* Offline Banner - Fixed at top */}
            {!isOnline && (
                <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-600 text-white py-2 px-4 flex items-center justify-center gap-2 text-sm font-medium shadow-lg">
                    <WifiOff size={16} />
                    <span>Browser offline. Your workspace remains available locally.</span>
                </div>
            )}

            {/* Reconnected Toast - Briefly visible */}
            {isOnline && showReconnected && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white py-2 px-4 rounded-lg flex items-center gap-2 text-sm font-medium shadow-lg animate-fade-in">
                    <Wifi size={16} />
                    <span>Browser network restored</span>
                </div>
            )}
        </>
    );
};

export default ConnectionStatus;
