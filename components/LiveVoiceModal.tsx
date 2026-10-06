import React, { useEffect, useState, useRef } from 'react';
import { LiveManager } from '../services/liveSession';
import { Mic, X, Activity, Loader2, User, Bot, Sparkles } from 'lucide-react';

interface LiveVoiceModalProps {
  onClose: () => void;
}

interface Subtitle {
  text: string;
  source: 'user' | 'model';
}

const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState<string>('initializing');
  const [transcript, setTranscript] = useState<Subtitle[]>([]);
  const managerRef = useRef<LiveManager | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  
  // Visualizer Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const manager = new LiveManager();
    managerRef.current = manager;
    
    manager.onStatusChange = (s) => setStatus(s);
    manager.onTranscription = (text, source) => {
      setTranscript(prev => {
        const last = prev[prev.length - 1];
        if (last && last.source === source) {
          return [...prev.slice(0, -1), { ...last, text: last.text + text }];
        }
        const newHistory = [...prev, { text, source }];
        if (newHistory.length > 5) newHistory.shift();
        return newHistory;
      });
    };

    manager.connect();

    // Horizontal soundwave visualizer loop
    const draw = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (manager.analyser && status === 'active') {
        const bufferLength = manager.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        manager.analyser.getByteFrequencyData(dataArray);

        const bars = 36;
        const barWidth = Math.max(3, Math.floor((width - (bars - 1) * 4) / bars));
        const spacing = 4;
        const totalW = bars * barWidth + (bars - 1) * spacing;
        const startX = Math.max(0, (width - totalW) / 2);

        for (let i = 0; i < bars; i++) {
          const sampleIndex = Math.floor((i / bars) * (bufferLength * 0.7));
          const value = dataArray[sampleIndex] || 0;
          const percent = value / 255;
          const barHeight = Math.max(4, percent * (height - 8));

          const x = startX + i * (barWidth + spacing);
          const y = centerY - barHeight / 2;

          // Gradient color from indigo to cyan
          const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
          grad.addColorStop(0, '#818cf8'); // indigo-400
          grad.addColorStop(1, '#38bdf8'); // sky-400

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, 2) : ctx.rect(x, y, barWidth, barHeight);
          ctx.fill();
        }
      } else {
        // Idle gentle wave baseline
        const bars = 36;
        const barWidth = Math.max(3, Math.floor((width - (bars - 1) * 4) / bars));
        const spacing = 4;
        const totalW = bars * barWidth + (bars - 1) * spacing;
        const startX = Math.max(0, (width - totalW) / 2);

        ctx.fillStyle = '#334155'; // slate-700
        for (let i = 0; i < bars; i++) {
          const x = startX + i * (barWidth + spacing);
          const y = centerY - 2;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(x, y, barWidth, 4, 2) : ctx.rect(x, y, barWidth, 4);
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
      manager.disconnect();
    };
  }, []);

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

  return (
    <div className="w-full bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-3 shadow-lg flex flex-col gap-2.5 backdrop-blur-sm animate-fade-in relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-sky-500/5 to-purple-500/5 pointer-events-none" />

      {/* Header bar: Status indicator + End button */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          {status === 'connecting' || status === 'initializing' ? (
            <>
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
              <span className="text-xs font-medium text-indigo-300">Connecting to Gemini Live...</span>
            </>
          ) : status === 'active' ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-400">Gemini Live</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">• Listening (speak naturally)</span>
            </>
          ) : status === 'error' ? (
            <>
              <Activity className="w-4 h-4 text-red-400" />
              <span className="text-xs font-medium text-red-400">Connection error. Check mic or API key.</span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
              <span className="text-xs text-slate-400">Disconnected</span>
            </>
          )}
        </div>

        <button
          onClick={handleClose}
          className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-medium transition-all active:scale-95"
          title="End Voice Session (Esc)"
          aria-label="End Voice Session"
        >
          <X size={14} />
          <span>End</span>
        </button>
      </div>

      {/* Visualizer Canvas */}
      <div className="w-full h-10 flex items-center justify-center bg-slate-950/60 rounded-xl px-2 py-1 border border-slate-800/80 z-10">
        <canvas
          ref={canvasRef}
          width={400}
          height={40}
          className="w-full h-full block"
        />
      </div>

      {/* Compact Real-Time Transcript */}
      <div
        ref={transcriptRef}
        className="max-h-24 min-h-[44px] overflow-y-auto space-y-1.5 p-2 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs z-10"
      >
        {transcript.length === 0 ? (
          <div className="text-slate-500 text-[11px] italic text-center py-2">
            {status === 'active'
              ? 'Say "Create a task for tomorrow at 10am" or "Log 30 min study"'
              : 'Starting audio session...'}
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