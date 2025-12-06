import React, { useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType } from '../types';
import { Building2, Clock, Target, CheckCircle, Calendar, TrendingUp, Users } from 'lucide-react';

interface ContextSummaryProps {
    contextTitle: string;
    onClose: () => void;
}

const ContextSummary: React.FC<ContextSummaryProps> = ({ contextTitle, onClose }) => {
    const { entities, relationships } = useStore();

    const summary = useMemo(() => {
        // Find the context entity
        const contextEntity = entities.find(e =>
            e.kind === EntityKind.CONTEXT &&
            e.title.toLowerCase() === contextTitle.toLowerCase()
        );

        if (!contextEntity) return null;

        // Find all entities linked to this context
        const relatedIds = new Set<string>();
        relationships.forEach(rel => {
            if (rel.from === contextEntity.id) relatedIds.add(rel.to);
            if (rel.to === contextEntity.id) relatedIds.add(rel.from);
        });

        const relatedEntities = entities.filter(e => relatedIds.has(e.id));

        // Categorize by kind
        const goals = relatedEntities.filter(e => e.kind === EntityKind.GOAL);
        const projects = relatedEntities.filter(e => e.kind === EntityKind.PROJECT);
        const tasks = relatedEntities.filter(e => e.kind === EntityKind.TASK);
        const events = relatedEntities.filter(e => e.kind === EntityKind.EVENT);
        const activities = relatedEntities.filter(e => e.kind === EntityKind.ACTIVITY);
        const people = relatedEntities.filter(e => e.kind === EntityKind.PERSON);

        // Calculate stats
        const completedTasks = tasks.filter(t => t.status === EntityStatus.COMPLETED).length;
        const activeTasks = tasks.filter(t => t.status === EntityStatus.ACTIVE || t.status === EntityStatus.IN_PROGRESS).length;

        // Calculate total time spent from activities
        const totalMinutes = activities.reduce((sum, a) => sum + (a.duration_minutes || 0), 0);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;

        // Find role/position from metadata or description
        const role = contextEntity.metadata?.role || contextEntity.description || null;

        // Find tenure from metadata
        const startDate = contextEntity.metadata?.start_date;
        const endDate = contextEntity.metadata?.end_date;

        // Get recent activity
        const recentActivities = activities
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5);

        // Upcoming events
        const upcoming = events
            .filter(e => e.start_time && new Date(e.start_time) > new Date())
            .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
            .slice(0, 3);

        return {
            context: contextEntity,
            role,
            startDate,
            endDate,
            goals,
            projects,
            tasks: { completed: completedTasks, active: activeTasks, total: tasks.length },
            events: upcoming,
            activities: recentActivities,
            people,
            totalTimeFormatted: hours > 0 ? `${hours}h ${mins}m` : `${mins}m`,
        };
    }, [entities, relationships, contextTitle]);

    if (!summary) {
        return (
            <div className="p-6 text-center text-slate-500">
                Context "{contextTitle}" not found
            </div>
        );
    }

    return (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 mb-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Building2 size={18} className="text-pink-400" />
                        <h2 className="text-lg font-bold text-white">{summary.context.title}</h2>
                    </div>
                    {summary.role && (
                        <p className="text-sm text-slate-400">{summary.role}</p>
                    )}
                    {summary.startDate && (
                        <p className="text-xs text-slate-500 mt-1">
                            📅 {new Date(summary.startDate).toLocaleDateString()}
                            {summary.endDate ? ` → ${new Date(summary.endDate).toLocaleDateString()}` : ' → Present'}
                        </p>
                    )}
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-indigo-400">{summary.goals.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase">Goals</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-purple-400">{summary.projects.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase">Projects</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-emerald-400">{summary.tasks.completed}/{summary.tasks.total}</div>
                    <div className="text-[10px] text-slate-500 uppercase">Tasks Done</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-amber-400">{summary.totalTimeFormatted}</div>
                    <div className="text-[10px] text-slate-500 uppercase">Time Spent</div>
                </div>
            </div>

            {/* Goals */}
            {summary.goals.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                        <Target size={12} /> Goals
                    </h3>
                    <div className="space-y-1">
                        {summary.goals.map(g => (
                            <div key={g.id} className="text-sm text-slate-300 flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${g.status === EntityStatus.COMPLETED ? 'bg-green-400' : 'bg-indigo-400'}`} />
                                {g.title}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* People */}
            {summary.people.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                        <Users size={12} /> People Involved
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {summary.people.map(p => (
                            <span key={p.id} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                                {p.title}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Upcoming Events */}
            {summary.events.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                        <Calendar size={12} /> Upcoming
                    </h3>
                    <div className="space-y-1">
                        {summary.events.map(e => (
                            <div key={e.id} className="text-sm text-slate-300 flex items-center gap-2">
                                <span className="text-[10px] text-slate-500">
                                    {e.start_time ? new Date(e.start_time).toLocaleDateString() : ''}
                                </span>
                                {e.title}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Recent Activity */}
            {summary.activities.length > 0 && (
                <div>
                    <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                        <Clock size={12} /> Recent Activity
                    </h3>
                    <div className="space-y-1">
                        {summary.activities.map(a => (
                            <div key={a.id} className="text-xs text-slate-500 flex items-center gap-2">
                                <span className="text-slate-600">
                                    {new Date(a.created_at).toLocaleDateString()}
                                </span>
                                <span className="text-slate-400">{a.title}</span>
                                {a.duration_minutes && <span className="text-slate-600">({a.duration_minutes}m)</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContextSummary;
