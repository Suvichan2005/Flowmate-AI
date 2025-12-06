import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType } from '../types';
import { Clock, CheckCircle2, Target, Calendar, TrendingUp, Sparkles, RefreshCw, ArrowRight, Zap, Briefcase, AlertTriangle, Link, Layers } from 'lucide-react';
import ActivityHeatmap from './ActivityHeatmap';
import MarkdownText from './MarkdownText';
import { calculateProgress } from '../utils/progressCalculation';

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

const Dashboard: React.FC = () => {
  const { entities, relationships, selectEntity, dailyBriefing, refreshDailyBriefing, setView } = useStore();
  const [briefingLoading, setBriefingLoading] = useState(false);

  const activeGoals = entities.filter(e => e.kind === EntityKind.GOAL && e.status === EntityStatus.ACTIVE);
  const pendingTasks = entities.filter(e => e.kind === EntityKind.TASK && e.status !== EntityStatus.COMPLETED);
  const activeProjects = entities.filter(e => e.kind === EntityKind.PROJECT && e.status === EntityStatus.ACTIVE);
  const upcomingEvents = entities
    .filter(e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time) > new Date())
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
    .slice(0, 3);
  
  const recentActivities = entities
    .filter(e => e.kind === EntityKind.ACTIVITY)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const handleGenerateBriefing = async () => {
      setBriefingLoading(true);
      await refreshDailyBriefing();
      setBriefingLoading(false);
  };
  
  const today = new Date().toISOString().split('T')[0];
  const isBriefingStale = !dailyBriefing || dailyBriefing.generated_for_date !== today;

  // -- GRAPH INSIGHTS --
  const insights = useMemo(() => {
     const relatedIds = new Set<string>();
     relationships.forEach(r => { relatedIds.add(r.from); relatedIds.add(r.to); });
     
     // 1. Orphans: No connections, excluding Tags and Notes which might be standalone
     const orphans = entities.filter(e => !relatedIds.has(e.id) && e.kind !== EntityKind.TAG && e.kind !== EntityKind.NOTE);
     
     // 2. Overdue: Active with past deadline
     const now = new Date();
     const overdue = entities.filter(e => 
        e.status === EntityStatus.ACTIVE && 
        e.deadline && 
        new Date(e.deadline) < now
     );
     
     // 3. Stalled Projects: Active project with NO active tasks linked
     const stalledProjects = entities.filter(e => {
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

     return { orphans, overdue, stalledProjects };
  }, [entities, relationships]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8">
      <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
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
                      Daily Briefing
                  </h2>
                  {(!dailyBriefing || isBriefingStale) && (
                      <button 
                        onClick={handleGenerateBriefing}
                        disabled={briefingLoading}
                        className="flex items-center gap-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shadow-lg shadow-indigo-900/50"
                      >
                          {briefingLoading ? <RefreshCw className="animate-spin w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                          {dailyBriefing ? "Refresh" : "Generate"}
                      </button>
                  )}
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
                          </p>
                      </div>
                  ) : (
                      <div className="flex items-center gap-4 text-slate-500">
                          <div className="p-3 rounded-full bg-slate-800">
                              <Zap size={20} className="text-yellow-500" />
                          </div>
                          <div className="text-sm">
                             <p className="text-slate-300 font-medium">Ready to start your day?</p>
                             <p className="text-xs mt-0.5">Generate a briefing to prioritize tasks and review your schedule.</p>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard 
            icon={<CheckCircle2 />} 
            label="Pending Tasks" 
            value={pendingTasks.length} 
            colorClass="text-emerald-400" 
        />
        <StatCard 
            icon={<Briefcase />} 
            label="Active Projects" 
            value={activeProjects.length} 
            colorClass="text-blue-400" 
        />
        <StatCard 
            icon={<Target />} 
            label="Active Goals" 
            value={activeGoals.length} 
            colorClass="text-indigo-400" 
        />
        <StatCard 
            icon={<Calendar />} 
            label="Events Soon" 
            value={upcomingEvents.length} 
            colorClass="text-purple-400" 
        />
      </div>

      {/* Activity Heatmap */}
      <ActivityHeatmap />

      {/* Smart Insights Grid */}
      <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
             <Layers size={18} /> Graph Insights
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Orphans */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4 hover:border-slate-700 transition-colors">
                  <div className={`p-3 rounded-lg ${insights.orphans.length > 0 ? 'bg-orange-500/10 text-orange-400' : 'bg-slate-800 text-slate-500'}`}>
                      <Link size={20} />
                  </div>
                  <div className="flex-1">
                      <div className="text-2xl font-bold text-slate-200">{insights.orphans.length}</div>
                      <div className="text-xs text-slate-500 font-medium uppercase">Orphaned Items</div>
                  </div>
                  {insights.orphans.length > 0 && (
                      <button onClick={() => selectEntity(insights.orphans[0].id)} className="text-xs text-indigo-400 hover:underline">
                          Review
                      </button>
                  )}
              </div>

              {/* Overdue */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4 hover:border-slate-700 transition-colors">
                  <div className={`p-3 rounded-lg ${insights.overdue.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
                      <AlertTriangle size={20} />
                  </div>
                  <div className="flex-1">
                      <div className="text-2xl font-bold text-slate-200">{insights.overdue.length}</div>
                      <div className="text-xs text-slate-500 font-medium uppercase">Overdue Tasks</div>
                  </div>
                  {insights.overdue.length > 0 && (
                      <button onClick={() => selectEntity(insights.overdue[0].id)} className="text-xs text-indigo-400 hover:underline">
                          Review
                      </button>
                  )}
              </div>

              {/* Stalled Projects */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4 hover:border-slate-700 transition-colors">
                  <div className={`p-3 rounded-lg ${insights.stalledProjects.length > 0 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-slate-800 text-slate-500'}`}>
                      <Briefcase size={20} />
                  </div>
                  <div className="flex-1">
                      <div className="text-2xl font-bold text-slate-200">{insights.stalledProjects.length}</div>
                      <div className="text-xs text-slate-500 font-medium uppercase">Stalled Projects</div>
                  </div>
                  {insights.stalledProjects.length > 0 && (
                      <button onClick={() => selectEntity(insights.stalledProjects[0].id)} className="text-xs text-indigo-400 hover:underline">
                          Review
                      </button>
                  )}
              </div>

          </div>
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
                        <div key={evt.id} className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex gap-3 items-center hover:border-slate-700 transition-colors">
                            <div className="bg-slate-900 p-2 rounded text-center min-w-[50px] border border-slate-800">
                                <div className="text-[10px] text-slate-500 uppercase font-bold">{new Date(evt.start_time!).toLocaleString('default', { month: 'short' })}</div>
                                <div className="text-lg font-bold text-slate-200">{new Date(evt.start_time!).getDate()}</div>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-200 line-clamp-1">{evt.title}</p>
                                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                    <Clock size={10} />
                                    {new Date(evt.start_time!).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>

      {/* Recent Activity (Full Width) */}
      <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Clock size={18} /> Recent Activity
        </h2>
        <div className="space-y-1">
            {recentActivities.length === 0 ? (
                <p className="text-slate-500 text-sm italic">No recent activity.</p>
            ) : (
                recentActivities.map((act, idx) => (
                    <div key={act.id} className="flex gap-4 items-center p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                        <div className="text-xs font-mono text-slate-500 w-24 shrink-0 text-right">
                            {new Date(act.created_at).toLocaleDateString()}
                        </div>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${idx === 0 ? 'bg-indigo-500 ring-2 ring-indigo-500/20' : 'bg-slate-600'}`}></div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-300 font-medium truncate">{act.title}</p>
                            {act.duration_minutes && (
                                <p className="text-xs text-slate-500 mt-0.5">{act.duration_minutes} mins logged</p>
                            )}
                        </div>
                    </div>
                ))
            )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;