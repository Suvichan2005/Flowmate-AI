import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, RecurrenceType } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckSquare, Clock, Plus, Grid3X3, List, CalendarDays, LayoutGrid, Repeat, RefreshCw, Cloud, Activity } from 'lucide-react';
import CreateEntityModal from './CreateEntityModal';
import { GoogleCalendarAdapter, GoogleAuthError } from '../services/googleSync';
import { refreshGoogleCalendarToken } from '../services/firebase';
import { v4 as uuidv4 } from 'uuid';

type ViewMode = 'month' | 'week' | 'day' | 'agenda';

const PIXELS_PER_HOUR = 60; // 1px per minute usually works well
const GRID_HEIGHT = 24 * PIXELS_PER_HOUR;

// Check if a target date matches a recurring pattern from original date
// Supports both simple recurrence (DAILY/WEEKLY/MONTHLY/YEARLY) and RRULE-style patterns
const matchesRecurrence = (originalDate: Date, targetDate: Date, recurrence: RecurrenceType, rrule?: string): boolean => {
    if (!recurrence && !rrule) return false;

    // Compare dates only (not timestamps)
    const origDateOnly = new Date(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate());
    const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    const origDay = originalDate.getDate();
    const origMonth = originalDate.getMonth();
    const origDayOfWeek = originalDate.getDay();

    // If we have RRULE metadata, parse it for complex patterns
    if (rrule) {
        // Parse BYDAY for patterns like "2SA" (2nd Saturday), "1MO" (1st Monday)
        const bydayMatch = rrule.match(/BYDAY=(-?\d)?(\w{2})/);
        if (bydayMatch) {
            const weekNum = parseInt(bydayMatch[1] || '0');
            const dayCode = bydayMatch[2];
            const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
            const targetDayOfWeek = dayMap[dayCode];
            const targetWeekOfMonth = Math.ceil(targetDate.getDate() / 7);

            if (targetDayOfWeek !== undefined && targetDate.getDay() === targetDayOfWeek) {
                if (weekNum !== 0) {
                    // Nth weekday of month (e.g., 2nd Saturday)
                    if (weekNum > 0 && targetWeekOfMonth === weekNum) {
                        return true;
                    }
                    // Negative means from end (-1 = last)
                    if (weekNum < 0) {
                        const lastDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
                        const weeksFromEnd = Math.ceil((lastDayOfMonth - targetDate.getDate() + 1) / 7);
                        if (weeksFromEnd === Math.abs(weekNum)) return true;
                    }
                } else {
                    // Every occurrence of this weekday
                    return true;
                }
            }
            return false;
        }

        // Parse INTERVAL for "every N weeks/months"
        const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
        if (intervalMatch && recurrence === 'WEEKLY') {
            const interval = parseInt(intervalMatch[1]);
            const weeksDiff = Math.floor((targetDateOnly.getTime() - origDateOnly.getTime()) / (7 * 24 * 60 * 60 * 1000));
            return weeksDiff >= 0 && weeksDiff % interval === 0 && targetDate.getDay() === origDayOfWeek;
        }
    }

    // Simple recurrence patterns
    switch (recurrence) {
        case 'DAILY':
            return targetDateOnly >= origDateOnly;
        case 'WEEKLY':
            return targetDateOnly >= origDateOnly && targetDate.getDay() === origDayOfWeek;
        case 'MONTHLY':
            return targetDate.getDate() === origDay;
        case 'YEARLY':
            return targetDate.getDate() === origDay && targetDate.getMonth() === origMonth;
        default:
            return false;
    }
};

const CalendarView: React.FC = () => {
    const { entities, selectEntity, applyOperations, addToast } = useStore();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [createModalDate, setCreateModalDate] = useState<string | null>(null);
    const [createModalStartTime, setCreateModalStartTime] = useState<string | null>(null);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('agenda');
    const [showEvents, setShowEvents] = useState(true);
    const [showTasks, setShowTasks] = useState(true);
    const [showLogs, setShowLogs] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Initial scroll to 8 AM
    useEffect(() => {
        if ((viewMode === 'week' || viewMode === 'day') && scrollRef.current) {
            scrollRef.current.scrollTop = 8 * PIXELS_PER_HOUR;
        }
    }, [viewMode]);

    // Filter events AND tasks with deadlines based on toggle state
    // Also exclude hidden entities
    // Also extract metadata.activity_log entries as pseudo-activities
    // Also expand rrule-based recurring tasks
    const calendarItems = useMemo(() => {
        const items: Entity[] = [];

        entities.forEach(e => {
            // Exclude hidden entities
            if (e.metadata?.hidden) return;

            // Add standard calendar items
            if (e.kind === EntityKind.EVENT && e.start_time && showEvents) {
                items.push(e);
            } else if (e.kind === EntityKind.TASK && e.status !== EntityStatus.COMPLETED && showTasks) {
                // Show tasks with deadline, start_time, or rrule
                if (e.deadline || e.start_time || e.metadata?.rrule) {
                    items.push(e);

                    // Expand rrule-based recurring tasks for next 30 days
                    if (e.metadata?.rrule && e.start_time) {
                        const rrule = e.metadata.rrule as string;
                        const baseDate = new Date(e.start_time);
                        const now = new Date();
                        const endRange = new Date(now);
                        endRange.setDate(endRange.getDate() + 30);

                        // Parse simple rrules (FREQ=DAILY;INTERVAL=N)
                        const freqMatch = rrule.match(/FREQ=(\w+)/);
                        const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
                        const freq = freqMatch?.[1] || 'DAILY';
                        const interval = parseInt(intervalMatch?.[1] || '1', 10);

                        let currentDate = new Date(baseDate);
                        let occurrence = 0;

                        while (currentDate <= endRange && occurrence < 10) {
                            // Skip the first occurrence (already added above)
                            if (occurrence > 0 && currentDate > now) {
                                items.push({
                                    ...e,
                                    id: `${e.id}-rrule-${occurrence}`,
                                    start_time: currentDate.toISOString(),
                                    metadata: { ...e.metadata, is_rrule_instance: true, parent_id: e.id }
                                });
                            }

                            // Calculate next occurrence
                            if (freq === 'DAILY') {
                                currentDate.setDate(currentDate.getDate() + interval);
                            } else if (freq === 'WEEKLY') {
                                currentDate.setDate(currentDate.getDate() + (7 * interval));
                            } else if (freq === 'MONTHLY') {
                                currentDate.setMonth(currentDate.getMonth() + interval);
                            }
                            occurrence++;
                        }
                    }
                }
            } else if (e.kind === EntityKind.ACTIVITY && (e.start_time || e.created_at) && showLogs) {
                items.push(e);
            }

            // Extract metadata.activity_log entries as pseudo-ACTIVITY entities
            if (showLogs && e.metadata?.activity_log && Array.isArray(e.metadata.activity_log)) {
                e.metadata.activity_log.forEach((log: any, idx: number) => {
                    if (log.timestamp) {
                        items.push({
                            id: `${e.id}-log-${idx}`,
                            kind: EntityKind.ACTIVITY,
                            title: log.title || log.note || `Log: ${e.title}`,
                            description: log.note || log.description || null,
                            status: EntityStatus.COMPLETED,
                            priority: 1,
                            start_time: log.timestamp,
                            end_time: null,
                            deadline: null,
                            duration_minutes: log.duration_minutes || null,
                            recurrence: null,
                            metadata: { parent_title: e.title, is_nested_log: true },
                            created_at: log.timestamp,
                            updated_at: log.timestamp,
                            canonical_tags: [],
                            parent_id: e.id
                        });
                    }
                });
            }
        });

        return items;
    }, [entities, showEvents, showTasks, showLogs]);

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

    // Google Calendar Sync (2-WAY: Import from GCal + Export to GCal)
    const handleGoogleSync = async () => {
        setIsSyncing(true);
        const settings = useStore.getState().settings;
        let importCount = 0;
        let exportCount = 0;

        // Check if we have a valid token, if not try to refresh
        if (!GoogleCalendarAdapter.isConnected()) {
            addToast('Refreshing Google Calendar access...', 'info');
            const newToken = await refreshGoogleCalendarToken();
            if (!newToken) {
                addToast('Please sign in with Google and grant Calendar access', 'error');
                setIsSyncing(false);
                return;
            }
        }

        try {
            // 1. IMPORT: Fetch events from Google Calendar → create in Flowmate
            console.log('[Sync] Starting import from Google Calendar...');
            const newEvents = await GoogleCalendarAdapter.importFromGoogleCalendar(entities);

            if (newEvents.length > 0) {
                const ops = newEvents.map(e => ({
                    type: 'create_entity' as const,
                    payload: {
                        id: uuidv4(),
                        ...e,
                        status: EntityStatus.ACTIVE,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                }));
                applyOperations(ops);
                importCount = newEvents.length;
                console.log(`[Sync] Imported ${importCount} events from GCal`);
            }

            // 2. EXPORT: Push Flowmate events (without google_calendar_id) → Google Calendar
            console.log('[Sync] Starting export to Google Calendar...');
            const eventsToExport = entities.filter(e =>
                e.kind === EntityKind.EVENT &&
                e.start_time &&
                !e.metadata?.google_calendar_id &&
                e.status !== EntityStatus.ARCHIVED
            );

            for (const event of eventsToExport) {
                const result = await GoogleCalendarAdapter.createEvent(event, settings);
                if (result.success && result.externalId) {
                    // Update entity with google_calendar_id (use fields wrapper!)
                    applyOperations([{
                        type: 'update_entity',
                        payload: {
                            id: event.id,
                            fields: {
                                metadata: {
                                    ...event.metadata,
                                    google_calendar_id: result.externalId
                                }
                            }
                        }
                    }]);
                    exportCount++;
                    console.log(`[Sync] Exported "${event.title}" to GCal`);
                } else {
                    console.error(`[Sync] Failed to export "${event.title}":`, result.error);
                }
            }

            // Show results
            if (importCount === 0 && exportCount === 0) {
                addToast('Calendar is fully synced!', 'success');
            } else {
                const messages = [];
                if (importCount > 0) messages.push(`Imported ${importCount}`);
                if (exportCount > 0) messages.push(`Exported ${exportCount}`);
                addToast(`${messages.join(', ')} events`, 'success');
            }
        } catch (error: any) {
            console.error('[CalendarView] Sync error:', error);
            if (error instanceof GoogleAuthError) {
                // Auth error - prompt user to re-authenticate
                addToast('Session expired. Click sync again to re-authenticate with Google.', 'info');
            } else if (error.message?.includes('401') || error.message?.includes('unauthorized') || error.message?.includes('Unauthorized')) {
                addToast('Authentication failed. Please sign in with Google again.', 'error');
            } else {
                addToast(`Sync failed: ${error.message || 'Unknown error'}`, 'error');
            }
        } finally {
            setIsSyncing(false);
        }
    };

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

    // Get items for a specific date (including recurring occurrences AND multi-day events)
    const getItemsForDate = (date: Date): { entity: Entity; isRecurring: boolean; isSpanning?: boolean }[] => {
        const dateStr = date.toDateString();
        const targetDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const results: { entity: Entity; isRecurring: boolean; isSpanning?: boolean }[] = [];

        calendarItems.forEach(e => {

            // Get date for this item
            let itemDate: Date | null = null;
            if (e.kind === EntityKind.EVENT && e.start_time) {
                itemDate = new Date(e.start_time);
            } else if (e.kind === EntityKind.TASK) {
                // Tasks can use start_time (for rrule tasks) or deadline
                if (e.start_time) {
                    itemDate = new Date(e.start_time);
                } else if (e.deadline) {
                    itemDate = new Date(e.deadline);
                }
            } else if (e.kind === EntityKind.ACTIVITY) {
                // Activities use start_time or fall back to created_at
                itemDate = new Date(e.start_time || e.created_at);
            }

            if (!itemDate) return;

            const originalDateStr = itemDate.toDateString();

            // Check if this is the original start date
            if (originalDateStr === dateStr) {
                results.push({ entity: e, isRecurring: false });
            }
            // Check for multi-day events: date is between start and end (exclusive of start, inclusive of end)
            // Only check if event actually spans multiple days
            else if (e.kind === EntityKind.EVENT && e.start_time && e.end_time) {
                const startDate = new Date(e.start_time);
                const endDate = new Date(e.end_time);

                // Convert to date-only for comparison (ignore time)
                const eventStartDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                const eventEndDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

                // Only process as multi-day if it actually spans multiple days
                const isMultiDay = eventEndDateOnly > eventStartDateOnly;

                // Check if target date is after start date and on or before end date
                if (isMultiDay && targetDateOnly > eventStartDateOnly && targetDateOnly <= eventEndDateOnly) {
                    results.push({ entity: e, isRecurring: false, isSpanning: true });
                }
                // If not a multi-day match, check for recurrence
                else if (e.metadata?.rrule) {
                    if (matchesRecurrence(itemDate, date, e.recurrence, e.metadata.rrule)) {
                        results.push({ entity: e, isRecurring: true });
                    }
                }
                else if (e.recurrence && e.recurrence !== 'None' && matchesRecurrence(itemDate, date, e.recurrence)) {
                    results.push({ entity: e, isRecurring: true });
                }
            }
            // Check if this date matches a recurring pattern (rrule takes priority)
            // Check rrule first (handles complex patterns like "every 2nd Saturday")
            else if (e.metadata?.rrule) {
                console.log('[RRULE Check]', { title: e.title, itemDate: itemDate.toDateString(), targetDate: date.toDateString() });
                if (matchesRecurrence(itemDate, date, e.recurrence, e.metadata.rrule)) {
                    results.push({ entity: e, isRecurring: true });
                }
            }
            // Then check simple recurrence (DAILY, WEEKLY, etc.) - skip if recurrence is null/undefined/'None'
            else if (e.recurrence && e.recurrence !== 'None' && matchesRecurrence(itemDate, date, e.recurrence)) {
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

    const renderEventPill = (item: Entity, isRecurring: boolean = false, compact: boolean = false) => {
        const customColor = item.metadata?.color_hex;
        const isEvent = item.kind === EntityKind.EVENT;

        // Use custom color if available, otherwise default colors
        const colorStyle = customColor ? {
            backgroundColor: `${customColor}20`,
            borderColor: customColor,
            color: customColor
        } : undefined;

        return (
            <div
                key={`${item.id}-${isRecurring ? 'r' : 'o'}`}
                draggable={!isRecurring}
                onDragStart={!isRecurring ? (e) => handleDragStart(e, item.id) : undefined}
                onClick={(e) => { e.stopPropagation(); selectEntity(item.id); }}
                className={`text-[10px] px-1.5 py-0.5 rounded border-l-2 truncate cursor-pointer transition-colors flex items-center gap-1 ${!customColor ? (isEvent
                    ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500 hover:bg-indigo-600/40'
                    : item.kind === EntityKind.ACTIVITY
                        ? 'bg-purple-600/20 text-purple-200 border-purple-500 hover:bg-purple-600/40'
                        : 'bg-emerald-600/20 text-emerald-200 border-emerald-500 hover:bg-emerald-600/40')
                    : 'hover:opacity-80'
                    } ${draggedId === item.id ? 'opacity-50' : ''} ${isRecurring ? 'opacity-75' : ''} ${!isRecurring ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={colorStyle}
                title={`${item.title}${isRecurring ? ' (recurring)' : ''}`}
            >
                {isEvent ? <Clock size={8} /> : item.kind === EntityKind.ACTIVITY ? <Activity size={8} /> : <CheckSquare size={8} />}
                {isRecurring && <Repeat size={7} className="text-amber-400" />}
                {!compact && <span className="truncate">{item.title}</span>}
                {compact && <span className="truncate max-w-[50px]">{item.title}</span>}
            </div>
        );
    };

    const renderAbsoluteEvent = (item: Entity, isRecurring: boolean, containerDate: Date, isSpanning: boolean = false) => {
        const startTime = item.start_time || item.deadline;
        if (!startTime) return null;

        const eventStartDate = new Date(startTime);
        const eventEndDate = item.end_time ? new Date(item.end_time) : null;

        // Container day bounds
        const dayStart = new Date(containerDate.getFullYear(), containerDate.getMonth(), containerDate.getDate(), 0, 0, 0);
        const dayEnd = new Date(containerDate.getFullYear(), containerDate.getMonth(), containerDate.getDate(), 23, 59, 59);

        // Determine if this is a multi-day event
        const isMultiDay = eventEndDate &&
            eventStartDate.toDateString() !== eventEndDate.toDateString();

        let displayStartTime: Date;
        let displayEndTime: Date;

        if (isMultiDay || isSpanning) {
            // For multi-day or spanning events, clamp to container day
            const isStartDay = eventStartDate.toDateString() === containerDate.toDateString();
            const isEndDay = eventEndDate && eventEndDate.toDateString() === containerDate.toDateString();

            if (isStartDay) {
                // Start day: original start time → end of day
                displayStartTime = eventStartDate;
                displayEndTime = dayEnd;
            } else if (isEndDay) {
                // End day: start of day → original end time
                displayStartTime = dayStart;
                displayEndTime = eventEndDate!;
            } else {
                // Middle spanning day: all day
                displayStartTime = dayStart;
                displayEndTime = dayEnd;
            }
        } else {
            // Single-day event: use original times
            displayStartTime = eventStartDate;
            displayEndTime = eventEndDate || new Date(eventStartDate.getTime() + (item.duration_minutes || 60) * 60000);
        }

        const startHour = displayStartTime.getHours();
        const startMin = displayStartTime.getMinutes();
        const startY = (startHour * 60 + startMin); // pixels from top

        const durationMin = (displayEndTime.getTime() - displayStartTime.getTime()) / 60000;

        // Min height 30px for visibility, max 24 hours (1440 min)
        const height = Math.min(1440, Math.max(30, durationMin));

        // Custom color support
        const customColor = item.metadata?.color_hex;
        const colorStyle = customColor ? {
            backgroundColor: `${customColor}30`,
            borderColor: customColor,
        } : undefined;

        return (
            <div
                key={`${item.id}-${isRecurring ? 'r' : 'o'}-${containerDate.toDateString()}`}
                draggable={!isRecurring && !isSpanning}
                onDragStart={!isRecurring && !isSpanning ? (e) => handleDragStart(e, item.id) : undefined}
                onClick={(e) => { e.stopPropagation(); selectEntity(item.id); }}
                style={{
                    top: `${startY}px`,
                    height: `${height}px`,
                    left: '2px',
                    right: '2px',
                    ...colorStyle
                }}
                className={`absolute rounded border-l-2 cursor-pointer transition-all flex flex-col p-1 overflow-hidden z-10 ${!customColor ? (item.kind === EntityKind.EVENT
                    ? 'bg-indigo-600/30 text-indigo-100 border-indigo-500 hover:bg-indigo-600/50 hover:z-20 shadow-sm'
                    : item.kind === EntityKind.ACTIVITY
                        ? 'bg-purple-600/30 text-purple-100 border-purple-500 hover:bg-purple-600/50 hover:z-20 shadow-sm'
                        : 'bg-emerald-600/30 text-emerald-100 border-emerald-500 hover:bg-emerald-600/50 hover:z-20 shadow-sm')
                    : 'text-white hover:opacity-80 hover:z-20 shadow-sm'
                    } ${draggedId === item.id ? 'opacity-50' : ''} ${isSpanning ? 'opacity-75 border-dashed' : ''}`}
                title={`${item.title}${isSpanning ? ' (continues)' : ''}\n${displayStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${displayEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            >
                <div className="flex items-center gap-1 font-semibold text-[10px] leading-tight">
                    {item.kind === EntityKind.EVENT ? <Clock size={8} /> : item.kind === EntityKind.ACTIVITY ? <Activity size={8} /> : <CheckSquare size={8} />}
                    <span className="truncate">{item.title}{isSpanning ? ' ⋯' : ''}</span>
                </div>
                {height > 40 && (
                    <div className="text-[9px] opacity-80 truncate mt-0.5">
                        {displayStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {` - ${displayEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
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
            <div className="flex-1 flex flex-col min-h-0 overflow-auto">
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
                                onClick={() => {
                                    // Click to open day view for this date
                                    setCurrentDate(date);
                                    setViewMode('day');
                                }}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, date)}
                                className={`bg-slate-950 border-r border-b border-slate-800 p-1.5 min-h-[80px] md:min-h-[100px] relative hover:bg-slate-900 transition-colors group flex flex-col cursor-pointer ${isToday ? 'bg-slate-900/80' : ''
                                    } ${draggedId ? 'hover:bg-indigo-500/10' : ''}`}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={`text-xs font-medium ${isToday ? 'text-indigo-400 bg-indigo-500/10 w-6 h-6 flex items-center justify-center rounded-full' : 'text-slate-500'}`}>
                                        {day}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Don't trigger day view
                                            handleDayClick(date);
                                        }}
                                        className="text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-slate-700 rounded"
                                        title="Create event"
                                    >
                                        <Plus size={12} />
                                    </button>
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
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 relative">
                {/* Unified Scroll Container for Header + Body */}
                <div className="flex-1 overflow-auto relative" ref={scrollRef}>
                    <div className="min-w-[800px] flex flex-col relative">

                        {/* Header Row (Sticky Top) */}
                        <div className="grid grid-cols-8 gap-0 sticky top-0 z-30 bg-slate-950 border-b border-slate-800 shadow-sm shrink-0">
                            {/* Top Left Corner (Sticky Left + Top) */}
                            <div className="p-2 border-r border-slate-800 bg-slate-950 sticky left-0 z-40"></div>

                            {/* Day Headers */}
                            {weekDays.map(d => (
                                <div
                                    key={d.toISOString()}
                                    onClick={() => {
                                        setCurrentDate(new Date(d));
                                        setViewMode('day');
                                    }}
                                    className={`p-2 text-center border-r border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors ${d.toDateString() === now.toDateString() ? 'bg-indigo-500/10' : ''}`}
                                >
                                    <div className="text-xs text-slate-500">{d.toLocaleDateString('en', { weekday: 'short' })}</div>
                                    <div className={`text-lg font-semibold ${d.toDateString() === now.toDateString() ? 'text-indigo-400' : 'text-slate-300'}`}>
                                        {d.getDate()}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Grid Body */}
                        <div className="grid grid-cols-8 gap-0 relative" style={{ height: GRID_HEIGHT }}>
                            {/* Time Column (Sticky Left) */}
                            <div className="border-r border-slate-800 bg-slate-950 z-20 sticky left-0 h-full">
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
                                        onDrop={(e) => handleDrop(e, d)}
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const y = e.clientY - rect.top; // Relative to viewport if fixed? No.
                                            // The click is relative to the element.
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
                                        {dayItems.map(({ entity, isRecurring, isSpanning }) => renderAbsoluteEvent(entity, isRecurring, d, isSpanning))}
                                    </div>
                                );
                            })}
                        </div>
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
                            {dayItems.map(({ entity, isRecurring, isSpanning }) => renderAbsoluteEvent(entity, isRecurring, currentDate, isSpanning))}
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
        <div className="flex-1 flex flex-col bg-slate-950 p-4 md:p-6 h-full min-h-0">
            {/* Clean Google Calendar-style Header */}
            <header className="mb-4 shrink-0 pl-4 md:pl-14">
                {/* Row 1: Title + Nav */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg md:text-xl font-bold text-slate-100">
                            {viewMode === 'agenda' ? 'Schedule' : getHeaderTitle()}
                        </h1>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={handlePrev} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                            <ChevronLeft size={18} />
                        </button>
                        <button onClick={handleToday} className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors">
                            Today
                        </button>
                        <button onClick={handleNext} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>

                {/* Row 2: View Tabs + Filters */}
                <div className="flex items-center justify-between gap-2">
                    {/* View Mode Pills */}
                    <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-0.5">
                        {viewModes.map(vm => (
                            <button
                                key={vm.id}
                                onClick={() => setViewMode(vm.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-all ${viewMode === vm.id
                                    ? 'bg-indigo-500/20 text-indigo-300 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                {vm.icon}
                                <span className="hidden sm:inline">{vm.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Quick Filters + Sync */}
                    <div className="flex items-center gap-1">
                        {/* Color-coded filter dots - always visible */}
                        <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-1 gap-0.5">
                            <button
                                onClick={() => setShowEvents(!showEvents)}
                                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${showEvents ? 'bg-indigo-500/30' : 'opacity-40'}`}
                                title="Events"
                            >
                                <div className={`w-2.5 h-2.5 rounded-full ${showEvents ? 'bg-indigo-500' : 'bg-slate-600'}`} />
                            </button>
                            <button
                                onClick={() => setShowTasks(!showTasks)}
                                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${showTasks ? 'bg-emerald-500/30' : 'opacity-40'}`}
                                title="Tasks"
                            >
                                <div className={`w-2.5 h-2.5 rounded-full ${showTasks ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                            </button>
                            <button
                                onClick={() => setShowLogs(!showLogs)}
                                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${showLogs ? 'bg-purple-500/30' : 'opacity-40'}`}
                                title="Activity Logs"
                            >
                                <div className={`w-2.5 h-2.5 rounded-full ${showLogs ? 'bg-purple-500' : 'bg-slate-600'}`} />
                            </button>
                        </div>

                        {/* Sync button */}
                        <button
                            onClick={handleGoogleSync}
                            disabled={isSyncing}
                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                            title="Sync with Google Calendar"
                        >
                            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <Cloud size={16} />}
                        </button>
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