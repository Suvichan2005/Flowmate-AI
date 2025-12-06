import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Entity, EntityStatus, EntityKind } from '../types';
import { Clock, AlertCircle, GripVertical, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface KanbanBoardProps {
  entities: Entity[];
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ entities }) => {
  const { applyOperations, selectEntity } = useStore();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  
  // Quick Add State
  const [addingToStatus, setAddingToStatus] = useState<EntityStatus | null>(null);
  const [quickTitle, setQuickTitle] = useState('');

  const columns = [
    { id: EntityStatus.PENDING, label: 'Backlog', color: 'border-slate-600' },
    { id: EntityStatus.ACTIVE, label: 'To Do', color: 'border-indigo-500' },
    { id: EntityStatus.IN_PROGRESS, label: 'In Progress', color: 'border-orange-500' },
    { id: EntityStatus.COMPLETED, label: 'Done', color: 'border-emerald-500' }
  ];

  const grouped = useMemo(() => {
    const groups: Record<string, Entity[]> = {};
    columns.forEach(c => groups[c.id] = []);
    entities.forEach(e => {
        if (groups[e.status]) {
            groups[e.status].push(e);
        } else if (e.status !== EntityStatus.CANCELED && e.status !== EntityStatus.ARCHIVED) {
            groups[EntityStatus.PENDING].push(e);
        }
    });
    return groups;
  }, [entities]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
      setDraggedId(id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, status: EntityStatus) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      setDraggedId(null);
      const entity = entities.find(e => e.id === id);
      if (entity && entity.status !== status) {
          applyOperations([{
              type: 'update_entity',
              payload: { id, fields: { status } }
          }]);
      }
  };

  const handleQuickAdd = (status: EntityStatus) => {
      if (!quickTitle.trim()) {
          setAddingToStatus(null);
          return;
      }
      applyOperations([{
          type: 'create_entity',
          payload: {
              kind: EntityKind.TASK,
              title: quickTitle,
              status: status
          }
      }]);
      setQuickTitle('');
      setAddingToStatus(null);
  };

  return (
    <div className="flex gap-4 h-full min-w-full overflow-x-auto pb-4">
      {columns.map(col => (
          <div 
            key={col.id}
            className={`flex-shrink-0 w-72 bg-slate-900/50 rounded-xl flex flex-col border-t-2 ${col.color}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
              <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-xl">
                  <span className="font-semibold text-sm text-slate-200">{col.label}</span>
                  <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                      {grouped[col.id]?.length || 0}
                  </span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {grouped[col.id]?.map(item => (
                      <div 
                          key={item.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, item.id)}
                          onClick={() => selectEntity(item.id)}
                          className={`bg-slate-800 p-3 rounded-lg border border-slate-700 cursor-grab active:cursor-grabbing hover:border-slate-600 transition-all shadow-sm ${draggedId === item.id ? 'opacity-50' : 'opacity-100'}`}
                      >
                          <div className="flex justify-between items-start mb-2">
                              <span className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700/50">
                                  {item.kind}
                              </span>
                              {item.priority > 1 && <AlertCircle size={14} className="text-orange-400" />}
                          </div>
                          
                          <div className="font-medium text-sm text-slate-200 mb-1 leading-snug">
                              {item.title}
                          </div>
                          
                          {item.deadline && (
                             <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-2">
                                 <Clock size={10} />
                                 <span>{new Date(item.deadline).toLocaleDateString()}</span>
                             </div>
                          )}
                      </div>
                  ))}
                  
                  {/* Quick Add Input */}
                  {addingToStatus === col.id ? (
                      <div className="p-2 bg-slate-800 rounded-lg border border-indigo-500/50 animate-in fade-in zoom-in duration-200">
                          <input 
                              autoFocus
                              type="text"
                              value={quickTitle}
                              onChange={e => setQuickTitle(e.target.value)}
                              onKeyDown={e => {
                                  if (e.key === 'Enter') handleQuickAdd(col.id);
                                  if (e.key === 'Escape') setAddingToStatus(null);
                              }}
                              onBlur={() => handleQuickAdd(col.id)}
                              placeholder="Task title..."
                              className="w-full bg-slate-900 text-sm p-1.5 rounded border border-slate-700 outline-none text-white"
                          />
                      </div>
                  ) : (
                      <button 
                        onClick={() => { setAddingToStatus(col.id); setQuickTitle(''); }}
                        className="w-full py-2 rounded-lg border-2 border-dashed border-slate-800 text-slate-600 hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-slate-800/50 transition-all text-xs font-medium flex items-center justify-center gap-2"
                      >
                          <Plus size={14} /> Add Task
                      </button>
                  )}
              </div>
          </div>
      ))}
    </div>
  );
};

export default KanbanBoard;