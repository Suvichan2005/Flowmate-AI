import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Entity, EntityKind, EntityStatus } from '../types';
import { useStore } from '../store';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface TimelineViewProps {
  entities: Entity[];
}

const CELL_WIDTH = 60; // Pixels per day
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 48;

const TimelineView: React.FC<TimelineViewProps> = ({ entities }) => {
  const { selectEntity } = useStore();
  const [zoomLevel, setZoomLevel] = useState(1); // 0.5 to 2
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // 1. Prepare Data
  const { processedEntities, startDate, totalDays } = useMemo(() => {
    const validItems = entities.map(e => {
        let start = e.start_time ? new Date(e.start_time) : new Date(e.created_at);
        let end = e.deadline ? new Date(e.deadline) : e.end_time ? new Date(e.end_time) : null;
        
        // If no end, assume 1 day duration
        if (!end) {
            end = new Date(start);
            end.setDate(start.getDate() + 1);
        }
        
        // Ensure end > start
        if (end < start) end = start;

        return { ...e, _start: start, _end: end };
    }).sort((a, b) => a._start.getTime() - b._start.getTime());

    if (validItems.length === 0) {
        return { processedEntities: [], startDate: new Date(), totalDays: 14 };
    }

    // Determine range
    let minDate = new Date(validItems[0]._start);
    let maxDate = new Date(validItems[0]._end);

    validItems.forEach(e => {
        if (e._start < minDate) minDate = new Date(e._start);
        if (e._end > maxDate) maxDate = new Date(e._end);
    });

    // Buffer
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 5);
    
    // Ensure "Today" is included in the range for context
    const today = new Date();
    if (today < minDate) minDate = new Date(today.setDate(today.getDate() - 2));
    if (today > maxDate) maxDate = new Date(today.setDate(today.getDate() + 2));

    const diffTime = Math.abs(maxDate.getTime() - minDate.getTime());
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return { 
        processedEntities: validItems, 
        startDate: minDate, 
        totalDays: days 
    };
  }, [entities]);

  const currentCellWidth = CELL_WIDTH * zoomLevel;

  const getX = (date: Date) => {
    const diff = Math.ceil((date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    return diff * currentCellWidth;
  };

  const todayX = getX(new Date());

  // Auto-scroll to today on mount/data change
  useEffect(() => {
     if (!hasScrolledRef.current && scrollContainerRef.current && todayX >= 0) {
         const containerW = scrollContainerRef.current.clientWidth;
         // Center Today
         scrollContainerRef.current.scrollLeft = todayX - (containerW / 2) + (currentCellWidth / 2);
         hasScrolledRef.current = true;
     }
  }, [todayX, currentCellWidth]);

  // Reset scroll flag if entities are reloaded completely
  useEffect(() => {
      if (entities.length === 0) hasScrolledRef.current = false;
  }, [entities.length]);

  const handleWheel = (e: React.WheelEvent) => {
      if (scrollContainerRef.current && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
         scrollContainerRef.current.scrollLeft += e.deltaX;
      }
  };

  if (processedEntities.length === 0) {
      return (
          <div className="flex items-center justify-center h-full text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No timeline data available. Add dates to your entities.
          </div>
      );
  }

  // Generate Calendar Header
  const headerDays = [];
  for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      headerDays.push({
          date: d,
          label: d.getDate(),
          dayName: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
          isWeekend: d.getDay() === 0 || d.getDay() === 6
      });
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden relative">
        {/* Controls */}
        <div className="absolute top-2 right-2 z-20 flex gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800 backdrop-blur">
            <button onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))} className="p-1 hover:text-white text-slate-400"><ZoomOut size={16}/></button>
            <button onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.25))} className="p-1 hover:text-white text-slate-400"><ZoomIn size={16}/></button>
        </div>

        {/* Scrollable Area */}
        <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-auto relative scrollbar-hide" 
            onWheel={handleWheel}
        >
            <div 
                style={{ 
                    width: `${totalDays * currentCellWidth}px`, 
                    minWidth: '100%',
                    position: 'relative' 
                }}
            >
                {/* Header Row */}
                <div className="flex border-b border-slate-800 sticky top-0 bg-slate-900 z-10 h-10">
                    {headerDays.map((d, i) => (
                        <div 
                            key={i} 
                            style={{ width: currentCellWidth }} 
                            className={`flex flex-col items-center justify-center border-r border-slate-800/50 text-xs shrink-0 ${d.isWeekend ? 'bg-slate-800/20' : ''}`}
                        >
                            <span className="text-slate-500 font-bold">{d.dayName}</span>
                            <span className="text-slate-400">{d.label}</span>
                        </div>
                    ))}
                </div>

                {/* Today Line */}
                {todayX >= 0 && todayX <= totalDays * currentCellWidth && (
                    <div 
                        className="absolute top-0 bottom-0 border-l-2 border-indigo-500 z-0 pointer-events-none shadow-[0_0_15px_rgba(99,102,241,0.6)]"
                        style={{ left: todayX + (currentCellWidth / 2) }}
                    >
                        <div className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded absolute -top-0 -left-6 shadow-sm">Today</div>
                    </div>
                )}

                {/* Grid Background */}
                <div className="absolute inset-0 pointer-events-none flex">
                     {headerDays.map((d, i) => (
                        <div 
                            key={i} 
                            style={{ width: currentCellWidth }} 
                            className={`border-r border-slate-800/30 h-full shrink-0 ${d.isWeekend ? 'bg-slate-800/10' : ''}`}
                        />
                    ))}
                </div>

                {/* Entity Rows */}
                <div className="py-2 space-y-1">
                    {processedEntities.map(e => {
                        const x = getX(e._start);
                        const width = Math.max(currentCellWidth, getX(e._end) - x);
                        
                        // Color based on kind
                        let bgClass = 'bg-slate-600';
                        if (e.kind === EntityKind.PROJECT) bgClass = 'bg-orange-600';
                        if (e.kind === EntityKind.GOAL) bgClass = 'bg-red-600';
                        if (e.kind === EntityKind.TASK) bgClass = 'bg-indigo-600';
                        if (e.kind === EntityKind.EVENT) bgClass = 'bg-purple-600';
                        
                        // Status opacity
                        const opacity = e.status === EntityStatus.COMPLETED ? 'opacity-50 grayscale' : 'opacity-100';

                        return (
                            <div 
                                key={e.id} 
                                className="relative h-8 hover:bg-slate-800/50 transition-colors group"
                            >
                                <div 
                                    onClick={() => selectEntity(e.id)}
                                    className={`absolute top-1 h-6 rounded px-2 flex items-center text-xs text-white cursor-pointer shadow-sm border border-white/10 overflow-hidden whitespace-nowrap transition-all hover:scale-105 hover:z-10 ${bgClass} ${opacity}`}
                                    style={{ left: x, width: width }}
                                    title={`${e.title} (${e._start.toLocaleDateString()} - ${e._end.toLocaleDateString()})`}
                                >
                                    {e.title}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    </div>
  );
};

export default TimelineView;