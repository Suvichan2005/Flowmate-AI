import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType } from '../types';
import { Target, BookOpen, Clock, AlertCircle, Search, Filter, CheckCircle2, Circle, Library, StickyNote, Hash, LayoutGrid, Kanban, CalendarRange } from 'lucide-react';
import KanbanBoard from './KanbanBoard';
import TimelineView from './TimelineView';
import { calculateProgress } from '../utils/progressCalculation';

interface EntityListProps {
  kinds: EntityKind[]; 
  title: string;
}

const EntityList: React.FC<EntityListProps> = ({ kinds, title }) => {
  const { entities, relationships, selectEntity } = useStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EntityStatus | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'GRID' | 'BOARD' | 'TIMELINE'>('GRID');

  const filteredItems = useMemo(() => {
    return entities.filter(e => {
        // 1. Kind Check
        if (!kinds.includes(e.kind)) return false;
        
        // 2. Search Check
        const query = searchQuery.toLowerCase();
        const matchesSearch = e.title.toLowerCase().includes(query) || 
                              (e.description || '').toLowerCase().includes(query);
        if (!matchesSearch) return false;

        // 3. Status Check (Only applies to GRID view)
        if (viewMode === 'GRID' && statusFilter !== 'ALL' && e.status !== statusFilter) return false;

        return true;
    }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [entities, kinds, searchQuery, statusFilter, viewMode]);

  const getChildCount = (entityId: string) => {
     return relationships.filter(r => r.to === entityId && r.type === RelationshipType.PART_OF).length;
  };

  const getIcon = () => {
      if (kinds.includes(EntityKind.GOAL)) return <Target className="text-indigo-400 w-8 h-8" />;
      if (kinds.includes(EntityKind.PROJECT)) return <BookOpen className="text-orange-400 w-8 h-8" />;
      if (kinds.includes(EntityKind.NOTE)) return <Library className="text-emerald-400 w-8 h-8" />;
      return <StickyNote className="text-slate-400 w-8 h-8" />;
  };

  const isTrackable = kinds.includes(EntityKind.PROJECT) || kinds.includes(EntityKind.GOAL);

  return (
    <div className="flex-1 overflow-hidden bg-slate-950 p-6 md:p-8 flex flex-col">
      <header className="mb-6 flex flex-col md:flex-row gap-4 md:items-end justify-between shrink-0">
        <div className="flex items-center gap-3">
            {getIcon()}
            <div>
            <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
            <p className="text-slate-500 text-sm">Managing {filteredItems.length} items</p>
            </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 w-full md:w-auto">
             <div className="flex gap-2">
                 {/* View Toggles */}
                 <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex">
                     <button 
                        onClick={() => setViewMode('GRID')}
                        className={`p-2 rounded ${viewMode === 'GRID' ? 'bg-slate-800 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        title="Grid View"
                     >
                         <LayoutGrid size={16} />
                     </button>
                     <button 
                        onClick={() => setViewMode('BOARD')}
                        className={`p-2 rounded ${viewMode === 'BOARD' ? 'bg-slate-800 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        title="Kanban Board"
                     >
                         <Kanban size={16} />
                     </button>
                     <button 
                        onClick={() => setViewMode('TIMELINE')}
                        className={`p-2 rounded ${viewMode === 'TIMELINE' ? 'bg-slate-800 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        title="Timeline View"
                     >
                         <CalendarRange size={16} />
                     </button>
                 </div>

                 {/* Status Filter (Only valid for Grid) */}
                 {viewMode === 'GRID' && (
                    <div className="relative w-full md:w-40">
                        <Filter className="absolute left-2.5 top-2.5 text-slate-500 w-3.5 h-3.5" />
                        <select 
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as EntityStatus | 'ALL')}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-200 rounded-lg pl-8 pr-2 py-2 text-xs focus:ring-1 focus:ring-indigo-500 outline-none appearance-none"
                        >
                            <option value="ALL">All Status</option>
                            <option value={EntityStatus.ACTIVE}>Active</option>
                            <option value={EntityStatus.IN_PROGRESS}>Doing</option>
                            <option value={EntityStatus.COMPLETED}>Done</option>
                            <option value={EntityStatus.PENDING}>Backlog</option>
                        </select>
                    </div>
                 )}
             </div>

             <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-2.5 text-slate-500 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder={`Search ${title.toLowerCase()}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 text-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                />
            </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
          {viewMode === 'TIMELINE' ? (
              <TimelineView entities={filteredItems} />
          ) : viewMode === 'BOARD' ? (
              <KanbanBoard entities={filteredItems} />
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-800 rounded-xl text-slate-500">
            <p>No items found matching your filters.</p>
            {searchQuery && <button onClick={() => setSearchQuery('')} className="text-indigo-400 text-sm mt-2 hover:underline">Clear Search</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {filteredItems.map(item => {
                const progress = calculateProgress(item, entities, relationships);
                const childCount = getChildCount(item.id);

                return (
                    <div 
                        key={item.id} 
                        onClick={() => selectEntity(item.id)}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors group cursor-pointer hover:bg-slate-800/50 flex flex-col h-full relative overflow-hidden"
                    >
                    <div className="flex justify-between items-start mb-3 relative z-10">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider flex items-center gap-1 ${
                            item.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' : 
                            item.status === 'ACTIVE' || item.status === 'IN_PROGRESS' ? 'bg-indigo-500/10 text-indigo-400' : 
                            'bg-slate-700 text-slate-400'
                        }`}>
                            {item.status === 'COMPLETED' ? <CheckCircle2 size={10} /> : <Circle size={10} />}
                            {item.status.replace('_', ' ')}
                        </span>
                        <div className="flex items-center gap-2">
                            {item.kind !== kinds[0] && (
                                <span className="text-[10px] font-mono text-slate-600 bg-slate-925 px-1.5 py-0.5 rounded border border-slate-800">
                                    {item.kind}
                                </span>
                            )}
                            {item.priority > 1 && <AlertCircle className="w-4 h-4 text-orange-400" />}
                        </div>
                    </div>
                    
                    <h3 className="font-semibold text-slate-200 mb-2 truncate" title={item.title}>{item.title}</h3>
                    <p className="text-sm text-slate-500 line-clamp-3 mb-4 flex-1">
                        {item.description || "No description provided."}
                    </p>

                    {/* Tags (for Knowledge view) */}
                    {!isTrackable && item.canonical_tags && item.canonical_tags.length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-1">
                            {item.canonical_tags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                    <Hash size={8} />{tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Progress Bar (for Trackables) */}
                    {isTrackable && (
                        <div className="mb-4">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span>Progress</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div 
                                    className={`h-full rounded-full transition-all duration-1000 ${
                                        progress >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                                    }`} 
                                    style={{ width: `${progress}%` }} 
                                />
                            </div>
                        </div>
                    )}

                    <div className="pt-4 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500 mt-auto">
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(item.updated_at).toLocaleDateString()}
                        </span>
                        {childCount > 0 && (
                            <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-400">
                                {childCount} items
                            </span>
                        )}
                    </div>
                    </div>
                );
            })}
            </div>
          )}
      </div>
    </div>
  );
};

export default EntityList;