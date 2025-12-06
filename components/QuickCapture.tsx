import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Plus, X, Zap, Target, CheckSquare, Calendar, BookOpen } from 'lucide-react';
import { EntityKind } from '../types';

const QuickCapture: React.FC = () => {
    const { applyOperations, addToast } = useStore();
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [selectedKind, setSelectedKind] = useState<EntityKind>(EntityKind.TASK);
    const inputRef = useRef<HTMLInputElement>(null);

    // Keyboard shortcut: Cmd/Ctrl + K
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        applyOperations([{
            type: 'create_entity',
            payload: {
                kind: selectedKind,
                title: input.trim(),
                status: 'ACTIVE'
            }
        }]);

        addToast(`${selectedKind} created!`, 'success');
        setInput('');
        setIsOpen(false);
    };

    const kindOptions = [
        { kind: EntityKind.TASK, icon: CheckSquare, label: 'Task', color: 'text-blue-400' },
        { kind: EntityKind.GOAL, icon: Target, label: 'Goal', color: 'text-amber-400' },
        { kind: EntityKind.EVENT, icon: Calendar, label: 'Event', color: 'text-purple-400' },
        { kind: EntityKind.NOTE, icon: BookOpen, label: 'Note', color: 'text-green-400' },
    ];

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/30 flex items-center justify-center hover:scale-105 transition-transform group"
                title="Quick Capture (⌘K)"
            >
                <Plus size={24} className="group-hover:rotate-90 transition-transform duration-200" />
            </button>
        );
    }

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={() => setIsOpen(false)}
            />

            {/* Modal */}
            <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg mx-4 animate-scale-in">
                <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                        <div className="flex items-center gap-2 text-indigo-400">
                            <Zap size={18} />
                            <span className="font-medium">Quick Capture</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Kind Selector */}
                    <div className="flex gap-2 p-3 border-b border-slate-800">
                        {kindOptions.map(({ kind, icon: Icon, label, color }) => (
                            <button
                                key={kind}
                                onClick={() => setSelectedKind(kind)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${selectedKind === kind
                                        ? 'bg-slate-700 text-white'
                                        : 'text-slate-400 hover:bg-slate-800'
                                    }`}
                            >
                                <Icon size={14} className={selectedKind === kind ? color : ''} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSubmit} className="p-4">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={`New ${selectedKind.toLowerCase()}...`}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                            autoFocus
                        />
                        <div className="flex justify-between items-center mt-3">
                            <span className="text-xs text-slate-500">Press Enter to create • Esc to close</span>
                            <button
                                type="submit"
                                disabled={!input.trim()}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium"
                            >
                                Create
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
};

export default QuickCapture;
