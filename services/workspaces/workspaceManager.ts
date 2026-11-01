/**
 * Flowmate Greenfield Domain Kernel — Generative Workspace Manager
 * STRICT INVARIANT: ZERO `any`
 */

import { DashboardManifest } from './generativeDashboardTypes';
import { dynamicSchemaRegistry, GYM_LOG_SCHEMA, WORKOUT_ROUTINE_SCHEMA } from '../kernel/dynamicSchemaRegistry';

export const CANONICAL_GYM_DASHBOARD_ID = 'dash-gym-performance-tracker';

/**
 * Creates the canonical Gym Tracker dashboard manifest demonstrating
 * the power of Flowmate's Generative Workspaces Framework.
 */
export function createCanonicalGymDashboardManifest(): DashboardManifest {
  return {
    id: CANONICAL_GYM_DASHBOARD_ID,
    title: 'Performance & Gym Tracker',
    description: 'Dynamic strength training tracker with intelligent split planning, rest timer, and macro cross-references',
    category: 'fitness',
    icon: 'dumbbell',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    associatedSchemas: [GYM_LOG_SCHEMA, WORKOUT_ROUTINE_SCHEMA],
    widgets: [
      {
        id: 'widget-gym-temporal-recom',
        type: 'temporal_recommendation',
        title: 'Intelligent Workout Plan',
        gridSpan: 3,
        targetSchemaId: 'user/gym_log',
        categoryField: 'target_muscle_group',
        splitCycle: ['Push', 'Pull', 'Legs'],
        defaultSplit: 'Push',
        recommendationRationale: 'Automatically calculates next muscle split based on previous workout history and recovery time.',
      },
      {
        id: 'widget-gym-rest-timer',
        type: 'interactive_timer',
        title: 'Rest Timer',
        gridSpan: 1,
        defaultSeconds: 90,
        presetSeconds: [30, 60, 90, 120, 180],
        autoStartOnLog: true,
        alertSound: true,
      },
      {
        id: 'widget-gym-daily-metrics',
        type: 'metric_counter',
        title: 'Daily Fitness Fuel & Hydration',
        gridSpan: 2,
        counters: [
          {
            id: 'metric-water',
            label: 'Water Intake',
            unit: 'glasses',
            current: 5,
            target: 8,
            step: 1,
            color: 'emerald',
          },
          {
            id: 'metric-protein',
            label: 'Protein Target',
            unit: 'g',
            current: 120,
            target: 160,
            step: 10,
            color: 'sky',
          },
          {
            id: 'metric-creatine',
            label: 'Creatine',
            unit: 'g',
            current: 5,
            target: 5,
            step: 5,
            color: 'indigo',
          },
        ],
      },
      {
        id: 'widget-gym-cross-ref',
        type: 'cross_reference_summary',
        title: 'Nutrition & Daily Fuel Summary',
        gridSpan: 2,
        sourceDomain: 'food_logs',
        metricKeys: ['calories', 'protein'],
        label: "Today's Nutrition Breakdown from Flowmate Food Log",
      },
      {
        id: 'widget-gym-exercise-log',
        type: 'entity_log_list',
        title: 'Active Exercise Sets & Workout Log',
        gridSpan: 4,
        schemaId: 'user/gym_log',
        allowVoiceInput: true,
        quickAddFields: ['exercise_name', 'target_muscle_group', 'sets', 'reps', 'weight_kg'],
        columns: [
          { key: 'exercise_name', label: 'Exercise', type: 'string', editable: true },
          { key: 'target_muscle_group', label: 'Muscle Group', type: 'badge' },
          { key: 'sets', label: 'Sets', type: 'number', editable: true, defaultValue: 3 },
          { key: 'reps', label: 'Reps', type: 'number', editable: true, defaultValue: 10 },
          { key: 'weight_kg', label: 'Weight (kg)', type: 'number', editable: true, defaultValue: 60 },
          { key: 'rpe', label: 'RPE', type: 'number', editable: true, defaultValue: 8 },
          { key: 'completed', label: 'Status', type: 'boolean', editable: true, defaultValue: true },
        ],
      },
    ],
  };
}

export class GenerativeWorkspaceManager {
  private dashboards = new Map<string, DashboardManifest>();

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    // Register canonical gym schemas
    if (!dynamicSchemaRegistry.has(GYM_LOG_SCHEMA.id)) {
      dynamicSchemaRegistry.register(GYM_LOG_SCHEMA);
    }
    if (!dynamicSchemaRegistry.has(WORKOUT_ROUTINE_SCHEMA.id)) {
      dynamicSchemaRegistry.register(WORKOUT_ROUTINE_SCHEMA);
    }
    // Register default gym dashboard
    const gymManifest = createCanonicalGymDashboardManifest();
    this.dashboards.set(gymManifest.id, gymManifest);
  }

  registerDashboard(manifest: DashboardManifest): void {
    // Register any dynamic schemas associated with this manifest
    for (const schema of manifest.associatedSchemas) {
      if (!dynamicSchemaRegistry.has(schema.id)) {
        dynamicSchemaRegistry.register(schema);
      }
    }
    this.dashboards.set(manifest.id, structuredClone(manifest));
  }

  getDashboard(id: string): DashboardManifest | undefined {
    return this.dashboards.get(id);
  }

  listDashboards(): DashboardManifest[] {
    return Array.from(this.dashboards.values()).map(d => structuredClone(d));
  }
}

export const generativeWorkspaceManager = new GenerativeWorkspaceManager();
