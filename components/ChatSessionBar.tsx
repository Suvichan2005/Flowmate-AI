import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, PanelLeftClose, Trash2, GitBranch, ChevronDown, Pencil, X, MessageSquare, Search } from 'lucide-react';
import { useStore } from '../store';
import { getActiveChatSessions } from '../store/helpers';

interface ChatSessionBarProps { onCloseChat?: () => void; showCloseButton?: boolean }
type ChatDialog = { kind: 'rename-conversation'; sessionId: string } | { kind: 'rename-branch'; branchId: string } | { kind: 'delete-conversation'; sessionId: string };

export const ChatSessionBar: React.FC<ChatSessionBarProps> = ({ onCloseChat, showCloseButton = false }) => {
    const { chatSessions, activeSessionId, branches, activeBranchId, createChatSession, setActiveSessionId,
        setActiveBranchId, renameBranch, deleteBranch, restoreBranch, deleteChatSession, renameChatSession } = useStore();
    const [showBranches, setShowBranches] = useState(false);
    const [showConversations, setShowConversations] = useState(false);
    const [conversationQuery, setConversationQuery] = useState('');
    const [dialog, setDialog] = useState<ChatDialog | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const [nameError, setNameError] = useState('');
    const branchToggleRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const sessions = getActiveChatSessions(chatSessions);
    const conversationBranches = branches.filter(b => b.conversation_id === activeSessionId);
    const activeBranches = conversationBranches.filter(b => !b.deleted_at);
    const currentBranch = activeBranches.find(b => b.id === activeBranchId) || activeBranches[0];
    const session = sessions.find(s => s.id === activeSessionId);
    const visibleSessions = sessions.filter(item => item.title.toLowerCase().includes(conversationQuery.trim().toLowerCase()));

    const openDialog = (nextDialog: ChatDialog, initialName: string, opener: HTMLElement) => {
        returnFocusRef.current = opener;
        setNameDraft(initialName);
        setNameError('');
        setDialog(nextDialog);
    };
    const closeDialog = () => {
        setDialog(null);
        setNameError('');
    };

    useEffect(() => {
        if (!dialog) {
            if (returnFocusRef.current) {
                const target = returnFocusRef.current.isConnected ? returnFocusRef.current : branchToggleRef.current;
                target?.focus();
                returnFocusRef.current = null;
            }
            return;
        }
        if (dialog.kind !== 'delete-conversation') nameInputRef.current?.focus();
        else dialogRef.current?.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.focus();

        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
            if (!controls.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault(); first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [dialog]);

    const submitName = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = nameDraft.trim();
        if (!name) {
            setNameError('Enter a name to continue.');
            nameInputRef.current?.focus();
            return;
        }
        if (dialog?.kind === 'rename-conversation') renameChatSession(dialog.sessionId, name);
        else if (dialog?.kind === 'rename-branch') renameBranch(dialog.branchId, name);
        setShowBranches(false);
        setShowConversations(false);
        closeDialog();
    };
    const depth = (id: string) => {
        const seen = new Set<string>();
        let branch = conversationBranches.find(b => b.id === id);
        while (branch?.diverged_from_branch_id && !seen.has(branch.id)) {
            seen.add(branch.id);
            const parentId = branch.diverged_from_branch_id;
            branch = conversationBranches.find(b => b.id === parentId);
        }
        return Math.min(seen.size, 8);
    };
    return <div className="relative border-b border-slate-800 bg-slate-900 px-3 py-2 z-20">
        <div data-testid="chat-session-actions" className="flex items-center gap-2 min-w-0">
            <button type="button" data-testid="conversation-switcher" aria-label={`Current conversation: ${session?.title || 'Conversation'}`} aria-expanded={showConversations}
                onClick={() => { setShowConversations(value => !value); setShowBranches(false); setConversationQuery(''); }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-2.5 py-1.5 text-left text-slate-100 hover:border-slate-500 hover:bg-slate-800">
                <MessageSquare size={15} className="shrink-0 text-emerald-300" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{session?.title || 'Conversation'}</span>
                <span className="hidden shrink-0 text-[10px] text-slate-500 sm:inline">Conversation</span>
                <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
            </button>
            <button aria-label="New Chat" title="New conversation" onClick={() => { createChatSession(); setShowBranches(false); setShowConversations(false); }} className="shrink-0 rounded-md p-2 text-indigo-300 hover:bg-slate-800 hover:text-indigo-200"><Plus size={16} /></button>
            <button ref={branchToggleRef} data-testid="branch-menu-toggle" aria-label="Select or manage branches" title="Select or manage conversation branches" aria-expanded={showBranches} aria-controls="conversation-branch-history" onClick={() => { setShowConversations(false); setShowBranches(v => !v); }} className="shrink-0 flex min-w-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-indigo-200">
                <GitBranch size={14} /><span className="max-w-24 truncate">{currentBranch?.name || 'Main'}</span><ChevronDown size={13} aria-hidden="true" />
            </button>
            {showCloseButton && onCloseChat && <button aria-label="Close Chat" onClick={onCloseChat} className="p-2 text-slate-400"><PanelLeftClose size={16} /></button>}
        </div>
        {showConversations && <section aria-label="Conversation switcher" className="absolute left-3 top-full z-30 mt-1 w-[min(26rem,calc(100vw-1.5rem))] max-w-[calc(100%-1.5rem)] rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs shadow-2xl">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div><h2 className="font-semibold text-slate-100">Your conversations</h2><p className="mt-0.5 text-[10px] text-slate-500">Switch or manage a chat</p></div>
                <button type="button" aria-label="Close conversation switcher" onClick={() => setShowConversations(false)} className="rounded p-1 text-slate-400 hover:bg-slate-800"><X size={15} /></button>
            </div>
            <label className="mb-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-400">
                <Search size={14} aria-hidden="true" /><span className="sr-only">Search conversations</span>
                <input aria-label="Search conversations" value={conversationQuery} onChange={event => setConversationQuery(event.target.value)} placeholder="Find a conversation" className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500" />
            </label>
            <ul aria-label="Conversations" className="max-h-64 space-y-1 overflow-y-auto">
                {visibleSessions.map(item => <li key={item.id} className={`flex min-w-0 items-center gap-1 rounded-lg px-1 ${item.id === activeSessionId ? 'bg-slate-800' : 'hover:bg-slate-800/70'}`}>
                    <button type="button" aria-current={item.id === activeSessionId ? 'true' : undefined} onClick={() => { setActiveSessionId(item.id); setShowConversations(false); }} className="min-w-0 flex-1 truncate py-2 pl-2 text-left text-slate-200">{item.title || 'Untitled conversation'}{item.id === activeSessionId && <span className="ml-2 text-[10px] text-emerald-300">Current</span>}</button>
                    <button type="button" aria-label={`Rename conversation ${item.title}`} title="Rename conversation" onClick={event => openDialog({ kind: 'rename-conversation', sessionId: item.id }, item.title || '', event.currentTarget)} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"><Pencil size={13} /></button>
                    {item.id !== 'general' && <button type="button" aria-label={`Delete conversation ${item.title}`} title="Delete conversation" onClick={event => openDialog({ kind: 'delete-conversation', sessionId: item.id }, '', event.currentTarget)} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-red-300"><Trash2 size={13} /></button>}
                </li>)}
                {visibleSessions.length === 0 && <li className="px-3 py-5 text-center text-slate-500">No conversations match that search.</li>}
            </ul>
            <p className="border-t border-slate-800 px-2 pt-2 text-[10px] leading-4 text-slate-500">The default conversation stays in your workspace.</p>
        </section>}
        {showBranches && <div id="conversation-branch-history" className="mt-2 w-full max-w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950/30 p-2 text-xs">
            <ul aria-label="Conversation branches" className="space-y-1 max-h-48 overflow-y-auto overflow-x-hidden">
                {conversationBranches.map(b => {
                    const parent = conversationBranches.find(p => p.id === b.diverged_from_branch_id);
                    return <li key={b.id} style={{ paddingInlineStart: depth(b.id) * 12 }} className="flex min-w-0 items-center gap-2">
                        {b.deleted_at ? <><span className="min-w-0 flex-1 truncate text-slate-400">{b.name} (deleted)</span><button type="button" data-branch-id={b.id} aria-label={`Restore branch ${b.name || 'Main'}`} title={`Restore branch ${b.name || 'Main'}`} onClick={() => restoreBranch(b.id)} className="shrink-0 text-indigo-300">{'Restore'}</button></> : <>
                            <button data-branch-id={b.id} aria-current={b.id === activeBranchId ? 'true' : undefined} onClick={() => { setActiveBranchId(b.id); setShowBranches(false); }} className="min-w-0 flex-1 truncate py-1 text-left text-slate-200">
                                {b.name || 'Main'}{parent && <span className="text-slate-400">{' · from ' + (parent.name || 'Main')}</span>}
                            </button>
                            <button type="button" aria-label={'Rename branch ' + (b.name || 'Main')} title="Rename branch" onClick={event => openDialog({ kind: 'rename-branch', branchId: b.id }, b.name || 'Main', event.currentTarget)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><Pencil size={13} /></button>
                            {parent && <button type="button" aria-label={'Delete branch ' + b.name} title="Delete branch; messages remain recoverable" onClick={() => deleteBranch(b.id)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-red-300"><Trash2 size={13} /></button>}
                        </>}
                    </li>;
                })}
            </ul>
            <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">Branches preserve alternate conversation paths. Rename or manage chats from the conversation switcher.</p>
        </div>}
        {dialog && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
                <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="chat-management-dialog-title" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <h2 id="chat-management-dialog-title" className="text-lg font-semibold">
                            {dialog.kind === 'rename-conversation' ? 'Rename conversation' : dialog.kind === 'rename-branch' ? 'Rename branch' : 'Delete conversation?'}
                        </h2>
                        <button type="button" aria-label="Close dialog" onClick={closeDialog} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
                    </div>
                    {dialog.kind === 'delete-conversation' ? <>
                        <p className="mb-5 text-sm leading-6 text-slate-300">This removes this conversation and its messages from this device and, when signed in, from its synced account. This cannot be undone.</p>
                        <div className="flex justify-end gap-2">
                            <button type="button" data-dialog-cancel onClick={closeDialog} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Keep conversation</button>
                            <button type="button" onClick={() => { deleteChatSession(dialog.sessionId); setShowBranches(false); setShowConversations(false); closeDialog(); }} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600">Delete conversation</button>
                        </div>
                    </> : <form onSubmit={submitName}>
                        <label htmlFor="chat-management-name" className="mb-1 block text-sm text-slate-300">{dialog.kind === 'rename-conversation' ? 'Conversation name' : 'Branch name'}</label>
                        <input ref={nameInputRef} id="chat-management-name" aria-describedby={nameError ? 'chat-management-name-error' : undefined} maxLength={80} value={nameDraft} onChange={event => { setNameDraft(event.target.value); setNameError(''); }} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30" />
                        {nameError && <p id="chat-management-name-error" role="alert" className="mt-2 text-sm text-red-300">{nameError}</p>}
                        <div className="mt-5 flex justify-end gap-2">
                            <button type="button" data-dialog-cancel onClick={closeDialog} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Cancel</button>
                            <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600">Save name</button>
                        </div>
                    </form>}
                </div>
            </div>, document.body
        )}
    </div>;
};
export default ChatSessionBar;
