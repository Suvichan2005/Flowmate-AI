import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';
import { queryKnowledgeBase } from '../services/geminiService';
import { Library, Search, Plus, Hash, Sparkles, X, BookOpen, FileText, ArrowRight, Loader2, Tag, Layers } from 'lucide-react';
import MarkdownText from './MarkdownText';

const KnowledgeView: React.FC = () => {
    const { entities, universalTags, selectEntity, applyOperations } = useStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [isAsking, setIsAsking] = useState(false);
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [askQuery, setAskQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'tags' | 'contexts'>('all');

    // 1. Filter Entities for Knowledge Base (include CONTEXTs now)
    const knowledgeEntities = useMemo(() => {
        return entities.filter(e =>
            [EntityKind.NOTE, EntityKind.TOPIC, EntityKind.COURSE, EntityKind.CONTEXT].includes(e.kind)
        ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }, [entities]);

    // 2. Get tags from universal store (proper source)
    const allTags = useMemo(() => {
        return universalTags.filter(t => t.kind === EntityKind.TAG).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    }, [universalTags]);

    // 3. Get contexts from universal store
    const allContexts = useMemo(() => {
        return universalTags.filter(t => t.kind === EntityKind.CONTEXT).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    }, [universalTags]);

    // 4. Filter Displayed Items
    const filteredItems = useMemo(() => {
        return knowledgeEntities.filter(e => {
            const matchesSearch = !searchQuery ||
                e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (e.description || '').toLowerCase().includes(searchQuery.toLowerCase());

            const matchesTag = !selectedTag || e.canonical_tags?.includes(selectedTag);

            return matchesSearch && matchesTag;
        });
    }, [knowledgeEntities, searchQuery, selectedTag]);

    // 5. Handle "Ask AI"
    const handleAskAI = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!askQuery.trim()) return;

        setIsAsking(true);
        setAiAnswer(null);

        // Perform client-side RAG
        const answer = await queryKnowledgeBase(askQuery, entities);

        setAiAnswer(answer);
        setIsAsking(false);
    };

    // 6. Quick Create Note
    const handleCreateNote = () => {
        const title = prompt("Note Title:");
        if (title) {
            applyOperations([{
                type: 'create_entity',
                payload: {
                    kind: EntityKind.NOTE,
                    title: title,
                    status: EntityStatus.ACTIVE
                }
            }]);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8 flex flex-col h-full">
            <header className="mb-6 flex flex-col gap-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            <Library className="text-emerald-400" /> Knowledge Base
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                            {knowledgeEntities.length} items &bull; {allTags.length} tags &bull; {allContexts.length} contexts
                        </p>
                    </div>
                    <button
                        onClick={handleCreateNote}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                        <Plus size={16} /> New Note
                    </button>
                </div>

                {/* Semantic Search / Ask AI Area */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-1 overflow-hidden">
                    <form onSubmit={handleAskAI} className="relative flex items-center">
                        <div className="pl-4 pr-2 text-indigo-400">
                            <Sparkles size={18} />
                        </div>
                        <input
                            type="text"
                            value={askQuery}
                            onChange={(e) => setAskQuery(e.target.value)}
                            placeholder="Ask a question about your notes (e.g., 'What were the key takeaways from the Q4 meeting?')"
                            className="flex-1 bg-transparent border-none outline-none text-slate-200 p-3 text-sm placeholder:text-slate-600"
                        />
                        <button
                            type="submit"
                            disabled={isAsking || !askQuery.trim()}
                            className="mr-1 px-4 py-1.5 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 hover:text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        >
                            {isAsking ? <Loader2 size={14} className="animate-spin" /> : 'Ask AI'}
                        </button>
                    </form>

                    {/* AI Answer Result */}
                    {aiAnswer && (
                        <div className="border-t border-slate-800 p-4 bg-indigo-950/10 animate-in slide-in-from-top-2 fade-in">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">AI Answer</span>
                                <button onClick={() => setAiAnswer(null)}><X size={14} className="text-slate-500 hover:text-white" /></button>
                            </div>
                            <div className="text-slate-300 text-sm">
                                <MarkdownText content={aiAnswer} />
                            </div>
                        </div>
                    )}
                </div>
            </header>

            <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
                {/* Left Sidebar: Tags & Filters */}
                <aside className="w-full md:w-56 flex-shrink-0 space-y-6">
                    {/* Search Filter */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 text-slate-500 w-4 h-4" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg pl-8 pr-2 py-2 focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </div>

                    {/* Tab Switcher */}
                    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg">
                        {(['all', 'tags', 'contexts'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors capitalize ${activeTab === tab
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Tags Section */}
                    {(activeTab === 'all' || activeTab === 'tags') && (
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                                <Tag size={12} /> Tags ({allTags.length})
                            </h3>
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                                <button
                                    onClick={() => setSelectedTag(null)}
                                    className={`text-[10px] px-2 py-1 rounded border transition-colors ${selectedTag === null
                                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                        }`}
                                >
                                    All
                                </button>
                                {allTags.map(tag => (
                                    <button
                                        key={tag.id}
                                        onClick={() => setSelectedTag(selectedTag === tag.title ? null : tag.title)}
                                        className={`text-[10px] px-2 py-1 rounded border transition-colors flex items-center gap-1 ${selectedTag === tag.title
                                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                            }`}
                                    >
                                        <Hash size={8} /> {tag.title}
                                        {tag.usage_count > 0 && (
                                            <span className="text-slate-600 ml-0.5">({tag.usage_count})</span>
                                        )}
                                    </button>
                                ))}
                                {allTags.length === 0 && (
                                    <span className="text-xs text-slate-600 italic">No tags yet</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Contexts Section */}
                    {(activeTab === 'all' || activeTab === 'contexts') && (
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                                <Layers size={12} /> Contexts ({allContexts.length})
                            </h3>
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                                {allContexts.map(ctx => (
                                    <button
                                        key={ctx.id}
                                        onClick={() => setSelectedTag(selectedTag === ctx.title ? null : ctx.title)}
                                        className={`text-[10px] px-2 py-1 rounded border transition-colors flex items-center gap-1 ${selectedTag === ctx.title
                                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                            }`}
                                    >
                                        <Layers size={8} /> {ctx.title}
                                        {ctx.usage_count > 0 && (
                                            <span className="text-slate-600 ml-0.5">({ctx.usage_count})</span>
                                        )}
                                    </button>
                                ))}
                                {allContexts.length === 0 && (
                                    <span className="text-xs text-slate-600 italic">No contexts yet</span>
                                )}
                            </div>
                        </div>
                    )}
                </aside>

                {/* Main Grid */}
                <div className="flex-1 overflow-y-auto">
                    {filteredItems.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                            <Library className="w-10 h-10 mb-2 opacity-20" />
                            <p>No matching items found.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredItems.map(item => (
                                <div
                                    key={item.id}
                                    onClick={() => selectEntity(item.id)}
                                    className="group bg-slate-900 border border-slate-800 hover:border-emerald-500/30 rounded-xl p-4 cursor-pointer transition-all hover:bg-slate-800/50 flex flex-col h-52 relative overflow-hidden"
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${item.kind === EntityKind.CONTEXT
                                                ? 'text-indigo-400 bg-indigo-950 border-indigo-800'
                                                : 'text-slate-500 bg-slate-950 border-slate-800'
                                            }`}>
                                            {item.kind}
                                        </span>
                                        {item.priority > 1 && <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>}
                                    </div>

                                    <h3 className="font-semibold text-slate-200 mb-2 truncate group-hover:text-emerald-400 transition-colors">
                                        {item.title}
                                    </h3>

                                    <div className="text-xs text-slate-500 line-clamp-3 leading-relaxed flex-1">
                                        {item.description ? (
                                            <MarkdownText content={item.description} />
                                        ) : (
                                            <span className="italic opacity-50">No content...</span>
                                        )}
                                    </div>

                                    {/* Tags on card */}
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

                                    {/* Bottom meta */}
                                    <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-slate-600">
                                        <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                                        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KnowledgeView;