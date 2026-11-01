/**
 * Tests for Flowmate Generative Workspace Plugin Framework
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  globalWorkspacePluginRegistry,
  WorkspacePlugin,
} from '../services/workspaces/workspacePluginRegistry';
import { CANONICAL_GYM_DASHBOARD_ID } from '../services/workspaces/workspaceManager';

describe('WorkspacePluginRegistry', () => {
  it('registers canonical default plugins on startup', () => {
    const plugins = globalWorkspacePluginRegistry.listPlugins();
    expect(plugins.length).toBeGreaterThanOrEqual(3);

    const gym = globalWorkspacePluginRegistry.getPlugin(CANONICAL_GYM_DASHBOARD_ID);
    expect(gym).toBeDefined();
    expect(gym?.name).toBe('Performance & Gym Tracker');
    expect(gym?.category).toBe('fitness');
    expect(gym?.manifest.widgets.length).toBeGreaterThan(0);

    const wellness = globalWorkspacePluginRegistry.getPlugin('dash-wellness-command');
    expect(wellness).toBeDefined();
    expect(wellness?.category).toBe('wellness');

    const focus = globalWorkspacePluginRegistry.getPlugin('dash-deep-work-studio');
    expect(focus).toBeDefined();
    expect(focus?.category).toBe('productivity');
  });

  it('filters plugins by category and enabled status', () => {
    const fitnessOnly = globalWorkspacePluginRegistry.listPlugins({ category: 'fitness' });
    expect(fitnessOnly.every(p => p.category === 'fitness')).toBe(true);

    const enabledOnly = globalWorkspacePluginRegistry.listPlugins({ enabledOnly: true });
    expect(enabledOnly.every(p => p.enabled)).toBe(true);
  });

  it('exports and imports a plugin manifest faithfully', () => {
    const exportedJson = globalWorkspacePluginRegistry.exportPlugin(CANONICAL_GYM_DASHBOARD_ID);
    expect(exportedJson).toContain('Performance & Gym Tracker');

    const customPluginJson = JSON.stringify({
      id: 'test-custom-workspace',
      name: 'Custom Research Lab',
      description: 'Experiment and hypothesis tracker',
      version: '1.0.0',
      category: 'productivity',
      icon: 'target',
      manifest: {
        id: 'dash-custom-lab',
        title: 'Custom Research Lab',
        description: 'Experiment and hypothesis tracker',
        category: 'productivity',
        icon: 'target',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        associatedSchemas: [],
        widgets: [
          {
            id: 'timer-1',
            type: 'interactive_timer',
            title: 'Experiment Timer',
            defaultSeconds: 600,
            presetSeconds: [300, 600, 1200],
          },
        ],
      },
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const imported = globalWorkspacePluginRegistry.importPlugin(customPluginJson);
    expect(imported.id).toBe('dash-test-custom-workspace');
    expect(imported.name).toBe('Custom Research Lab');

    const fetched = globalWorkspacePluginRegistry.getPlugin(imported.id);
    expect(fetched).toBeDefined();
    expect(fetched?.manifest.widgets.length).toBe(1);

    // Clean up
    globalWorkspacePluginRegistry.unregisterPlugin(imported.id);
    expect(globalWorkspacePluginRegistry.getPlugin(imported.id)).toBeUndefined();
  });
});
