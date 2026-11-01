/**
 * Flowmate Greenfield Domain Kernel — Generic Declarative Workspace Renderer
 *
 * Renders arbitrary generative dashboard manifests without hardcoding domain strings.
 * Dynamically binds widgets to SchemaDefinitions, KernelEntities, and timers.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import {
  DashboardManifest,
  DashboardWidgetConfig,
  EntityLogListConfig,
  InteractiveTimerConfig,
  MetricCounterConfig,
  TemporalRecommendationConfig,
  CrossReferenceSummaryConfig,
} from '../services/workspaces/generativeDashboardTypes';
import { computeTemporalRecommendation } from '../services/workspaces/temporalRecommendationEngine';
import { generativeWorkspaceManager, CANONICAL_GYM_DASHBOARD_ID } from '../services/workspaces/workspaceManager';
import { globalWorkspacePluginRegistry } from '../services/workspaces/workspacePluginRegistry';
import { KernelEntity } from '../services/kernel/types';
import {
  LayoutDashboard,
  Dumbbell,
  Sparkles,
  Target,
  BookOpen,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  TrendingUp,
  ArrowLeft,
  Flame,
} from 'lucide-react';

interface GenerativeDashboardViewProps {
  dashboardId?: string;
}

export const GenerativeDashboardView: React.FC<GenerativeDashboardViewProps> = ({
  dashboardId = CANONICAL_GYM_DASHBOARD_ID,
}) => {
  const kernelEntities = useStore(state => state.kernelEntities);
  const foodLogs = useStore(state => state.foodLogs);
  const applyOperations = useStore(state => state.applyOperations);
  const addToast = useStore(state => state.addToast);
  const setView = useStore(state => state.setView);

  const [activeDashboard, setActiveDashboard] = useState<DashboardManifest>(() => {
    return (
      generativeWorkspaceManager.getDashboard(dashboardId) ||
      globalWorkspacePluginRegistry.getPlugin(dashboardId)?.manifest ||
      generativeWorkspaceManager.listDashboards()[0]
    );
  });

  useEffect(() => {
    if (dashboardId) {
      const found =
        generativeWorkspaceManager.getDashboard(dashboardId) ||
        globalWorkspacePluginRegistry.getPlugin(dashboardId)?.manifest;
      if (found) setActiveDashboard(found);
    }
  }, [dashboardId]);

  // Dynamic Icon Resolver
  const renderDashboardIcon = () => {
    switch (activeDashboard.icon) {
      case 'dumbbell':
        return <Dumbbell className="w-5 h-5" />;
      case 'sparkles':
        return <Sparkles className="w-5 h-5" />;
      case 'target':
        return <Target className="w-5 h-5" />;
      case 'book-open':
        return <BookOpen className="w-5 h-5" />;
      case 'flame':
        return <Flame className="w-5 h-5" />;
      default:
        return <LayoutDashboard className="w-5 h-5" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Workspace Identity */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {renderDashboardIcon()}
            </span>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{activeDashboard.title}</h1>
            <span className="text-xs uppercase font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-indigo-400 border border-indigo-500/30">
              {activeDashboard.category} Workspace
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{activeDashboard.description}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView('knowledge')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Workspaces Gallery
          </button>
        </div>
      </div>

      {/* Declarative Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {activeDashboard.widgets.map(widget => (
          <GenericWidgetRenderer
            key={widget.id}
            widget={widget}
            dashboardId={activeDashboard.id}
            kernelEntities={kernelEntities}
            foodLogs={foodLogs}
            applyOperations={applyOperations}
            addToast={addToast}
          />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Generic Declarative Widget Renderer
// ---------------------------------------------------------------------------

interface GenericWidgetRendererProps {
  widget: DashboardWidgetConfig;
  dashboardId: string;
  kernelEntities: Record<string, KernelEntity>;
  foodLogs: Array<{ timestamp?: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number }>;
  applyOperations: (ops: Array<{ type: string; payload: Record<string, unknown> }>) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const GenericWidgetRenderer: React.FC<GenericWidgetRendererProps> = ({
  widget,
  dashboardId,
  kernelEntities,
  foodLogs,
  applyOperations,
  addToast,
}) => {
  const colSpanClass =
    widget.gridSpan === 1
      ? 'md:col-span-1'
      : widget.gridSpan === 2
      ? 'md:col-span-2'
      : widget.gridSpan === 3
      ? 'md:col-span-3'
      : 'md:col-span-4';

  switch (widget.type) {
    case 'temporal_recommendation':
      return (
        <div className={`${colSpanClass}`}>
          <TemporalRecommendationWidget
            config={widget}
            kernelEntities={kernelEntities}
            applyOperations={applyOperations}
            addToast={addToast}
          />
        </div>
      );

    case 'interactive_timer':
      return (
        <div className={`${colSpanClass}`}>
          <InteractiveTimerWidget config={widget} addToast={addToast} />
        </div>
      );

    case 'metric_counter':
      return (
        <div className={`${colSpanClass}`}>
          <MetricCounterWidget config={widget} dashboardId={dashboardId} />
        </div>
      );

    case 'cross_reference_summary':
      return (
        <div className={`${colSpanClass}`}>
          <CrossReferenceSummaryWidget config={widget} foodLogs={foodLogs} />
        </div>
      );

    case 'entity_log_list':
      return (
        <div className={`${colSpanClass}`}>
          <EntityLogListWidget
            config={widget}
            kernelEntities={kernelEntities}
            applyOperations={applyOperations}
            addToast={addToast}
          />
        </div>
      );

    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Widget Subcomponents
// ---------------------------------------------------------------------------

/**
 * 1. Temporal Recommendation Widget
 */
const TemporalRecommendationWidget: React.FC<{
  config: TemporalRecommendationConfig;
  kernelEntities: Record<string, KernelEntity>;
  applyOperations: (ops: Array<{ type: string; payload: Record<string, unknown> }>) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}> = ({ config, kernelEntities, applyOperations, addToast }) => {
  const recom = useMemo(() => {
    return computeTemporalRecommendation(kernelEntities, config);
  }, [kernelEntities, config]);

  const handleStartRecommendation = () => {
    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    applyOperations([
      {
        type: 'create_entity',
        payload: {
          id,
          title: `${recom.recommendedAction} Session`,
          schema_id: config.targetSchemaId,
          canonical_tags: [recom.recommendedAction.toLowerCase()],
          m: {
            [config.categoryField]: recom.recommendedAction,
            completed: false,
            logged_at: new Date().toISOString(),
          },
        },
      },
    ]);
    addToast(`Started ${recom.recommendedAction}`, 'success');
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/90 border border-indigo-500/20 p-5 shadow-xl relative overflow-hidden h-full flex flex-col justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400 uppercase tracking-wider">
          <TrendingUp className="w-4 h-4" />
          {config.title}
        </div>
        <h3 className="text-xl font-bold text-slate-100">{recom.headline}</h3>
        <p className="text-sm text-slate-300 leading-relaxed">{recom.description}</p>
        {recom.lastActivitySummary && (
          <div className="text-xs text-slate-400 pt-1">
            <span className="text-slate-500">Previous record:</span> {recom.lastActivitySummary}
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          Cycle: <strong className="text-slate-200">{config.splitCycle.join(' → ')}</strong>
        </span>
        <button
          type="button"
          onClick={handleStartRecommendation}
          className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
        >
          Begin {recom.recommendedAction}
        </button>
      </div>
    </div>
  );
};

/**
 * 2. Interactive Timer Widget
 */
const InteractiveTimerWidget: React.FC<{
  config: InteractiveTimerConfig;
  addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}> = ({ config, addToast }) => {
  const [seconds, setSeconds] = useState(config.defaultSeconds || 90);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      timerRef.current = window.setInterval(() => {
        setSeconds(prev => {
          if (prev <= 1) {
            setRunning(false);
            if (timerRef.current) clearInterval(timerRef.current);
            addToast(`${config.title} complete!`, 'info');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running, config.title, addToast]);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          <span>{config.title}</span>
          <Volume2 className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="text-center py-4">
          <div className="text-4xl font-extrabold font-mono tracking-tight text-slate-100">
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {running ? 'Running...' : seconds === 0 ? 'Completed' : 'Ready'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setRunning(!running)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
              running
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-indigo-600 text-white border-indigo-500'
            }`}
          >
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? 'Pause' : 'Start'}
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(false);
              setSeconds(config.defaultSeconds || 90);
            }}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
            title="Reset timer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {config.presetSeconds && config.presetSeconds.length > 0 && (
          <div className="flex gap-1 justify-center pt-1">
            {config.presetSeconds.map(sec => (
              <button
                key={sec}
                type="button"
                onClick={() => {
                  setRunning(false);
                  setSeconds(sec);
                }}
                className={`text-[11px] px-2 py-1 rounded-lg border transition ${
                  seconds === sec
                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 font-bold'
                    : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 3. Metric Counter Widget
 */
const MetricCounterWidget: React.FC<{
  config: MetricCounterConfig;
  dashboardId: string;
}> = ({ config, dashboardId }) => {
  const [counters, setCounters] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(`flowmate_widget_counters_${dashboardId}_${config.id}`);
      return saved ? (JSON.parse(saved) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });

  const stepCounter = (counterId: string, step: number, defaultVal: number) => {
    setCounters(prev => {
      const current = prev[counterId] !== undefined ? prev[counterId] : defaultVal;
      const next = Math.max(0, current + step);
      const updated = { ...prev, [counterId]: next };
      try {
        localStorage.setItem(`flowmate_widget_counters_${dashboardId}_${config.id}`, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-4 h-full">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{config.title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {config.counters.map(item => {
          const val = counters[item.id] !== undefined ? counters[item.id] : item.current;
          const pct = Math.min(100, Math.round((val / (item.target || 1)) * 100));
          return (
            <div key={item.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">{item.label}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {val} / {item.target} {item.unit}
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => stepCounter(item.id, -item.step, item.current)}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => stepCounter(item.id, item.step, item.current)}
                  className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 4. Cross Reference Summary Widget
 */
const CrossReferenceSummaryWidget: React.FC<{
  config: CrossReferenceSummaryConfig;
  foodLogs: Array<{ timestamp?: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number }>;
}> = ({ config, foodLogs }) => {
  const summary = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayLogs = foodLogs.filter(f => f.timestamp && f.timestamp.startsWith(todayStr));
    const totalCalories = todayLogs.reduce((acc, log) => acc + (log.calories || 0), 0);
    const totalProtein = todayLogs.reduce((acc, log) => acc + (log.protein_g || 0), 0);
    return { count: todayLogs.length, calories: totalCalories, protein: totalProtein };
  }, [foodLogs]);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-3 h-full">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{config.title}</div>
      <p className="text-xs text-slate-300">{config.label}</p>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="text-slate-400 text-xs">Today's Energy</div>
          <div className="text-xl font-bold text-slate-100">{summary.calories} kcal</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="text-slate-400 text-xs">Protein Logged</div>
          <div className="text-xl font-bold text-slate-100">{summary.protein} g</div>
        </div>
      </div>
    </div>
  );
};

/**
 * 5. Entity Log List Widget (Pure Schema-Bound Declarative Table)
 */
const EntityLogListWidget: React.FC<{
  config: EntityLogListConfig;
  kernelEntities: Record<string, KernelEntity>;
  applyOperations: (ops: Array<{ type: string; payload: Record<string, unknown> }>) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}> = ({ config, kernelEntities, applyOperations, addToast }) => {
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const matchingEntities = useMemo(() => {
    return Object.values(kernelEntities)
      .filter(e => e.schema_id === config.schemaId && e.lifecycle.deleted_at === null)
      .sort((a, b) => {
        const aT = Date.parse(String(a.attributes.logged_at || a.lifecycle.created_at)) || 0;
        const bT = Date.parse(String(b.attributes.logged_at || b.lifecycle.created_at)) || 0;
        return bT - aT;
      });
  }, [kernelEntities, config.schemaId]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const primaryKey = config.quickAddFields[0] || 'title';
    const primaryValue = (formValues[primaryKey] || '').trim();
    if (!primaryValue) {
      addToast(`Please enter a ${primaryKey}`, 'error');
      return;
    }

    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const attributesPayload: Record<string, unknown> = {
      ...formValues,
      completed: false,
      logged_at: new Date().toISOString(),
    };

    applyOperations([
      {
        type: 'create_entity',
        payload: {
          id,
          title: primaryValue,
          schema_id: config.schemaId,
          canonical_tags: [config.schemaId.split('/')[1] || 'item'],
          m: attributesPayload,
          attributes: attributesPayload,
        },
      },
    ]);

    addToast(`Added ${primaryValue}`, 'success');
    setFormValues({});
  };

  const handleToggleComplete = (entity: KernelEntity) => {
    const isCompleted = Boolean(entity.attributes.completed);
    applyOperations([
      {
        type: 'update_entity',
        payload: {
          id: entity.id,
          m: {
            ...entity.attributes,
            completed: !isCompleted,
          },
        },
      },
    ]);
  };

  const handleDelete = (entityId: string) => {
    applyOperations([
      {
        type: 'delete_entity',
        payload: { id: entityId },
      },
    ]);
    addToast('Entry removed', 'info');
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <span>{config.title}</span>
          <span className="text-xs font-mono text-slate-500">({matchingEntities.length})</span>
        </h3>
      </div>

      {/* Quick Add Form */}
      <form onSubmit={handleQuickAdd} className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
        {config.quickAddFields.map(field => (
          <input
            key={field}
            type="text"
            placeholder={field.replace('_', ' ').toUpperCase()}
            value={formValues[field] || ''}
            onChange={e => setFormValues({ ...formValues, [field]: e.target.value })}
            className="flex-1 min-w-[130px] bg-slate-900 border border-slate-700/80 text-slate-200 text-xs rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500"
          />
        ))}
        <button
          type="submit"
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition"
        >
          <Plus size={14} /> Add
        </button>
      </form>

      {/* Dynamic Data Table */}
      {matchingEntities.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
          No records logged yet. Add your first entry above!
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="text-[10px] uppercase font-semibold text-slate-500 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Status</th>
                {config.columns.map(col => (
                  <th key={col.key} className="py-2.5 px-3">
                    {col.label}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {matchingEntities.map(entity => {
                const isCompleted = Boolean(entity.attributes.completed);
                return (
                  <tr key={entity.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleToggleComplete(entity)}
                        className="text-slate-500 hover:text-indigo-400 transition"
                      >
                        {isCompleted ? (
                          <CheckCircle2 size={16} className="text-emerald-400" />
                        ) : (
                          <Circle size={16} />
                        )}
                      </button>
                    </td>
                    {config.columns.map(col => {
                      const val = entity.attributes[col.key] !== undefined ? entity.attributes[col.key] : entity.title;
                      if (col.type === 'badge') {
                        return (
                          <td key={col.key} className="py-2.5 px-3">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                              {String(val || '')}
                            </span>
                          </td>
                        );
                      }
                      if (col.type === 'boolean') {
                        return (
                          <td key={col.key} className="py-2.5 px-3">
                            <span className={val ? 'text-emerald-400' : 'text-slate-500'}>
                              {val ? 'Done' : 'Pending'}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className={`py-2.5 px-3 ${isCompleted ? 'line-through text-slate-500' : ''}`}>
                          {String(val || '')}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(entity.id)}
                        className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-rose-400 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
