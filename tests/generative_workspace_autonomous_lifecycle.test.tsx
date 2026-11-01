/**
 * Flowmate Greenfield Domain Kernel — Autonomous Generative Workspace Lifecycle Tests
 *
 * Verifies Level 4/5 Generative Workspace capabilities across multiple unrelated domains:
 * 1. Research Paper Literature Review Studio (user/research_paper)
 * 2. Career & Job Application Pipeline (user/job_application)
 * 3. Arbitrary custom domain (user/french_vocabulary_maste_item)
 *
 * Validates:
 * - Dynamic schema registration in domain kernel
 * - Composable widget tree construction
 * - AI tool execution via dispatchToolCall('generate_workspace')
 * - Pure declarative rendering in GenerativeDashboardView without domain hardcoding
 * - Dynamic entity creation, schema validation, and store persistence
 *
 * STRICT INVARIANT: ZERO `any`
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { dispatchToolCall } from '../services/ai/executors';
import { dynamicSchemaRegistry } from '../services/kernel/dynamicSchemaRegistry';
import { globalWorkspacePluginRegistry } from '../services/workspaces/workspacePluginRegistry';
import { generativeWorkspaceManager } from '../services/workspaces/workspaceManager';
import { GenerativeDashboardView } from '../components/GenerativeDashboardView';
import { useStore } from '../store';
import { KernelEntity, AttributeValue } from '../services/kernel/types';
import { ToonOperation } from '../types';

function createMockKernelEntity(
  id: string,
  schema_id: string,
  title: string,
  attributes: Record<string, AttributeValue>
): KernelEntity {
  const now = new Date().toISOString();
  return {
    id,
    schema_id,
    version: 1,
    title,
    attributes,
    lifecycle: {
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: now,
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };
}

describe('Autonomous Generative Workspace Lifecycle & Multi-Domain Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('autonomously generates and renders a Literature Review & Research Paper Studio', async () => {
    const applyOperationsMock = vi.fn();
    const addToastMock = vi.fn();

    // 1. Initial store setup
    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: applyOperationsMock,
      addToast: addToastMock,
      activeDashboardId: null,
      currentView: 'chat',
    });

    // 2. Invoke the AI generate_workspace tool for literature research
    const toolCallResult = await dispatchToolCall(
      {
        name: 'generate_workspace',
        args: {
          topic: 'Literature Review and Research Papers',
          description: 'Academic paper reading and synthesis tracker',
          category: 'education',
        },
      },
      []
    );

    expect(toolCallResult.name).toBe('generate_workspace');
    const result = toolCallResult.response.result as {
      workspace_id: string;
      title: string;
      schema_id: string;
      widget_count: number;
    };
    expect(result.workspace_id).toBe('dash-research-paper-lab');
    expect(result.schema_id).toBe('user/research_paper');
    expect(result.widget_count).toBeGreaterThanOrEqual(4);

    // 3. Dynamic schema registration verified in domain kernel
    expect(dynamicSchemaRegistry.has('user/research_paper')).toBe(true);
    const paperSchema = dynamicSchemaRegistry.get('user/research_paper');
    expect(paperSchema?.displayName).toBe('Research Paper Entry');
    expect(paperSchema?.attributes['reading_stage']).toBeDefined();
    expect(paperSchema?.attributes['authors']).toBeDefined();
    expect(paperSchema?.attributes['venue']).toBeDefined();

    // 4. Verify workspace plugin registered
    const plugin = globalWorkspacePluginRegistry.getPlugin('dash-research-paper-lab');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('Research Paper & Literature Studio');

    // 5. Add a research paper entity with typed attributes to kernelEntities
    const paperEntity = createMockKernelEntity(
      'entity-paper-transformers',
      'user/research_paper',
      'Attention Is All You Need',
      {
        title: 'Attention Is All You Need',
        authors: 'Vaswani et al.',
        venue: 'NeurIPS 2017',
        reading_stage: 'Synthesized',
        rating: 5,
        completed: true,
      }
    );

    useStore.setState({
      kernelEntities: {
        [paperEntity.id]: paperEntity,
      },
      activeDashboardId: 'dash-research-paper-lab',
      currentView: 'generative_dashboard',
    });

    // 6. Mount GenerativeDashboardView and assert declarative rendering
    render(<GenerativeDashboardView dashboardId="dash-research-paper-lab" />);

    // Assert Workspace Header
    expect(screen.getByRole('heading', { name: 'Research Paper & Literature Studio' })).toBeInTheDocument();

    // Assert Declarative Widgets
    expect(screen.getByText('Literature Review Sprint')).toBeInTheDocument();
    expect(screen.getByText('Deep Reading Sprint Timer')).toBeInTheDocument();
    expect(screen.getByText('Weekly Literature Milestones')).toBeInTheDocument();
    expect(screen.getByText('Active Research Papers & Literature Index')).toBeInTheDocument();

    // Assert Bound Entity Data
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument();
    expect(screen.getByText('Vaswani et al.')).toBeInTheDocument();
    expect(screen.getByText('NeurIPS 2017')).toBeInTheDocument();
    expect(screen.getByText('Synthesized')).toBeInTheDocument();
  });

  it('autonomously generates and renders a Career & Job Application Pipeline', async () => {
    const applyOperationsMock = vi.fn();
    const addToastMock = vi.fn();

    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: applyOperationsMock,
      addToast: addToastMock,
      activeDashboardId: null,
      currentView: 'chat',
    });

    // 1. Invoke the AI generate_workspace tool for career pipeline
    const toolCallResult = await dispatchToolCall(
      {
        name: 'generate_workspace',
        args: {
          topic: 'Job Application Pipeline & Interview Tracker',
          description: 'Track SWE and AI research job applications',
          category: 'productivity',
        },
      },
      []
    );

    expect(toolCallResult.name).toBe('generate_workspace');
    const result = toolCallResult.response.result as {
      workspace_id: string;
      title: string;
      schema_id: string;
      widget_count: number;
    };
    expect(result.workspace_id).toBe('dash-job-application-pipeline');
    expect(result.schema_id).toBe('user/job_application');

    // 2. Dynamic schema registration verified
    expect(dynamicSchemaRegistry.has('user/job_application')).toBe(true);
    const jobSchema = dynamicSchemaRegistry.get('user/job_application');
    expect(jobSchema?.displayName).toBe('Job Application Record');
    expect(jobSchema?.attributes['company']).toBeDefined();
    expect(jobSchema?.attributes['role']).toBeDefined();
    expect(jobSchema?.attributes['stage']).toBeDefined();

    // 3. Add a job application entity to kernelEntities
    const jobEntity = createMockKernelEntity(
      'entity-job-google',
      'user/job_application',
      'Staff AI Engineer - Google DeepMind',
      {
        company: 'Google DeepMind',
        role: 'Staff AI Engineer',
        stage: 'Final Round',
        location: 'Mountain View / London',
        salary_range: '$350k - $450k',
        completed: false,
      }
    );

    useStore.setState({
      kernelEntities: {
        [jobEntity.id]: jobEntity,
      },
      activeDashboardId: 'dash-job-application-pipeline',
      currentView: 'generative_dashboard',
    });

    // 4. Mount GenerativeDashboardView and assert declarative rendering
    render(<GenerativeDashboardView dashboardId="dash-job-application-pipeline" />);

    // Assert Workspace Header
    expect(screen.getByRole('heading', { name: 'Career & Internship Pipeline' })).toBeInTheDocument();

    // Assert Declarative Widgets
    expect(screen.getByText('Career Search Cadence')).toBeInTheDocument();
    expect(screen.getByText('Mock Interview & Assessment Timer')).toBeInTheDocument();
    expect(screen.getByText('Application Targets')).toBeInTheDocument();
    expect(screen.getByText('Active Opportunity Pipeline')).toBeInTheDocument();

    // Assert Bound Job Data
    expect(screen.getByText('Google DeepMind')).toBeInTheDocument();
    expect(screen.getByText('Staff AI Engineer')).toBeInTheDocument();
    expect(screen.getByText('Final Round')).toBeInTheDocument();
  });

  it('autonomously generates and renders an arbitrary custom domain (French Language Learning)', async () => {
    const applyOperationsMock = vi.fn();
    const addToastMock = vi.fn();

    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: applyOperationsMock,
      addToast: addToastMock,
      activeDashboardId: null,
      currentView: 'chat',
    });

    // 1. Invoke tool for arbitrary custom domain
    const toolCallResult = await dispatchToolCall(
      {
        name: 'generate_workspace',
        args: {
          topic: 'French Vocabulary Mastery',
          description: 'Daily French vocabulary drills and immersion tracker',
          category: 'education',
          icon: 'sparkles',
        },
      },
      []
    );

    const result = toolCallResult.response.result as {
      workspace_id: string;
      title: string;
      schema_id: string;
    };
    expect(result.workspace_id).toContain('dash-french_vocabulary_mast');
    expect(result.schema_id).toContain('user/french_vocabulary_master_item');

    // 2. Verify schema and plugin registration
    expect(dynamicSchemaRegistry.has(result.schema_id)).toBe(true);
    expect(globalWorkspacePluginRegistry.getPlugin(result.workspace_id)).toBeDefined();

    // 3. Add custom entity
    const frenchEntity = createMockKernelEntity(
      'entity-french-1',
      result.schema_id,
      'Le Subjonctif Vocab Drill',
      {
        name: 'Le Subjonctif Drill',
        status: 'Active',
        notes: 'Review irregular forms: être, avoir, aller',
        priority: 1,
        completed: false,
      }
    );

    useStore.setState({
      kernelEntities: {
        [frenchEntity.id]: frenchEntity,
      },
      activeDashboardId: result.workspace_id,
      currentView: 'generative_dashboard',
    });

    // 4. Render and verify
    render(<GenerativeDashboardView dashboardId={result.workspace_id} />);
    expect(screen.getByRole('heading', { name: 'French Vocabulary Mastery' })).toBeInTheDocument();
    expect(screen.getByText('French Vocabulary Mastery Focus Timer')).toBeInTheDocument();
    expect(screen.getByText('Le Subjonctif Drill')).toBeInTheDocument();
    expect(screen.getByText('Review irregular forms: être, avoir, aller')).toBeInTheDocument();
  });

  it('supports quick add via the declarative widget form and dispatches operations', () => {
    const applyOperationsMock = vi.fn();
    const addToastMock = vi.fn();

    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: applyOperationsMock,
      addToast: addToastMock,
      activeDashboardId: 'dash-research-paper-lab',
      currentView: 'generative_dashboard',
    });

    render(<GenerativeDashboardView dashboardId="dash-research-paper-lab" />);

    // Quick add fields: ['title', 'authors', 'venue', 'reading_stage', 'rating']
    const titleInput = screen.getByPlaceholderText('TITLE');
    const authorsInput = screen.getByPlaceholderText('AUTHORS');
    const venueInput = screen.getByPlaceholderText('VENUE');

    fireEvent.change(titleInput, { target: { value: 'Deep Residual Learning' } });
    fireEvent.change(authorsInput, { target: { value: 'He et al.' } });
    fireEvent.change(venueInput, { target: { value: 'CVPR 2016' } });

    const addBtn = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addBtn);

    expect(applyOperationsMock).toHaveBeenCalledTimes(1);
    const dispatchedOps: ToonOperation[] = applyOperationsMock.mock.calls[0][0];
    expect(dispatchedOps.length).toBe(1);
    expect(dispatchedOps[0].type).toBe('create_entity');
    const payload = dispatchedOps[0].payload as {
      title: string;
      attributes: Record<string, unknown>;
    };
    expect(payload.title).toBe('Deep Residual Learning');
    expect(payload.attributes.authors).toBe('He et al.');
    expect(payload.attributes.venue).toBe('CVPR 2016');
  });

  it('autonomously evolves an existing workspace: adds widgets and extends dynamic schema contracts', async () => {
    // 1. First ensure Literature Studio is generated
    await dispatchToolCall(
      {
        name: 'generate_workspace',
        args: {
          topic: 'Literature Review and Research Papers',
        },
      },
      []
    );

    const initialPlugin = globalWorkspacePluginRegistry.getPlugin('dash-research-paper-lab');
    expect(initialPlugin).toBeDefined();
    const initialWidgetCount = initialPlugin!.manifest.widgets.length;

    // 2. Evolve by adding a new Metric Counter widget
    const addWidgetResult = await dispatchToolCall(
      {
        name: 'evolve_workspace',
        args: {
          workspace_id: 'dash-research-paper-lab',
          action: 'add_widget',
          widget: {
            id: 'widget-paper-citations-verified',
            type: 'metric_counter',
            title: 'Verified Citations',
            gridSpan: 2,
            counters: [
              { id: 'verified_citations', label: 'Cross-Verified Citations', unit: 'refs', current: 5, target: 20, step: 1, color: 'emerald' },
            ],
          },
        },
      },
      []
    );

    expect(addWidgetResult.name).toBe('evolve_workspace');
    const addRes = addWidgetResult.response.result as { widget_count: number; message: string };
    expect(addRes.widget_count).toBe(initialWidgetCount + 1);

    // 3. Evolve by extending the dynamic schema with a new attribute ('difficulty')
    const extendSchemaResult = await dispatchToolCall(
      {
        name: 'evolve_workspace',
        args: {
          workspace_id: 'dash-research-paper-lab',
          action: 'extend_schema',
          schema_attribute: {
            name: 'difficulty',
            label: 'Difficulty Rating',
            type: 'string',
            description: 'Introductory | Intermediate | Frontier',
            required: false,
            default_value: 'Frontier',
          },
        },
      },
      []
    );

    expect(extendSchemaResult.name).toBe('evolve_workspace');
    const updatedSchema = dynamicSchemaRegistry.get('user/research_paper');
    expect(updatedSchema).toBeDefined();
    expect(updatedSchema?.attributes['difficulty']).toBeDefined();
    expect(updatedSchema?.attributes['difficulty'].label).toBe('Difficulty Rating');
    expect(updatedSchema?.version).toBeGreaterThanOrEqual(2);

    // 4. Verify entity_log_list widget automatically incorporated the new attribute
    const evolvedPlugin = globalWorkspacePluginRegistry.getPlugin('dash-research-paper-lab');
    const logListWidget = evolvedPlugin?.manifest.widgets.find(w => w.type === 'entity_log_list');
    expect(logListWidget).toBeDefined();
    if (logListWidget && logListWidget.type === 'entity_log_list') {
      expect(logListWidget.quickAddFields).toContain('difficulty');
      expect(logListWidget.columns.some(col => col.key === 'difficulty')).toBe(true);
    }
  });
});
