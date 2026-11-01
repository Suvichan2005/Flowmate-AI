import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { DashboardManifest, MetricCounterItem } from '../services/workspaces/generativeDashboardTypes';
import { computeTemporalRecommendation } from '../services/workspaces/temporalRecommendationEngine';
import { generativeWorkspaceManager, CANONICAL_GYM_DASHBOARD_ID } from '../services/workspaces/workspaceManager';
import { KernelEntity } from '../services/kernel/types';
import { Dumbbell, Plus, Trash2, CheckCircle2, Circle, Play, Pause, RotateCcw, Volume2, Mic, Sparkles, TrendingUp, Droplets, Utensils } from 'lucide-react';

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

  const [activeDashboard, setActiveDashboard] = useState<DashboardManifest>(() => {
    return generativeWorkspaceManager.getDashboard(dashboardId) || generativeWorkspaceManager.listDashboards()[0];
  });

  // Local state for Metric Counters
  const [metricCounters, setMetricCounters] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(`flowmate:gen_dash:metrics:${activeDashboard.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const updateMetric = (metricId: string, delta: number, defaultVal: number) => {
    setMetricCounters(prev => {
      const current = prev[metricId] !== undefined ? prev[metricId] : defaultVal;
      const next = Math.max(0, current + delta);
      const updated = { ...prev, [metricId]: next };
      try {
        localStorage.setItem(`flowmate:gen_dash:metrics:${activeDashboard.id}`, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Rest Timer State
  const [timerSeconds, setTimerSeconds] = useState(90);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRunning) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds(prev => {
          if (prev <= 1) {
            setTimerRunning(false);
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            addToast('Rest timer complete! Ready for next set.', 'info');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerRunning, addToast]);

  const startTimer = (seconds?: number) => {
    if (seconds !== undefined) setTimerSeconds(seconds);
    setTimerRunning(true);
  };

  const pauseTimer = () => setTimerRunning(false);
  const resetTimer = (seconds = 90) => {
    setTimerRunning(false);
    setTimerSeconds(seconds);
  };

  // Quick Add Exercise Form State
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newMuscleGroup, setNewMuscleGroup] = useState('Push');
  const [newSets, setNewSets] = useState(3);
  const [newReps, setNewReps] = useState(10);
  const [newWeight, setNewWeight] = useState(60);
  const [isDictating, setIsDictating] = useState(false);

  // Compute Temporal Recommendation
  const temporalRecommendation = useMemo(() => {
    const recomWidget = activeDashboard.widgets.find(w => w.type === 'temporal_recommendation');
    if (!recomWidget || recomWidget.type !== 'temporal_recommendation') return null;
    return computeTemporalRecommendation(kernelEntities, recomWidget);
  }, [activeDashboard, kernelEntities]);

  // Logged Exercises matching target schema
  const loggedExercises = useMemo(() => {
    return Object.values(kernelEntities)
      .filter(e => e.schema_id === 'user/gym_log' && e.lifecycle.deleted_at === null)
      .sort((a, b) => {
        const aT = Date.parse(String(a.attributes.logged_at || a.lifecycle.created_at)) || 0;
        const bT = Date.parse(String(b.attributes.logged_at || b.lifecycle.created_at)) || 0;
        return bT - aT;
      });
  }, [kernelEntities]);

  // Cross reference Nutrition summary from foodLogs
  const todayFoodNutrition = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayLogs = foodLogs.filter(f => f.timestamp && f.timestamp.startsWith(todayStr));
    const totalCalories = todayLogs.reduce((acc, log) => acc + (log.calories || 0), 0);
    const totalProtein = todayLogs.reduce((acc, log) => acc + (log.protein_g || 0), 0);
    return { count: todayLogs.length, calories: totalCalories, protein: totalProtein };
  }, [foodLogs]);

  // Add Exercise Handler
  const handleAddExercise = (exerciseName?: string, muscleGroup?: string) => {
    const name = (exerciseName || newExerciseName).trim();
    if (!name) {
      addToast('Please enter an exercise name', 'error');
      return;
    }
    const group = muscleGroup || newMuscleGroup;
    const entityId = `gym_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: entityId,
          title: name,
          schema_id: 'user/gym_log',
          canonical_tags: ['gym', group.toLowerCase()],
          m: {
            exercise_name: name,
            target_muscle_group: group,
            sets: Number(newSets) || 3,
            reps: Number(newReps) || 10,
            weight_kg: Number(newWeight) || 0,
            rpe: 8,
            completed: true,
            logged_at: new Date().toISOString(),
          },
        },
      },
    ]);

    addToast(`Logged ${name} (${group})`, 'success');
    setNewExerciseName('');

    // Auto-start rest timer
    const timerWidget = activeDashboard.widgets.find(w => w.type === 'interactive_timer');
    if (timerWidget && timerWidget.type === 'interactive_timer' && timerWidget.autoStartOnLog) {
      startTimer(timerWidget.defaultSeconds || 90);
    }
  };

  // Toggle Exercise Completed
  const handleToggleCompleted = (entity: KernelEntity) => {
    const currentCompleted = Boolean(entity.attributes.completed);
    applyOperations([
      {
        type: 'update_entity',
        payload: {
          id: entity.id,
          m: {
            ...entity.attributes,
            completed: !currentCompleted,
          },
        },
      },
    ]);
  };

  // Delete Logged Exercise
  const handleDeleteExercise = (entityId: string) => {
    applyOperations([
      {
        type: 'delete_entity',
        payload: { id: entityId },
      },
    ]);
    addToast('Exercise log removed', 'info');
  };

  // Voice Dictation Simulation / Web Speech API
  const handleVoiceInput = () => {
    const windowWithSpeech = window as unknown as {
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        onresult: (e: { results: Array<Array<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
    };

    if (windowWithSpeech.webkitSpeechRecognition) {
      const recognition = new windowWithSpeech.webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      setIsDictating(true);
      recognition.onresult = event => {
        const transcript = event.results[0]?.[0]?.transcript || '';
        if (transcript) {
          setNewExerciseName(transcript);
          addToast(`Voice recognized: "${transcript}"`, 'info');
        }
        setIsDictating(false);
      };
      recognition.onerror = () => setIsDictating(false);
      recognition.onend = () => setIsDictating(false);
      recognition.start();
    } else {
      // Fallback
      const sample = 'Incline Dumbbell Press';
      setNewExerciseName(sample);
      addToast(`Mic unavailable in this browser. Filled: "${sample}"`, 'info');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Workspace Identity */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Dumbbell className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{activeDashboard.title}</h1>
            <span className="text-xs uppercase font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-emerald-500/30">
              Generative Workspace
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{activeDashboard.description}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleAddExercise('Quick 3x10 Pushups', 'Push')}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Quick Calisthenics
          </button>
        </div>
      </div>

      {/* Main Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* 1. Temporal Recommendation Widget (Span 3) */}
        {temporalRecommendation && (
          <div className="md:col-span-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/90 border border-emerald-500/20 p-5 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -z-0 pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                  <TrendingUp className="w-4 h-4" />
                  Temporal AI Recommendation
                </div>
                <h3 className="text-xl font-bold text-slate-100">{temporalRecommendation.headline}</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{temporalRecommendation.description}</p>

                {temporalRecommendation.lastActivitySummary && (
                  <div className="text-xs text-slate-400 pt-1">
                    <span className="text-slate-500">Previous record:</span> {temporalRecommendation.lastActivitySummary}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const firstExercise = temporalRecommendation.suggestedExercises[0] || 'Bench Press';
                    const cleanName = firstExercise.split('(')[0].trim();
                    handleAddExercise(cleanName, temporalRecommendation.recommendedAction);
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition shadow-sm shadow-emerald-500/20"
                >
                  Start {temporalRecommendation.recommendedAction}
                </button>
              </div>
            </div>

            {/* Suggested Split Exercises */}
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <p className="text-xs font-medium text-slate-400 mb-2">Suggested routine for this session:</p>
              <div className="flex flex-wrap gap-2">
                {temporalRecommendation.suggestedExercises.map((ex, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const cleanName = ex.split('(')[0].trim();
                      setNewExerciseName(cleanName);
                      setNewMuscleGroup(temporalRecommendation.recommendedAction);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition text-left"
                  >
                    + {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 2. Interactive Rest Timer Widget (Span 1) */}
        <div className="md:col-span-1 rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              <span>Rest Timer</span>
              <Volume2 className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="text-center py-4">
              <div className="text-4xl font-extrabold font-mono tracking-tight text-slate-100">
                {String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:
                {String(timerSeconds % 60).padStart(2, '0')}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {timerRunning ? 'Timer active' : timerSeconds === 0 ? 'Rest complete!' : 'Paused'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              {timerRunning ? (
                <button
                  type="button"
                  onClick={pauseTimer}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/30 transition"
                >
                  <Pause className="w-3.5 h-3.5" /> Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startTimer()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/30 transition"
                >
                  <Play className="w-3.5 h-3.5" /> Start
                </button>
              )}
              <button
                type="button"
                onClick={() => resetTimer(90)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
                title="Reset timer to 90s"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1 pt-1">
              {[30, 60, 90, 120].map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => resetTimer(sec)}
                  className={`text-[11px] py-1 rounded-lg border transition ${
                    timerSeconds === sec
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-bold'
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Metric Counter Widgets (Water & Protein) (Span 2) */}
        <div className="md:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Droplets className="w-4 h-4 text-sky-400" />
              Fitness Fuel &amp; Hydration
            </h3>
            <span className="text-xs text-slate-400">Daily Target</span>
          </div>

          <div className="space-y-4">
            {/* Water Counter */}
            <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-300">Water Intake</div>
                <div className="text-lg font-bold text-sky-400">
                  {metricCounters['metric-water'] !== undefined ? metricCounters['metric-water'] : 5} / 8{' '}
                  <span className="text-xs font-normal text-slate-400">glasses</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateMetric('metric-water', -1, 5)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-base flex items-center justify-center border border-slate-700"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => updateMetric('metric-water', 1, 5)}
                  className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-base flex items-center justify-center shadow-sm shadow-sky-500/20"
                >
                  +
                </button>
              </div>
            </div>

            {/* Protein Counter */}
            <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-300">Protein Target</div>
                <div className="text-lg font-bold text-emerald-400">
                  {metricCounters['metric-protein'] !== undefined ? metricCounters['metric-protein'] : 120} / 160{' '}
                  <span className="text-xs font-normal text-slate-400">g</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateMetric('metric-protein', -10, 120)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-base flex items-center justify-center border border-slate-700"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => updateMetric('metric-protein', 10, 120)}
                  className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base flex items-center justify-center shadow-sm shadow-emerald-500/20"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Cross-Reference Summary from Food Log (Span 2) */}
        <div className="md:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-amber-400" />
                Flowmate Nutrition Cross-Reference
              </h3>
              <span className="text-xs text-slate-400">Live Linked</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Aggregated from your Flowmate Food Logs for today
            </p>

            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-750">
                <div className="text-lg font-bold text-slate-100">{todayFoodNutrition.count}</div>
                <div className="text-[11px] text-slate-400">Meals Logged</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-750">
                <div className="text-lg font-bold text-amber-400">{todayFoodNutrition.calories}</div>
                <div className="text-[11px] text-slate-400">Est. Calories</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-750">
                <div className="text-lg font-bold text-emerald-400">{todayFoodNutrition.protein}g</div>
                <div className="text-[11px] text-slate-400">Logged Protein</div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-500">
            {todayFoodNutrition.count > 0
              ? 'Your workout energy and protein intake are synced with your daily diet.'
              : 'No meals logged yet today in Food Log. Eat clean and hit your macros!'}
          </div>
        </div>

        {/* 5. Active Exercise Log Table & Quick Add Form (Span 4) */}
        <div className="md:col-span-4 rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Dumbbell className="w-5 h-5 text-emerald-400" />
                Exercise Log &amp; Performance Sets
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Durable kernel entity storage with cross-device live sync
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVoiceInput}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  isDictating
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                {isDictating ? 'Listening...' : 'Dictate Exercise'}
              </button>
            </div>
          </div>

          {/* Quick Add Row */}
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 p-3 rounded-xl bg-slate-800/60 border border-slate-750">
            <div className="sm:col-span-2">
              <input
                type="text"
                placeholder="Exercise (e.g. Barbell Squat)"
                value={newExerciseName}
                onChange={e => setNewExerciseName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddExercise()}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <select
                value={newMuscleGroup}
                onChange={e => setNewMuscleGroup(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="Push">Push (Chest/Shoulders/Tri)</option>
                <option value="Pull">Pull (Back/Biceps)</option>
                <option value="Legs">Legs (Quads/Hams/Calves)</option>
                <option value="Core">Core / Abs</option>
                <option value="Cardio">Cardio / Endurance</option>
              </select>
            </div>
            <div>
              <input
                type="number"
                placeholder="Sets"
                value={newSets}
                onChange={e => setNewSets(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 text-center"
              />
            </div>
            <div>
              <input
                type="number"
                placeholder="Reps"
                value={newReps}
                onChange={e => setNewReps(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 text-center"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Weight (kg)"
                value={newWeight}
                onChange={e => setNewWeight(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 text-center"
              />
              <button
                type="button"
                onClick={() => handleAddExercise()}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center shrink-0 transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Table of Logged Exercises */}
          <div className="overflow-x-auto">
            {loggedExercises.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No exercises logged yet. Choose an exercise above or start the recommended workout!
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Done</th>
                    <th className="py-2.5 px-3">Exercise</th>
                    <th className="py-2.5 px-3">Split</th>
                    <th className="py-2.5 px-3 text-center">Sets</th>
                    <th className="py-2.5 px-3 text-center">Reps</th>
                    <th className="py-2.5 px-3 text-center">Weight</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {loggedExercises.map(ex => {
                    const completed = Boolean(ex.attributes.completed);
                    return (
                      <tr key={ex.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => handleToggleCompleted(ex)}
                            className="text-slate-400 hover:text-emerald-400 transition"
                          >
                            {completed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Circle className="w-4 h-4 text-slate-500" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-100">
                          {String(ex.attributes.exercise_name || ex.title)}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {String(ex.attributes.target_muscle_group || 'Split')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono">
                          {String(ex.attributes.sets || 3)}
                        </td>
                        <td className="py-2 px-3 text-center font-mono">
                          {String(ex.attributes.reps || 10)}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-200">
                          {String(ex.attributes.weight_kg || 0)} kg
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteExercise(ex.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 transition"
                            title="Delete log"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
