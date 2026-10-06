import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Download, Bug } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary - Catches React errors and prevents app crash
 * 
 * Features:
 * - Displays friendly error message
 * - Offers recovery options (reload, export data)
 * - Logs errors for debugging
 * - Prevents complete app crash
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log to console for debugging
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

        this.setState({ errorInfo });

        // Error tracking hook — integrate your preferred service here (e.g. Sentry)
        // Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    }

    handleReload = (): void => {
        window.location.reload();
    };

    handleExportData = (): void => {
        try {
            // Attempt to export data from localStorage for recovery
            const storageKey = 'flowmate-storage';
            const data = localStorage.getItem(storageKey);
            
            if (data) {
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `flowmate_recovery_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                alert('No data found in storage to export.');
            }
        } catch (exportError) {
            console.error('[ErrorBoundary] Failed to export data:', exportError);
            alert('Failed to export data. Check console for details.');
        }
    };

    handleClearAndReload = (): void => {
        if (confirm('This will clear all local data and reload. Your cloud data (if synced) will be preserved. Continue?')) {
            try {
                localStorage.removeItem('flowmate-storage');
                window.location.reload();
            } catch (e) {
                console.error('[ErrorBoundary] Failed to clear storage:', e);
                window.location.reload();
            }
        }
    };

    render(): ReactNode {
        if (this.state.hasError) {
            const { error, errorInfo } = this.state;
            const isChunkError = error?.message?.includes('dynamically imported module') ||
                error?.message?.includes('Loading chunk') ||
                error?.message?.includes('module script failed');

            return (
                <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
                    <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-6">
                            <div className={`p-3 rounded-xl ${isChunkError ? 'bg-indigo-500/10' : 'bg-red-500/10'}`}>
                                {isChunkError ? (
                                    <RefreshCw className="w-8 h-8 text-indigo-400" />
                                ) : (
                                    <AlertTriangle className="w-8 h-8 text-red-400" />
                                )}
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-slate-100">
                                    {isChunkError ? 'New Update Available' : 'Something went wrong'}
                                </h1>
                                <p className="text-sm text-slate-400">
                                    {isChunkError ? 'A newer version of Flowmate has been deployed.' : 'Flowmate encountered an unexpected error'}
                                </p>
                            </div>
                        </div>

                        {/* Error Details */}
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 mb-6">
                            <p className={`text-sm font-medium mb-2 ${isChunkError ? 'text-indigo-300' : 'text-red-400'}`}>
                                {isChunkError ? 'The application assets were updated on the server. Reloading will refresh your session cleanly.' : `${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`}
                            </p>
                            {errorInfo?.componentStack && (
                                <details className="mt-2">
                                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                                        Show technical details
                                    </summary>
                                    <pre className="mt-2 text-xs text-slate-600 overflow-auto max-h-32 whitespace-pre-wrap">
                                        {errorInfo.componentStack}
                                    </pre>
                                </details>
                            )}
                        </div>

                        {/* Recovery Actions */}
                        <div className="space-y-3">
                            <button
                                onClick={this.handleReload}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
                            >
                                <RefreshCw size={18} />
                                Reload Application
                            </button>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={this.handleExportData}
                                    className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Download size={16} />
                                    Export Data
                                </button>

                                <button
                                    onClick={this.handleClearAndReload}
                                    className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Bug size={16} />
                                    Clear & Reload
                                </button>
                            </div>
                        </div>

                        {/* Help Text */}
                        <p className="text-xs text-slate-500 mt-4 text-center">
                            If this keeps happening, try exporting your data and then clearing storage.
                            <br />
                            Your synced cloud data will be restored on next sign-in.
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
