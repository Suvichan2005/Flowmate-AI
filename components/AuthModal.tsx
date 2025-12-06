import React, { useState } from 'react';
import { Mail, Lock, User, LogIn, UserPlus, X, Loader2, AlertCircle } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, isFirebaseConfigured } from '../services/firebase';

interface AuthModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess }) => {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isConfigured = isFirebaseConfigured();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) return;

        setLoading(true);
        setError(null);

        const result = mode === 'signin'
            ? await signInWithEmail(email, password)
            : await signUpWithEmail(email, password);

        setLoading(false);

        if (result.error) {
            setError(result.error);
        } else {
            onSuccess();
        }
    };

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError(null);

        const result = await signInWithGoogle();

        setLoading(false);

        if (result.error) {
            setError(result.error);
        } else {
            onSuccess();
        }
    };

    if (!isConfigured) {
        return (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-slate-100">Firebase Not Configured</h2>
                        <button onClick={onClose} className="text-slate-500 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
                        <div className="flex gap-2 text-amber-400">
                            <AlertCircle size={20} />
                            <div>
                                <p className="font-medium">Configuration Required</p>
                                <p className="text-sm text-amber-300/80 mt-1">
                                    To enable cloud sync and authentication, add your Firebase config to environment variables:
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-400 overflow-x-auto">
                        <p>VITE_FIREBASE_API_KEY=your_key</p>
                        <p>VITE_FIREBASE_AUTH_DOMAIN=project.firebaseapp.com</p>
                        <p>VITE_FIREBASE_PROJECT_ID=your_project</p>
                        <p>VITE_FIREBASE_STORAGE_BUCKET=project.appspot.com</p>
                        <p>VITE_FIREBASE_MESSAGING_SENDER_ID=123456789</p>
                        <p>VITE_FIREBASE_APP_ID=1:123:web:abc</p>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-100">
                        {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">
                        {error}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 text-slate-600 w-4 h-4" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-10 pr-3 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 text-slate-600 w-4 h-4" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-10 pr-3 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                required
                                minLength={6}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                        {loading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : mode === 'signin' ? (
                            <>
                                <LogIn size={18} /> Sign In
                            </>
                        ) : (
                            <>
                                <UserPlus size={18} /> Sign Up
                            </>
                        )}
                    </button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-4 my-4">
                    <div className="flex-1 h-px bg-slate-800"></div>
                    <span className="text-xs text-slate-600">or</span>
                    <div className="flex-1 h-px bg-slate-800"></div>
                </div>

                {/* Google Sign In */}
                <button
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                {/* Toggle Mode */}
                <p className="text-center text-sm text-slate-500 mt-4">
                    {mode === 'signin' ? (
                        <>
                            Don't have an account?{' '}
                            <button onClick={() => setMode('signup')} className="text-indigo-400 hover:text-indigo-300">
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            Already have an account?{' '}
                            <button onClick={() => setMode('signin')} className="text-indigo-400 hover:text-indigo-300">
                                Sign in
                            </button>
                        </>
                    )}
                </p>
            </div>
        </div>
    );
};

export default AuthModal;
