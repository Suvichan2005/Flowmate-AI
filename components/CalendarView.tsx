import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, RecurrenceType } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckSquare, Clock, Plus, Grid3X3, List, CalendarDays, LayoutGrid, Repeat } from 'lucide-react';
import CreateEntityModal from './CreateEntityModal';

type ViewMode = 'month' | 'week' | 'day' | 'agenda';

const PIXELS_PER_HOUR = 60; // 1px per minute usually works well
const GRID_HEIGHT = 24 * PIXELS_PER_HOUR;

// Check if a target date matches a recurring pattern from original date
const matchesRecurrence = (originalDate: Date, targetDate: Date, recurrence: RecurrenceType): boolean => {
    if (!recurrence) return false;

    // Target must be on or after original date
    if (targetDate < originalDate) return false;

    const origDay = originalDate.getDate();
    const origMonth = originalDate.getMonth();
    const origDayOfWeek = originalDate.getDay();

    switch (recurrence) {
        case 'DAILY':
            return true; // Every day after original
        case 'WEEKLY':
            return targetDate.getDay() === origDayOfWeek; // Same day of week
        case 'MONTHLY':
            return targetDate.getDate() === origDay; // Same day of month
        case 'YEARLY':
            return targetDate.getDate() === origDay && targetDate.getMonth() === origMonth; // Same date
        default:
            return false;
    }
};

const CalendarView: React.FC = () => {
    const { entities, selectEntity, applyOperations } = useStore();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [createModalDate, setCreateModalDate] = useState<string | null>(null);
    const [createModalStartTime, setCreateModalStartTime] = useState<string | null>(null);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('agenda');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Initial scroll to 8 AM
    useEffect(() => {
        if ((viewMode === 'week' || viewMode === 'day') && scrollRef.current) {
            scrollRef.current.scrollTop = 8 * PIXELS_PER_HOUR;
        }
    }, [viewMode]);

    // Filter events AND tasks with deadlines
    const calendarItems = useMemo(() => entities.filter(e => {
        if (e.kind === EntityKind.EVENT && e.start_time) return true;
        if (e.kind === EntityKind.TASK && e.deadline && e.status !== EntityStatus.COMPLETED) return true;
        return false;
    }), [entities]);

    // Navigation helpers
    const handlePrev = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        } else if (viewMode === 'week') {
            setCurrentDate(new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000));
        } else {
            setCurrentDate(new Date(currentDate.getTime() - 24 * 60 * 60 * 1000));
        }
    };

    const handleNext = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        } else if (viewMode === 'week') {
            setCurrentDate(new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000));
        } else {
            setCurrentDate(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000));
        }
    };

    const handleToday = () => setCurrentDate(new Date());

    // Drag handlers
    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggedId(id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, targetDate: Date, targetHour?: number, targetMinute?: number) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        const entity = entities.find(ent => ent.id === id);

        if (entity) {
            const newDate = new Date(targetDate);
            if (targetHour !== undefined) {
                newDate.setHours(targetHour, targetMinute || 0, 0, 0);
            } else if (entity.kind === EntityKind.EVENT && entity.start_time) {
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
                } else {
                    // Default 1 hour if no end time exists 
                    updates.end_time = new Date(newDate.getTime() + 60 * 60 * 1000).toISOString();
                }
            } else {
                updates.deadline = newDate.toISOString();
            }

            applyOperations([{ type: 'update_entity', payload: { id: entity.id, fields: updates } }]);
        }
        setDraggedId(null);
    };

    // Date helpers
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const now = new Date();

    // Get items for a specific date (including recurring occurrences)
    const getItemsForDate = (date: Date): { entity: Entity; isRecurring: boolean }[] => {
        const dateStr = date.toDateString();
        const results: { entity: Entity; isRecurring: boolean }[] = [];

        calendarItems.forEach(e => {
            const originalDate = new Date(e.kind === EntityKind.EVENT ? e.start_time! : e.deadline!);

            // Check if this is the original date
            if (originalDate.toDateString() === dateStr) {
                results.push({ entity: e, isRecurring: false });
            }
            // Check if this date matches a recurring pattern
            else if (e.recurrence && matchesRecurrence(originalDate, date, e.recurrence)) {
                results.push({ entity: e, isRecurring: true });
            }
        });

        return results.sort((a, b) => {
            const aTime = a.entity.start_time || a.entity.deadline || '';
            const bTime = b.entity.start_time || b.entity.deadline || '';
            return aTime.localeCompare(bTime);
        });
    };

    const handleDayClick = (date: Date, hour?: number) => {
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        setCreateModalDate(adjustedDate.toISOString().split('T')[0]);
        if (hour !== undefined) {
            setCreateModalStartTime(`${hour.toString().padStart(2, '0')}:00`);
        } else {
            setCreateModalStartTime(null);
        }
    };

    const renderEventPill = (item: Entity, isRecurring: boolean = false, compact: boolean = false) => (
        <div
            key={`${item.id}-${isRecurring ? 'r' : 'o'}`}
            draggable={!isRecurring}
            onDragStart={!isRecurring ? (e) => handleDragStart(e, item.id) : undefined}
            onClick={(e) => { e.stopPropagation(); selectEntity(item.id); }}
            className={`text-[10px] px-1.5 py-0.5 rounded border-l-2 truncate cursor-pointer transition-colors flex items-center gap-1 ${item.kind === EntityKind.EVENT
                ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500 hover:bg-indigo-600/40'
                : 'bg-emerald-600/20 text-emerald-200 border-emerald-500 hover:bg-emerald-600/40'
                } ${draggedId === item.id ? 'opacity-50' : ''} ${isRecurring ? 'opacity-75' : ''} ${!isRecurring ? 'cursor-grab active:cursor-grabbing' : ''}`}
            title={`${item.title}${isRecurring ? ' (recurring)' : ''}`}
        >
            {item.kind === EntityKind.EVENT ? <Clock size={8} /> : <CheckSquare size={8} />}
            {isRecurring && <Repeat size={7} className="text-amber-400" />}
            {!compact && <span className="truncate">{item.title}</span>}
            {compact && <span className="truncate max-w-[50px]">{item.title}</span>}
        </div>
    );

    const renderAbsoluteEvent = (item: Entity, isRecurring: boolean, containerDate: Date) => {
        const startTime = item.start_time || item.deadline;
        if (!startTime) return null;

        const dateObj = new Date(startTime);
        // Correct time for recurring events if necessary (for now assuming standard recurrence keeps time)
        // Actually, we use the containerDate's date but the item's time
        const startHour = dateObj.getHours();
        const startMin = dateObj.getMinutes();
        const startY = (startHour * 60 + startMin); // relative pixels

        let durationMin = 60;
        if (item.end_time) {
            const endObj = new Date(item.end_time);
            durationMin = (endObj.getTime() - dateObj.getTime()) / 60000;
        } else if (item.duration_minutes) {
            durationMin = item.duration_minutes;
        }

        // Min height 30px for visibility
        const height = Math.max(30, durationMin);

        return (
            <div
                key={`${item.id}-${isRecurring ? 'r' : 'o'}`}
                draggable={!isRecurring}
                onDragStart={!isRecurring ? (e) => handleDragStart(e, item.id) : undefined}
                onClick={(e) => { e.stopPropagation(); selectEntity(item.id); }}
                style={{
                    top: `${startY}px`,
                    height: `${height}px`,
                    left: '2px',
                    right: '2px'
                }}
                className={`absolute rounded border-l-2 cursor-pointer transition-all flex flex-col p-1 overflow-hidden z-10 ${item.kind === EntityKind.EVENT
                    ? 'bg-indigo-600/30 text-indigo-100 border-indigo-500 hover:bg-indigo-600/50 hover:z-20 shadow-sm'
                    : 'bg-emerald-600/30 text-emerald-100 border-emerald-500 hover:bg-emerald-600/50 hover:z-20 shadow-sm'
                    } ${draggedId === item.id ? 'opacity-50' : ''}`}
                title={`${item.title}\n${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            >
                <div className="flex items-center gap-1 font-semibold text-[10px] leading-tight">
                    {item.kind === EntityKind.EVENT ? <Clock size={8} /> : <CheckSquare size={8} />}
                    <span className="truncate">{item.title}</span>
                </div>
                {height > 40 && (
                    <div className="text-[9px] opacity-80 truncate mt-0.5">
                        {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {item.end_time && ` - ${new Date(new Date(item.end_time).getTime() + (isRecurring ? 0 : 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                )}
            </div>
        );
    };

    // ============ MONTH VIEW ============
    const renderMonthView = () => {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDay = new Date(year, month, 1).getDay();
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const blanks = Array.from({ length: startDay }, (_, i) => i);
        const isCurrentMonth = now.getMonth() === month && now.getFullYear() === year;

        return (
            <div className="flex-1 flex flex-col">
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                </div>
                <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-1 border-t border-l border-slate-800 bg-slate-800">
                    {blanks.map((_, i) => <div key={`blank-${i}`} className="bg-slate-950 border-r border-b border-slate-800" />)}
                    {days.map(day => {
                        const date = new Date(year, month, day);
                        const isToday = isCurrentMonth && day === now.getDate();
                        const dayItems = getItemsForDate(date);

                        return (
                            <div
                                key={day}
                                onClick={() => handleDayClick(date)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, date)}
                                className={`bg-slate-950 border-r border-b border-slate-800 p-1.5 min-h-[80px] md:min-h-[100px] relative hover:bg-slate-900 transition-colors group flex flex-col cursor-pointer ${isToday ? 'bg-slate-900/80' : ''
                                    } ${draggedId ? 'hover:bg-indigo-500/10' : ''}`}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={`text-xs font-medium ${isToday ? 'text-indigo-400 bg-indigo-500/10 w-6 h-6 flex items-center justify-center rounded-full' : 'text-slate-500'}`}>
                                        {day}
                                    </span>
                                    <Plus size={12} className="text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="space-y-0.5 overflow-hidden flex-1 mt-1">
                                    {dayItems.slice(0, 3).map(({ entity, isRecurring }) => renderEventPill(entity, isRecurring, true))}
                                    {dayItems.length > 3 && <div className="text-[9px] text-slate-500">+{dayItems.length - 3} more</div>}
                                </div>
                            </div>
                        );
                    })}
                    {Array.from({ length: Math.max(0, 42 - (days.length + blanks.length)) }).map((_, i) => (
                        <div key={`end-blank-${i}`} className="bg-slate-950 border-r border-b border-slate-800 opacity-50" />
                    ))}
                </div>
            </div>
        );
    };

    // ============ WEEK VIEW (ABSOLUTE POS) ============
    const renderWeekView = () => {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const weekDays = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            return d;
        });
        const hours = Array.from({ length: 24 }, (_, i) => i);

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-8 gap-0 border-b border-slate-800 shrink-0 bg-slate-950 z-20">
                    <div className="p-2 text-xs text-slate-600 border-r border-slate-800"></div>
                    {weekDays.map(d => (
                        <div key={d.toISOString()} className={`p-2 text-center border-r border-slate-800 ${d.toDateString() === now.toDateString() ? 'bg-indigo-500/10' : ''}`}>
                            <div className="text-xs text-slate-500">{d.toLocaleDateString('en', { weekday: 'short' })}</div>
                            <div className={`text-lg font-semibold ${d.toDateString() === now.toDateString() ? 'text-indigo-400' : 'text-slate-300'}`}>
                                {d.getDate()}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Scrollable Grid */}
                <div className="flex-1 overflow-y-auto relative" ref={scrollRef}>
                    <div className="grid grid-cols-8 gap-0 relative" style={{ height: GRID_HEIGHT }}>
                        {/* Time Column */}
                        <div className="border-r border-slate-800 bg-slate-950 z-10 sticky left-0">
                            {hours.map(hour => (
                                <div key={hour} className="text-[10px] text-slate-600 border-b border-slate-800/50 text-right pr-2 relative" style={{ height: PIXELS_PER_HOUR }}>
                                    <span className="-top-2 relative">{hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}</span>
                                </div>
                            ))}
                        </div>

                        {/* Day Columns */}
                        {weekDays.map(d => {
                            const dayItems = getItemsForDate(d);
                            const isToday = d.toDateString() === now.toDateString();

                            return (
                                <div
                                    key={d.toISOString()}
                                    className={`border-r border-slate-800 relative ${isToday ? 'bg-indigo-500/5' : ''}`}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const y = e.clientY - rect.top + e.currentTarget.scrollTop;
                                        // Adjust for scroll? No, currentTarget is the simple div which is tall.
                                        // Actually e.clientY is viewport relative. element relative Y needed.
                                        // Simplified: Use simple math if possible, or rough estimate.
                                        // Ideally we want exact drop time. 
                                        // Let's rely on simple hover logic for now or improve later.
                                        // For now, defaulting to dropping on the day. Improved drop logic requires more DOM math.
                                        handleDrop(e, d);
                                    }}
                                    onClick={(e) => {
                                        // Calculate clicked hour
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const y = e.clientY - rect.top; // This might be wrong if scrolled?
                                        // The container is TALL, inside a scroll pane. 
                                        // Better to just pass date for now.
                                        // If we want exact hour click:
                                        // We need to use nativeEvent.offsetY if target is this container
                                        const offsetY = e.nativeEvent.offsetY;
                                        const hour = Math.floor(offsetY / PIXELS_PER_HOUR);
                                        handleDayClick(d, hour);
                                    }}
                                >
                                    {/* Hour Grid Lines */}
                                    {hours.map(h => (
                                        <div key={h} className="border-b border-slate-800/30 absolute w-full" style={{ top: h * PIXELS_PER_HOUR, height: PIXELS_PER_HOUR, pointerEvents: 'none' }} />
                                    ))}

                                    {/* Events */}
                                    {dayItems.map(({ entity, isRecurring }) => renderAbsoluteEvent(entity, isRecurring, d))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // ============ DAY VIEW (ABSOLUTE POS) ============
    const renderDayView = () => {
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const dayItems = getItemsForDate(currentDate);

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-800 text-center shrink-0">
                    <div className="text-2xl font-bold text-slate-100">{currentDate.toLocaleDateString('en', { weekday: 'long' })}</div>
                    <div className="text-sm text-slate-400">{currentDate.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                </div>

                <div className="flex-1 overflow-y-auto relative" ref={scrollRef}>
                    <div className="flex relative" style={{ height: GRID_HEIGHT }}>
                        {/* Time Column */}
                        <div className="w-20 border-r border-slate-800 bg-slate-950 shrink-0">
                            {hours.map(hour => (
                                <div key={hour} className="text-[10px] text-slate-600 border-b border-slate-800/50 text-right pr-2 relative" style={{ height: PIXELS_PER_HOUR }}>
                                    <span className="-top-2 relative">{hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}</span>
                                </div>
                            ))}
                        </div>

                        {/* Day Area */}
                        <div
                            className="flex-1 relative"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, currentDate)}
                            onClick={(e) => {
                                const offsetY = e.nativeEvent.offsetY;
                                const hour = Math.floor(offsetY / PIXELS_PER_HOUR);
                                handleDayClick(currentDate, hour);
                            }}
                        >
                            {/* Hour Grid Lines */}
                            {hours.map(h => (
                                <div key={h} className="border-b border-slate-800/30 absolute w-full" style={{ top: h * PIXELS_PER_HOUR, height: PIXELS_PER_HOUR, pointerEvents: 'none' }} />
                            ))}

                            {/* Events */}
                            {dayItems.map(({ entity, isRecurring }) => renderAbsoluteEvent(entity, isRecurring, currentDate))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ============ AGENDA VIEW ============
    const renderAgendaView = () => {
        const next30Days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() + i);
            return d;
        });

        const daysWithItems = next30Days.map(d => ({
            date: d,
            items: getItemsForDate(d)
        })).filter(d => d.items.length > 0);

        return (
            <div className="flex-1 overflow-y-auto">
                {daysWithItems.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                        <CalendarIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>No upcoming events or tasks in the next 30 days</p>
                    </div>
                ) : (
                    daysWithItems.map(({ date, items }) => (
                        <div key={date.toISOString()} className="border-b border-slate-800">
                            <div className="px-4 py-2 bg-slate-900/50 sticky top-0 z-10 backdrop-blur-sm border-y border-slate-800/50">
                                <span className={`font-semibold ${date.toDateString() === now.toDateString() ? 'text-indigo-400' : 'text-slate-300'}`}>
                                    {date.toDateString() === now.toDateString() ? 'Today' :
                                        date.toDateString() === new Date(now.getTime() + 86400000).toDateString() ? 'Tomorrow' :
                                            date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}
                                </span>
                            </div>
                            <div className="divide-y divide-slate-800/50">
                                {items.map(({ entity, isRecurring }) => (
                                    <div
                                        key={`${entity.id}-${isRecurring ? 'r' : 'o'}`}
                                        onClick={() => selectEntity(entity.id)}
                                        className="px-4 py-3 hover:bg-slate-900/50 cursor-pointer flex items-center gap-3 group"
                                    >
                                        <div className={`w-1 h-8 rounded ${entity.kind === EntityKind.EVENT ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-slate-200 truncate flex items-center gap-1">
                                                {entity.title}
                                                {isRecurring && <Repeat size={10} className="text-amber-400" />}
                                                <span className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto text-xs text-indigo-400">Edit</span>
                                            </div>
                                            {(entity.start_time || entity.deadline) && (
                                                <div className="text-xs text-slate-500 flex gap-2">
                                                    <span>{new Date(entity.start_time || entity.deadline!).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</span>
                                                    {entity.end_time && (
                                                        <>
                                                            <span>→</span>
                                                            <span>{new Date(entity.end_time).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</span>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded ${entity.kind === EntityKind.EVENT ? 'bg-indigo-500/20 text-indigo-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                            {entity.kind}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        );
    };

    const getHeaderTitle = () => {
        if (viewMode === 'month') return currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        if (viewMode === 'week') {
            const startOfWeek = new Date(currentDate);
            startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            return `${startOfWeek.toLocaleDateString('en', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
        if (viewMode === 'day') return currentDate.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        return 'Upcoming Loop';
    };

    const viewModes: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
        { id: 'agenda', label: 'Agenda', icon: <List size={14} /> },
        { id: 'week', label: 'Week', icon: <CalendarDays size={14} /> },
        { id: 'day', label: 'Day', icon: <LayoutGrid size={14} /> },
        { id: 'month', label: 'Month', icon: <Grid3X3 size={14} /> },
    ];

    return (
        <div className="flex-1 flex flex-col bg-slate-950 p-4 md:p-6 h-full overflow-hidden">
            <header className="mb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl md:text-2xl font-bold text-slate-100 min-w-[200px]">{getHeaderTitle()}</h1>
                    <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-1">
                        <button onClick={handlePrev} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronLeft size={18} /></button>
                        <button onClick={handleToday} className="px-3 text-xs font-medium text-slate-400 hover:text-white transition-colors">Today</button>
                        <button onClick={handleNext} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronRight size={18} /></button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-1">
                        {viewModes.map(vm => (
                            <button
                                key={vm.id}
                                onClick={() => setViewMode(vm.id)}
                                className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${viewMode === vm.id
                                    ? 'bg-indigo-500/20 text-indigo-300'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                {vm.icon}
                                <span className="hidden md:inline">{vm.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-3 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-indigo-500" /> Events</div>
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-500" /> Tasks</div>
                    </div>
                </div>
            </header>

            {viewMode === 'month' && renderMonthView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'day' && renderDayView()}
            {viewMode === 'agenda' && renderAgendaView()}

            {createModalDate && (
                <CreateEntityModal
                    onClose={() => setCreateModalDate(null)}
                    initialDate={createModalDate}
                    initialKind={EntityKind.EVENT}
                    initialTime={createModalStartTime || undefined}
                />
            )}
        </div>
    );
};

export default CalendarView;