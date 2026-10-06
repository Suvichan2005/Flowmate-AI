import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import {
    Plus,
    MessageSquare,
    Trash2,
    Edit2,
    Check,
    X,
    ChevronDown,
    Clock,
    Sparkles,
    PanelLeftClose
} from 'lucide-react';

interface ChatSessionBarProps {
    onCloseChat?: () => void;
    showCloseButton?: boolean;
}

export const ChatSessionBar: React.FC<ChatSessionBarProps> = ({
    onCloseChat,
    showCloseButton = false
}) => {
    const {
        chatSessions,
        activeSessionId,
        createChatSession,
        setActiveSessionId,
        deleteChatSession,
        renameChatSession,
        clearChatSession,
        messages,
        settings,
        loading
    } = useStore();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);

    const activeSession = (chatSessions || []).find(s => s.id === activeSessionId) || {
        id: 'general',
        title: 'General Chat',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsMenuOpen(false);
                setEditingSessionId(null);
            }
        };
        if (isMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMenuOpen]);

    const handleNewChat = () => {
        const newId = createChatSession('New Chat');
        setIsMenuOpen(false);
    };

    const handleSelectSession = (id: string) => {
        setActiveSessionId(id);
        setIsMenuOpen(false);
    };

    const handleStartRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
        e.stopPropagation();
        setEditingSessionId(id);
        setEditTitle(currentTitle);
    };

    const handleSaveRename = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (editTitle.trim()) {
            renameChatSession(id, editTitle.trim());
        }
        setEditingSessionId(null);
    };

    const handleDeleteSession = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        deleteChatSession(id);
    };

    return (
        <div className="relative border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md px-3 py-2 z-20" ref={menuRef}>
            <div className="flex items-center justify-between gap-3">
                {/* Left: Chat Session Switcher Dropdown */}
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-800/80 text-slate-200 transition-all text-xs font-medium border border-slate-800 hover:border-slate-700/60 shrink-0"
                        title="Switch chat session"
                    >
                        <MessageSquare size={13} className="text-indigo-400 shrink-0" />
                        <span className="max-w-[110px] sm:max-w-[180px] md:max-w-[220px] truncate">{activeSession.title}</span>
                        <ChevronDown size={12} className={`text-slate-400 shrink-0 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* New Chat Pill Button (ChatGPT-style) */}
                    <button
                        onClick={handleNewChat}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all active:scale-95 shadow-sm shrink-0"
                        title="Start a new chat (+)"
                    >
                        <Plus size={13} />
                        <span className="hidden sm:inline">New Chat</span>
                    </button>
                </div>

                {/* Right: Model badge & Close button */}
                <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden md:flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-1 rounded-lg border border-slate-700/60">
                        <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-indigo-400 animate-pulse' : 'bg-emerald-400'}`} />
                        <span>{settings?.preferred_model || 'gemini-2.5-flash'}</span>
                    </div>

                    {showCloseButton && onCloseChat && (
                        <button
                            onClick={onCloseChat}
                            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                            title="Close Chat panel (Cmd+B)"
                            aria-label="Close Chat"
                        >
                            <PanelLeftClose size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Dropdown Menu for Sessions */}
            {isMenuOpen && (
                <div className="absolute left-3 top-full mt-1.5 w-72 sm:w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-fade-in backdrop-blur-xl">
                    <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-800/80 mb-1.5">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Conversations</span>
                        <button
                            onClick={handleNewChat}
                            className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            <Plus size={12} />
                            <span>New</span>
                        </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
                        {(chatSessions || []).map((session) => {
                            const isActive = session.id === activeSessionId;
                            const isEditing = editingSessionId === session.id;
                            const sessionMsgCount = (messages || []).filter(m => (m.channelId || 'general') === session.id).length;

                            return (
                                <div
                                    key={session.id}
                                    onClick={() => !isEditing && handleSelectSession(session.id)}
                                    className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                                        isActive
                                            ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                                            : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <MessageSquare size={13} className={isActive ? 'text-indigo-400' : 'text-slate-500'} />
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={editTitle}
                                                onChange={(e) => setEditTitle(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveRename(e as any, session.id);
                                                    if (e.key === 'Escape') setEditingSessionId(null);
                                                }}
                                                className="bg-slate-950 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white outline-none w-full"
                                                autoFocus
                                            />
                                        ) : (
                                            <div className="min-w-0 flex-1">
                                                <div className="font-medium truncate">{session.title}</div>
                                                <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                                                    <span>{sessionMsgCount} {sessionMsgCount === 1 ? 'message' : 'messages'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-1 shrink-0 ml-2">
                                        {isEditing ? (
                                            <>
                                                <button
                                                    onClick={(e) => handleSaveRename(e, session.id)}
                                                    className="p-1 hover:bg-emerald-500/20 text-emerald-400 rounded transition-colors"
                                                    title="Save"
                                                >
                                                    <Check size={12} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingSessionId(null); }}
                                                    className="p-1 hover:bg-slate-700 text-slate-400 rounded transition-colors"
                                                    title="Cancel"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => handleStartRename(e, session.id, session.title)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 rounded transition-all"
                                                    title="Rename"
                                                >
                                                    <Edit2 size={11} />
                                                </button>
                                                {chatSessions.length > 1 && (
                                                    <button
                                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded transition-all"
                                                        title="Delete chat"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatSessionBar;
