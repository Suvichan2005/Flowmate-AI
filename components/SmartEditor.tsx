import React, { useState } from 'react';
import { improveText, ImprovementType } from '../services/geminiService';
import { Sparkles, Type, AlignLeft, Check, Loader2, Wand2, List } from 'lucide-react';

interface SmartEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

const SmartEditor: React.FC<SmartEditorProps> = ({ value, onChange, placeholder, className }) => {
  const [loading, setLoading] = useState<ImprovementType | null>(null);
  const [showAiMenu, setShowAiMenu] = useState(false);

  const handleImprove = async (type: ImprovementType) => {
    if (!value.trim()) return;
    setLoading(type);
    setShowAiMenu(false);
    
    try {
      const improved = await improveText(value, type);
      onChange(improved);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  };

  const insertFormatting = (syntax: string) => {
    // Simple append for MVP. Real cursor handling would require refs.
    onChange(value + syntax);
  };

  return (
    <div className={`flex flex-col border border-slate-700 rounded-lg overflow-hidden bg-slate-950 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-slate-800 bg-slate-900/50">
         <button 
           onClick={() => insertFormatting('**Bold** ')}
           className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
           title="Bold"
         >
           <strong className="font-serif font-bold">B</strong>
         </button>
         <button 
           onClick={() => insertFormatting('*Italic* ')}
           className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
           title="Italic"
         >
           <em className="font-serif italic">I</em>
         </button>
         <button 
           onClick={() => insertFormatting('\n- ')}
           className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
           title="List"
         >
           <List size={14} />
         </button>

         <div className="w-px h-4 bg-slate-700 mx-1"></div>

         <div className="relative">
            <button 
                onClick={() => setShowAiMenu(!showAiMenu)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    loading ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
            >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? 'Thinking...' : 'AI Edit'}
            </button>

            {showAiMenu && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 flex flex-col py-1 animate-in fade-in zoom-in duration-150">
                    <button 
                        onClick={() => handleImprove('fix_grammar')}
                        className="text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                        <Check size={12} className="text-emerald-400" /> Fix Grammar
                    </button>
                    <button 
                        onClick={() => handleImprove('make_professional')}
                        className="text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                        <Type size={12} className="text-blue-400" /> Professional Tone
                    </button>
                    <button 
                        onClick={() => handleImprove('expand')}
                        className="text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                        <Wand2 size={12} className="text-purple-400" /> Expand
                    </button>
                    <button 
                        onClick={() => handleImprove('summarize')}
                        className="text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                        <AlignLeft size={12} className="text-orange-400" /> Summarize
                    </button>
                </div>
            )}
         </div>
      </div>

      {/* Editor Area */}
      <textarea 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Start typing..."}
        className="w-full bg-slate-950 text-slate-300 text-sm p-3 min-h-[150px] outline-none resize-y font-sans leading-relaxed"
      />
      
      {/* Backdrop click to close menu */}
      {showAiMenu && <div className="fixed inset-0 z-10" onClick={() => setShowAiMenu(false)} />}
    </div>
  );
};

export default SmartEditor;