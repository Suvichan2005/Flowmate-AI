import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType, Entity } from '../types';
import { Clock, CheckCircle2, Target, Calendar, TrendingUp, Sparkles, RefreshCw, ArrowRight, Zap, Briefcase, AlertTriangle, Link, Layers, X, Bot, CalendarClock, ListTodo, Flame, Trophy, Wand2 } from 'lucide-react';
import ActivityHeatmap from './ActivityHeatmap';
import MomentumHeatmap from './MomentumHeatmap';
import MarkdownText from './MarkdownText';
import { calculateProgress } from '../utils/progressCalculation';
import { getStreakInfo, getActivitySummary } from '../utils/streakCalculation';
import DailyProductivityBar from './DailyProductivityBar';
import QuickStreaks from './QuickStreaks';
import { SkeletonDashboard } from './Skeleton';

interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: number;
    subValue?: string;
    colorClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subValue, colorClass }) => (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-start justify-between relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity ${colorClass}`}>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { size: 64 }) : icon}
        </div>
        <div className="relative z-10">
            <div className="text-3xl font-bold text-slate-100 mb-1">{value}</div>
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
            {subValue && <div className="text-[10px] text-slate-600 mt-2 font-mono">{subValue}</div>}
        </div>
        <div className={`p-3 rounded-lg bg-slate-950 border border-slate-800 ${colorClass}`}>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { size: 20 }) : icon}
        </div>
    </div>
);

// Insight Modal Component
interface InsightModalProps {
    title: string;
    items: Entity[];
    onClose: () => void;
    onSelect: (id: string) => void;
    onAskAI?: () => void;
    renderItem?: (item: Entity) => React.ReactNode;
}

const InsightModal: React.FC<InsightModalProps> = ({ title, items, onClose, onSelect, onAskAI, renderItem }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[70vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
                <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
                    <X size={18} />
                </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[50vh] space-y-2">
                {items.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">No items found</p>
                ) : (
                    items.map(item => (
                        renderItem ? renderItem(item) : (
                            <div
                                key={item.id}
                                onClick={() => onSelect(item.id)}
                                className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-200 truncate">{item.title}</div>
                                    <div className="text-xs text-slate-500">{item.kind} • {item.status}</div>
                                </div>
                                {item.deadline && (
                                    <div className="text-xs text-slate-400 shrink-0">
                                        {new Date(item.deadline).toLocaleDateString()}
                                    </div>
                                )}
                            </div>
                        )
                    ))
                )}
            </div>
            {onAskAI && items.length > 0 && (
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={onAskAI}
                        className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                        <Bot size={16} />
                        Ask AI to Analyze & Connect These
                    </button>
                </div>
            )}
        </div>
    </div>
);

interface DashboardProps {
    onOpenGraphFixer?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onOpenGraphFixer }) => {
    const { entities, relationships, selectEntity, dailyBriefing, refreshDailyBriefing, setView, addMessage, addToast, setPendingOrchestration, applyOperations, settings, isHydrated } = useStore();
    const [briefingLoading, setBriefingLoading] = useState(false);
    const [showOrphansModal, setShowOrphansModal] = useState(false);
    const [showDueModal, setShowDueModal] = useState(false);
    const [showProjectsModal, setShowProjectsModal] = useState(false);
    const [tapCounts, setTapCounts] = useState<Record<string, number>>({});
    const [showConfirmPopup, setShowConfirmPopup] = useState<string | null>(null);

    // Show skeleton while data is loading
    if (!isHydrated) {
        return <SkeletonDashboard />;
    }

    // Events from past 24h that need confirmation (no confirmation_status set)
    const unconfirmedPastEvents = useMemo(() => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        return entities.filter(e => {
            if (e.kind !== EntityKind.EVENT) return false;
            if (!e.end_time && !e.start_time) return false;
            const eventEnd = new Date(e.end_time || e.start_time!);
            // Past event (ended before now), within 24h, not yet confirmed
            return eventEnd < now && eventEnd > yesterday && !e.metadata?.confirmation_status;
        }).sort((a, b) => new Date(b.start_time!).getTime() - new Date(a.start_time!).getTime());
    }, [entities]);

    // Timeout refs for delayed confirmation
    const confirmTimeouts = React.useRef<Record<string, NodeJS.Timeout>>({});

    // Handle tap to cycle: 1=green preview, 2=red preview, 3=popup
    // Apply confirmation only after 1.5s pause
    const handleEventTap = (eventId: string) => {
        // Clear any existing timeout for this event
        if (confirmTimeouts.current[eventId]) {
            clearTimeout(confirmTimeouts.current[eventId]);
        }

        const currentTaps = (tapCounts[eventId] || 0) + 1;

        if (currentTaps >= 3) {
            // Open popup for more options
            setShowConfirmPopup(eventId);
            setTapCounts(prev => ({ ...prev, [eventId]: 0 }));
            return;
        }

        // Update visual state (1=green, 2=red)
        setTapCounts(prev => ({ ...prev, [eventId]: currentTaps }));

        // Set timeout to apply after 1.5s of no taps
        confirmTimeouts.current[eventId] = setTimeout(() => {
            const finalTapCount = currentTaps;

            if (finalTapCount === 1) {
                applyOperations([{
                    type: 'update_entity',
                    payload: { id: eventId, fields: { metadata: { confirmation_status: 'confirmed' } } }
                }]);
                addToast('✅ Marked as done!', 'success');
            } else if (finalTapCount === 2) {
                applyOperations([{
                    type: 'update_entity',
                    payload: { id: eventId, fields: { metadata: { confirmation_status: 'skipped' } } }
                }]);
                addToast('❌ Marked as skipped', 'info');
            }

            // Reset state
            setTapCounts(prev => ({ ...prev, [eventId]: 0 }));
            delete confirmTimeouts.current[eventId];
        }, 1500);
    };

    const handleConfirmOption = (eventId: string, status: 'postponed' | 'cancelled' | 'rescheduled') => {
        applyOperations([{
            type: 'update_entity',
            payload: { id: eventId, fields: { metadata: { confirmation_status: status } } }
        }]);
        addToast(`Marked as ${status}`, 'info');
        setShowConfirmPopup(null);
    };

    const activeGoals = entities.filter(e => e.kind === EntityKind.GOAL && e.status === EntityStatus.ACTIVE);
    const pendingTasks = entities.filter(e => e.kind === EntityKind.TASK && e.status !== EntityStatus.COMPLETED);
    const activeProjects = entities.filter(e => e.kind === EntityKind.PROJECT && e.status === EntityStatus.ACTIVE);
    const upcomingEvents = entities
        .filter(e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time) > new Date())
        .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
        .slice(0, 3);

    // Combine legacy ACTIVITY entities with nested metadata.activity_log entries
    const recentActivities = useMemo(() => {
        type ActivityItem = {
            id: string;
            title: string;
            created_at: string;
            duration_minutes?: number | null;
            parentId?: string;
            parentTitle?: string;
            isNestedLog?: boolean;
        };

        const activities: ActivityItem[] = [];

        // 1. Add legacy ACTIVITY entities
        entities
            .filter(e => e.kind === EntityKind.ACTIVITY)
            .forEach(e => {
                activities.push({
                    id: e.id,
                    title: e.title,
                    created_at: e.created_at,
                    duration_minutes: e.duration_minutes
                });
            });

        // 2. Extract metadata.activity_log entries from all entities
        entities.forEach(e => {
            if (e.metadata?.activity_log && Array.isArray(e.metadata.activity_log)) {
                e.metadata.activity_log.forEach((log: any, idx: number) => {
                    if (log.timestamp) {
                        activities.push({
                            id: `${e.id}-log-${idx}`,
                            title: log.title || log.note || `Activity on ${e.title}`,
                            created_at: log.timestamp,
                            duration_minutes: log.duration_minutes,
                            parentId: e.id,
                            parentTitle: e.title,
                            isNestedLog: true
                        });
                    }
                });
            }
        });

        // Sort by created_at descending and take top 5
        return activities
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5);
    }, [entities]);

    // Memoized Calculations
    const streakInfo = useMemo(() => getStreakInfo(entities), [entities]);
    const activitySummary = useMemo(() => getActivitySummary(entities, settings.productivity_calc_method), [entities, settings.productivity_calc_method]);

    const handleGenerateBriefing = async () => {
        setBriefingLoading(true);
        await refreshDailyBriefing();
        setBriefingLoading(false);
    };

    const today = new Date().toISOString().split('T')[0];
    const isBriefingStale = !dailyBriefing || dailyBriefing.generated_for_date !== today;

    // Format minutes to hours/minutes string
    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    // -- GRAPH INSIGHTS --
    const insights = useMemo(() => {
        const relatedIds = new Set<string>();
        relationships.forEach(r => { relatedIds.add(r.from); relatedIds.add(r.to); });

        // 1. Orphans: No connections, excluding Tags, Notes, Activities, and hidden entities
        const orphans = entities.filter(e =>
            !relatedIds.has(e.id) &&
            e.kind !== EntityKind.TAG &&
            e.kind !== EntityKind.NOTE &&
            e.kind !== EntityKind.ACTIVITY &&
            !e.metadata?.hidden  // Exclude hidden from AI
        );

        // 2. Due Soon: Active tasks/goals with upcoming deadlines (sorted chronologically)
        const now = new Date();
        const dueSoon = entities
            .filter(e =>
                e.status === EntityStatus.ACTIVE &&
                e.deadline &&
                (e.kind === EntityKind.TASK || e.kind === EntityKind.GOAL || e.kind === EntityKind.PROJECT)
            )
            .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

        // 3. Needs Next Action: Active projects with NO active tasks linked
        const needsNextAction = entities.filter(e => {
            if (e.kind !== EntityKind.PROJECT || e.status !== EntityStatus.ACTIVE) return false;

            const childrenIds = relationships
                .filter(r => r.to === e.id && r.type === RelationshipType.PART_OF)
                .map(r => r.from);

            const hasActiveTask = entities.some(child =>
                childrenIds.includes(child.id) &&
                child.kind === EntityKind.TASK &&
                child.status === EntityStatus.ACTIVE
            );
            return !hasActiveTask;
        });

        return { orphans, dueSoon, needsNextAction };
    }, [entities, relationships]);

    // Ask AI to analyze orphans - triggers LLM orchestration
    const handleAskAIOrphans = () => {
        const orphanInfo = insights.orphans.map(o => `${o.title} (ID: ${o.id.slice(-6)})`).join('\n- ');
        const message = `Please analyze these unconnected items and suggest how to link them:\n- ${orphanInfo}`;
        // Trigger LLM orchestration via App.tsx
        setPendingOrchestration(message);
        setShowOrphansModal(false);
        addToast('Asking AI to analyze...', 'info');
    };

    return (
        <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4 pl-4 md:pl-14">
                <div>
                    <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Dashboard</h1>
                    <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        System Operational
                    </p>
                </div>
            </header>

            {/* AI Daily Briefing */}
            <div className="mb-8 relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity"></div>
                <div className="relative bg-slate-900 border border-slate-800 rounded-xl p-6 overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Sparkles size={120} />
                    </div>

                    <div className="flex justify-between items-start mb-4 relative z-10">
                        <h2 className="text-lg font-semibold text-indigo-100 flex items-center gap-2">
                            <Sparkles size={18} className="text-indigo-400" />
                            {(() => {
                                const hour = new Date().getHours();
                                if (hour >= 5 && hour < 12) return 'Good morning!';
                                if (hour >= 12 && hour < 17) return 'Good afternoon!';
                                if (hour >= 17 && hour < 21) return 'Good evening!';
                                return 'Working late?';
                            })()}
                        </h2>
                        <button
                            onClick={handleGenerateBriefing}
                            disabled={briefingLoading}
                            className="flex items-center gap-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shadow-lg shadow-indigo-900/50"
                        >
                            {briefingLoading ? <RefreshCw className="animate-spin w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                            {dailyBriefing ? "Regenerate" : "Generate"}
                        </button>
                    </div>

                    <div className="relative z-10 min-h-[80px]">
                        {briefingLoading ? (
                            <div className="space-y-3 animate-pulse max-w-lg">
                                <div className="h-4 bg-indigo-500/10 rounded w-3/4"></div>
                                <div className="h-4 bg-indigo-500/10 rounded w-1/2"></div>
                                <div className="h-4 bg-indigo-500/10 rounded w-5/6"></div>
                            </div>
                        ) : dailyBriefing ? (
                            <div className="text-slate-300 text-sm">
                                <MarkdownText content={dailyBriefing.content} />
                                <p className="text-[10px] text-slate-500 mt-4 font-mono">
                                    Generated {new Date(dailyBriefing.timestamp).toLocaleTimeString()}
                                    {isBriefingStale && <span className="ml-2 text-amber-500">(outdated)</span>}
                                </p>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4 text-slate-500">
                                <div className="p-3 rounded-full bg-slate-800">
                                    <Zap size={20} className="text-yellow-500" />
                                </div>
                                <div className="text-sm">
                                    <p className="text-slate-300 font-medium">Ready to start?</p>
                                    <p className="text-xs mt-0.5">Generate a briefing to prioritize tasks and review your schedule.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Streak Stats Banner */}
            <div className="mb-6 bg-gradient-to-r from-orange-500/10 via-purple-500/10 to-blue-500/10 border border-slate-800 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-6 md:gap-12">
                    {/* Current Streak */}
                    <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-xl ${streakInfo.current > 0 ? 'bg-orange-500/20' : 'bg-slate-800'}`}>
                            <Flame className={`w-6 h-6 ${streakInfo.current > 0 ? 'text-orange-400' : 'text-slate-500'}`} />
                        </div>
                        <div>
                            <div className={`text-2xl font-bold ${streakInfo.current > 0 ? 'text-orange-300' : 'text-slate-400'}`}>
                                {streakInfo.current} day{streakInfo.current !== 1 ? 's' : ''}
                            </div>
                            <div className="text-xs text-slate-500">Current Streak</div>
                        </div>
                    </div>

                    {/* Best Streak */}
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-purple-500/20">
                            <Trophy className="w-6 h-6 text-purple-400" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-purple-300">{streakInfo.longest}</div>
                            <div className="text-xs text-slate-500">Best Streak</div>
                        </div>
                    </div>

                    {/* This Week */}
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-blue-500/20">
                            <Calendar className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-blue-300">{activitySummary.thisWeekCount}</div>
                            <div className="text-xs text-slate-500">This Week</div>
                        </div>
                    </div>

                    {/* Productive Hours */}
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-green-500/20">
                            <Clock className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-green-300">{formatDuration(activitySummary.productiveMinutes)}</div>
                            <div className="text-xs text-slate-500">Productive Hours</div>
                        </div>
                    </div>

                    {/* Focus Score (Productive Hours) */}
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-teal-500/20">
                            <Zap className="w-6 h-6 text-teal-400" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-teal-300">{activitySummary.focusScore}%</div>
                            <div className="text-xs text-slate-500">Focus Score</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 24-Hour Productivity Timeline */}
            <div className="mb-6">
                <DailyProductivityBar entities={entities} />
            </div>

            {/* Stats Row - 4 Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {/* Tasks - Navigate to Calendar */}
                <div
                    onClick={() => setView('calendar')}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-emerald-500/50 cursor-pointer transition-colors"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{pendingTasks.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Tasks</div>
                </div>

                <div
                    onClick={() => setView('knowledge', ['PROJECT'])}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-blue-500/50 cursor-pointer transition-colors"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                            <Briefcase size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{activeProjects.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Projects</div>
                </div>

                <div
                    onClick={() => setView('knowledge', ['GOAL'])}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-indigo-500/50 cursor-pointer transition-colors"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                            <Target size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{activeGoals.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Goals</div>
                </div>

                <div
                    onClick={() => setView('calendar')}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-purple-500/50 cursor-pointer transition-colors"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                            <Calendar size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{upcomingEvents.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Events</div>
                </div>
            </div>

            {/* Confirm Past Events - Tap to Cycle */}
            {unconfirmedPastEvents.length > 0 && (
                <div className="mb-6 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
                        <CalendarClock size={16} /> Confirm Past Events
                        <span className="text-xs text-amber-500/70 font-normal">Tap: 1×=✓ done, 2×=✗ skip, 3×=options</span>
                    </h3>
                    <div className="space-y-2">
                        {unconfirmedPastEvents.slice(0, 5).map(event => (
                            <div
                                key={event.id}
                                onClick={() => handleEventTap(event.id)}
                                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${tapCounts[event.id] === 1 ? 'bg-emerald-500/20 border border-emerald-500/40' :
                                    tapCounts[event.id] === 2 ? 'bg-red-500/20 border border-red-500/40' :
                                        'bg-slate-800/50 hover:bg-slate-800 border border-transparent'
                                    }`}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`p-2 rounded-lg ${tapCounts[event.id] === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                                        tapCounts[event.id] === 2 ? 'bg-red-500/20 text-red-400' :
                                            'bg-amber-500/10 text-amber-400'
                                        }`}>
                                        <Calendar size={14} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-200 truncate">{event.title}</div>
                                        <div className="text-[10px] text-slate-500">
                                            {new Date(event.start_time!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                                <div className={`text-xs font-medium px-2 py-1 rounded ${tapCounts[event.id] === 1 ? 'text-emerald-400 bg-emerald-500/20' :
                                    tapCounts[event.id] === 2 ? 'text-red-400 bg-red-500/20' :
                                        tapCounts[event.id] === 3 ? 'text-purple-400 bg-purple-500/20' :
                                            'text-slate-500'
                                    }`}>
                                    {tapCounts[event.id] === 1 ? '✓ Done' :
                                        tapCounts[event.id] === 2 ? '✗ Skip' :
                                            tapCounts[event.id] === 3 ? '⋯' : 'Tap'}
                                </div>
                            </div>
                        ))}
                    </div>
                    {unconfirmedPastEvents.length > 5 && (
                        <p className="text-xs text-slate-500 mt-2 text-center">+{unconfirmedPastEvents.length - 5} more events</p>
                    )}
                </div>
            )}

            {/* Confirmation Popup Modal */}
            {showConfirmPopup && (
                <>
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowConfirmPopup(null)} />
                    <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-semibold text-slate-100 mb-4">What happened?</h3>
                            <div className="space-y-2">
                                <button
                                    onClick={() => handleConfirmOption(showConfirmPopup, 'postponed')}
                                    className="w-full py-3 px-4 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded-lg text-sm font-medium border border-amber-500/30 transition-colors"
                                >
                                    ⏰ Postponed to later
                                </button>
                                <button
                                    onClick={() => handleConfirmOption(showConfirmPopup, 'cancelled')}
                                    className="w-full py-3 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg text-sm font-medium border border-red-500/30 transition-colors"
                                >
                                    ❌ Cancelled
                                </button>
                                <button
                                    onClick={() => handleConfirmOption(showConfirmPopup, 'rescheduled')}
                                    className="w-full py-3 px-4 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 rounded-lg text-sm font-medium border border-blue-500/30 transition-colors"
                                >
                                    📅 Rescheduled (will create new)
                                </button>
                            </div>
                            <button
                                onClick={() => setShowConfirmPopup(null)}
                                className="w-full mt-4 py-2 text-slate-500 text-sm hover:text-slate-300 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Quick Actions Row - 4 Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {/* Unlinked Items */}
                <div
                    onClick={() => insights.orphans.length > 0 && setShowOrphansModal(true)}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 transition-colors ${insights.orphans.length > 0 ? 'hover:border-orange-500/50 cursor-pointer' : ''}`}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`p-2 rounded-lg ${insights.orphans.length > 0 ? 'bg-orange-500/10 text-orange-400' : 'bg-slate-800 text-slate-500'}`}>
                            <Link size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{insights.orphans.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Unlinked</div>
                </div>

                <div
                    onClick={() => insights.dueSoon.length > 0 && setShowDueModal(true)}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 transition-colors ${insights.dueSoon.length > 0 ? 'hover:border-cyan-500/50 cursor-pointer' : ''}`}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`p-2 rounded-lg ${insights.dueSoon.length > 0 ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                            <CalendarClock size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{insights.dueSoon.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Due</div>
                </div>

                <div
                    onClick={() => insights.needsNextAction.length > 0 && setShowProjectsModal(true)}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 transition-colors ${insights.needsNextAction.length > 0 ? 'hover:border-yellow-500/50 cursor-pointer' : ''}`}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`p-2 rounded-lg ${insights.needsNextAction.length > 0 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-slate-800 text-slate-500'}`}>
                            <ListTodo size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-100">{insights.needsNextAction.length}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">Stalled</div>
                </div>

                {/* Chat Quick Action */}
                <div
                    onClick={() => setView('chat')}
                    className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-4 hover:border-indigo-500/60 cursor-pointer transition-all"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                            <Bot size={16} />
                        </div>
                    </div>
                    <div className="text-sm font-bold text-indigo-300">Ask AI</div>
                    <div className="text-[10px] text-indigo-400/70 font-medium">Quick Chat</div>
                </div>

                {/* Fix Graph AI Button - Spans 2 cols on mobile, 4 on desktop when visible */}
                {(insights.orphans.length > 0 || insights.needsNextAction.length > 0) && onOpenGraphFixer && (
                    <div
                        onClick={onOpenGraphFixer}
                        className="bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/30 rounded-xl p-4 hover:border-violet-500/60 cursor-pointer transition-all col-span-2 md:col-span-4"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-violet-500/20 text-violet-400">
                                    <Wand2 size={16} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-violet-200">AI Graph Fixer</div>
                                    <div className="text-[10px] text-violet-400/70">Automatically categorize, tag, and connect entities</div>
                                </div>
                            </div>
                            <ArrowRight size={16} className="text-violet-400" />
                        </div>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Goal Progress Section */}
                {activeGoals.length > 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                                <TrendingUp size={18} /> Goal Progress
                            </h2>
                            <button onClick={() => setView('goals')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                View All <ArrowRight size={12} />
                            </button>
                        </div>

                        <div className="space-y-4 flex-1">
                            {activeGoals.slice(0, 3).map(goal => {
                                const percent = calculateProgress(goal, entities, relationships);
                                return (
                                    <div
                                        key={goal.id}
                                        onClick={() => selectEntity(goal.id)}
                                        className="group cursor-pointer"
                                    >
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-medium text-slate-300 text-sm group-hover:text-white transition-colors truncate">{goal.title}</span>
                                            <span className="text-xs font-mono text-indigo-400 bg-indigo-950/30 px-1.5 py-0.5 rounded">{percent}%</span>
                                        </div>
                                        <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                                            <div
                                                className="bg-indigo-500 h-full rounded-full transition-all duration-1000 ease-out group-hover:bg-indigo-400"
                                                style={{ width: `${percent}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                        <Target className="w-12 h-12 text-slate-700 mb-3" />
                        <p className="text-slate-300 font-medium">No active goals</p>
                        <p className="text-slate-500 text-sm mt-1">Set a goal to track your progress.</p>
                    </div>
                )}

                {/* Upcoming Events */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
                    <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <Calendar size={18} /> Upcoming Events
                    </h2>
                    <div className="space-y-3 flex-1">
                        {upcomingEvents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 italic text-sm py-8">
                                No upcoming events scheduled.
                            </div>
                        ) : (
                            upcomingEvents.map(evt => (
                                <div
                                    key={evt.id}
                                    onClick={() => selectEntity(evt.id)}
                                    className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex gap-3 items-center hover:border-indigo-500/50 cursor-pointer transition-colors"
                                >
                                    <div className="bg-slate-900 p-2 rounded text-center min-w-[50px] border border-slate-800">
                                        <div className="text-[10px] text-slate-500 uppercase font-bold">{new Date(evt.start_time!).toLocaleString('default', { month: 'short' })}</div>
                                        <div className="text-lg font-bold text-slate-200">{new Date(evt.start_time!).getDate()}</div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-200 line-clamp-1">{evt.title}</p>
                                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                            <Clock size={10} />
                                            {new Date(evt.start_time!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <ArrowRight size={14} className="text-slate-600" />
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Heatmaps - Above Recent Activity */}
            <div className="mt-8 mb-8">
                <MomentumHeatmap />
            </div>

            {/* Recent Activity (Full Width) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                        <Clock size={18} /> Recent Activity
                    </h2>
                    <button
                        onClick={() => setView('calendar', undefined, 'history')}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                        View All <ArrowRight size={12} />
                    </button>
                </div>
                <div className="space-y-1">
                    {recentActivities.length === 0 ? (
                        <p className="text-slate-500 text-sm italic">No recent activity.</p>
                    ) : (
                        recentActivities.map((act, idx) => (
                            <div
                                key={act.id}
                                onClick={() => selectEntity(act.isNestedLog && act.parentId ? act.parentId : act.id)}
                                className="flex gap-4 items-center p-3 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors group"
                            >
                                <div className="text-xs font-mono text-slate-500 w-20 shrink-0 text-right">
                                    {new Date(act.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </div>
                                <div className={`w-2 h-2 rounded-full shrink-0 ${idx === 0 ? 'bg-indigo-500 ring-2 ring-indigo-500/20' : 'bg-slate-600'}`}></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-300 font-medium truncate group-hover:text-white">{act.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {act.duration_minutes && (
                                            <span className="text-xs text-slate-500">{act.duration_minutes} mins</span>
                                        )}
                                        {act.isNestedLog && act.parentTitle && (
                                            <span className="text-[10px] text-indigo-400/70 bg-indigo-400/10 px-1.5 py-0.5 rounded">
                                                {act.parentTitle}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ArrowRight size={14} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Quick Streaks Widget (feature toggle controlled) */}
            {settings.feature_toggles?.quick_streaks && (
                <div className="mt-8 mb-8">
                    <QuickStreaks />
                </div>
            )}

            {/* Insight Modals */}
            {showOrphansModal && (
                <InsightModal
                    title="Unconnected Items"
                    items={insights.orphans}
                    onClose={() => setShowOrphansModal(false)}
                    onSelect={(id) => { selectEntity(id); setShowOrphansModal(false); }}
                    onAskAI={handleAskAIOrphans}
                />
            )}

            {showDueModal && (
                <InsightModal
                    title="Due Soon (Chronological)"
                    items={insights.dueSoon}
                    onClose={() => setShowDueModal(false)}
                    onSelect={(id) => { selectEntity(id); setShowDueModal(false); }}
                />
            )}

            {showProjectsModal && (
                <InsightModal
                    title="Projects Needing Next Action"
                    items={insights.needsNextAction}
                    onClose={() => setShowProjectsModal(false)}
                    onSelect={(id) => { selectEntity(id); setShowProjectsModal(false); }}
                />
            )}
        </div>
    );
};

export default Dashboard;