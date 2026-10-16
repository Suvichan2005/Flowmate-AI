import { themeColor } from '../services/theme';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { LiveManager, LiveVoiceStatus } from '../services/liveSession';
import { useStore } from '../store';
import { 
  X, 
  Loader2, 
  User, 
  Sparkles, 
  ShieldCheck, 
  MessageSquare, 
  WifiOff, 
  AlertCircle, 
  RotateCcw,
  Volume2,
  Mic
} from 'lucide-react';

interface LiveVoiceModalProps {
  onClose: () => void;
  onFallbackToChat?: (draftText?: string) => void;
}

interface Subtitle {
  text: string;
  source: 'user' | 'model';
}

const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ onClose, onFallbackToChat }) => {
  const [status, setStatus] = useState<LiveVoiceStatus>('initializing');
  const [statusDetails, setStatusDetails] = useState<string>('');
  const [transcript, setTranscript] = useState<Subtitle[]>([]);
  const managerRef = useRef<LiveManager | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  
  // Visualizer Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  // Store Pending Ops Subscription for Two-Phase Gate Display
  const pendingOps = useStore(state => state.pendingOps);
  const clearPendingOps = useStore(state => state.clearPendingOps);

  const handleStatusChange = useCallback((s: LiveVoiceStatus, details?: string) => {
    setStatus(s);
    if (details) setStatusDetails(details);
  }, []);

  const handleTranscription = useCallback((text: string, source: 'user' | 'model') => {
    setTranscript(prev => {
      const last = prev[prev.length - 1];
      if (last && last.source === source) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      const newHistory = [...prev, { text, source }];
      if (newHistory.length > 6) newHistory.shift();
      return newHistory;
    });
  }, []);

  const initManager = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.disconnect();
    }
    const manager = new LiveManager();
    managerRef.current = manager;
    
    manager.onStatusChange = handleStatusChange;
    manager.onTranscription = handleTranscription;

    manager.connect();
  }, [handleStatusChange, handleTranscription]);

  useEffect(() => {
    initManager();

    // Horizontal soundwave visualizer loop with state-dependent gradients
    const draw = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      const manager = managerRef.current;
      const isVoiceActive = manager?.analyser && (status === 'active' || status === 'speaking' || status === 'listening');

      if (manager?.analyser && isVoiceActive) {
        const bufferLength = manager.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        manager.analyser.getByteFrequencyData(dataArray);

        const bars = 36;
        const barWidth = Math.max(3, Math.floor((width - (bars - 1) * 4) / bars));
        const spacing = 4;
        const totalW = bars * barWidth + (bars - 1) * spacing;
        const startX = Math.max(0, (width - totalW) / 2);

        const paintStart = themeColor(status === 'speaking' ? '--accent-primary' : status === 'listening' ? '--chart-series-1' : '--graph-node-secondary');
        const paintEnd = themeColor(status === 'listening' ? '--chart-series-2' : status === 'speaking' ? '--graph-edge-primary' : '--accent-primary');

        for (let i = 0; i < bars; i++) {
          const sampleIndex = Math.floor((i / bars) * (bufferLength * 0.7));
          const value = dataArray[sampleIndex] || 0;
          const percent = value / 255;
          const barHeight = Math.max(4, percent * (height - 8));

          const x = startX + i * (barWidth + spacing);
          const y = centerY - barHeight / 2;

          const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
          grad.addColorStop(0, paintStart);
          grad.addColorStop(1, paintEnd);

          ctx.fillStyle = grad;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, y, barWidth, barHeight, 2);
          } else {
            ctx.rect(x, y, barWidth, barHeight);
          }
          ctx.fill();
        }
      } else {
        // Idle / Interrupted / Fallback baseline
        const bars = 36;
        const barWidth = Math.max(3, Math.floor((width - (bars - 1) * 4) / bars));
        const spacing = 4;
        const totalW = bars * barWidth + (bars - 1) * spacing;
        const startX = Math.max(0, (width - totalW) / 2);

        let baselineColor = themeColor('--border-subtle'); // slate-700
        if (status === 'confirming_action') baselineColor = '#f59e0b'; // amber-500
        if (status === 'interrupted') baselineColor = themeColor('--accent-primary'); // indigo-400
        if (status === 'offline_fallback' || status === 'error') baselineColor = '#ef4444'; // red-500

        ctx.fillStyle = baselineColor;
        for (let i = 0; i < bars; i++) {
          const x = startX + i * (barWidth + spacing);
          const y = centerY - 2;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, y, barWidth, 4, 2);
          } else {
            ctx.rect(x, y, barWidth, 4);
          }
          ctx.fill();
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    // Close on Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('keydown', handleKeyDown);
      managerRef.current?.disconnect();
    };
  }, [initManager, status]);

  // Auto-scroll transcript drawer
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleClose = () => {
    managerRef.current?.disconnect();
    onClose();
  };

  const handleFallbackToChat = () => {
    const manager = managerRef.current;
    let draft = '';
    if (manager) {
      draft = manager.getUserTurnBuffer();
      manager.disconnect();
    }
    if (onFallbackToChat) {
      onFallbackToChat(draft);
    } else {
      onClose();
    }
  };

  const handleRetry = () => {
    initManager();
  };

  return (
    <div 
      className="w-full bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-3 shadow-xl flex flex-col gap-2.5 backdrop-blur-md animate-fade-in relative overflow-hidden"
      data-testid="live-voice-modal"
    >
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-sky-500/5 to-purple-500/5 pointer-events-none" />

      {/* Header bar: Status indicator + Actions */}
      <div className="flex items-center justify-between z-10 gap-2">
        <div className="flex items-center gap-2 min-w-0" data-testid="live-voice-status">
          {status === 'connecting' || status === 'initializing' ? (
            <>
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
              <span className="text-xs font-medium text-indigo-300 truncate">Connecting to Gemini Live...</span>
            </>
          ) : status === 'listening' ? (
            <>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-400">Listening</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">• Speak naturally</span>
            </>
          ) : status === 'speaking' ? (
            <>
              <Volume2 className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-sky-400">Gemini Live Speaking</span>
            </>
          ) : status === 'confirming_action' ? (
            <>
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-300">Action Staged for Review</span>
            </>
          ) : status === 'interrupted' ? (
            <>
              <Mic className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-indigo-300">Interrupted</span>
            </>
          ) : status === 'offline_fallback' ? (
            <>
              <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-300">Offline Fallback</span>
            </>
          ) : status === 'error' ? (
            <>
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs font-medium text-red-400 truncate">
                {statusDetails || 'Connection error'}
              </span>
            </>
          ) : status === 'active' ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-emerald-400">Gemini Live</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">• Ready</span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0" />
              <span className="text-xs text-slate-400">Disconnected</span>
            </>
          )}
        </div>

        {/* Right action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Switch to Text Chat Fallback */}
          <button
            onClick={handleFallbackToChat}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-indigo-300 hover:text-indigo-200 border border-indigo-500/20 text-xs font-medium transition-all active:scale-95"
            title="Switch to Text Chat"
            aria-label="Switch to Text Chat"
            data-testid="switch-to-chat-btn"
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">Text Chat</span>
          </button>

          {/* End Button */}
          <button
            onClick={handleClose}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-medium transition-all active:scale-95"
            title="End Voice Session (Esc)"
            aria-label="End Voice Session"
            data-testid="end-voice-btn"
          >
            <X size={13} />
            <span>End</span>
          </button>
        </div>
      </div>

      {/* Visualizer Canvas */}
      <div className="w-full h-10 flex items-center justify-center bg-slate-950/70 rounded-xl px-2 py-1 border border-slate-800/80 z-10 shadow-inner">
        <canvas
          ref={canvasRef}
          width={400}
          height={40}
          className="w-full h-full block"
          data-testid="live-voice-canvas"
        />
      </div>

      {/* Two-Phase Cryptographic Confirmation Banner (User Authority Gate) */}
      {pendingOps && pendingOps.ops.length > 0 && (
        <div 
          className="z-10 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs animate-fade-in shadow-sm gap-2"
          data-testid="staged-action-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck size={16} className="text-amber-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-amber-200 block truncate">
                Action Proposed ({pendingOps.ops.length} operation{pendingOps.ops.length > 1 ? 's' : ''})
              </span>
              <span className="text-[10px] text-amber-300/80 block truncate">
                Staged for cryptographic confirmation on screen.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                // Focus OpsPreviewForm or inform user
                const reviewEl = document.getElementById('action-review-modal');
                if (reviewEl) reviewEl.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] transition-all active:scale-95 shadow-sm"
              data-testid="review-action-btn"
            >
              Review
            </button>
            <button
              onClick={() => clearPendingOps()}
              className="p-1 rounded-lg text-amber-300 hover:text-amber-100 hover:bg-amber-500/20 transition-colors"
              title="Dismiss proposed changes"
              aria-label="Dismiss proposed changes"
              data-testid="dismiss-action-btn"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Offline / Error Recovery Card */}
      {(status === 'offline_fallback' || status === 'error') && (
        <div 
          className="z-10 p-2.5 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-between text-xs animate-fade-in gap-2"
          data-testid="error-recovery-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            {status === 'offline_fallback' ? (
              <WifiOff size={15} className="text-amber-400 shrink-0" />
            ) : (
              <AlertCircle size={15} className="text-red-400 shrink-0" />
            )}
            <span className="text-slate-200 text-[11px] truncate">
              {statusDetails || (status === 'offline_fallback' ? 'Voice unavailable offline' : 'Voice connection error')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleRetry}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium border border-slate-700 transition-all active:scale-95"
              data-testid="retry-voice-btn"
            >
              <RotateCcw size={11} />
              <span>Retry</span>
            </button>
            <button
              onClick={handleFallbackToChat}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-all active:scale-95 shadow-sm"
              data-testid="fallback-chat-btn"
            >
              <MessageSquare size={11} />
              <span>Use Text</span>
            </button>
          </div>
        </div>
      )}

      {/* Compact Real-Time Transcript Drawer */}
      <div
        ref={transcriptRef}
        className="max-h-24 min-h-[44px] overflow-y-auto space-y-1.5 p-2 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs z-10 shadow-inner"
        data-testid="live-voice-transcript"
      >
        {transcript.length === 0 ? (
          <div className="text-slate-500 text-[11px] italic text-center py-2">
            {status === 'active' || status === 'listening'
              ? 'Say "Schedule meeting tomorrow at 3pm" or "Note that I prefer morning focus"'
              : status === 'connecting'
              ? 'Starting live audio session...'
              : 'Voice session ready.'}
          </div>
        ) : (
          transcript.map((t, idx) => (
            <div
              key={idx}
              className={`flex gap-1.5 items-start text-xs ${
                t.source === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {t.source === 'model' && (
                <Sparkles size={13} className="text-indigo-400 mt-0.5 shrink-0" />
              )}
              <span
                className={`px-2.5 py-1 rounded-lg max-w-[85%] leading-relaxed ${
                  t.source === 'user'
                    ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/20 rounded-tr-none'
                    : 'bg-slate-800 text-slate-200 border border-slate-700/80 rounded-tl-none'
                }`}
              >
                {t.text}
              </span>
              {t.source === 'user' && (
                <User size={13} className="text-slate-400 mt-0.5 shrink-0" />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LiveVoiceModal;