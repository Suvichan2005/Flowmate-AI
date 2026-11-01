/**
 * Flowmate Generative Workspace Plugin Framework (P1-10)
 *
 * Provides dynamic discovery, registration, lifecycle management, and
 * export/import for user- and AI-generated workspace dashboards.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { DashboardManifest } from './generativeDashboardTypes';
import {
  generativeWorkspaceManager,
  createCanonicalGymDashboardManifest,
  CANONICAL_GYM_DASHBOARD_ID,
} from './workspaceManager';
import { SchemaDefinition } from '../kernel/types';

export interface WorkspacePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: 'fitness' | 'productivity' | 'wellness' | 'education' | 'finance' | 'custom';
  readonly icon: string;
  readonly author?: string;
  readonly manifest: DashboardManifest;
  enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  deleted?: boolean;
  deletedAt?: string | null;
}

const LOCAL_STORAGE_KEY = 'flowmate_workspace_plugins_v1';

export class WorkspacePluginRegistry {
  private plugins = new Map<string, WorkspacePlugin>();

  constructor() {
    this.initializeDefaults();
    this.loadFromStorage();
  }

  private initializeDefaults(): void {
    // 1. Canonical Gym & Performance Tracker Plugin
    const gymManifest = createCanonicalGymDashboardManifest();
    const gymPlugin: WorkspacePlugin = {
      id: CANONICAL_GYM_DASHBOARD_ID,
      name: 'Performance & Gym Tracker',
      description: 'Intelligent strength training split planner, interactive rest timer, and nutrition cross-referencing.',
      version: '1.0.0',
      category: 'fitness',
      icon: 'dumbbell',
      author: 'Flowmate Core',
      manifest: gymManifest,
      enabled: true,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    };
    this.plugins.set(gymPlugin.id, gymPlugin);
    generativeWorkspaceManager.registerDashboard(gymManifest);

    // 2. Wellness & Nutrition Command Center Plugin
    const wellnessManifest: DashboardManifest = {
      id: 'dash-wellness-command',
      title: 'Daily Fuel & Wellness Studio',
      description: 'Comprehensive hydration, nutrient balance, habit grounding, and recovery monitoring.',
      category: 'wellness',
      icon: 'sparkles',
      version: 1,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
      associatedSchemas: [],
      widgets: [
        {
          id: 'widget-wellness-fuel',
          type: 'metric_counter',
          title: 'Daily Target Vitals',
          gridSpan: 2,
          counters: [
            { id: 'water_glasses', label: 'Hydration', unit: 'cups', current: 6, target: 10, step: 1, color: 'sky' },
            { id: 'mindful_minutes', label: 'Mindfulness', unit: 'min', current: 15, target: 20, step: 5, color: 'indigo' },
            { id: 'sunlight_exposure', label: 'Morning Sunlight', unit: 'min', current: 20, target: 30, step: 10, color: 'amber' },
          ],
        },
        {
          id: 'widget-wellness-nutrition',
          type: 'cross_reference_summary',
          title: 'Caloric & Macro Intake',
          gridSpan: 2,
          sourceDomain: 'food_logs',
          metricKeys: ['calories', 'protein', 'carbs', 'fats'],
          label: "Today's Logged Nutrition",
        },
      ],
    };
    const wellnessPlugin: WorkspacePlugin = {
      id: 'dash-wellness-command',
      name: 'Daily Fuel & Wellness Studio',
      description: 'Track daily vitals, macro targets, and mindful habits in one focused view.',
      version: '1.0.0',
      category: 'wellness',
      icon: 'sparkles',
      author: 'Flowmate Core',
      manifest: wellnessManifest,
      enabled: true,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    };
    this.plugins.set(wellnessPlugin.id, wellnessPlugin);
    generativeWorkspaceManager.registerDashboard(wellnessManifest);

    // 3. Deep Work & Focus Studio Plugin
    const focusManifest: DashboardManifest = {
      id: 'dash-deep-work-studio',
      title: 'Deep Work & Sprint Studio',
      description: 'High-intensity focus blocks, sprint countdown timers, and project progress telemetry.',
      category: 'productivity',
      icon: 'target',
      version: 1,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
      associatedSchemas: [],
      widgets: [
        {
          id: 'widget-focus-timer',
          type: 'interactive_timer',
          title: 'Pomodoro Interval Timer',
          gridSpan: 2,
          defaultSeconds: 1500, // 25 mins
          presetSeconds: [300, 900, 1500, 3000],
          alertSound: true,
        },
        {
          id: 'widget-focus-metrics',
          type: 'metric_counter',
          title: 'Sprint Milestones',
          gridSpan: 2,
          counters: [
            { id: 'focus_blocks', label: 'Deep Blocks Completed', unit: 'blocks', current: 3, target: 5, step: 1, color: 'emerald' },
            { id: 'distractions_deflected', label: 'Distractions Deflected', unit: 'items', current: 7, target: 0, step: 1, color: 'rose' },
          ],
        },
      ],
    };
    const focusPlugin: WorkspacePlugin = {
      id: 'dash-deep-work-studio',
      name: 'Deep Work & Sprint Studio',
      description: 'Structured sprint blocks, interval timers, and distraction deflection metrics.',
      version: '1.0.0',
      category: 'productivity',
      icon: 'target',
      author: 'Flowmate Core',
      manifest: focusManifest,
      enabled: true,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    };
    this.plugins.set(focusPlugin.id, focusPlugin);
    generativeWorkspaceManager.registerDashboard(focusManifest);
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as WorkspacePlugin[];
      if (Array.isArray(parsed)) {
        for (const plugin of parsed) {
          if (plugin && plugin.id && plugin.manifest) {
            this.plugins.set(plugin.id, plugin);
            if (!plugin.deleted) {
              generativeWorkspaceManager.registerDashboard(plugin.manifest);
            }
          }
        }
      }
    } catch {
      // Storage parsing safe fallback
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const list = Array.from(this.plugins.values());
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage quota safe fallback
    }
  }

  registerPlugin(plugin: WorkspacePlugin): void {
    this.plugins.set(plugin.id, structuredClone(plugin));
    if (!plugin.deleted) {
      generativeWorkspaceManager.registerDashboard(plugin.manifest);
    }
    this.saveToStorage();
  }

  unregisterPlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    const now = new Date().toISOString();
    const updated: WorkspacePlugin = {
      ...plugin,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
    };
    this.plugins.set(id, updated);
    this.saveToStorage();
    return true;
  }

  getPlugin(id: string): WorkspacePlugin | undefined {
    const found = this.plugins.get(id);
    if (!found || found.deleted) return undefined;
    return structuredClone(found);
  }

  listPlugins(filter?: { category?: string; enabledOnly?: boolean; includeDeleted?: boolean }): WorkspacePlugin[] {
    let result = Array.from(this.plugins.values());
    if (!filter?.includeDeleted) {
      result = result.filter(p => !p.deleted);
    }
    if (filter?.category && filter.category !== 'all') {
      result = result.filter(p => p.category === filter.category);
    }
    if (filter?.enabledOnly) {
      result = result.filter(p => p.enabled);
    }
    return result.map(p => structuredClone(p));
  }

  listAllPluginsWithTombstones(): WorkspacePlugin[] {
    return Array.from(this.plugins.values()).map(p => structuredClone(p));
  }

  getDynamicPlugins(): WorkspacePlugin[] {
    return this.listPlugins().filter(p => p.author !== 'Flowmate Core');
  }

  togglePluginEnabled(id: string, enabled?: boolean): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.enabled = enabled !== undefined ? enabled : !plugin.enabled;
    this.saveToStorage();
    return plugin.enabled;
  }

  exportPlugin(id: string): string {
    const plugin = this.getPlugin(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    return JSON.stringify(plugin, null, 2);
  }

  importPlugin(jsonString: string): WorkspacePlugin {
    const parsed = JSON.parse(jsonString) as WorkspacePlugin;
    if (!parsed || !parsed.id || !parsed.manifest) {
      throw new Error('Invalid workspace plugin manifest: missing id or manifest property');
    }
    const cleanPlugin: WorkspacePlugin = {
      ...parsed,
      id: parsed.id.startsWith('dash-') ? parsed.id : `dash-${parsed.id}`,
      updatedAt: new Date().toISOString(),
    };
    this.registerPlugin(cleanPlugin);
    return cleanPlugin;
  }
}

export const globalWorkspacePluginRegistry = new WorkspacePluginRegistry();
