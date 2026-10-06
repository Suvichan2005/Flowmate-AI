import React, { useEffect, useState, useRef } from 'react';
import { LiveManager } from '../services/liveSession';
import { Mic, X, Activity, Loader2, User, Bot } from 'lucide-react';

interface LiveVoiceModalProps {
  onClose: () => void;
}

interface Subtitle {
    text: string;
    source: 'user' | 'model';
    isFinal?: boolean;
}

const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState('initializing');
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
            if (newHistory.length > 3) newHistory.shift();
            return newHistory;
        });
    };

    manager.connect();
    
    // Start Visualizer Loop
    const draw = () => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = 60;

        ctx.clearRect(0, 0, width, height);

        // Basic Circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#1e293b'; // slate-800
        ctx.fill();
        
        if (manager.analyser && status === 'active') {
            const bufferLength = manager.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            manager.analyser.getByteFrequencyData(dataArray);

            const bars = 40;
            const step = Math.floor(bufferLength / bars);
            
            for (let i = 0; i < bars; i++) {
                const value = dataArray[i * step];
                const percent = value / 255;
                const barHeight = percent * 40;
                
                const angle = (i / bars) * 2 * Math.PI;
                const x1 = centerX + Math.cos(angle) * radius;
                const y1 = centerY + Math.sin(angle) * radius;
                const x2 = centerX + Math.cos(angle) * (radius + barHeight);
                const y2 = centerY + Math.sin(angle) * (radius + barHeight);
                
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = `rgba(99, 102, 241, ${0.5 + percent * 0.5})`; // Indigo-500
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        } else {
             // Idle ring
             ctx.beginPath();
             ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
             ctx.strokeStyle = '#334155'; // slate-700
             ctx.lineWidth = 2;
             ctx.stroke();
        }

        animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
      manager.disconnect();
    };
  }, []);

  // Auto-scroll transcript
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full text-center">
        
        {/* Visualizer Canvas Area */}
        <div className="relative shrink-0 w-64 h-64 flex items-center justify-center">
            <canvas 
                ref={canvasRef} 
                width={256} 
                height={256} 
                className="absolute inset-0 w-full h-full"
            />
            
            {/* Center Icon Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                 {status === 'connecting' || status === 'initializing' ? (
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                 ) : status === 'active' ? (
                    <Mic className="w-8 h-8 text-indigo-400" />
                 ) : (
                    <Activity className="w-8 h-8 text-red-400" />
                 )}
            </div>
        </div>

        <div className="-mt-8">
          <h2 className="text-2xl font-bold text-white mb-2">Flowmate Live</h2>
          <p className="text-slate-400 text-sm">
             {status === 'connecting' ? 'Connecting to Gemini Live...' : 
              status === 'active' ? 'Listening... Speak naturally.' :
              status === 'error' ? 'Connection failed. Please check microphone permissions and API key.' : 'Disconnected'}
          </p>
        </div>

        {/* Subtitles Area */}
        <div 
            ref={transcriptRef}
            className="w-full h-32 bg-slate-900/50 rounded-xl border border-slate-800 p-3 overflow-y-auto flex flex-col gap-2 text-left"
        >
            {transcript.length === 0 && status === 'active' && (
                <div className="text-slate-600 text-xs italic text-center mt-8">Say "Create a task to buy milk"...</div>
            )}
            {transcript.map((t, idx) => (
                <div key={idx} className={`flex gap-2 text-xs ${t.source === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {t.source === 'model' && <Bot size={14} className="text-indigo-400 mt-0.5 shrink-0" />}
                    <span className={`px-2 py-1.5 rounded-lg max-w-[85%] ${
                        t.source === 'user' 
                            ? 'bg-indigo-600/20 text-indigo-200 rounded-tr-none' 
                            : 'bg-slate-800 text-slate-300 rounded-tl-none'
                    }`}>
                        {t.text}
                    </span>
                    {t.source === 'user' && <User size={14} className="text-slate-500 mt-0.5 shrink-0" />}
                </div>
            ))}
        </div>

        <button 
          onClick={handleClose}
          className="px-8 py-3 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors flex items-center gap-2"
        >
          <X size={18} />
          End Session
        </button>
      </div>
    </div>
  );
};

export default LiveVoiceModal;