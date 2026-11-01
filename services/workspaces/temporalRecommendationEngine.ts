/**
 * Flowmate Greenfield Domain Kernel — Temporal Recommendation Engine
 * STRICT INVARIANT: ZERO `any`
 */

import { KernelEntity } from '../kernel/types';
import { TemporalRecommendationConfig, TemporalRecommendationResult } from './generativeDashboardTypes';

/**
 * Computes an intelligent temporal recommendation for a generative workspace
 * based on previous entity timestamps and user activity history.
 */
export function computeTemporalRecommendation(
  entities: Record<string, KernelEntity>,
  config: TemporalRecommendationConfig,
  referenceDate = new Date(),
): TemporalRecommendationResult {
  // Filter entities matching the target schema
  const matching = Object.values(entities)
    .filter(e => e.schema_id === config.targetSchemaId && e.lifecycle.deleted_at === null)
    .sort((a, b) => {
      const aTime = extractEntityTimestamp(a);
      const bTime = extractEntityTimestamp(b);
      return bTime - aTime; // Most recent first
    });

  if (matching.length === 0) {
    return {
      recommendedAction: config.defaultSplit,
      headline: `Start with ${config.defaultSplit}`,
      description: `Welcome to your generative workspace! No previous logs found. Kick off your first session with ${config.defaultSplit}.`,
      lastActivityDate: null,
      lastActivitySummary: null,
      suggestedExercises: getSuggestedExercisesForSplit(config.defaultSplit),
      daysSinceLastSession: -1,
    };
  }

  const mostRecent = matching[0];
  const lastTimeMs = extractEntityTimestamp(mostRecent);
  const diffDays = Math.floor((referenceDate.getTime() - lastTimeMs) / (1000 * 60 * 60 * 24));

  // Determine what was done in the most recent session
  const lastGroup = String(mostRecent.attributes[config.categoryField] || '');
  const lastExercise = String(mostRecent.attributes.exercise_name || mostRecent.title || 'Workout');
  const lastSummary = `${lastGroup ? lastGroup + ': ' : ''}${lastExercise}`;

  // Next recommendation based on cycle
  const cycle = config.splitCycle;
  let nextSplit = config.defaultSplit;

  if (cycle.length > 0) {
    const lastIndex = cycle.findIndex(s => s.toLowerCase() === lastGroup.toLowerCase());
    if (lastIndex !== -1) {
      nextSplit = cycle[(lastIndex + 1) % cycle.length];
    } else {
      nextSplit = cycle[0];
    }
  }

  // Handle rest day vs active day logic
  if (diffDays === 0) {
    return {
      recommendedAction: 'Recovery / Hydration',
      headline: `Completed ${lastGroup || 'session'} today!`,
      description: `Great job on your session today! Focus on hydration, stretching, and hitting your protein goal.`,
      lastActivityDate: new Date(lastTimeMs).toISOString(),
      lastActivitySummary: lastSummary,
      suggestedExercises: ['Light stretching', 'Foam rolling', '10-minute walk'],
      daysSinceLastSession: 0,
    };
  }

  if (diffDays >= 4) {
    return {
      recommendedAction: nextSplit,
      headline: `Resume with ${nextSplit} (${diffDays} days since last session)`,
      description: `It's been a few days since your last session. Warm up thoroughly and ease back in with ${nextSplit}.`,
      lastActivityDate: new Date(lastTimeMs).toISOString(),
      lastActivitySummary: lastSummary,
      suggestedExercises: getSuggestedExercisesForSplit(nextSplit),
      daysSinceLastSession: diffDays,
    };
  }

  return {
    recommendedAction: nextSplit,
    headline: `Recommended Today: ${nextSplit}`,
    description: `You logged ${lastGroup || 'exercise'} ${diffDays === 1 ? 'yesterday' : `${diffDays} days ago`}. Today is optimal for ${nextSplit}.`,
    lastActivityDate: new Date(lastTimeMs).toISOString(),
    lastActivitySummary: lastSummary,
    suggestedExercises: getSuggestedExercisesForSplit(nextSplit),
    daysSinceLastSession: diffDays,
  };
}

function extractEntityTimestamp(entity: KernelEntity): number {
  const loggedAt = entity.attributes.logged_at;
  if (typeof loggedAt === 'string') {
    const parsed = Date.parse(loggedAt);
    if (!isNaN(parsed)) return parsed;
  }
  const updatedAt = entity.lifecycle.updated_at;
  if (typeof updatedAt === 'string') {
    const parsed = Date.parse(updatedAt);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.parse(entity.lifecycle.created_at) || 0;
}

function getSuggestedExercisesForSplit(split: string): string[] {
  const normalized = split.toLowerCase();
  if (normalized.includes('push')) {
    return [
      'Barbell Bench Press (3x8-10)',
      'Incline Dumbbell Press (3x10-12)',
      'Overhead Shoulder Press (3x8-10)',
      'Cable Lateral Raises (4x15)',
      'Tricep Rope Pushdowns (3x12-15)',
    ];
  }
  if (normalized.includes('pull')) {
    return [
      'Barbell Deadlift / Romanian Deadlift (3x6-8)',
      'Lat Pulldown / Pull-ups (4x8-10)',
      'Barbell Chest-Supported Row (3x10-12)',
      'Face Pulls (4x15)',
      'Incline Dumbbell Bicep Curls (3x12)',
    ];
  }
  if (normalized.includes('leg')) {
    return [
      'Barbell Back Squat (4x6-8)',
      'Romanian Deadlift (3x8-10)',
      'Leg Press / Bulgarian Split Squat (3x10-12)',
      'Lying Leg Curls (3x12-15)',
      'Standing Calf Raises (4x15-20)',
    ];
  }
  return [
    'Dynamic Warm-up (5 mins)',
    'Compound Exercise 1 (3x8)',
    'Compound Exercise 2 (3x10)',
    'Isolation Accessory (3x12)',
    'Core / Mobility (2x15)',
  ];
}
