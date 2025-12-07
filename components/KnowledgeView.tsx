import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';
import { queryKnowledgeBase } from '../services/geminiService';
import { Library, Search, Plus, Sparkles, X, ArrowRight, Loader2, Filter, FileText, BookOpen, Folder, Target, Calendar, CheckSquare, Square, Eye, EyeOff, User, Briefcase, GraduationCap } from 'lucide-react';
import MarkdownText from './MarkdownText';

type FilterKind = 'all' | EntityKind.PERSON | EntityKind.ROLE | EntityKind.COURSE | EntityKind.TASK | EntityKind.PROJECT | EntityKind.GOAL | EntityKind.EVENT;

const KnowledgeView: React.FC = () => {
    const { entities = [], relationships = [], universalTags = [], selectEntity, applyOperations, selectedEntityId } = useStore();
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // UI State
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [selectedContext, setSelectedContext] = useState<string | null>(null);

    // AI State
    const [showAiSearch, setShowAiSearch] = useState(false);
    const [isAsking, setIsAsking] = useState(false);
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [askQuery, setAskQuery] = useState('');

    // Filters
    const [showFilters, setShowFilters] = useState(false);
    const [kindFilter, setKindFilter] = useState<FilterKind>('all');

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Refs
    const aiInputRef = useRef<HTMLInputElement>(null);

    // Get tags/contexts
    const allTags = useMemo(() => universalTags.filter(t => t.kind === EntityKind.TAG).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)), [universalTags]);
    const allContexts = useMemo(() => universalTags.filter(t => t.kind === EntityKind.CONTEXT).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)), [universalTags]);

    // Focus AI input when toggled
    useEffect(() => {
        if (showAiSearch && aiInputRef.current) {
            aiInputRef.current.focus();
        }
    }, [showAiSearch]);

    // Helper: Related IDs
    const getRelatedEntityIds = (tagOrContextTitle: string): Set<string> => {
        const tagEntity = entities.find(e =>
            (e.kind === EntityKind.TAG || e.kind === EntityKind.CONTEXT) &&
            e.title.toLowerCase() === tagOrContextTitle.toLowerCase()
        );
        if (!tagEntity) return new Set();

        const relatedIds = new Set<string>();
        relationships.forEach(rel => {
            if (rel.from === tagEntity.id) relatedIds.add(rel.to);
            if (rel.to === tagEntity.id) relatedIds.add(rel.from);
        });
        return relatedIds;
    };

    const hasActiveFilters = Boolean(searchQuery || selectedTag || selectedContext || kindFilter !== 'all');

    // Filter Logic
    const filteredItems = useMemo(() => {
        return entities.filter(e => {
            if (e.status === EntityStatus.ARCHIVED || e.status === EntityStatus.CANCELED) return false;
            if (kindFilter !== 'all' && e.kind !== kindFilter) return false;

            const matchesSearch = !searchQuery ||
                e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (e.description || '').toLowerCase().includes(searchQuery.toLowerCase());
            if (!matchesSearch) return false;

            if (selectedTag) {
                const hasTag = e.canonical_tags?.includes(selectedTag);
                const relatedIds = getRelatedEntityIds(selectedTag);
                if (!hasTag && !relatedIds.has(e.id)) return false;
            }

            if (selectedContext) {
                const hasContext = e.canonical_tags?.includes(selectedContext);
                const relatedIds = getRelatedEntityIds(selectedContext);
                if (!hasContext && !relatedIds.has(e.id)) return false;
            }
            return true;
        }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }, [entities, searchQuery, selectedTag, selectedContext, kindFilter, relationships]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                setSelectedIds(new Set(filteredItems.map(e => e.id)));
            }
            if (e.key === 'Escape') {
                setSelectedIds(new Set());
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [filteredItems]);

    // AI Handler
    const handleAskAI = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!askQuery.trim()) return;
        setIsAsking(true);
        setAiAnswer(null);
        const itemsToSearch = filteredItems.length > 0 ? filteredItems : entities;
        const answer = await queryKnowledgeBase(askQuery, itemsToSearch);
        setAiAnswer(answer);
        setIsAsking(false);
        // Don't close search, let user read answer
    };

    // Quick Creation
    const handleCreateEntity = () => {
        let kindToCreate: EntityKind = EntityKind.TASK;

        // If filtering by a specific kind, create that kind
        if (kindFilter !== 'all') {
            kindToCreate = kindFilter as EntityKind;
        } else {
            // Ask user for kind if not filtered, defaulting to Task usually but maybe Person here?
            // Let's just create a Task for generic quick add, or prompt.
            // For simplicity in quick add, let's keep it creating a Task if 'All'.
            // Or better, create a NOTE if it existed, but since removed, maybe just generic Task.
            kindToCreate = EntityKind.TASK;
        }

        const title = prompt(`Create new ${kindToCreate}:`);
        if (title) {
            applyOperations([{
                type: 'create_entity',
                payload: { kind: kindToCreate, title, status: EntityStatus.ACTIVE }
            }]);
        }
    };

    const clearFilters = () => {
        setSearchQuery('');
        setSelectedTag(null);
        setSelectedContext(null);
        setKindFilter('all');
    };

    // Selection Handlers
    const toggleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(selectedIds);

        // Shift+Click Range Selection
        if (e.shiftKey && lastSelectedId && filteredItems.some(i => i.id === lastSelectedId)) {
            const idx1 = filteredItems.findIndex(i => i.id === lastSelectedId);
            const idx2 = filteredItems.findIndex(i => i.id === id);
            if (idx1 !== -1 && idx2 !== -1) {
                const start = Math.min(idx1, idx2);
                const end = Math.max(idx1, idx2);
                const range = filteredItems.slice(start, end + 1);
                range.forEach(item => next.add(item.id));
            }
        } else {
            if (next.has(id)) next.delete(id); else next.add(id);
        }

        setSelectedIds(next);
        setLastSelectedId(id);
    };

    const selectAll = () => setSelectedIds(new Set(filteredItems.map(e => e.id)));
    const deselectAll = () => setSelectedIds(new Set());

    const bulkUpdate = (hidden: boolean) => {
        if (selectedIds.size === 0) return;
        const ops = Array.from(selectedIds).map(id => {
            const entity = entities.find(e => e.id === id);
            return {
                type: 'update_entity' as const,
                payload: { id, fields: { metadata: { ...entity?.metadata, hidden } } }
            };
        });
        applyOperations(ops);
        setSelectedIds(new Set());
    };

    // Kind Tabs
    const kindTabs: { id: FilterKind; label: string; icon?: React.ReactNode }[] = [
        { id: 'all', label: 'All' },
        { id: EntityKind.PERSON, label: 'People', icon: <User size={14} /> },
        { id: EntityKind.ROLE, label: 'Roles', icon: <Briefcase size={14} /> },
        { id: EntityKind.PROJECT, label: 'Projects', icon: <Folder size={14} /> },
        { id: EntityKind.GOAL, label: 'Goals', icon: <Target size={14} /> },
        { id: EntityKind.COURSE, label: 'Courses', icon: <GraduationCap size={14} /> },
        { id: EntityKind.TASK, label: 'Tasks', icon: <CheckSquare size={14} /> },
        { id: EntityKind.EVENT, label: 'Events', icon: <Calendar size={14} /> },
    ];

    const getKindColorClass = (kind: EntityKind) => {
        switch (kind) {
            case EntityKind.NOTE: return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'; // Fallback
            case EntityKind.PERSON: return 'text-pink-400 border-pink-500/30 bg-pink-500/10';
            case EntityKind.ROLE: return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
            case EntityKind.COURSE: return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
            case EntityKind.TOPIC: return 'text-violet-400 border-violet-500/30 bg-violet-500/10';
            case EntityKind.TASK: return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
            case EntityKind.PROJECT: return 'text-purple-400 border-purple-500/30 bg-purple-500/10';
            case EntityKind.GOAL: return 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10';
            case EntityKind.EVENT: return 'text-orange-400 border-orange-500/30 bg-orange-500/10';
            default: return 'text-slate-400 border-slate-700 bg-slate-800';
        }
    };

    return (
        <div className="flex-1 overflow-hidden bg-slate-950 flex flex-col h-full relative">

            {/* 1. Header & Controls */}
            <div className="shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm z-10">
                <div className="p-4 flex flex-col gap-4">

                    {/* Top Row: Title, Search, Actions */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 mr-2">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <Library size={18} />
                            </div>
                            <h1 className="text-xl font-bold text-slate-100 hidden md:block">Library</h1>
                        </div>

                        {/* Search Bar */}
                        <div className="flex-1 relative max-w-xl group">
                            <Search className="absolute left-3 top-2.5 text-slate-500 w-4 h-4 group-focus-within:text-indigo-400 transition-colors" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search people, roles, goals..."
                                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl pl-10 pr-4 py-2 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                            />
                        </div>

                        {/* Right Actions */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowAiSearch(!showAiSearch)}
                                className={`p-2 rounded-lg transition-all ${showAiSearch ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-slate-800 text-slate-400 hover:text-indigo-400'}`}
                                title="Ask AI"
                            >
                                <Sparkles size={20} />
                            </button>
                            <button
                                onClick={() => setShowFilters(!showFilters)}
                                className={`p-2 rounded-lg transition-all ${showFilters || selectedTag || selectedContext ? 'bg-emerald-500/20 text-emerald-300' : 'hover:bg-slate-800 text-slate-400 hover:text-emerald-400'}`}
                                title="Filters"
                            >
                                <Filter size={20} />
                            </button>
                            <button
                                onClick={selectAll}
                                className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-all font-mono text-xs hidden sm:block"
                                title="Select All (Ctrl+A)"
                            >
                                <CheckSquare size={20} />
                            </button>
                            <button
                                onClick={handleCreateEntity}
                                className="ml-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all hover:scale-105 active:scale-95"
                            >
                                <Plus size={18} /> <span className="hidden sm:inline">New Item</span>
                            </button>
                        </div>
                    </div>

                    {/* Expandable: AI Search */}
                    {showAiSearch && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-200">
                            <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-1 flex items-start gap-2">
                                <form onSubmit={handleAskAI} className="flex-1 flex gap-2 p-1">
                                    <input
                                        ref={aiInputRef}
                                        value={askQuery}
                                        onChange={(e) => setAskQuery(e.target.value)}
                                        placeholder="Ask AI a question about your library..."
                                        className="flex-1 bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-600 p-1"
                                    />
                                    <button type="submit" disabled={isAsking || !askQuery} className="px-3 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                                        {isAsking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
                                    </button>
                                </form>
                            </div>
                            {aiAnswer && (
                                <div className="mt-2 bg-slate-900/80 border border-slate-800 rounded-xl p-4 relative animate-in fade-in zoom-in-95">
                                    <button onClick={() => setAiAnswer(null)} className="absolute top-2 right-2 text-slate-500 hover:text-white p-1 hover:bg-slate-800 rounded">
                                        <X size={14} />
                                    </button>
                                    <div className="text-xs font-bold text-indigo-400 uppercase mb-2 flex items-center gap-1">
                                        <Sparkles size={12} /> AI Answer
                                    </div>
                                    <div className="text-slate-300 text-sm leading-relaxed max-h-60 overflow-y-auto pr-2">
                                        <MarkdownText content={aiAnswer} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Expandable: Advanced Filters */}
                    {showFilters && (
                        <div className="flex flex-wrap gap-4 p-4 bg-slate-900 rounded-xl border border-slate-800 animate-in slide-in-from-top-2 fade-in">
                            <div className="flex-1 min-w-[200px]">
                                <label className="text-xs font-semibold text-slate-500 uppercase block mb-2">Filter by Tag</label>
                                <select
                                    value={selectedTag || ''}
                                    onChange={e => setSelectedTag(e.target.value || null)}
                                    className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-sm rounded-lg p-2 outline-none focus:border-indigo-500"
                                >
                                    <option value="">All Tags</option>
                                    {allTags.map(t => <option key={t.id} value={t.title}>#{t.title} ({t.usage_count})</option>)}
                                </select>
                            </div>
                            <div className="flex-1 min-w-[200px]">
                                <label className="text-xs font-semibold text-slate-500 uppercase block mb-2">Filter by Context</label>
                                <select
                                    value={selectedContext || ''}
                                    onChange={e => setSelectedContext(e.target.value || null)}
                                    className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-sm rounded-lg p-2 outline-none focus:border-indigo-500"
                                >
                                    <option value="">All Contexts</option>
                                    {allContexts.map(c => <option key={c.id} value={c.title}>@{c.title} ({c.usage_count})</option>)}
                                </select>
                            </div>
                            <div className="w-full flex justify-end">
                                <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                                    <X size={12} /> Clear all filters
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Kind Tabs (Horizontal Scroll) */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar -mx-4 px-4 mask-fade-sides">
                        {kindTabs.map(tab => {
                            const isActive = kindFilter === tab.id;
                            const Icon = tab.icon as any;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setKindFilter(tab.id)}
                                    className={`
                                        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all
                                        ${isActive
                                            ? 'bg-slate-100 text-slate-900 border-slate-100 shadow-sm'
                                            : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:bg-slate-800 hover:text-slate-200'
                                        }
                                    `}
                                >
                                    {tab.id !== 'all' && tab.icon}
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 2. Selection Bar (Floating) */}
            {selectedIds.size > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900 border border-slate-700 shadow-2xl rounded-full px-4 py-2 flex items-center gap-3 animate-in slide-in-from-bottom-4 fade-in">
                    <span className="text-xs font-bold text-slate-200">{selectedIds.size} Selected</span>
                    <div className="h-4 w-px bg-slate-700" />
                    <button onClick={() => bulkUpdate(true)} className="p-1.5 hover:bg-slate-800 rounded-full text-amber-400" title="Hide from AI">
                        <EyeOff size={16} />
                    </button>
                    <button onClick={() => bulkUpdate(false)} className="p-1.5 hover:bg-slate-800 rounded-full text-emerald-400" title="Unhide">
                        <Eye size={16} />
                    </button>
                    <div className="h-4 w-px bg-slate-700" />
                    <button onClick={deselectAll} className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* 3. Main Grid */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-950">
                {filteredItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600">
                        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center mb-4">
                            <Search size={24} className="opacity-20" />
                        </div>
                        <p className="font-medium">No results found</p>
                        {hasActiveFilters && <button onClick={clearFilters} className="mt-2 text-sm text-indigo-400 hover:underline">Clear Filters</button>}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 pb-20">
                        {filteredItems.map(item => (
                            <div
                                key={item.id}
                                onClick={() => selectEntity(item.id)}
                                className={`
                                    group relative flex flex-col h-48 bg-slate-900 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200
                                    ${selectedIds.has(item.id)
                                        ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20 scale-[1.02] bg-slate-800'
                                        : 'border border-slate-800/60 hover:border-slate-700 hover:shadow-xl hover:-translate-y-1'
                                    }
                                `}
                            >
                                {/* Header */}
                                <div className="p-4 flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${getKindColorClass(item.kind)}`}>
                                                {item.kind}
                                            </span>
                                            {item.priority > 1 && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="High Priority" />}
                                        </div>
                                        <h3 className="font-bold text-slate-100 text-sm truncate leading-snug group-hover:text-indigo-400 transition-colors">
                                            {item.title}
                                        </h3>
                                    </div>
                                    <button
                                        onClick={(e) => toggleSelect(item.id, e)}
                                        className={`shrink-0 p-1.5 rounded-lg transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-slate-700 hover:text-slate-300'}`}
                                    >
                                        {selectedIds.has(item.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="px-4 pb-2 flex-1 relative">
                                    <div className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                                        {item.description ? <MarkdownText content={item.description} /> : <span className="italic opacity-30">No content</span>}
                                    </div>
                                    {/* Gradient Fade for text */}
                                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
                                </div>

                                {/* Link / Metadata Footer */}
                                <div className="px-4 py-3 bg-slate-950/30 border-t border-slate-800/50 flex items-center justify-between text-[10px] text-slate-500">
                                    <div className="flex items-center gap-2">
                                        {item.canonical_tags && item.canonical_tags.length > 0 ? (
                                            <div className="flex -space-x-1">
                                                <div className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 truncate max-w-[80px]">#{item.canonical_tags[0]}</div>
                                                {item.canonical_tags.length > 1 && <div className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-500">+{item.canonical_tags.length - 1}</div>}
                                            </div>
                                        ) : (
                                            <span>{new Date(item.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                        )}
                                    </div>
                                    <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all text-indigo-400" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default KnowledgeView;