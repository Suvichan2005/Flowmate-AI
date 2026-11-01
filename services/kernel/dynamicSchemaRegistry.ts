/**
 * Flowmate Greenfield Domain Kernel — Dynamic Schema Registry
 * STRICT INVARIANT: ZERO `any`
 */

import { SchemaDefinition } from './types';
import { SchemaRegistry } from './schemaRegistry';

export class DynamicSchemaRegistry {
  private customSchemas = new Map<string, SchemaDefinition>();
  private globalRegistry: SchemaRegistry | null = null;

  constructor(globalRegistry?: SchemaRegistry) {
    if (globalRegistry) {
      this.globalRegistry = globalRegistry;
    }
  }

  setGlobalRegistry(registry: SchemaRegistry): void {
    this.globalRegistry = registry;
    // Register any already-defined custom schemas into the newly set global registry
    for (const schema of this.customSchemas.values()) {
      if (!registry.get(schema.id)) {
        registry.register(schema);
      }
    }
  }

  /**
   * Registers a dynamically created schema definition into both the local custom map
   * and the authoritative domain kernel SchemaRegistry.
   */
  register(schema: SchemaDefinition): void {
    if (!schema.id.startsWith('user/') && !schema.id.startsWith('custom/')) {
      throw new Error(`Dynamic schema must start with 'user/' or 'custom/'. Got: "${schema.id}"`);
    }

    // Register into domain kernel registry if available
    if (this.globalRegistry && !this.globalRegistry.get(schema.id)) {
      this.globalRegistry.register(schema);
    }

    // Deep copy into custom schemas map
    this.customSchemas.set(schema.id, structuredClone(schema));
  }

  get(id: string): SchemaDefinition | undefined {
    return this.customSchemas.get(id) || this.globalRegistry?.get(id);
  }

  listCustom(): SchemaDefinition[] {
    return Array.from(this.customSchemas.values()).map(s => structuredClone(s));
  }

  has(id: string): boolean {
    return this.customSchemas.has(id) || !!this.globalRegistry?.get(id);
  }

  /**
   * Loads serialized dynamic schemas (e.g. from local storage or cloud sync).
   */
  loadPersistedSchemas(schemas: SchemaDefinition[]): void {
    for (const schema of schemas) {
      if (!this.has(schema.id)) {
        this.register(schema);
      }
    }
  }
}

export const dynamicSchemaRegistry = new DynamicSchemaRegistry();

// ============================================================================
// Canonical Dynamic Schema Templates (e.g. Gym Tracker)
// ============================================================================

export const GYM_LOG_SCHEMA: SchemaDefinition = {
  id: 'user/gym_log',
  version: 1,
  displayName: 'Gym Exercise Log',
  description: 'Individual exercise sets, reps, weight, RPE, and completion status',
  scope: 'user',
  privacy_tier: 'private',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  capabilities: ['trackable_progress', 'evaluable_state'],
  attributes: {
    exercise_name: {
      name: 'exercise_name',
      type: 'string',
      label: 'Exercise Name',
      description: 'Name of the exercise (e.g. Bench Press, Squat, Barbell Row)',
      required: true,
    },
    target_muscle_group: {
      name: 'target_muscle_group',
      type: 'string',
      label: 'Muscle Group',
      description: 'Target muscle group (e.g. Chest, Back, Legs, Shoulders, Arms, Core)',
      required: true,
    },
    sets: {
      name: 'sets',
      type: 'number',
      label: 'Sets',
      description: 'Number of sets completed',
      required: true,
      default_value: 3,
      constraints: { min: 1, max: 20 },
    },
    reps: {
      name: 'reps',
      type: 'number',
      label: 'Reps per Set',
      description: 'Number of repetitions per set',
      required: true,
      default_value: 10,
      constraints: { min: 1, max: 100 },
    },
    weight_kg: {
      name: 'weight_kg',
      type: 'number',
      label: 'Weight (kg)',
      description: 'Weight lifted in kilograms',
      required: false,
      default_value: 0,
      constraints: { min: 0, max: 500 },
    },
    rpe: {
      name: 'rpe',
      type: 'number',
      label: 'RPE (Rate of Perceived Exertion)',
      description: 'Scale 1-10 exertion score',
      required: false,
      default_value: 8,
      constraints: { min: 1, max: 10 },
    },
    completed: {
      name: 'completed',
      type: 'boolean',
      label: 'Completed',
      description: 'Whether all planned sets were finished',
      required: true,
      default_value: true,
    },
    logged_at: {
      name: 'logged_at',
      type: 'datetime',
      label: 'Logged At',
      description: 'Timestamp when this exercise was logged',
      required: true,
    },
  },
};

export const WORKOUT_ROUTINE_SCHEMA: SchemaDefinition = {
  id: 'user/workout_routine',
  version: 1,
  displayName: 'Workout Routine & Split',
  description: 'Structured workout day routine (e.g. Push, Pull, Legs, Upper, Lower)',
  scope: 'user',
  privacy_tier: 'private',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  capabilities: ['schedulable', 'recurrent'],
  attributes: {
    routine_name: {
      name: 'routine_name',
      type: 'string',
      label: 'Routine Name',
      description: 'Title of the routine (e.g. Push Day A, Leg Hypertrophy)',
      required: true,
    },
    primary_split: {
      name: 'primary_split',
      type: 'string',
      label: 'Split Type',
      description: 'Split classification (e.g. Push, Pull, Legs, Upper, Lower, Full Body)',
      required: true,
    },
    estimated_duration_minutes: {
      name: 'estimated_duration_minutes',
      type: 'duration_minutes',
      label: 'Estimated Duration',
      description: 'Target session duration in minutes',
      required: false,
      default_value: 60,
    },
    recommended_exercises: {
      name: 'recommended_exercises',
      type: 'array',
      label: 'Planned Exercises',
      description: 'List of recommended exercises in this routine',
      required: false,
      item_type: 'string',
    },
  },
};
