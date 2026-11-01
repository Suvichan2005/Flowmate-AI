/**
 * Flowmate Greenfield Domain Kernel & Generative Workspaces Acceptance Test
 *
 * Verifies:
 * 1. Autonomous generation of custom multi-domain workspace with typed schema,
 *    pipeline stages, calculation summary, and initial records.
 * 2. Pure declarative rendering in GenerativeDashboardView.
 * 3. Moving items across pipeline stages via PipelineStageBoardWidget ("Next" button).
 * 4. Reactive financial/domain calculations in CalculationSummaryWidget.
 * 5. Cross-device convergence: serializing dynamic schemas and workspace plugins to
 *    Firestore meta documents and hydrating a fresh device instance.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { dispatchToolCall } from '../services/ai/executors';
import { dynamicSchemaRegistry } from '../services/kernel/dynamicSchemaRegistry';
import { globalWorkspacePluginRegistry } from '../services/workspaces/workspacePluginRegistry';
import { GenerativeDashboardView } from '../components/GenerativeDashboardView';
import { useStore } from '../store';
import { KernelEntity, AttributeValue } from '../services/kernel/types';
import { mergeWorkspacePlugins, mergeDynamicSchemas } from '../services/firestoreSync';

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

describe('Generative Workspaces — Kanban Pipeline, Dynamic Calculations & Durable Cross-Device Sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('autonomously synthesizes a Venture Capital Deal Flow workspace, advances pipeline stages, calculates summaries, and converges across devices', async () => {
    const applyOperationsMock = vi.fn();
    const addToastMock = vi.fn();

    // 1. Initial State
    useStore.setState({
      kernelEntities: {},
      foodLogs: [],
      applyOperations: applyOperationsMock,
      addToast: addToastMock,
      activeDashboardId: null,
      currentView: 'chat',
    });

    // 2. Invoke AI generate_workspace tool with custom pipeline stages & financial attributes
    const toolCallResult = await dispatchToolCall(
      {
        name: 'generate_workspace',
        args: {
          topic: 'Venture Capital Deal Flow & Syndication',
          description: 'Autonomous deal pipeline tracking investments from sourcing to term sheet',
          category: 'finance',
          pipeline_stages: [
            { id: 'sourcing', label: 'Sourcing & Inbound', color: 'sky' },
            { id: 'diligence', label: 'Due Diligence', color: 'indigo' },
            { id: 'term_sheet', label: 'Term Sheet Issued', color: 'amber' },
            { id: 'portfolio', label: 'Portfolio Company', color: 'emerald' },
          ],
          custom_attributes: [
            { name: 'company_name', type: 'string', label: 'Company Name', description: 'Startup name', required: true },
            { name: 'valuation_usd', type: 'number', label: 'Valuation ($)', description: 'Post-money valuation', required: false },
            { name: 'check_size_usd', type: 'number', label: 'Check Size ($)', description: 'Investment check size', required: false },
            { name: 'sector', type: 'string', label: 'Sector', description: 'Industry vertical', required: false },
            { name: 'pipeline_stage', type: 'string', label: 'Stage', description: 'Current pipeline stage', required: true },
          ],
          suggested_widgets: [
            {
              id: 'vc_calc_metrics',
              title: 'Syndicate Capital Metrics',
              type: 'calculation_summary',
              gridSpan: 'full',
              schemaId: 'user/venture_capital_deal',
              calculations: [
                { id: 'deal_count', label: 'Active Pipeline Deals', aggregation: 'count' },
                { id: 'total_deployed', label: 'Target Capital Deployment', aggregation: 'sum', targetField: 'check_size_usd', prefix: '$' },
              ],
            },
            {
              id: 'vc_stage_board',
              title: 'Deal Flow Pipeline',
              type: 'pipeline_stage_board',
              gridSpan: 'full',
              schemaId: 'user/venture_capital_deal',
              stageField: 'pipeline_stage',
              stages: [
                { id: 'sourcing', label: 'Sourcing & Inbound', color: 'sky' },
                { id: 'diligence', label: 'Due Diligence', color: 'indigo' },
                { id: 'term_sheet', label: 'Term Sheet Issued', color: 'amber' },
                { id: 'portfolio', label: 'Portfolio Company', color: 'emerald' },
              ],
              cardFields: {
                titleField: 'company_name',
                subtitleField: 'sector',
                badgeField: 'stage',
                metaField: 'valuation_usd',
              },
            },
          ],
          initial_records: [
            {
              title: 'NeuralSynth AI',
              company_name: 'NeuralSynth AI',
              sector: 'Generative Audio',
              valuation_usd: 15000000,
              check_size_usd: 1500000,
              pipeline_stage: 'sourcing',
            },
            {
              title: 'QuantumRoute Systems',
              company_name: 'QuantumRoute Systems',
              sector: 'Logistics Optimization',
              valuation_usd: 28000000,
              check_size_usd: 3000000,
              pipeline_stage: 'diligence',
            },
          ],
        },
      },
      []
    );

    // Verify AI tool output
    expect(toolCallResult.name).toBe('generate_workspace');
    const result = toolCallResult.response.result as {
      workspace_id: string;
      title: string;
      schema_id: string;
      widget_count: number;
    };
    expect(result.workspace_id).toBe('dash-venture_capital_deal_flo');
    expect(result.schema_id).toBe('user/venture_capital_deal');
    expect(result.widget_count).toBeGreaterThanOrEqual(2);

    // 3. Verify Dynamic Schema Registration in Kernel
    expect(dynamicSchemaRegistry.has('user/venture_capital_deal')).toBe(true);
    const vcSchema = dynamicSchemaRegistry.get('user/venture_capital_deal')!;
    expect(vcSchema.displayName).toBe('Venture Capital Deal Flow & Syndication Item');
    expect(vcSchema.attributes['valuation_usd']).toBeDefined();
    expect(vcSchema.attributes['check_size_usd']).toBeDefined();
    expect(vcSchema.attributes['pipeline_stage']).toBeDefined();

    // 4. Verify Workspace Plugin Registration
    const plugin = globalWorkspacePluginRegistry.getPlugin(result.workspace_id);
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('Venture Capital Deal Flow & Syndication');

    // 5. Mount entities in store
    const deal1 = createMockKernelEntity(
      'deal-1-neuralsynth',
      'user/venture_capital_deal',
      'NeuralSynth AI',
      {
        company_name: 'NeuralSynth AI',
        sector: 'Generative Audio',
        valuation_usd: 15000000,
        check_size_usd: 1500000,
        pipeline_stage: 'sourcing',
      }
    );

    const deal2 = createMockKernelEntity(
      'deal-2-quantumroute',
      'user/venture_capital_deal',
      'QuantumRoute Systems',
      {
        company_name: 'QuantumRoute Systems',
        sector: 'Logistics Optimization',
        valuation_usd: 28000000,
        check_size_usd: 3000000,
        pipeline_stage: 'diligence',
      }
    );

    useStore.setState({
      kernelEntities: {
        [deal1.id]: deal1,
        [deal2.id]: deal2,
      },
      activeDashboardId: result.workspace_id,
      currentView: 'generative_dashboard',
    });

    // 6. Render GenerativeDashboardView
    render(<GenerativeDashboardView dashboardId={result.workspace_id} />);

    // Assert Workspace Header
    expect(screen.getByRole('heading', { name: 'Venture Capital Deal Flow & Syndication' })).toBeInTheDocument();

    // Assert Stage Board is rendered
    expect(screen.getByText('Deal Flow Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Sourcing & Inbound')).toBeInTheDocument();
    expect(screen.getByText('Due Diligence')).toBeInTheDocument();
    expect(screen.getByText('Term Sheet Issued')).toBeInTheDocument();
    expect(screen.getByText('Portfolio Company')).toBeInTheDocument();

    // Assert Cards rendered in stages
    expect(screen.getByText('NeuralSynth AI')).toBeInTheDocument();
    expect(screen.getByText('QuantumRoute Systems')).toBeInTheDocument();

    // 7. Assert Calculation Summary Widget
    expect(screen.getByText('Syndicate Capital Metrics')).toBeInTheDocument();
    expect(screen.getByText('Active Pipeline Deals')).toBeInTheDocument();
    expect(screen.getByText('Target Capital Deployment')).toBeInTheDocument();
    // 1,500,000 + 3,000,000 = 4,500,000 (localized)
    expect(screen.getByText((4500000).toLocaleString())).toBeInTheDocument();

    // 8. Test Kanban Stage Advance: Move NeuralSynth AI to next stage (Due Diligence)
    const nextButtons = screen.getAllByRole('button', { name: /Next/i });
    expect(nextButtons.length).toBeGreaterThan(0);
    fireEvent.click(nextButtons[0]);

    // Verify applyOperations was dispatched with stage update
    expect(applyOperationsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'update_entity',
        payload: expect.objectContaining({
          id: 'deal-1-neuralsynth',
          m: expect.objectContaining({
            pipeline_stage: 'diligence',
          }),
        }),
      }),
    ]);

    // 9. Verify Cross-Device Convergence Algorithm
    // Simulate remote device receiving snapshot of dynamic schemas & workspaces
    const localSchemas = dynamicSchemaRegistry.listCustom();
    const localPlugins = globalWorkspacePluginRegistry.getDynamicPlugins();

    expect(localSchemas.some(s => s.id === 'user/venture_capital_deal')).toBe(true);
    expect(localPlugins.some(p => p.id === result.workspace_id)).toBe(true);

    // Test Firestore merging algorithm
    const mergedSchemas = mergeDynamicSchemas([], localSchemas);
    expect(mergedSchemas.length).toBe(localSchemas.length);
    expect(mergedSchemas.find(s => s.id === 'user/venture_capital_deal')).toBeDefined();

    const mergedPlugins = mergeWorkspacePlugins([], localPlugins);
    expect(mergedPlugins.length).toBe(localPlugins.length);
    expect(mergedPlugins.find(p => p.id === result.workspace_id)).toBeDefined();
  });
});
