import React, { useState } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckSquare, Clock, Plus } from 'lucide-react';
import CreateEntityModal from './CreateEntityModal';

const CalendarView: React.FC = () => {
  const { entities, selectEntity, applyOperations } = useStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [createModalDate, setCreateModalDate] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Filter events AND tasks with deadlines
  const calendarItems = entities.filter(e => {
      if (e.kind === EntityKind.EVENT && e.start_time) return true;
      if (e.kind === EntityKind.TASK && e.deadline && e.status !== EntityStatus.COMPLETED) return true;
      return false;
  });
  
  // Navigation helpers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
      setDraggedId(id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
      // Transparent drag image hack if needed, but default is usually okay
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault(); // Necessary to allow dropping
      e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, day: number) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      const entity = entities.find(ent => ent.id === id);
      
      if (entity) {
          // Create new date object for the target day
          const newDate = new Date(year, month, day);
          
          // Logic to preserve time or default to noon (to avoid timezone shift issues)
          if (entity.kind === EntityKind.EVENT && entity.start_time) {
              const oldStart = new Date(entity.start_time);
              newDate.setHours(oldStart.getHours(), oldStart.getMinutes());
          } else {
              newDate.setHours(12, 0, 0, 0); 
          }

          const updates: any = {};
          
          if (entity.kind === EntityKind.EVENT) {
              updates.start_time = newDate.toISOString();
              if (entity.end_time && entity.start_time) {
                   const duration = new Date(entity.end_time).getTime() - new Date(entity.start_time).getTime();
                   updates.end_time = new Date(newDate.getTime() + duration).toISOString();
              }
          } else {
              // For tasks, update deadline
              updates.deadline = newDate.toISOString();
          }
          
          applyOperations([{
              type: 'update_entity',
              payload: { id: entity.id, fields: updates }
          }]);
      }
      setDraggedId(null);
  };

  // Render variables
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay(); // 0 is Sunday

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: startDay }, (_, i) => i);

  // Today check
  const now = new Date();
  const isCurrentMonth = now.getMonth() === month && now.getFullYear() === year;

  const handleDayClick = (day: number) => {
      const d = new Date(year, month, day);
      const offset = d.getTimezoneOffset(); 
      const adjustedDate = new Date(d.getTime() - (offset*60*1000));
      setCreateModalDate(adjustedDate.toISOString().split('T')[0]);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 p-6 h-full overflow-hidden relative">
      <header className="mb-6 flex justify-between items-center">
         <div className="flex items-center gap-4">
             <h1 className="text-2xl font-bold text-slate-100 w-48">{monthName}</h1>
             <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-1">
                 <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronLeft size={18}/></button>
                 <button onClick={handleToday} className="px-3 text-xs font-medium text-slate-400 hover:text-white transition-colors">Today</button>
                 <button onClick={handleNextMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronRight size={18}/></button>
             </div>
         </div>
         <div className="flex gap-4 text-xs text-slate-500">
             <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded bg-indigo-500"></div> Events
             </div>
             <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded bg-emerald-500"></div> Deadlines
             </div>
         </div>
      </header>

      <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
      </div>

      <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-1 border-t border-l border-slate-800 bg-slate-800">
        {blanks.map((_, i) => (
           <div key={`blank-${i}`} className="bg-slate-950 border-r border-b border-slate-800"></div>
        ))}
        
        {days.map(day => {
            const dateStr = new Date(year, month, day).toDateString();
            const isToday = isCurrentMonth && day === now.getDate();
            
            // Filter items for this day
            const dayItems = calendarItems.filter(e => {
                const d = e.kind === EntityKind.EVENT ? new Date(e.start_time!) : new Date(e.deadline!);
                return d.toDateString() === dateStr;
            }).sort((a, b) => {
                 if (a.kind !== b.kind) return a.kind === EntityKind.EVENT ? -1 : 1;
                 return 0;
            });

            return (
                <div 
                    key={day} 
                    onClick={() => handleDayClick(day)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day)}
                    className={`bg-slate-950 border-r border-b border-slate-800 p-2 min-h-[80px] relative hover:bg-slate-900 transition-colors group flex flex-col cursor-pointer ${
                        isToday ? 'bg-slate-900/80' : ''
                    } ${draggedId ? 'hover:bg-indigo-500/10' : ''}`}
                >
                    <div className="flex justify-between items-start">
                        <span className={`text-xs font-medium block mb-1 ${isToday ? 'text-indigo-400 bg-indigo-500/10 w-6 h-6 flex items-center justify-center rounded-full' : 'text-slate-500'}`}>
                            {day}
                        </span>
                        {/* Hover Add Button */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                             <Plus size={12} className="text-slate-500 hover:text-white" />
                        </div>
                    </div>

                    <div className="space-y-1 overflow-hidden flex-1">
                        {dayItems.map(item => (
                            <div 
                                key={item.id} 
                                draggable
                                onDragStart={(e) => handleDragStart(e, item.id)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    selectEntity(item.id);
                                }}
                                className={`text-[10px] px-1.5 py-0.5 rounded border-l-2 truncate cursor-grab active:cursor-grabbing transition-colors flex items-center gap-1 ${
                                    item.kind === EntityKind.EVENT 
                                        ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500 hover:bg-indigo-600/40' 
                                        : 'bg-emerald-600/20 text-emerald-200 border-emerald-500 hover:bg-emerald-600/40'
                                } ${draggedId === item.id ? 'opacity-50' : ''}`} 
                                title={item.title}
                            >
                                {item.kind === EntityKind.EVENT ? <Clock size={8} /> : <CheckSquare size={8} />}
                                {item.title}
                            </div>
                        ))}
                    </div>
                </div>
            );
        })}
        
        {Array.from({ length: 42 - (days.length + blanks.length) }).map((_, i) => (
             <div key={`end-blank-${i}`} className="bg-slate-950 border-r border-b border-slate-800 opacity-50"></div>
        ))}
      </div>

      {createModalDate && (
          <CreateEntityModal 
            onClose={() => setCreateModalDate(null)} 
            initialDate={createModalDate}
            initialKind={EntityKind.EVENT}
          />
      )}
    </div>
  );
};

export default CalendarView;