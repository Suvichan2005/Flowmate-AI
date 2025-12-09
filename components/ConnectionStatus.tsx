import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useStore } from '../store';

/**
 * ConnectionStatus - Displays online/offline status and triggers auto-sync on reconnection
 * Shows a subtle indicator when online, and a more prominent banner when offline
 */
const ConnectionStatus: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [showReconnected, setShowReconnected] = useState(false);
    const { syncToCloud, currentUser, addToast } = useStore();

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setShowReconnected(true);

            // Auto-sync when coming back online if user is logged in
            if (currentUser) {
                addToast('Connection restored - syncing...', 'info');
                syncToCloud().then(() => {
                    addToast('Sync complete!', 'success');
                }).catch((err) => {
                    console.error('[ConnectionStatus] Auto-sync failed:', err);
                    addToast('Auto-sync failed', 'error');
                });
            }

            // Hide the reconnected indicator after 3 seconds
            setTimeout(() => setShowReconnected(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setShowReconnected(false);
            addToast('You are offline - changes will sync when connected', 'info');
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [currentUser, syncToCloud, addToast]);

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
                    <span>You're offline - changes will sync when you reconnect</span>
                </div>
            )}

            {/* Reconnected Toast - Briefly visible */}
            {isOnline && showReconnected && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white py-2 px-4 rounded-lg flex items-center gap-2 text-sm font-medium shadow-lg animate-fade-in">
                    <Wifi size={16} />
                    <span>Back online!</span>
                    <RefreshCw size={14} className="animate-spin ml-1" />
                </div>
            )}
        </>
    );
};

export default ConnectionStatus;
