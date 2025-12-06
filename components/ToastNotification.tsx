import React from 'react';
import { useStore } from '../store';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

const ToastNotification: React.FC = () => {
  const { toasts, removeToast } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div 
          key={toast.id}
          className={`pointer-events-auto min-w-[300px] max-w-sm p-4 rounded-xl border shadow-2xl flex items-start gap-3 animate-in slide-in-from-right-10 fade-in duration-300 ${
            toast.type === 'success' ? 'bg-slate-900/95 border-emerald-500/30 text-emerald-100' :
            toast.type === 'error' ? 'bg-slate-900/95 border-red-500/30 text-red-100' :
            'bg-slate-900/95 border-blue-500/30 text-blue-100'
          }`}
        >
          <div className={`mt-0.5 shrink-0 ${
            toast.type === 'success' ? 'text-emerald-500' :
            toast.type === 'error' ? 'text-red-500' :
            'text-blue-500'
          }`}>
             {toast.type === 'success' ? <CheckCircle2 size={18} /> :
              toast.type === 'error' ? <AlertCircle size={18} /> :
              <Info size={18} />}
          </div>
          <div className="flex-1 text-sm font-medium leading-relaxed">
            {toast.message}
          </div>
          <button 
            onClick={() => removeToast(toast.id)}
            className="text-slate-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastNotification;