/**
 * Flowmate Greenfield Domain Kernel — Generative Dashboard Contracts
 * STRICT INVARIANT: ZERO `any`
 */

import { SchemaDefinition } from '../kernel/types';

export type WidgetType =
  | 'temporal_recommendation'
  | 'entity_log_list'
  | 'interactive_timer'
  | 'metric_counter'
  | 'cross_reference_summary'
  | 'quick_stat_grid'
  | 'pipeline_stage_board'
  | 'calculation_summary';

export interface BaseWidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  gridSpan?: 1 | 2 | 3 | 4; // Visual span in grid layout
}

export interface TemporalRecommendationConfig extends BaseWidgetConfig {
  type: 'temporal_recommendation';
  targetSchemaId: string; // e.g. 'user/gym_log'
  categoryField: string; // e.g. 'target_muscle_group'
  splitCycle: string[]; // e.g. ['Push', 'Pull', 'Legs', 'Rest']
  defaultSplit: string; // e.g. 'Push'
  recommendationRationale: string;
}

export interface EntityLogListConfig extends BaseWidgetConfig {
  type: 'entity_log_list';
  schemaId: string; // e.g. 'user/gym_log'
  columns: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'badge';
    editable?: boolean;
    defaultValue?: string | number | boolean;
  }>;
  quickAddFields: string[]; // Fields shown in quick add row
  allowVoiceInput?: boolean;
}

export interface InteractiveTimerConfig extends BaseWidgetConfig {
  type: 'interactive_timer';
  defaultSeconds: number; // e.g. 90
  presetSeconds: number[]; // e.g. [30, 60, 90, 120, 180]
  autoStartOnLog?: boolean;
  alertSound?: boolean;
}

export interface MetricCounterItem {
  id: string;
  label: string;
  unit: string;
  current: number;
  target: number;
  step: number;
  color?: string; // Tailwind color token or hex
}

export interface MetricCounterConfig extends BaseWidgetConfig {
  type: 'metric_counter';
  counters: MetricCounterItem[];
}

export interface CrossReferenceSummaryConfig extends BaseWidgetConfig {
  type: 'cross_reference_summary';
  sourceDomain: 'food_logs' | 'calendar' | 'tasks' | 'habits';
  metricKeys: string[];
  label: string;
}

export interface QuickStatGridConfig extends BaseWidgetConfig {
  type: 'quick_stat_grid';
  stats: Array<{
    label: string;
    valueExpression: string; // e.g. 'total_sets_this_week', 'current_streak'
    icon?: string;
  }>;
}

export interface PipelineStageBoardConfig extends BaseWidgetConfig {
  type: 'pipeline_stage_board';
  schemaId: string;
  stageField: string;
  stages: Array<{
    id: string;
    label: string;
    color?: 'sky' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'slate';
  }>;
  cardFields: {
    titleField: string;
    subtitleField?: string;
    badgeField?: string;
    metaField?: string;
  };
}

export interface CalculationSummaryConfig extends BaseWidgetConfig {
  type: 'calculation_summary';
  schemaId: string;
  calculations: Array<{
    id: string;
    label: string;
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    targetField?: string;
    unit?: string;
    prefix?: string;
  }>;
}

export type DashboardWidgetConfig =
  | TemporalRecommendationConfig
  | EntityLogListConfig
  | InteractiveTimerConfig
  | MetricCounterConfig
  | CrossReferenceSummaryConfig
  | QuickStatGridConfig
  | PipelineStageBoardConfig
  | CalculationSummaryConfig;

export interface DashboardManifest {
  id: string;
  title: string;
  description: string;
  category: 'fitness' | 'productivity' | 'wellness' | 'education' | 'finance' | 'custom';
  icon: string; // e.g. 'dumbbell', 'flame', 'sparkles', 'brain', 'target'
  associatedSchemas: SchemaDefinition[];
  widgets: DashboardWidgetConfig[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TemporalRecommendationResult {
  recommendedAction: string;
  headline: string;
  description: string;
  lastActivityDate: string | null;
  lastActivitySummary: string | null;
  suggestedExercises: string[];
  daysSinceLastSession: number;
}
