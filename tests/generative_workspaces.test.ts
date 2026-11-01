import { describe, expect, it, beforeEach } from 'vitest';
import { dynamicSchemaRegistry, GYM_LOG_SCHEMA, WORKOUT_ROUTINE_SCHEMA } from '../services/kernel/dynamicSchemaRegistry';
import { SchemaDefinition, KernelEntity } from '../services/kernel/types';
import {
  createCanonicalGymDashboardManifest,
  generativeWorkspaceManager,
  CANONICAL_GYM_DASHBOARD_ID,
} from '../services/workspaces/workspaceManager';
import { computeTemporalRecommendation } from '../services/workspaces/temporalRecommendationEngine';
import { TemporalRecommendationConfig } from '../services/workspaces/generativeDashboardTypes';

describe('Generative Workspaces Framework', () => {
  describe('Dynamic Schema Registry', () => {
    it('registers and retrieves custom user schemas', () => {
      const customStudySchema: SchemaDefinition = {
        id: 'user/study_session',
        version: 1,
        displayName: 'Study Session',
        description: 'Deep focus study block with topic and pomodoro count',
        scope: 'user',
        privacy_tier: 'private',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        capabilities: ['trackable_progress'],
        attributes: {
          topic: {
            name: 'topic',
            type: 'string',
            label: 'Topic',
            description: 'Subject or chapter being studied',
            required: true,
          },
          pomodoro_count: {
            name: 'pomodoro_count',
            type: 'number',
            label: 'Pomodoros',
            description: 'Number of 25m intervals finished',
            required: true,
            default_value: 2,
          },
        },
      };

      dynamicSchemaRegistry.register(customStudySchema);

      expect(dynamicSchemaRegistry.has('user/study_session')).toBe(true);
      const retrieved = dynamicSchemaRegistry.get('user/study_session');
      expect(retrieved).toBeDefined();
      expect(retrieved?.displayName).toBe('Study Session');
      expect(retrieved?.attributes.topic.type).toBe('string');
    });

    it('rejects dynamic schemas outside user/ or custom/ namespaces', () => {
      const invalidSchema: SchemaDefinition = {
        id: 'system/illegal_override',
        version: 1,
        displayName: 'Illegal',
        description: 'Should fail',
        scope: 'system',
        privacy_tier: 'private',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        capabilities: [],
        attributes: {
          foo: { name: 'foo', type: 'string', label: 'Foo', description: 'Foo', required: true },
        },
      };

      expect(() => dynamicSchemaRegistry.register(invalidSchema)).toThrow(
        /Dynamic schema must start with 'user\/' or 'custom\/'/
      );
    });

    it('has canonical gym schemas registered by default', () => {
      expect(dynamicSchemaRegistry.has('user/gym_log')).toBe(true);
      expect(dynamicSchemaRegistry.has('user/workout_routine')).toBe(true);

      const gymLog = dynamicSchemaRegistry.get('user/gym_log');
      expect(gymLog?.attributes.exercise_name).toBeDefined();
      expect(gymLog?.attributes.sets.type).toBe('number');
      expect(gymLog?.attributes.weight_kg.type).toBe('number');
    });
  });

  describe('Generative Dashboard Manifests', () => {
    it('creates and lists canonical Gym Performance Tracker manifest', () => {
      const manifest = createCanonicalGymDashboardManifest();
      expect(manifest.id).toBe(CANONICAL_GYM_DASHBOARD_ID);
      expect(manifest.category).toBe('fitness');
      expect(manifest.widgets.length).toBeGreaterThanOrEqual(5);

      const timerWidget = manifest.widgets.find(w => w.type === 'interactive_timer');
      expect(timerWidget).toBeDefined();

      const metricWidget = manifest.widgets.find(w => w.type === 'metric_counter');
      expect(metricWidget).toBeDefined();

      const recomWidget = manifest.widgets.find(w => w.type === 'temporal_recommendation');
      expect(recomWidget).toBeDefined();
    });

    it('manages multiple generative workspaces in manager', () => {
      const manager = generativeWorkspaceManager;
      const initialDashboards = manager.listDashboards();
      expect(initialDashboards.some(d => d.id === CANONICAL_GYM_DASHBOARD_ID)).toBe(true);

      const customManifest = {
        ...createCanonicalGymDashboardManifest(),
        id: 'custom-reading-tracker',
        title: 'Daily Reading & Synthesis',
        category: 'education' as const,
      };

      manager.registerDashboard(customManifest);
      expect(manager.getDashboard('custom-reading-tracker')?.title).toBe('Daily Reading & Synthesis');
    });
  });

  describe('Temporal Recommendation Engine', () => {
    const config: TemporalRecommendationConfig = {
      id: 'test-temporal',
      type: 'temporal_recommendation',
      title: 'Split Recommendation',
      targetSchemaId: 'user/gym_log',
      categoryField: 'target_muscle_group',
      splitCycle: ['Push', 'Pull', 'Legs'],
      defaultSplit: 'Push',
      recommendationRationale: 'Calculates next muscle split based on previous workout history.',
    };

    it('returns default split when no entities exist', () => {
      const result = computeTemporalRecommendation({}, config);
      expect(result.recommendedAction).toBe('Push');
      expect(result.headline).toContain('Push');
      expect(result.daysSinceLastSession).toBe(-1);
    });

    it('recommends Pull when the last session yesterday was Push', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const entities: Record<string, KernelEntity> = {
        'log-1': {
          id: 'log-1',
          schema_id: 'user/gym_log',
          version: 1,
          title: 'Barbell Bench Press',
          lifecycle: { status: 'completed', created_at: yesterday, updated_at: yesterday, deleted_at: null },
          provenance: { source_type: 'user', observed_at: yesterday, confidence: 1, is_inferred: false, user_confirmed: true },
          attributes: {
            exercise_name: 'Barbell Bench Press',
            target_muscle_group: 'Push',
            sets: 4,
            reps: 8,
            weight_kg: 80,
            logged_at: yesterday,
          },
        },
      };

      const result = computeTemporalRecommendation(entities, config);
      expect(result.recommendedAction).toBe('Pull');
      expect(result.headline).toBe('Recommended Today: Pull');
      expect(result.suggestedExercises[0]).toContain('Deadlift');
    });

    it('recommends Legs when the last session yesterday was Pull', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const entities: Record<string, KernelEntity> = {
        'log-pull': {
          id: 'log-pull',
          schema_id: 'user/gym_log',
          version: 1,
          title: 'Lat Pulldown',
          lifecycle: { status: 'completed', created_at: yesterday, updated_at: yesterday, deleted_at: null },
          provenance: { source_type: 'user', observed_at: yesterday, confidence: 1, is_inferred: false, user_confirmed: true },
          attributes: {
            exercise_name: 'Lat Pulldown',
            target_muscle_group: 'Pull',
            sets: 3,
            reps: 12,
            weight_kg: 65,
            logged_at: yesterday,
          },
        },
      };

      const result = computeTemporalRecommendation(entities, config);
      expect(result.recommendedAction).toBe('Legs');
      expect(result.headline).toBe('Recommended Today: Legs');
      expect(result.suggestedExercises[0]).toContain('Squat');
    });

    it('recommends recovery when a workout was already logged today', () => {
      const today = new Date().toISOString();
      const entities: Record<string, KernelEntity> = {
        'log-today': {
          id: 'log-today',
          schema_id: 'user/gym_log',
          version: 1,
          title: 'Barbell Squat',
          lifecycle: { status: 'completed', created_at: today, updated_at: today, deleted_at: null },
          provenance: { source_type: 'user', observed_at: today, confidence: 1, is_inferred: false, user_confirmed: true },
          attributes: {
            exercise_name: 'Barbell Squat',
            target_muscle_group: 'Legs',
            sets: 4,
            reps: 10,
            weight_kg: 100,
            logged_at: today,
          },
        },
      };

      const result = computeTemporalRecommendation(entities, config);
      expect(result.recommendedAction).toBe('Recovery / Hydration');
      expect(result.headline).toContain('Completed Legs today!');
    });
  });
});
