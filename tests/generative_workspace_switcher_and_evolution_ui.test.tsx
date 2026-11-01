import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenerativeDashboardView } from '../components/GenerativeDashboardView';
import { useStore } from '../store';
import { globalWorkspacePluginRegistry } from '../services/workspaces/workspacePluginRegistry';
import { dynamicSchemaRegistry } from '../services/kernel/dynamicSchemaRegistry';
import { globalSyncCoordinator } from '../services/sync/syncCoordinator';
import { generateWorkspaceFromPrompt } from '../services/workspaces/workspaceGenerator';

describe('GenerativeDashboardView — Switcher, Generation & Evolution UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: vi.fn(),
      addToast: vi.fn(),
      activeDashboardId: null,
      currentView: 'generative_dashboard',
    });
  });

  it('renders all registered workspace pills and allows switching active workspace', () => {
    render(<GenerativeDashboardView />);

    // Assert initial canonical gym workspace is active
    expect(screen.getByRole('heading', { name: 'Performance & Gym Tracker' })).toBeInTheDocument();

    // Assert pills for pre-registered workspaces exist in the switcher bar
    const gymPill = screen.getByRole('button', { name: /Performance & Gym Tracker/i });
    const wellnessPill = screen.getByRole('button', { name: /Daily Fuel & Wellness Studio/i });
    const focusPill = screen.getByRole('button', { name: /Deep Work & Sprint Studio/i });

    expect(gymPill).toBeInTheDocument();
    expect(wellnessPill).toBeInTheDocument();
    expect(focusPill).toBeInTheDocument();

    // Click on Wellness Studio pill
    fireEvent.click(wellnessPill);

    // Verify view dynamically updates to Wellness Studio
    expect(screen.getByRole('heading', { name: 'Daily Fuel & Wellness Studio' })).toBeInTheDocument();
    expect(screen.getByText('Daily Target Vitals')).toBeInTheDocument();
  });

  it('opens Autonomous Workspace Creator and generates a custom workspace', () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    render(<GenerativeDashboardView />);

    // Click "+ New Workspace"
    const newWorkspaceBtn = screen.getByRole('button', { name: /\+ New Workspace/i });
    fireEvent.click(newWorkspaceBtn);

    // Verify creator modal is open
    expect(screen.getByText('Autonomous Workspace Creator')).toBeInTheDocument();

    // Enter custom topic
    const textarea = screen.getByPlaceholderText(/Real Estate Deal Pipeline/i);
    fireEvent.change(textarea, { target: { value: 'Cryptocurrency Portfolio Tracker' } });

    // Click "Generate Workspace"
    const generateBtn = screen.getByRole('button', { name: 'Generate Workspace' });
    fireEvent.click(generateBtn);

    // Verify the newly generated workspace is registered and active
    expect(screen.getByRole('heading', { name: 'Cryptocurrency Portfolio Tracker' })).toBeInTheDocument();
    expect(screen.getByText('Portfolio Return Summary')).toBeInTheDocument();

    // Verify cross-device sync mutation was broadcast
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: 'workspace_plugin',
        op: 'upsert',
      })
    );
  });

  it('opens Evolve Workspace modal and adds a custom attribute to the data model', () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    render(<GenerativeDashboardView />);

    // First switch to or generate a workspace with a schema
    const newWorkspaceBtn = screen.getByRole('button', { name: /\+ New Workspace/i });
    fireEvent.click(newWorkspaceBtn);
    const textarea = screen.getByPlaceholderText(/Real Estate Deal Pipeline/i);
    fireEvent.change(textarea, { target: { value: 'Venture Capital Pipeline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Workspace' }));

    // Click "Evolve Workspace"
    const evolveBtn = screen.getByRole('button', { name: /Evolve Workspace/i });
    fireEvent.click(evolveBtn);

    // Verify modal is open
    expect(screen.getByText(/Evolve: Venture Capital Pipeline/i)).toBeInTheDocument();

    // Fill field form
    const fieldInput = screen.getByPlaceholderText(/rating, priority/i);
    fireEvent.change(fieldInput, { target: { value: 'valuation_tier' } });

    const labelInput = screen.getByPlaceholderText(/Priority Level/i);
    fireEvent.change(labelInput, { target: { value: 'Valuation Tier' } });

    // Click "Apply Evolution"
    const applyBtn = screen.getByRole('button', { name: 'Apply Evolution' });
    fireEvent.click(applyBtn);

    // Verify the new field appears in the quick-add input fields
    expect(screen.getByPlaceholderText('VALUATION TIER')).toBeInTheDocument();

    // Verify cross-device sync mutation was broadcast
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: 'workspace_plugin',
        op: 'upsert',
      })
    );
  });

  it('receives remote workspace_plugin mutations and registers them seamlessly', () => {
    const remotePlugin = {
      id: 'dash-remote-quantum-computing',
      name: 'Quantum Computing Research',
      description: 'Qubit simulation and quantum algorithm synthesis',
      version: '1.0.0',
      category: 'education' as const,
      icon: 'code',
      manifest: {
        id: 'dash-remote-quantum-computing',
        title: 'Quantum Computing Research',
        description: 'Qubit simulation and quantum algorithm synthesis',
        category: 'education' as const,
        icon: 'code',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        associatedSchemas: [
          {
            id: 'user/quantum_experiment',
            version: 1,
            displayName: 'Quantum Experiment',
            description: 'Quantum circuit benchmarks',
            scope: 'user' as const,
            privacy_tier: 'private' as const,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            capabilities: ['schedulable' as const, 'actionable' as const],
            attributes: {
              circuit_name: {
                name: 'circuit_name',
                label: 'Circuit Name',
                type: 'string' as const,
                required: true,
                description: 'Circuit Name',
              },
            },
          },
        ],
        widgets: [],
      },
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Simulate remote broadcast incoming through sync coordinator
    globalSyncCoordinator.handleIncomingEnvelope({
      version: 2,
      envelopeId: 'env_remote_test_1',
      senderDeviceId: 'peer_phone_123',
      userId: 'test_user',
      timestamp: new Date().toISOString(),
      mutations: [
        {
          id: 'mut_remote_1',
          entityKind: 'workspace_plugin',
          op: 'upsert',
          entityId: remotePlugin.id,
          clientTimestamp: new Date().toISOString(),
          deviceId: 'peer_phone_123',
          data: remotePlugin as unknown as Record<string, unknown>,
        },
      ],
    });

    // Verify remote plugin registered in registry
    expect(globalWorkspacePluginRegistry.getPlugin('dash-remote-quantum-computing')).toBeDefined();
    // Verify remote schema registered in dynamic schema registry
    expect(dynamicSchemaRegistry.has('user/quantum_experiment')).toBe(true);
  });

  it('deletes a custom workspace, marks tombstone, and broadcasts delete mutation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    // Register custom workspace
    const customWorkspace = generateWorkspaceFromPrompt({
      topic: 'Podcast Audio Studio',
      category: 'custom',
    });
    expect(globalWorkspacePluginRegistry.getPlugin(customWorkspace.id)).toBeDefined();

    render(<GenerativeDashboardView dashboardId={customWorkspace.id} />);

    // Click delete workspace button
    const deleteBtn = screen.getByTitle('Delete this workspace');
    fireEvent.click(deleteBtn);

    // Verify workspace is unregistered from active list
    expect(globalWorkspacePluginRegistry.getPlugin(customWorkspace.id)).toBeUndefined();
    // Verify tombstone is recorded in registry
    const tombstones = globalWorkspacePluginRegistry.listAllPluginsWithTombstones();
    const deletedPlugin = tombstones.find(p => p.id === customWorkspace.id);
    expect(deletedPlugin?.deleted).toBe(true);
    expect(deletedPlugin?.deletedAt).toBeDefined();

    // Verify deletion mutation broadcast
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: 'workspace_plugin',
        op: 'delete',
        entityId: customWorkspace.id,
      })
    );
  });
});
