import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity } from '../types';
import { queryKnowledgeBase } from '../services/geminiService';
import { Library, Search, Plus, Hash, Sparkles, X, ArrowRight, Loader2, Tag, Layers, Filter, FileText, BookOpen, Folder, Target, Calendar, CheckSquare, Square, Eye, EyeOff } from 'lucide-react';
import MarkdownText from './MarkdownText';

type FilterKind = 'all' | EntityKind.NOTE | EntityKind.TOPIC | EntityKind.COURSE | EntityKind.CONTEXT | EntityKind.TASK | EntityKind.PROJECT | EntityKind.GOAL | EntityKind.EVENT;

const KnowledgeView: React.FC = () => {
    const { entities, relationships, universalTags, selectEntity, applyOperations } = useStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [selectedContext, setSelectedContext] = useState<string | null>(null);
    const [isAsking, setIsAsking] = useState(false);
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [askQuery, setAskQuery] = useState('');
    const [kindFilter, setKindFilter] = useState<FilterKind>('all');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Get tags and contexts from universal store
    const allTags = useMemo(() => {
        return universalTags.filter(t => t.kind === EntityKind.TAG).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    }, [universalTags]);

    const allContexts = useMemo(() => {
        return universalTags.filter(t => t.kind === EntityKind.CONTEXT).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    }, [universalTags]);

    // Get entities related to selected tag/context via relationships
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

    // Filter entities based on all criteria
    const filteredItems = useMemo(() => {
        return entities.filter(e => {
            // Exclude archived/canceled
            if (e.status === EntityStatus.ARCHIVED || e.status === EntityStatus.CANCELED) return false;

            // Kind filter
            if (kindFilter !== 'all' && e.kind !== kindFilter) return false;

            // Search query
            const matchesSearch = !searchQuery ||
                e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (e.description || '').toLowerCase().includes(searchQuery.toLowerCase());
            if (!matchesSearch) return false;

            // Tag filter - check canonical_tags or relationships
            if (selectedTag) {
                const hasTag = e.canonical_tags?.includes(selectedTag);
                const relatedIds = getRelatedEntityIds(selectedTag);
                if (!hasTag && !relatedIds.has(e.id)) return false;
            }

            // Context filter - check canonical_tags or relationships
            if (selectedContext) {
                const hasContext = e.canonical_tags?.includes(selectedContext);
                const relatedIds = getRelatedEntityIds(selectedContext);
                if (!hasContext && !relatedIds.has(e.id)) return false;
            }

            return true;
        }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }, [entities, searchQuery, selectedTag, selectedContext, kindFilter, relationships]);

    // Ask AI (uses filtered items to respect active filters)
    const handleAskAI = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!askQuery.trim()) return;
        setIsAsking(true);
        setAiAnswer(null);
        // Use filteredItems to respect tag/context/kind filters
        const itemsToSearch = filteredItems.length > 0 ? filteredItems : entities;
        const answer = await queryKnowledgeBase(askQuery, itemsToSearch);
        setAiAnswer(answer);
        setIsAsking(false);
    };

    // Quick Create Note
    const handleCreateNote = () => {
        const title = prompt("Note Title:");
        if (title) {
            applyOperations([{
                type: 'create_entity',
                payload: { kind: EntityKind.NOTE, title, status: EntityStatus.ACTIVE }
            }]);
        }
    };

    // Clear all filters
    const clearFilters = () => {
        setSearchQuery('');
        setSelectedTag(null);
        setSelectedContext(null);
        setKindFilter('all');
    };

    // Multi-select handlers
    const toggleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedIds(next);
    };

    const selectAll = () => {
        setSelectedIds(new Set(filteredItems.map(e => e.id)));
    };

    const deselectAll = () => {
        setSelectedIds(new Set());
    };

    const bulkHide = () => {
        if (selectedIds.size === 0) return;
        const ops = Array.from(selectedIds).map(id => {
            const entity = entities.find(e => e.id === id);
            return {
                type: 'update_entity' as const,
                payload: {
                    id,
                    fields: {
                        metadata: {
                            ...entity?.metadata,
                            hidden: true
                        }
                    }
                }
            };
        });
        applyOperations(ops);
        setSelectedIds(new Set());
    };

    const bulkUnhide = () => {
        if (selectedIds.size === 0) return;
        const ops = Array.from(selectedIds).map(id => {
            const entity = entities.find(e => e.id === id);
            return {
                type: 'update_entity' as const,
                payload: {
                    id,
                    fields: {
                        metadata: {
                            ...entity?.metadata,
                            hidden: false
                        }
                    }
                }
            };
        });
        applyOperations(ops);
        setSelectedIds(new Set());
    };

    const hasActiveFilters = searchQuery || selectedTag || selectedContext || kindFilter !== 'all';

    // Kind filter options
    const kindOptions: { id: FilterKind; label: string; icon: React.ReactNode }[] = [
        { id: 'all', label: 'All', icon: <Folder size={12} /> },
        { id: EntityKind.NOTE, label: 'Notes', icon: <FileText size={12} /> },
        { id: EntityKind.TOPIC, label: 'Topics', icon: <BookOpen size={12} /> },
        { id: EntityKind.TASK, label: 'Tasks', icon: <CheckSquare size={12} /> },
        { id: EntityKind.PROJECT, label: 'Projects', icon: <Folder size={12} /> },
        { id: EntityKind.GOAL, label: 'Goals', icon: <Target size={12} /> },
        { id: EntityKind.EVENT, label: 'Events', icon: <Calendar size={12} /> },
    ];

    const getKindColor = (kind: EntityKind) => {
        switch (kind) {
            case EntityKind.NOTE: return 'text-cyan-400 bg-cyan-950 border-cyan-800';
            case EntityKind.TOPIC: return 'text-violet-400 bg-violet-950 border-violet-800';
            case EntityKind.TASK: return 'text-emerald-400 bg-emerald-950 border-emerald-800';
            case EntityKind.PROJECT: return 'text-purple-400 bg-purple-950 border-purple-800';
            case EntityKind.GOAL: return 'text-indigo-400 bg-indigo-950 border-indigo-800';
            case EntityKind.EVENT: return 'text-amber-400 bg-amber-950 border-amber-800';
            case EntityKind.CONTEXT: return 'text-pink-400 bg-pink-950 border-pink-800';
            default: return 'text-slate-400 bg-slate-950 border-slate-800';
        }
    };

    return (
        <div className="flex-1 overflow-hidden bg-slate-950 p-4 md:p-6 flex flex-col h-full">
            {/* Header */}
            <header className="mb-4 flex flex-col gap-3">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            <Library className="text-emerald-400" /> Knowledge Base
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">
                            {filteredItems.length} items {hasActiveFilters && <span className="text-indigo-400">• filtered</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1"
                            >
                                <X size={12} /> Clear Filters
                            </button>
                        )}
                        <button
                            onClick={handleCreateNote}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            <Plus size={16} /> New Note
                        </button>
                    </div>
                </div>

                {/* Multi-Select Action Bar */}
                {filteredItems.length > 0 && (
                    <div className="flex items-center gap-2 p-2 bg-slate-900 rounded-lg border border-slate-800">
                        <button
                            onClick={selectedIds.size === filteredItems.length ? deselectAll : selectAll}
                            className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            {selectedIds.size === filteredItems.length ? <Square size={14} /> : <CheckSquare size={14} />}
                            {selectedIds.size === filteredItems.length ? 'Deselect All' : 'Select All'}
                        </button>

                        {selectedIds.size > 0 && (
                            <>
                                <span className="text-xs text-slate-500">{selectedIds.size} selected</span>
                                <div className="flex-1" />
                                <button
                                    onClick={bulkHide}
                                    className="px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    <EyeOff size={14} /> Hide from AI
                                </button>
                                <button
                                    onClick={bulkUnhide}
                                    className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    <Eye size={14} /> Unhide
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* AI Search */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-1">
                    <form onSubmit={handleAskAI} className="relative flex items-center">
                        <div className="pl-4 pr-2 text-indigo-400"><Sparkles size={18} /></div>
                        <input
                            type="text"
                            value={askQuery}
                            onChange={(e) => setAskQuery(e.target.value)}
                            placeholder="Ask AI about your knowledge..."
                            className="flex-1 bg-transparent border-none outline-none text-slate-200 p-3 text-sm placeholder:text-slate-600"
                        />
                        <button
                            type="submit"
                            disabled={isAsking || !askQuery.trim()}
                            className="mr-1 px-4 py-1.5 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                            {isAsking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
                        </button>
                    </form>
                    {aiAnswer && (
                        <div className="border-t border-slate-800 p-4 bg-indigo-950/10">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold text-indigo-400 uppercase">AI Answer</span>
                                <button onClick={() => setAiAnswer(null)}><X size={14} className="text-slate-500 hover:text-white" /></button>
                            </div>
                            <div className="text-slate-300 text-sm"><MarkdownText content={aiAnswer} /></div>
                        </div>
                    )}
                </div>
            </header>

            {/* Filters Bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-slate-800">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                    <Search className="absolute left-2.5 top-2.5 text-slate-500 w-4 h-4" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg pl-8 pr-2 py-2 focus:ring-1 focus:ring-emerald-500 outline-none"
                    />
                </div>

                {/* Kind Filter */}
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                    {kindOptions.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setKindFilter(opt.id)}
                            className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors ${kindFilter === opt.id
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            {opt.icon}
                            <span className="hidden sm:inline">{opt.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tag selector */}
                {allTags.length > 0 && (
                    <select
                        value={selectedTag || ''}
                        onChange={(e) => setSelectedTag(e.target.value || null)}
                        className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-2 py-2 outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                        <option value="">All Tags</option>
                        {allTags.map(tag => (
                            <option key={tag.id} value={tag.title}>#{tag.title} ({tag.usage_count})</option>
                        ))}
                    </select>
                )}

                {/* Context selector */}
                {allContexts.length > 0 && (
                    <select
                        value={selectedContext || ''}
                        onChange={(e) => setSelectedContext(e.target.value || null)}
                        className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-2 py-2 outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                        <option value="">All Contexts</option>
                        {allContexts.map(ctx => (
                            <option key={ctx.id} value={ctx.title}>@{ctx.title} ({ctx.usage_count})</option>
                        ))}
                    </select>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                {filteredItems.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                        <Library className="w-10 h-10 mb-2 opacity-20" />
                        <p>{hasActiveFilters ? 'No matching items.' : 'No items yet.'}</p>
                        {hasActiveFilters && (
                            <button onClick={clearFilters} className="mt-2 text-xs text-indigo-400 hover:text-indigo-300">
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filteredItems.map(item => (
                            <div
                                key={item.id}
                                onClick={() => selectEntity(item.id)}
                                className={`group bg-slate-900 border rounded-xl p-4 cursor-pointer transition-all hover:bg-slate-800/50 flex flex-col h-44 relative overflow-hidden ${selectedIds.has(item.id)
                                        ? 'border-indigo-500 ring-1 ring-indigo-500/50'
                                        : 'border-slate-800 hover:border-emerald-500/30'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    {/* Selection checkbox */}
                                    <button
                                        onClick={(e) => toggleSelect(item.id, e)}
                                        className={`p-0.5 rounded transition-colors ${selectedIds.has(item.id)
                                                ? 'text-indigo-400'
                                                : 'text-slate-600 hover:text-slate-400'
                                            }`}
                                    >
                                        {selectedIds.has(item.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                                    </button>
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getKindColor(item.kind)}`}>
                                        {item.kind}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        {item.metadata?.hidden && <EyeOff size={12} className="text-amber-400" title="Hidden from AI" />}
                                        {item.priority > 1 && <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                                    </div>
                                </div>

                                <h3 className="font-semibold text-slate-200 mb-1 truncate group-hover:text-emerald-400 transition-colors text-sm">
                                    {item.title}
                                </h3>

                                <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed flex-1">
                                    {item.description ? (
                                        <MarkdownText content={item.description} />
                                    ) : (
                                        <span className="italic opacity-50">No content...</span>
                                    )}
                                </div>

                                {item.canonical_tags && item.canonical_tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-slate-800/50">
                                        {item.canonical_tags.slice(0, 3).map(tag => (
                                            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded">
                                                #{tag}
                                            </span>
                                        ))}
                                        {item.canonical_tags.length > 3 && (
                                            <span className="text-[9px] text-slate-600">+{item.canonical_tags.length - 3}</span>
                                        )}
                                    </div>
                                )}

                                <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-slate-600">
                                    <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                                    <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
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