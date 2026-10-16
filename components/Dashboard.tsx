import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { getActiveEntities } from '../store/helpers';
import { EntityKind, EntityStatus, RelationshipType, Entity, ToonOperation } from '../types';
import { Clock, CheckCircle2, Target, Calendar, TrendingUp, Sparkles, RefreshCw, ArrowRight, Zap, Briefcase, AlertTriangle, Link, Layers, X, Bot, CalendarClock, ListTodo, Flame, Trophy, Wand2, Brain, UserCheck, History, Plus, Check } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import MomentumHeatmap from './MomentumHeatmap';
import MarkdownText from './MarkdownText';
import { deferDeadline, getDeadlineState, parseCalendarDate, selectDueEntities } from '../utils/calendarDates';
import { calculateProgress } from '../utils/progressCalculation';
import { getStreakInfo, getActivitySummary } from '../utils/streakCalculation';
import DailyProductivityBar from './DailyProductivityBar';
import QuickStreaks from './QuickStreaks';
import { SkeletonDashboard } from './Skeleton';
import { CommitmentCard } from './CommitmentCard';
import { InterruptedDayRecovery } from './InterruptedDayRecovery';
import { extractMemoryItem } from '../services/context/resolver';
import { hasAiApiKey } from '../services/ai/client';

interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: number;
    subValue?: string;
    colorClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subValue, colorClass }) => (
    <div className="bg-ideapad-surface border border-ideapad-border/40 p-5 rounded-xl flex items-start justify-between relative overflow-hidden group hover:border-ideapad-mint/30 transition-all">
        <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity ${colorClass}`}>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 64 }) : icon}
        </div>
        <div className="relative z-10">
            <div className="text-3xl font-bold text-ideapad-text mb-1">{value}</div>
            <div className="text-xs text-ideapad-muted font-medium uppercase tracking-wide">{label}</div>
            {subValue && <div className="text-[10px] text-ideapad-muted/70 mt-2 font-mono">{subValue}</div>}
        </div>
        <div className={`p-3 rounded-lg bg-ideapad-elevated border border-ideapad-border/50 ${colorClass}`}>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 20 }) : icon}
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

const InsightModal: React.FC<InsightModalProps> = ({ title, items, onClose, onSelect, onAskAI, renderItem }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="insight-modal-title"
            data-testid="insight-modal-backdrop"
        >
            <div
                className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[70vh] overflow-hidden shadow-2xl flex flex-col"
                onClick={e => e.stopPropagation()}
                data-testid="insight-modal-content"
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h3 id="insight-modal-title" className="text-lg font-semibold text-slate-100">{title}</h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="p-4 overflow-y-auto max-h-[50vh] space-y-2">
                    {items.length === 0 ? (
                        <p className="text-slate-500 text-sm text-center py-4" data-testid="insight-modal-empty">No items found</p>
                    ) : (
                        items.map(item => (
                            renderItem ? renderItem(item) : (
                                <div
                                    key={item.id}
                                    onClick={() => onSelect(item.id)}
                                    className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer transition-colors"
                                    data-testid={`insight-item-${item.id}`}
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
                            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                            <Bot size={16} />
                            Ask AI to Analyze & Connect These
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

interface DashboardProps { onOpenGraphFixer?: () => void }
const Dashboard: React.FC<DashboardProps> = ({ onOpenGraphFixer }) => {
    const { entities: rawEntities, kernelEntities, relationships, selectEntity, dailyBriefing, refreshDailyBriefing, setView, addMessage, addToast, setPendingOrchestration, applyOperations, settings, isHydrated } = useStore();
    const entities = useMemo(() => getActiveEntities(rawEntities), [rawEntities]);
    const commitmentEntityIds = useMemo(() => {
        return Object.values(kernelEntities || {})
            .filter(e => !e.lifecycle?.deleted_at && e.lifecycle?.status !== 'deleted' && (e.attributes?.commitment || (typeof e.attributes?.frequency_goal === 'number' && typeof e.attributes?.frequency_period === 'string')))
            .map(e => e.id);
    }, [kernelEntities]);
    const memoryItems = useMemo(() => {
        return Object.values(kernelEntities || {})
            .filter(e => e.schema_id === 'system/memory_item' && !e.lifecycle?.deleted_at && e.lifecycle?.status !== 'deleted')
            .map(e => ({ entity: e, memory: extractMemoryItem(e) }))
            .sort((a, b) => new Date(b.memory.valid_from || 0).getTime() - new Date(a.memory.valid_from || 0).getTime());
    }, [kernelEntities]);
    const [briefingLoading, setBriefingLoading] = useState(false);
    const [showOrphansModal, setShowOrphansModal] = useState(false);
    const [showDueModal, setShowDueModal] = useState(false);
    const [showProjectsModal, setShowProjectsModal] = useState(false);
    const [addingNextActionProjectId, setAddingNextActionProjectId] = useState<string | null>(null);
    const [nextActionTitle, setNextActionTitle] = useState<string>('');

    // Show skeleton while data is loading
    if (!isHydrated) {
        return <SkeletonDashboard />;
    }

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
                e.metadata.activity_log.forEach((log: Record<string, unknown>, idx: number) => {
                    if (typeof log.timestamp === 'string') {
                        activities.push({
                            id: `${e.id}-log-${idx}`,
                            title: (typeof log.title === 'string' ? log.title : (typeof log.note === 'string' ? log.note : `Activity on ${e.title}`)),
                            created_at: log.timestamp,
                            duration_minutes: typeof log.duration_minutes === 'number' ? log.duration_minutes : undefined,
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
    const isBriefingStale = !dailyBriefing || dailyBriefing.generated_for_date !== today
        || entities.some(e => Date.parse(e.updated_at) > Date.parse(dailyBriefing.timestamp));

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

        // Symmetrically account for parent-child hierarchies via canonical parent_id
        entities.forEach(e => {
            if (e.parent_id) {
                relatedIds.add(e.id);
                relatedIds.add(e.parent_id);
            }
        });

        // 1. Orphans: No connections, excluding Tags, Notes, Activities, and hidden entities
        const orphans = entities.filter(e =>
            !relatedIds.has(e.id) &&
            e.kind !== EntityKind.TAG &&
            e.kind !== EntityKind.NOTE &&
            e.kind !== EntityKind.ACTIVITY &&
            !e.metadata?.hidden  // Exclude hidden from AI
        );

        // 2. Due Soon: Uncompleted tasks, goals, and projects with deadlines (sorted chronologically)
        const dueSoon = selectDueEntities(entities);

        // 3. Needs Next Action: Active projects with NO active tasks linked
        const needsNextAction = entities.filter(e => {
            if (e.kind !== EntityKind.PROJECT || e.status !== EntityStatus.ACTIVE) return false;

            const childrenIds = new Set<string>();
            relationships.forEach(r => {
                if (r.to === e.id && (r.type === RelationshipType.PART_OF || r.type === RelationshipType.FULFILLS)) {
                    childrenIds.add(r.from);
                } else if (r.from === e.id && (r.type === RelationshipType.PART_OF || r.type === RelationshipType.FULFILLS)) {
                    childrenIds.add(r.to);
                }
            });

            entities.forEach(child => {
                if (child.parent_id === e.id) {
                    childrenIds.add(child.id);
                }
            });

            const hasActiveTask = entities.some(child =>
                childrenIds.has(child.id) &&
                child.kind === EntityKind.TASK &&
                child.status === EntityStatus.ACTIVE
            );
            return !hasActiveTask;
        });

        return { orphans, dueSoon, needsNextAction };
    }, [entities, relationships]);

    const handleCreateNextAction = (projectId: string, projectTitle: string) => {
        if (!nextActionTitle.trim()) return;
        const taskId = `task-${uuidv4().substring(0, 8)}`;
        const trimmedTitle = nextActionTitle.trim();

        const ops: ToonOperation[] = [
            {
                type: 'create_entity',
                payload: {
                    id: taskId,
                    kind: EntityKind.TASK,
                    title: trimmedTitle,
                    status: EntityStatus.ACTIVE,
                    priority: 2,
                    parent_id: projectId,
                    metadata: {},
                    attributes: {
                        kind: 'TASK',
                        priority: 2,
                        parent_id: projectId
                    }
                }
            },
            {
                type: 'link_entities',
                payload: {
                    id: `rel-${uuidv4().substring(0, 8)}`,
                    from: taskId,
                    to: projectId,
                    type: RelationshipType.PART_OF
                }
            }
        ];

        applyOperations(ops);
        if (addToast) {
            addToast(`Added next action to "${projectTitle}"`, 'success');
        }
        setAddingNextActionProjectId(null);
        setNextActionTitle('');
    };

    const handleCompleteDueItem = (item: Entity) => {
        const ops: ToonOperation[] = [
            {
                type: 'update_entity',
                payload: {
                    id: item.id,
                    status: EntityStatus.COMPLETED,
                    fields: {
                        status: EntityStatus.COMPLETED
                    }
                }
            }
        ];
        applyOperations(ops);
        if (addToast) {
            addToast(`Completed "${item.title}"!`, 'success');
        }
    };

    const handleDeferDueItem = (item: Entity) => {
        if (!item.deadline) return;
        const newDeadlineIso = deferDeadline(item.deadline);
        if (!newDeadlineIso) return;

        const ops: ToonOperation[] = [
            {
                type: 'update_entity',
                payload: {
                    id: item.id,
                    deadline: newDeadlineIso,
                    fields: {
                        deadline: newDeadlineIso
                    }
                }
            }
        ];
        applyOperations(ops);
        if (addToast) {
            addToast(`Postponed "${item.title}" by 1 day`, 'info');
        }
    };

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
        <div className="flex-1 overflow-y-auto bg-ideapad-base text-ideapad-text p-6 md:p-8">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4 pl-4 md:pl-14">
                <div>
                    <h1 className="font-serif text-3xl font-bold text-ideapad-text tracking-tight">Dashboard</h1>
                    <p className="text-ideapad-muted text-sm mt-1 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        Local workspace
                    </p>
                </div>
            </header>

            {/* AI Daily Briefing */}
            <div className="mb-8 relative group">
                <div data-testid="dashboard-daily-briefing" style={{ borderColor: 'var(--border-hairline)' }} className="relative bg-ideapad-surface border rounded-xl p-6 overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-emerald-400">
                        <Sparkles size={120} />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 relative z-10">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <h2 className="text-lg font-semibold text-ideapad-text flex items-center gap-2">
                                <Sparkles size={18} className="text-ideapad-mint" />
                                {(() => {
                                    const hour = new Date().getHours();
                                    if (hour >= 5 && hour < 12) return 'Good morning!';
                                    if (hour >= 12 && hour < 17) return 'Good afternoon!';
                                    if (hour >= 17 && hour < 21) return 'Good evening!';
                                    return 'Working late?';
                                })()}
                            </h2>
                            {!hasAiApiKey() && (
                                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-ideapad-elevated text-ideapad-muted border border-ideapad-border">
                                    Local rules — not AI generated
                                </span>
                            )}
                        </div>
                        <button
                            onClick={handleGenerateBriefing}
                            disabled={briefingLoading}
                            className="flex items-center justify-center gap-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/40 w-full sm:w-auto self-start sm:self-auto"
                        >
                            {briefingLoading ? <RefreshCw className="animate-spin w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                            {!hasAiApiKey()
                                ? (dailyBriefing ? "Update Local Briefing" : "Generate Local Briefing")
                                : (dailyBriefing ? "Regenerate" : "Generate")}
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
                                    <p className="text-xs mt-0.5">
                                        {hasAiApiKey()
                                            ? "Generate a briefing to prioritize tasks and review your schedule."
                                            : "Generate a local offline briefing summarizing active tasks and scheduled events."}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Interrupted Day Recovery (Reference Workflow 2) */}
            <InterruptedDayRecovery />

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
                    data-testid="dashboard-stat-card" className="dashboard-stat-card bg-ideapad-surface border rounded-xl p-4 cursor-pointer"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-ideapad-text">{pendingTasks.length}</div>
                    <div className="text-[10px] text-ideapad-muted font-medium uppercase">Tasks</div>
                </div>

                <div
                    onClick={() => setView('knowledge', ['PROJECT'])}
                    data-testid="dashboard-stat-card" className="dashboard-stat-card bg-ideapad-surface border rounded-xl p-4 cursor-pointer"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                            <Briefcase size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-ideapad-text">{activeProjects.length}</div>
                    <div className="text-[10px] text-ideapad-muted font-medium uppercase">Projects</div>
                </div>

                <div
                    onClick={() => setView('knowledge', ['GOAL'])}
                    data-testid="dashboard-stat-card" className="dashboard-stat-card bg-ideapad-surface border rounded-xl p-4 cursor-pointer"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-ideapad-mint">
                            <Target size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-ideapad-text">{activeGoals.length}</div>
                    <div className="text-[10px] text-ideapad-muted font-medium uppercase">Goals</div>
                </div>

                <div
                    onClick={() => setView('calendar')}
                    data-testid="dashboard-stat-card" className="dashboard-stat-card bg-ideapad-surface border rounded-xl p-4 cursor-pointer"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-300">
                            <Calendar size={16} />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-ideapad-text">{upcomingEvents.length}</div>
                    <div className="text-[10px] text-ideapad-muted font-medium uppercase">Events</div>
                </div>
            </div>

            {/* Quick Actions Row - 4 Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {/* Unlinked Items */}
                <div
                    onClick={() => insights.orphans.length > 0 && setShowOrphansModal(true)}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 transition-colors ${insights.orphans.length > 0 ? 'hover:border-orange-500/50 cursor-pointer' : ''}`}
                    data-testid="dashboard-unlinked-card"
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
                    data-testid="dashboard-due-card"
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
                    data-testid="dashboard-stalled-card"
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

            {/* Reusable Entity Capabilities: Active Commitments */}
            {commitmentEntityIds.length > 0 && (
                <div className="mb-8" data-testid="dashboard-commitments-section">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                            <Target size={18} className="text-violet-400" /> Active Commitments
                        </h2>
                        <span className="text-xs text-slate-500 font-medium">{commitmentEntityIds.length} tracked</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {commitmentEntityIds.map(id => (
                            <CommitmentCard key={id} entityId={id} />
                        ))}
                    </div>
                </div>
            )}

            {/* Contextual Beliefs, Preferences & Decisions (Reference Workflow 4) */}
            {memoryItems.length > 0 && (
                <div className="mb-8" data-testid="dashboard-beliefs-section">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                            <Brain size={18} className="text-indigo-400" /> Stated Decisions &amp; Preferences
                        </h2>
                        <span className="text-xs text-slate-500 font-medium">
                            {memoryItems.length} contextual beliefs tracked
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {memoryItems.slice(0, 6).map(({ entity: kEntity, memory }) => {
                            const isSuperseded = memory.status === 'superseded' || Boolean(memory.superseded_by);
                            const isUserStated =
                                memory.speaker === 'user' ||
                                memory.source_type === 'user_explicit' ||
                                memory.source_type === 'user_confirmed' ||
                                memory.epistemic_status === 'user_decision';
                            const isProposal =
                                memory.speaker === 'assistant' ||
                                memory.source_type === 'inferred' ||
                                memory.epistemic_status === 'assistant_proposal';

                            return (
                                <div
                                    key={kEntity.id}
                                    onClick={() => selectEntity(kEntity.id)}
                                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all flex flex-col justify-between group"
                                    data-testid={`belief-card-${kEntity.id}`}
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                                                {memory.category}
                                            </span>
                                            {isSuperseded ? (
                                                <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <History size={10} /> Superseded
                                                </span>
                                            ) : isUserStated ? (
                                                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <UserCheck size={10} /> User Decision
                                                </span>
                                            ) : isProposal ? (
                                                <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <Bot size={10} /> {Math.round(memory.confidence * 100)}% Proposal
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors line-clamp-2">
                                            {memory.content}
                                        </div>
                                    </div>

                                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                                        <span className="font-mono text-[10px]">
                                            {memory.valid_from ? new Date(memory.valid_from).toLocaleDateString() : 'Permanent'}
                                        </span>
                                        <span className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                                            Inspect <ArrowRight size={11} />
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

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
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-sm font-medium text-slate-200 line-clamp-1">{evt.title}</p>
                                            {(evt.scheduling_certainty === 'tentative' || evt.metadata?.scheduling_certainty === 'tentative') && (
                                                <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 py-0.2 rounded font-normal shrink-0">Tentative</span>
                                            )}
                                        </div>
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
                    renderItem={(item) => {
                        const deadlineState = getDeadlineState(item.deadline);
                        const isOverdue = deadlineState === 'overdue';
                        const isDueToday = deadlineState === 'today';

                        return (
                            <div
                                key={item.id}
                                className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                                data-testid={`due-item-card-${item.id}`}
                            >
                                <div
                                    role="button"
                                    tabIndex={0}
                                    className="flex-1 min-w-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
                                    onClick={() => {
                                        selectEntity(item.id);
                                        setShowDueModal(false);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            selectEntity(item.id);
                                            setShowDueModal(false);
                                        }
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-200 hover:text-indigo-300 truncate transition-colors">
                                            {item.title}
                                        </span>
                                        {isOverdue ? (
                                            <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                                                <AlertTriangle size={10} /> Overdue
                                            </span>
                                        ) : isDueToday ? (
                                            <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full shrink-0">
                                                Due Today
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <span>{item.kind} • {item.status}</span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <Clock size={11} /> {parseCalendarDate(item.deadline)?.toLocaleDateString() || ''}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                    <button
                                        type="button"
                                        onClick={() => handleDeferDueItem(item)}
                                        className="px-2 py-1 text-[11px] bg-slate-700/60 hover:bg-slate-700 border border-slate-600/40 text-slate-300 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer"
                                        data-testid={`defer-due-btn-${item.id}`}
                                        title="Postpone deadline by 1 day"
                                        aria-label={`Postpone ${item.title} by 1 day`}
                                    >
                                        <CalendarClock size={12} /> +1d
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleCompleteDueItem(item)}
                                        className="px-2.5 py-1 text-[11px] bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer"
                                        data-testid={`complete-due-btn-${item.id}`}
                                        title="Mark as completed"
                                        aria-label={`Mark ${item.title} as completed`}
                                    >
                                        <CheckCircle2 size={12} /> Done
                                    </button>
                                </div>
                            </div>
                        );
                    }}
                />
            )}

            {showProjectsModal && (
                <InsightModal
                    title="Projects Needing Next Action"
                    items={insights.needsNextAction}
                    onClose={() => {
                        setShowProjectsModal(false);
                        setAddingNextActionProjectId(null);
                        setNextActionTitle('');
                    }}
                    onSelect={(id) => { selectEntity(id); setShowProjectsModal(false); }}
                    renderItem={(project) => (
                        <div
                            key={project.id}
                            className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 hover:border-slate-700 flex flex-col gap-2 transition-colors"
                            data-testid={`stalled-project-card-${project.id}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => {
                                        selectEntity(project.id);
                                        setShowProjectsModal(false);
                                    }}
                                >
                                    <div className="text-sm font-medium text-slate-200 hover:text-indigo-300 truncate transition-colors">
                                        {project.title}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {project.kind} • {project.status}
                                        {project.deadline && ` • Due ${new Date(project.deadline).toLocaleDateString()}`}
                                    </div>
                                </div>
                                {addingNextActionProjectId !== project.id && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setAddingNextActionProjectId(project.id);
                                            setNextActionTitle('');
                                        }}
                                        className="px-2.5 py-1 text-xs bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded-md flex items-center gap-1 font-medium transition-colors cursor-pointer shrink-0"
                                        data-testid={`add-next-action-btn-${project.id}`}
                                        aria-label={`Add next action to ${project.title}`}
                                    >
                                        <Plus size={13} /> Next Action
                                    </button>
                                )}
                            </div>

                            {addingNextActionProjectId === project.id && (
                                <div
                                    className="pt-2 border-t border-slate-700/60 flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`inline-next-action-form-${project.id}`}
                                >
                                    <input
                                        type="text"
                                        autoFocus
                                        value={nextActionTitle}
                                        onChange={(e) => setNextActionTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleCreateNextAction(project.id, project.title);
                                            } else if (e.key === 'Escape') {
                                                setAddingNextActionProjectId(null);
                                                setNextActionTitle('');
                                            }
                                        }}
                                        placeholder="Next action task title..."
                                        className="flex-1 bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded px-2.5 py-1.5 outline-none focus:border-indigo-400 placeholder:text-slate-500"
                                        data-testid={`inline-next-action-input-${project.id}`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleCreateNextAction(project.id, project.title)}
                                        disabled={!nextActionTitle.trim()}
                                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                                        data-testid={`inline-next-action-save-${project.id}`}
                                    >
                                        <Check size={12} /> Add
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAddingNextActionProjectId(null);
                                            setNextActionTitle('');
                                        }}
                                        className="p-1.5 text-slate-400 hover:text-slate-200 rounded text-xs transition-colors cursor-pointer"
                                        aria-label="Cancel next action"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                />
            )}

        </div>
    );
};

export default Dashboard;
