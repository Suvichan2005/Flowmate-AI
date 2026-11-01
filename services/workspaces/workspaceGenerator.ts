/**
 * Flowmate Greenfield Domain Kernel — Autonomous Workspace Generator (P1-10)
 *
 * Translates natural language requests and domain specifications into:
 * 1. Fully-typed SchemaDefinition dynamically registered in the kernel
 * 2. Composable DashboardManifest with typed widget bindings
 * 3. Registered WorkspacePlugin ready for immediate rendering and cross-device sync
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { SchemaDefinition, AttributeDefinition, KernelEntity, AttributeValue } from '../kernel/types';
import { dynamicSchemaRegistry } from '../kernel/dynamicSchemaRegistry';
import { DashboardManifest, DashboardWidgetConfig } from './generativeDashboardTypes';
import { WorkspacePlugin, globalWorkspacePluginRegistry } from './workspacePluginRegistry';
import { generativeWorkspaceManager } from './workspaceManager';
import { useStore } from '../../store';
import { syncWorkspacePluginToCloud, syncDynamicSchemaToCloud } from '../syncManager';

export interface WorkspaceGenerationRequest {
  topic: string;
  category?: 'fitness' | 'productivity' | 'wellness' | 'education' | 'finance' | 'custom';
  description?: string;
  icon?: string;
  custom_attributes?: Record<string, AttributeDefinition>;
  pipeline_stages?: Array<{ id: string; label: string; color?: 'sky' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'slate' }>;
  suggested_widgets?: DashboardWidgetConfig[];
  initial_records?: Array<{ title?: string; name?: string; attributes?: Record<string, unknown> }>;
}

/**
 * Creates the canonical Research Paper Management workspace and schema.
 */
export function createResearchPaperWorkspace(): WorkspacePlugin {
  const now = new Date().toISOString();
  const schemaId = 'user/research_paper';
  const schema: SchemaDefinition = {
    id: schemaId,
    version: 1,
    displayName: 'Research Paper Entry',
    description: 'Literature review tracking schema for research papers, preprints, and academic articles',
    scope: 'user',
    privacy_tier: 'private',
    created_at: now,
    updated_at: now,
    capabilities: ['schedulable', 'actionable'],
    attributes: {
      title: {
        name: 'title',
        label: 'Paper Title',
        type: 'string',
        required: true,
        description: 'Paper title',
      },
      authors: {
        name: 'authors',
        label: 'Authors',
        type: 'string',
        required: false,
        description: 'Primary authors or lab',
      },
      venue: {
        name: 'venue',
        label: 'Venue',
        type: 'string',
        required: false,
        description: 'Conference or journal (e.g. NeurIPS, ICML)',
      },
      reading_stage: {
        name: 'reading_stage',
        label: 'Reading Stage',
        type: 'string',
        required: true,
        default_value: 'To Read',
        description: 'Current reading status: To Read | Reading | Annotated | Synthesized',
      },
      rating: {
        name: 'rating',
        label: 'Relevance Score',
        type: 'number',
        required: false,
        default_value: 4,
        description: 'Importance / Relevance (1-5)',
      },
      key_findings: {
        name: 'key_findings',
        label: 'Key Findings',
        type: 'string',
        required: false,
        description: 'Core takeaways and methodologies',
      },
      read_date: {
        name: 'read_date',
        label: 'Read Date',
        type: 'string',
        required: false,
        description: 'Date finished reading',
      },
      completed: {
        name: 'completed',
        label: 'Finished Reading',
        type: 'boolean',
        required: false,
        default_value: false,
        description: 'Finished reading',
      },
    },
  };

  if (!dynamicSchemaRegistry.has(schemaId)) {
    dynamicSchemaRegistry.register(schema);
  }
  try {
    useStore.setState(s => ({ schemas: { ...s.schemas, [schemaId]: schema } }));
  } catch {
    // In headless tests or SSR, store might not be mounted
  }

  const manifest: DashboardManifest = {
    id: 'dash-research-paper-lab',
    title: 'Research Paper & Literature Studio',
    description: 'Autonomous workspace for discovering, annotating, and synthesizing academic papers and technical preprints.',
    category: 'education',
    icon: 'book-open',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    associatedSchemas: [schema],
    widgets: [
      {
        id: 'widget-paper-temporal-cycle',
        type: 'temporal_recommendation',
        title: 'Literature Review Sprint',
        gridSpan: 3,
        targetSchemaId: schemaId,
        categoryField: 'reading_stage',
        splitCycle: ['Literature Search', 'Deep Reading', 'Synthesis & Notes'],
        defaultSplit: 'Literature Search',
        recommendationRationale: 'Recommends next study block based on recently logged reading stages and paper annotations.',
      },
      {
        id: 'widget-reading-timer',
        type: 'interactive_timer',
        title: 'Deep Reading Sprint Timer',
        gridSpan: 1,
        defaultSeconds: 2700, // 45 mins
        presetSeconds: [900, 1800, 2700, 3600],
        alertSound: true,
      },
      {
        id: 'widget-paper-metrics',
        type: 'metric_counter',
        title: 'Weekly Literature Milestones',
        gridSpan: 2,
        counters: [
          { id: 'papers_read', label: 'Papers Read', unit: 'papers', current: 3, target: 7, step: 1, color: 'indigo' },
          { id: 'notes_taken', label: 'Detailed Summaries', unit: 'notes', current: 2, target: 5, step: 1, color: 'emerald' },
          { id: 'citations_cataloged', label: 'Citations Indexed', unit: 'items', current: 14, target: 30, step: 5, color: 'sky' },
        ],
      },
      {
        id: 'widget-paper-logs',
        type: 'entity_log_list',
        title: 'Active Research Papers & Literature Index',
        gridSpan: 4,
        schemaId: schemaId,
        allowVoiceInput: true,
        quickAddFields: ['title', 'authors', 'venue', 'reading_stage', 'rating'],
        columns: [
          { key: 'title', label: 'Paper Title', type: 'string', editable: true },
          { key: 'authors', label: 'Authors', type: 'string', editable: true },
          { key: 'venue', label: 'Venue', type: 'badge' },
          { key: 'reading_stage', label: 'Stage', type: 'badge' },
          { key: 'rating', label: 'Score', type: 'number', editable: true, defaultValue: 4 },
          { key: 'completed', label: 'Done', type: 'boolean', editable: true, defaultValue: false },
        ],
      },
    ],
  };

  const plugin: WorkspacePlugin = {
    id: manifest.id,
    name: manifest.title,
    description: manifest.description,
    version: '1.0.0',
    category: 'education',
    icon: 'book-open',
    author: 'Flowmate Autonomous Generator',
    manifest,
    enabled: true,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };

  generativeWorkspaceManager.registerDashboard(manifest);
  globalWorkspacePluginRegistry.registerPlugin(plugin);
  try {
    syncWorkspacePluginToCloud(plugin);
  } catch {
    // Offline / test safe fallback
  }
  return plugin;
}

/**
 * Creates the canonical Job & Internship Application Pipeline workspace.
 */
export function createJobApplicationWorkspace(): WorkspacePlugin {
  const now = new Date().toISOString();
  const schemaId = 'user/job_application';
  const schema: SchemaDefinition = {
    id: schemaId,
    version: 1,
    displayName: 'Job Application Record',
    description: 'Career opportunity pipeline tracking applications, interview stages, and offers',
    scope: 'user',
    privacy_tier: 'private',
    created_at: now,
    updated_at: now,
    capabilities: ['schedulable', 'actionable'],
    attributes: {
      company: {
        name: 'company',
        label: 'Company',
        type: 'string',
        required: true,
        description: 'Company or organization name',
      },
      role: {
        name: 'role',
        label: 'Position Role',
        type: 'string',
        required: true,
        description: 'Position title',
      },
      stage: {
        name: 'stage',
        label: 'Pipeline Stage',
        type: 'string',
        required: true,
        default_value: 'Applied',
        description: 'Pipeline stage: Sourced | Applied | OA | Technical | Final Round | Offer | Rejected',
      },
      location: {
        name: 'location',
        label: 'Location',
        type: 'string',
        required: false,
        description: 'Work location or Remote',
      },
      salary_range: {
        name: 'salary_range',
        label: 'Salary Target',
        type: 'string',
        required: false,
        description: 'Compensation range',
      },
      next_deadline: {
        name: 'next_deadline',
        label: 'Next Deadline',
        type: 'string',
        required: false,
        description: 'Next interview or assessment deadline',
      },
      completed: {
        name: 'completed',
        label: 'Process Closed',
        type: 'boolean',
        required: false,
        default_value: false,
        description: 'Process finished',
      },
    },
  };

  if (!dynamicSchemaRegistry.has(schemaId)) {
    dynamicSchemaRegistry.register(schema);
  }
  try {
    useStore.setState(s => ({ schemas: { ...s.schemas, [schemaId]: schema } }));
  } catch {
    // In headless tests or SSR, store might not be mounted
  }

  const manifest: DashboardManifest = {
    id: 'dash-job-application-pipeline',
    title: 'Career & Internship Pipeline',
    description: 'Autonomous career pipeline for tracking job applications, technical interviews, and salary offers.',
    category: 'productivity',
    icon: 'target',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    associatedSchemas: [schema],
    widgets: [
      {
        id: 'widget-career-temporal-cycle',
        type: 'temporal_recommendation',
        title: 'Career Search Cadence',
        gridSpan: 3,
        targetSchemaId: schemaId,
        categoryField: 'stage',
        splitCycle: ['Prospecting', 'Resume Tailoring', 'Submitting', 'Interview Prep'],
        defaultSplit: 'Prospecting',
        recommendationRationale: 'Recommends current sprint based on application pipeline depth and interview deadlines.',
      },
      {
        id: 'widget-interview-timer',
        type: 'interactive_timer',
        title: 'Mock Interview & Assessment Timer',
        gridSpan: 1,
        defaultSeconds: 1800, // 30 mins
        presetSeconds: [900, 1800, 2700, 3600],
        alertSound: true,
      },
      {
        id: 'widget-career-metrics',
        type: 'metric_counter',
        title: 'Application Targets',
        gridSpan: 2,
        counters: [
          { id: 'apps_sent', label: 'Applications Sent', unit: 'apps', current: 12, target: 30, step: 1, color: 'indigo' },
          { id: 'interviews_scheduled', label: 'Interviews Landed', unit: 'rounds', current: 3, target: 8, step: 1, color: 'emerald' },
          { id: 'network_reachouts', label: 'Cold Outreach', unit: 'emails', current: 8, target: 20, step: 2, color: 'sky' },
        ],
      },
      {
        id: 'widget-career-logs',
        type: 'entity_log_list',
        title: 'Active Opportunity Pipeline',
        gridSpan: 4,
        schemaId: schemaId,
        allowVoiceInput: true,
        quickAddFields: ['company', 'role', 'stage', 'location', 'salary_range'],
        columns: [
          { key: 'company', label: 'Company', type: 'string', editable: true },
          { key: 'role', label: 'Position', type: 'string', editable: true },
          { key: 'stage', label: 'Stage', type: 'badge' },
          { key: 'location', label: 'Location', type: 'string', editable: true },
          { key: 'salary_range', label: 'Salary Target', type: 'string', editable: true },
          { key: 'completed', label: 'Closed', type: 'boolean', editable: true, defaultValue: false },
        ],
      },
    ],
  };

  const plugin: WorkspacePlugin = {
    id: manifest.id,
    name: manifest.title,
    description: manifest.description,
    version: '1.0.0',
    category: 'productivity',
    icon: 'target',
    author: 'Flowmate Autonomous Generator',
    manifest,
    enabled: true,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };

  generativeWorkspaceManager.registerDashboard(manifest);
  globalWorkspacePluginRegistry.registerPlugin(plugin);
  try {
    syncWorkspacePluginToCloud(plugin);
  } catch {
    // Offline / test safe fallback
  }
  return plugin;
}

/**
 * Autonomous Workspace Generator: turns any arbitrary user topic or prompt into
 * a functional schema, widgets, and registered workspace.
 */
export function generateWorkspaceFromPrompt(request: WorkspaceGenerationRequest): WorkspacePlugin {
  const topicLower = request.topic.toLowerCase();
  const hasCustomSpecs = Boolean(
    request.custom_attributes ||
    request.pipeline_stages?.length ||
    request.suggested_widgets?.length ||
    request.initial_records?.length
  );

  let effectiveRequest = { ...request };

  // If no custom specs were provided, use rich canonical templates or autonomous archetype synthesizers
  if (!hasCustomSpecs) {
    if (topicLower.includes('paper') || topicLower.includes('research') || topicLower.includes('literature') || topicLower.includes('reading')) {
      const plugin = createResearchPaperWorkspace();
      globalWorkspacePluginRegistry.registerPlugin(plugin);
      return plugin;
    }

    if (topicLower.includes('job') || topicLower.includes('career') || topicLower.includes('interview') || topicLower.includes('placement') || topicLower.includes('application')) {
      const plugin = createJobApplicationWorkspace();
      globalWorkspacePluginRegistry.registerPlugin(plugin);
      return plugin;
    }

    // Domain Archetype Synthesizers
    if (topicLower.includes('real estate') || topicLower.includes('property') || topicLower.includes('acquisition') || topicLower.includes('housing') || topicLower.includes('realtor')) {
      const slug = 'real_estate_acquisition';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'finance',
        icon: request.icon || 'building',
        description: request.description || 'Intelligent acquisition pipeline, underwriting metrics, cap rate calculations, and closing workflow.',
        pipeline_stages: [
          { id: 'lead', label: 'Lead & Sourcing', color: 'indigo' },
          { id: 'underwriting', label: 'Underwriting & Due Diligence', color: 'amber' },
          { id: 'loi', label: 'LOI & Offer Submitted', color: 'sky' },
          { id: 'escrow', label: 'In Escrow / Closing', color: 'purple' },
          { id: 'acquired', label: 'Closed & Portfolio Asset', color: 'emerald' },
        ],
        custom_attributes: {
          property_address: { name: 'property_address', label: 'Address', type: 'string', required: true, description: 'Street address' },
          property_type: { name: 'property_type', label: 'Asset Type', type: 'string', required: false, default_value: 'Multifamily', description: 'Property category' },
          deal_size: { name: 'deal_size', label: 'Purchase Price ($)', type: 'number', required: true, default_value: 2500000, description: 'Acquisition price' },
          cap_rate_pct: { name: 'cap_rate_pct', label: 'Cap Rate (%)', type: 'number', required: false, default_value: 6.8, description: 'Capitalization rate percentage' },
          target_close: { name: 'target_close', label: 'Closing Date', type: 'string', required: false, description: 'Target settlement date' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Acquisition Pipeline Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'lead', label: 'Lead & Sourcing', color: 'indigo' },
              { id: 'underwriting', label: 'Underwriting & Due Diligence', color: 'amber' },
              { id: 'loi', label: 'LOI & Offer Submitted', color: 'sky' },
              { id: 'escrow', label: 'In Escrow / Closing', color: 'purple' },
              { id: 'acquired', label: 'Closed & Portfolio Asset', color: 'emerald' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'property_address',
              badgeField: 'property_type',
              metaField: 'deal_size',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Portfolio Underwriting Totals',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-deal-sum', label: 'Total Acquisition Value', aggregation: 'sum', targetField: 'deal_size', prefix: '$' },
              { id: 'calc-cap-avg', label: 'Average Cap Rate', aggregation: 'avg', targetField: 'cap_rate_pct', unit: '%' },
              { id: 'calc-prop-count', label: 'Total Underwritten Properties', aggregation: 'count' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Property Deal Records',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'property_address', 'deal_size', 'cap_rate_pct', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Property Title', type: 'string', editable: true },
              { key: 'property_address', label: 'Address', type: 'string', editable: true },
              { key: 'deal_size', label: 'Purchase Price ($)', type: 'number', editable: true },
              { key: 'cap_rate_pct', label: 'Cap Rate (%)', type: 'number', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'Oakridge Terrace Multifamily', attributes: { property_address: '840 Skyline Blvd', property_type: 'Multifamily (36 units)', deal_size: 4800000, cap_rate_pct: 7.1, pipeline_stage: 'underwriting' } },
          { title: 'Harbor Commercial Plaza', attributes: { property_address: '102 Pier Way', property_type: 'Retail Mixed-Use', deal_size: 3200000, cap_rate_pct: 6.9, pipeline_stage: 'loi' } },
          { title: 'AeroTech Industrial Logistics', attributes: { property_address: '450 Airport Rd', property_type: 'Industrial Warehouse', deal_size: 6500000, cap_rate_pct: 7.8, pipeline_stage: 'escrow' } },
        ],
      };
    } else if (topicLower.includes('sale') || topicLower.includes('crm') || topicLower.includes('deal') || topicLower.includes('outreach') || topicLower.includes('client')) {
      const slug = 'sales_deal_crm';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'productivity',
        icon: request.icon || 'briefcase',
        description: request.description || 'Enterprise sales pipeline, stage velocity, deal value summaries, and account tracking.',
        pipeline_stages: [
          { id: 'prospect', label: 'Inbound / Prospect', color: 'slate' },
          { id: 'discovery', label: 'Discovery Call', color: 'indigo' },
          { id: 'demo', label: 'Product Demonstration', color: 'amber' },
          { id: 'proposal', label: 'Contract & Proposal', color: 'sky' },
          { id: 'won', label: 'Closed Won', color: 'emerald' },
        ],
        custom_attributes: {
          account_name: { name: 'account_name', label: 'Client / Account', type: 'string', required: true, description: 'Organization name' },
          deal_value: { name: 'deal_value', label: 'Deal Size ($)', type: 'number', required: true, default_value: 50000, description: 'Contract ARR or value' },
          win_probability_pct: { name: 'win_probability_pct', label: 'Win Probability (%)', type: 'number', required: false, default_value: 50, description: 'Likelihood to close' },
          champion: { name: 'champion', label: 'Internal Champion', type: 'string', required: false, description: 'Primary contact' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Sales Opportunity Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'prospect', label: 'Inbound / Prospect', color: 'slate' },
              { id: 'discovery', label: 'Discovery Call', color: 'indigo' },
              { id: 'demo', label: 'Product Demonstration', color: 'amber' },
              { id: 'proposal', label: 'Contract & Proposal', color: 'sky' },
              { id: 'won', label: 'Closed Won', color: 'emerald' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'account_name',
              badgeField: 'pipeline_stage',
              metaField: 'deal_value',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Revenue & Quota Pipeline',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-arr-sum', label: 'Gross Pipeline ARR', aggregation: 'sum', targetField: 'deal_value', prefix: '$' },
              { id: 'calc-prob-avg', label: 'Average Win Probability', aggregation: 'avg', targetField: 'win_probability_pct', unit: '%' },
              { id: 'calc-opp-count', label: 'Active Opportunities', aggregation: 'count' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Active Deal Records',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'account_name', 'deal_value', 'win_probability_pct', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Opportunity', type: 'string', editable: true },
              { key: 'account_name', label: 'Account', type: 'string', editable: true },
              { key: 'deal_value', label: 'Deal Value ($)', type: 'number', editable: true },
              { key: 'win_probability_pct', label: 'Win Prob (%)', type: 'number', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'Global Enterprise Migration', attributes: { account_name: 'Starlight Corp', deal_value: 120000, win_probability_pct: 75, pipeline_stage: 'proposal' } },
          { title: 'Core Analytics Expansion', attributes: { account_name: 'Apex Health Systems', deal_value: 65000, win_probability_pct: 50, pipeline_stage: 'demo' } },
          { title: 'Developer Tools SLA', attributes: { account_name: 'FinTech Innovations', deal_value: 40000, win_probability_pct: 30, pipeline_stage: 'discovery' } },
        ],
      };
    } else if (topicLower.includes('recruit') || topicLower.includes('hiring') || topicLower.includes('candidate') || topicLower.includes('talent')) {
      const slug = 'recruiting_pipeline';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'productivity',
        icon: request.icon || 'users',
        description: request.description || 'Candidate sourcing, interview pipeline, compensation benchmarks, and hiring workflow.',
        pipeline_stages: [
          { id: 'sourced', label: 'Sourced & In Review', color: 'slate' },
          { id: 'screen', label: 'Recruiter Screen', color: 'indigo' },
          { id: 'tech', label: 'Technical Evaluation', color: 'amber' },
          { id: 'final', label: 'Leadership Onsite', color: 'purple' },
          { id: 'offer', label: 'Offer Extended', color: 'emerald' },
        ],
        custom_attributes: {
          candidate_name: { name: 'candidate_name', label: 'Candidate Name', type: 'string', required: true, description: 'Full name' },
          role_applied: { name: 'role_applied', label: 'Position', type: 'string', required: true, default_value: 'Senior Engineer', description: 'Job title' },
          score_out_of_5: { name: 'score_out_of_5', label: 'Interview Score (1-5)', type: 'number', required: false, default_value: 4.5, description: 'Composite evaluation' },
          target_compensation: { name: 'target_compensation', label: 'Target Comp ($)', type: 'number', required: false, default_value: 180000, description: 'Base salary' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Recruiting Funnel Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'sourced', label: 'Sourced & In Review', color: 'slate' },
              { id: 'screen', label: 'Recruiter Screen', color: 'indigo' },
              { id: 'tech', label: 'Technical Evaluation', color: 'amber' },
              { id: 'final', label: 'Leadership Onsite', color: 'purple' },
              { id: 'offer', label: 'Offer Extended', color: 'emerald' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'role_applied',
              badgeField: 'pipeline_stage',
              metaField: 'score_out_of_5',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Talent Acquisition Metrics',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-score-avg', label: 'Average Interview Score', aggregation: 'avg', targetField: 'score_out_of_5' },
              { id: 'calc-comp-avg', label: 'Average Target Comp', aggregation: 'avg', targetField: 'target_compensation', prefix: '$' },
              { id: 'calc-cand-count', label: 'Candidates in Funnel', aggregation: 'count' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Candidate Pool',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'role_applied', 'score_out_of_5', 'target_compensation', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Candidate', type: 'string', editable: true },
              { key: 'role_applied', label: 'Role', type: 'string', editable: true },
              { key: 'score_out_of_5', label: 'Rating (1-5)', type: 'number', editable: true },
              { key: 'target_compensation', label: 'Comp ($)', type: 'number', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'Dr. Sarah Connor', attributes: { candidate_name: 'Dr. Sarah Connor', role_applied: 'Staff AI Research Scientist', score_out_of_5: 4.9, target_compensation: 260000, pipeline_stage: 'final' } },
          { title: 'Marcus Brody', attributes: { candidate_name: 'Marcus Brody', role_applied: 'Senior Frontend Architect', score_out_of_5: 4.4, target_compensation: 195000, pipeline_stage: 'tech' } },
        ],
      };
    } else if (topicLower.includes('content') || topicLower.includes('editorial') || topicLower.includes('podcast') || topicLower.includes('youtube') || topicLower.includes('creator')) {
      const slug = 'editorial_content';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'custom',
        icon: request.icon || 'pen-tool',
        description: request.description || 'Editorial calendar, content staging, production time tracking, and release management.',
        pipeline_stages: [
          { id: 'ideation', label: 'Pitches & Ideation', color: 'slate' },
          { id: 'drafting', label: 'Drafting & Research', color: 'indigo' },
          { id: 'production', label: 'Production / Editing', color: 'amber' },
          { id: 'review', label: 'Final Review', color: 'purple' },
          { id: 'published', label: 'Published & Live', color: 'emerald' },
        ],
        custom_attributes: {
          channel: { name: 'channel', label: 'Channel', type: 'string', required: true, default_value: 'YouTube', description: 'Platform' },
          est_duration_min: { name: 'est_duration_min', label: 'Duration (min)', type: 'number', required: false, default_value: 15, description: 'Estimated length' },
          target_date: { name: 'target_date', label: 'Target Release Date', type: 'string', required: false, description: 'Date of publication' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Editorial Calendar Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'ideation', label: 'Pitches & Ideation', color: 'slate' },
              { id: 'drafting', label: 'Drafting & Research', color: 'indigo' },
              { id: 'production', label: 'Production / Editing', color: 'amber' },
              { id: 'review', label: 'Final Review', color: 'purple' },
              { id: 'published', label: 'Published & Live', color: 'emerald' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'channel',
              badgeField: 'pipeline_stage',
              metaField: 'est_duration_min',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Content Volume Summary',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-dur-sum', label: 'Total Content Minutes', aggregation: 'sum', targetField: 'est_duration_min', unit: 'min' },
              { id: 'calc-dur-avg', label: 'Average Duration', aggregation: 'avg', targetField: 'est_duration_min', unit: 'min' },
              { id: 'calc-rel-count', label: 'Total Planned Releases', aggregation: 'count' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Editorial Content Schedule',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'channel', 'est_duration_min', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Title', type: 'string', editable: true },
              { key: 'channel', label: 'Channel', type: 'string', editable: true },
              { key: 'est_duration_min', label: 'Duration (min)', type: 'number', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'Building Distributed Sync with CRDT Semantics', attributes: { channel: 'Technical Blog', est_duration_min: 14, pipeline_stage: 'drafting' } },
          { title: 'The Next Generation of Personal Operating Systems', attributes: { channel: 'YouTube Video', est_duration_min: 24, pipeline_stage: 'production' } },
        ],
      };
    } else if (topicLower.includes('bug') || topicLower.includes('issue') || topicLower.includes('sprint') || topicLower.includes('release') || topicLower.includes('ticket')) {
      const slug = 'sprint_bug_tracker';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'productivity',
        icon: request.icon || 'terminal',
        description: request.description || 'Sprint backlog, defect triage, story points estimation, and release verification.',
        pipeline_stages: [
          { id: 'triage', label: 'Backlog / Triage', color: 'rose' },
          { id: 'in_dev', label: 'In Development', color: 'indigo' },
          { id: 'code_review', label: 'Code Review', color: 'amber' },
          { id: 'qa', label: 'QA & Staging', color: 'sky' },
          { id: 'shipped', label: 'Released to Prod', color: 'emerald' },
        ],
        custom_attributes: {
          severity: { name: 'severity', label: 'Severity', type: 'string', required: true, default_value: 'P2', description: 'Urgency tier' },
          story_points: { name: 'story_points', label: 'Story Points', type: 'number', required: true, default_value: 3, description: 'Effort estimate' },
          component: { name: 'component', label: 'Module / Subsystem', type: 'string', required: false, description: 'Component tag' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Sprint Release Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'triage', label: 'Backlog / Triage', color: 'rose' },
              { id: 'in_dev', label: 'In Development', color: 'indigo' },
              { id: 'code_review', label: 'Code Review', color: 'amber' },
              { id: 'qa', label: 'QA & Staging', color: 'sky' },
              { id: 'shipped', label: 'Released to Prod', color: 'emerald' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'component',
              badgeField: 'severity',
              metaField: 'story_points',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Sprint Velocity Metrics',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-points-sum', label: 'Total Sprint Story Points', aggregation: 'sum', targetField: 'story_points', unit: 'pts' },
              { id: 'calc-points-avg', label: 'Average Ticket Weight', aggregation: 'avg', targetField: 'story_points', unit: 'pts' },
              { id: 'calc-issue-count', label: 'Total Issues Tracked', aggregation: 'count' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Sprint Ticket Backlog',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'severity', 'story_points', 'component', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Issue', type: 'string', editable: true },
              { key: 'severity', label: 'Severity', type: 'badge' },
              { key: 'story_points', label: 'Points', type: 'number', editable: true },
              { key: 'component', label: 'Component', type: 'string', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'Eliminate audio phase clicks on hardware rate transitions', attributes: { severity: 'P1', story_points: 5, component: 'Audio Engine', pipeline_stage: 'code_review' } },
          { title: 'Add real-time workspace deletion tombstone synchronization', attributes: { severity: 'P1', story_points: 3, component: 'Sync Coordinator', pipeline_stage: 'qa' } },
        ],
      };
    } else if (topicLower.includes('invest') || topicLower.includes('portfolio') || topicLower.includes('venture') || topicLower.includes('asset')) {
      const slug = 'venture_investment';
      const sId = `user/${slug}_item`;
      effectiveRequest = {
        ...request,
        category: request.category || 'finance',
        icon: request.icon || 'trending-up',
        description: request.description || 'Investment diligence, round valuations, check sizes, and holding returns.',
        pipeline_stages: [
          { id: 'sourcing', label: 'Sourcing & Pitch', color: 'slate' },
          { id: 'diligence', label: 'Active Diligence', color: 'indigo' },
          { id: 'term_sheet', label: 'Term Sheet Issued', color: 'amber' },
          { id: 'active', label: 'Active Portfolio', color: 'emerald' },
          { id: 'exited', label: 'Exited Holding', color: 'purple' },
        ],
        custom_attributes: {
          asset_class: { name: 'asset_class', label: 'Asset Class', type: 'string', required: true, default_value: 'Venture Seed', description: 'Investment vehicle' },
          invested_amount: { name: 'invested_amount', label: 'Invested Check ($)', type: 'number', required: true, default_value: 200000, description: 'Principal capital' },
          current_valuation: { name: 'current_valuation', label: 'Current Valuation ($)', type: 'number', required: true, default_value: 600000, description: 'Fair market value' },
          moic: { name: 'moic', label: 'MOIC Multiple', type: 'number', required: false, default_value: 3.0, description: 'Multiple on invested capital' },
        },
        suggested_widgets: [
          {
            id: `widget-${slug}-pipeline`,
            type: 'pipeline_stage_board',
            title: 'Deal Flow & Portfolio Kanban',
            gridSpan: 4,
            schemaId: sId,
            stageField: 'pipeline_stage',
            stages: [
              { id: 'sourcing', label: 'Sourcing & Pitch', color: 'slate' },
              { id: 'diligence', label: 'Active Diligence', color: 'indigo' },
              { id: 'term_sheet', label: 'Term Sheet Issued', color: 'amber' },
              { id: 'active', label: 'Active Portfolio', color: 'emerald' },
              { id: 'exited', label: 'Exited Holding', color: 'purple' },
            ],
            cardFields: {
              titleField: 'name',
              subtitleField: 'asset_class',
              badgeField: 'pipeline_stage',
              metaField: 'current_valuation',
            },
          },
          {
            id: `widget-${slug}-calculations`,
            type: 'calculation_summary',
            title: 'Portfolio Return Summary',
            gridSpan: 4,
            schemaId: sId,
            calculations: [
              { id: 'calc-inv-sum', label: 'Total Invested Capital', aggregation: 'sum', targetField: 'invested_amount', prefix: '$' },
              { id: 'calc-val-sum', label: 'Total Portfolio Valuation', aggregation: 'sum', targetField: 'current_valuation', prefix: '$' },
              { id: 'calc-moic-avg', label: 'Average MOIC', aggregation: 'avg', targetField: 'moic', unit: 'x' },
            ],
          },
          {
            id: `widget-${slug}-logs`,
            type: 'entity_log_list',
            title: 'Portfolio Holdings & Deals',
            gridSpan: 4,
            schemaId: sId,
            allowVoiceInput: true,
            quickAddFields: ['name', 'asset_class', 'invested_amount', 'current_valuation', 'pipeline_stage'],
            columns: [
              { key: 'name', label: 'Company', type: 'string', editable: true },
              { key: 'asset_class', label: 'Asset Class', type: 'string', editable: true },
              { key: 'invested_amount', label: 'Invested ($)', type: 'number', editable: true },
              { key: 'current_valuation', label: 'Valuation ($)', type: 'number', editable: true },
              { key: 'pipeline_stage', label: 'Stage', type: 'badge' },
            ],
          },
        ],
        initial_records: [
          { title: 'NeuraLink Systems', attributes: { asset_class: 'Seed Venture', invested_amount: 250000, current_valuation: 1000000, moic: 4.0, pipeline_stage: 'active' } },
          { title: 'HyperScale Computing', attributes: { asset_class: 'Series A', invested_amount: 500000, current_valuation: 1250000, moic: 2.5, pipeline_stage: 'active' } },
        ],
      };
    } else if (topicLower.includes('pipeline') || topicLower.includes('funnel') || topicLower.includes('stage') || topicLower.includes('process') || topicLower.includes('flow') || topicLower.includes('kanban')) {
      effectiveRequest = {
        ...request,
        pipeline_stages: [
          { id: 'intake', label: 'Intake / New', color: 'slate' },
          { id: 'in_progress', label: 'In Progress', color: 'indigo' },
          { id: 'review', label: 'In Review', color: 'amber' },
          { id: 'completed', label: 'Completed', color: 'emerald' },
        ],
      };
    }
  }

  // Pure Autonomous Synthesizer for arbitrary domains and customized workflows
  const sanitizedSlug = effectiveRequest.topic.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 24);
  const explicitWidget = effectiveRequest.suggested_widgets?.find(
    w => 'schemaId' in w && typeof (w as { schemaId?: unknown }).schemaId === 'string' && Boolean((w as { schemaId: string }).schemaId)
  );
  const explicitSchemaId = explicitWidget && 'schemaId' in explicitWidget ? (explicitWidget as { schemaId: string }).schemaId : undefined;
  const schemaId = explicitSchemaId || `user/${sanitizedSlug}_item`;
  const now = new Date().toISOString();

  const attributes: Record<string, AttributeDefinition> = {
    name: {
      name: 'name',
      label: 'Name',
      type: 'string',
      required: true,
      description: 'Primary item name or title',
    },
    status: {
      name: 'status',
      label: 'Status',
      type: 'string',
      required: true,
      default_value: 'Active',
      description: 'Item progress status',
    },
    notes: {
      name: 'notes',
      label: 'Notes',
      type: 'string',
      required: false,
      description: 'Contextual notes and observations',
    },
    priority: {
      name: 'priority',
      label: 'Priority',
      type: 'number',
      required: false,
      default_value: 2,
      description: 'Priority level (1-3)',
    },
    completed: {
      name: 'completed',
      label: 'Completed',
      type: 'boolean',
      required: false,
      default_value: false,
      description: 'Completed',
    },
  };

  // Add custom attributes if provided
  if (Array.isArray(effectiveRequest.custom_attributes)) {
    for (const attr of effectiveRequest.custom_attributes) {
      attributes[attr.name] = attr;
    }
  } else if (effectiveRequest.custom_attributes && typeof effectiveRequest.custom_attributes === 'object') {
    Object.assign(attributes, effectiveRequest.custom_attributes);
  }

  // Ensure pipeline_stage attribute exists if pipeline stages are provided
  if (effectiveRequest.pipeline_stages && effectiveRequest.pipeline_stages.length > 0 && !attributes['pipeline_stage']) {
    attributes['pipeline_stage'] = {
      name: 'pipeline_stage',
      label: 'Pipeline Stage',
      type: 'string',
      required: true,
      default_value: effectiveRequest.pipeline_stages[0].id,
      description: 'Current pipeline stage',
    };
  }

  const schema: SchemaDefinition = {
    id: schemaId,
    version: 1,
    displayName: `${effectiveRequest.topic} Item`,
    description: `Dynamic domain schema for ${effectiveRequest.topic}`,
    scope: 'user',
    privacy_tier: 'private',
    created_at: now,
    updated_at: now,
    capabilities: ['schedulable', 'actionable'],
    attributes,
  };

  if (!dynamicSchemaRegistry.has(schemaId)) {
    dynamicSchemaRegistry.register(schema);
  }
  try {
    useStore.setState(s => ({ schemas: { ...s.schemas, [schemaId]: schema } }));
  } catch {
    // In headless tests or SSR, store might not be mounted
  }
  try {
    syncDynamicSchemaToCloud(schema);
  } catch {
    // Offline / test safe fallback
  }

  let widgets: DashboardWidgetConfig[] = [];
  if (effectiveRequest.suggested_widgets && effectiveRequest.suggested_widgets.length > 0) {
    widgets = effectiveRequest.suggested_widgets.map(w => {
      if ('schemaId' in w && !(w as { schemaId?: string }).schemaId) {
        return { ...w, schemaId } as DashboardWidgetConfig;
      }
      return w;
    });
  } else {
    widgets = [
      {
        id: `widget-${sanitizedSlug}-timer`,
        type: 'interactive_timer',
        title: `${effectiveRequest.topic} Focus Timer`,
        gridSpan: 2,
        defaultSeconds: 1500, // 25 min
        presetSeconds: [300, 900, 1500, 3000],
        alertSound: true,
      },
      {
        id: `widget-${sanitizedSlug}-metrics`,
        type: 'metric_counter',
        title: `${effectiveRequest.topic} Progress Targets`,
        gridSpan: 2,
        counters: [
          { id: 'target_count', label: 'Milestones Completed', unit: 'items', current: 0, target: 10, step: 1, color: 'indigo' },
          { id: 'hours_invested', label: 'Hours Invested', unit: 'hrs', current: 0, target: 20, step: 1, color: 'emerald' },
        ],
      },
      {
        id: `widget-${sanitizedSlug}-logs`,
        type: 'entity_log_list',
        title: `${effectiveRequest.topic} Active Items & Records`,
        gridSpan: 4,
        schemaId: schemaId,
        allowVoiceInput: true,
        quickAddFields: ['name', 'status', 'notes', 'priority'],
        columns: [
          { key: 'name', label: 'Name', type: 'string', editable: true },
          { key: 'status', label: 'Status', type: 'badge' },
          { key: 'notes', label: 'Notes', type: 'string', editable: true },
          { key: 'priority', label: 'Priority', type: 'number', editable: true, defaultValue: 2 },
          { key: 'completed', label: 'Done', type: 'boolean', editable: true, defaultValue: false },
        ],
      },
    ];

    if (effectiveRequest.pipeline_stages && effectiveRequest.pipeline_stages.length > 0) {
      widgets.unshift({
        id: `widget-${sanitizedSlug}-pipeline`,
        type: 'pipeline_stage_board',
        title: `${effectiveRequest.topic} Pipeline`,
        gridSpan: 4,
        schemaId: schemaId,
        stageField: 'pipeline_stage',
        stages: effectiveRequest.pipeline_stages,
        cardFields: {
          titleField: 'name',
          subtitleField: 'status',
          badgeField: 'priority',
        },
      });
    }
  }

  const manifest: DashboardManifest = {
    id: `dash-${sanitizedSlug}`,
    title: effectiveRequest.topic,
    description: effectiveRequest.description || `Autonomously generated workspace tailored for ${effectiveRequest.topic}.`,
    category: effectiveRequest.category || 'custom',
    icon: effectiveRequest.icon || 'sparkles',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    associatedSchemas: [schema],
    widgets,
  };

  // Populate initial records if provided
  if (effectiveRequest.initial_records && effectiveRequest.initial_records.length > 0) {
    try {
      const newEntities: Record<string, KernelEntity> = {};
      const nowIso = new Date().toISOString();
      for (const rec of effectiveRequest.initial_records) {
        const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const recordObj = rec as Record<string, unknown>;
        const title = String(recordObj.title || recordObj.name || recordObj.company_name || 'Untitled');
        const customAttrs = (recordObj.attributes && typeof recordObj.attributes === 'object')
          ? (recordObj.attributes as Record<string, AttributeValue>)
          : {};
        const attrs: Record<string, AttributeValue> = {
          name: title,
          title: title,
          logged_at: nowIso,
          ...customAttrs,
          ...(recordObj as Record<string, AttributeValue>),
        };
        // Clean up nested attributes key if duplicated
        delete attrs.attributes;
        newEntities[id] = {
          id,
          schema_id: schemaId,
          version: 1,
          title,
          attributes: attrs,
          lifecycle: { status: 'active', created_at: nowIso, updated_at: nowIso, deleted_at: null },
          provenance: { source_type: 'agent', observed_at: nowIso, confidence: 1.0, is_inferred: false, user_confirmed: true },
        };
      }
      useStore.setState(s => ({
        kernelEntities: { ...s.kernelEntities, ...newEntities },
      }));
    } catch {
      // Store update safe fallback
    }
  }

  const plugin: WorkspacePlugin = {
    id: manifest.id,
    name: manifest.title,
    description: manifest.description,
    version: '1.0.0',
    category: request.category || 'custom',
    icon: request.icon || 'sparkles',
    author: 'Flowmate Autonomous Generator',
    manifest,
    enabled: true,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };

  generativeWorkspaceManager.registerDashboard(manifest);
  globalWorkspacePluginRegistry.registerPlugin(plugin);
  try {
    syncWorkspacePluginToCloud(plugin);
  } catch {
    // Offline / test safe fallback
  }
  return plugin;
}

export interface WorkspaceEvolutionRequest {
  workspace_id: string;
  action: 'add_widget' | 'remove_widget' | 'update_widget' | 'extend_schema' | 'update_metadata';
  widget?: DashboardWidgetConfig;
  widget_id?: string;
  schema_attribute?: AttributeDefinition;
  title?: string;
  description?: string;
}

/**
 * Evolve an existing workspace based on user instructions or automated adaptations.
 * Adds/removes widgets, extends schemas, updates metrics/timers, and persists the changes.
 */
export function evolveWorkspace(request: WorkspaceEvolutionRequest): {
  success: boolean;
  plugin: WorkspacePlugin;
  message: string;
} {
  const existingPlugin = globalWorkspacePluginRegistry.getPlugin(request.workspace_id);
  const existingDashboard = existingPlugin?.manifest || generativeWorkspaceManager.getDashboard(request.workspace_id);

  if (!existingDashboard) {
    throw new Error(`Workspace with ID "${request.workspace_id}" not found.`);
  }

  const updatedManifest: DashboardManifest = structuredClone(existingDashboard);
  updatedManifest.updatedAt = new Date().toISOString();

  let message = `Workspace "${updatedManifest.title}" evolved successfully.`;

  switch (request.action) {
    case 'add_widget': {
      if (!request.widget) throw new Error('Widget configuration is required for add_widget action.');
      const widgetToAdd: DashboardWidgetConfig = {
        ...request.widget,
        id: request.widget.id || `widget-${Date.now().toString(36)}`,
      };
      updatedManifest.widgets.push(widgetToAdd);
      message = `Added widget "${widgetToAdd.title}" to workspace "${updatedManifest.title}".`;
      break;
    }

    case 'remove_widget': {
      const targetId = request.widget_id || request.widget?.id;
      if (!targetId) throw new Error('Widget ID is required for remove_widget action.');
      const initialLen = updatedManifest.widgets.length;
      updatedManifest.widgets = updatedManifest.widgets.filter(w => w.id !== targetId);
      if (updatedManifest.widgets.length === initialLen) {
        throw new Error(`Widget with ID "${targetId}" not found in workspace.`);
      }
      message = `Removed widget "${targetId}" from workspace "${updatedManifest.title}".`;
      break;
    }

    case 'update_widget': {
      if (!request.widget || !request.widget.id) {
        throw new Error('Widget configuration with id is required for update_widget action.');
      }
      const idx = updatedManifest.widgets.findIndex(w => w.id === request.widget!.id);
      if (idx === -1) {
        throw new Error(`Widget with ID "${request.widget.id}" not found in workspace.`);
      }
      updatedManifest.widgets[idx] = { ...updatedManifest.widgets[idx], ...request.widget };
      message = `Updated widget "${request.widget.title || request.widget.id}" in workspace "${updatedManifest.title}".`;
      break;
    }

    case 'extend_schema': {
      if (!request.schema_attribute) {
        throw new Error('schema_attribute is required for extend_schema action.');
      }
      const targetSchemaId = updatedManifest.associatedSchemas[0]?.id;
      if (!targetSchemaId) {
        throw new Error('No associated schema found for this workspace to extend.');
      }
      const existingSchema = dynamicSchemaRegistry.get(targetSchemaId);
      if (!existingSchema) {
        throw new Error(`Schema "${targetSchemaId}" not found in dynamic registry.`);
      }
      const updatedSchema: SchemaDefinition = structuredClone(existingSchema);
      updatedSchema.attributes[request.schema_attribute.name] = request.schema_attribute;
      updatedSchema.version += 1;
      updatedSchema.updated_at = new Date().toISOString();
      dynamicSchemaRegistry.register(updatedSchema);
      try {
        useStore.setState(s => ({ schemas: { ...s.schemas, [targetSchemaId]: updatedSchema } }));
      } catch {
        // Safe fallback for SSR or headless tests
      }

      // Update associated schema in manifest
      const schemaIdx = updatedManifest.associatedSchemas.findIndex(s => s.id === targetSchemaId);
      if (schemaIdx >= 0) {
        updatedManifest.associatedSchemas[schemaIdx] = updatedSchema;
      }

      // Also automatically update any entity_log_list widget bound to this schema
      for (const widget of updatedManifest.widgets) {
        if (widget.type === 'entity_log_list' && widget.schemaId === targetSchemaId) {
          if (!widget.quickAddFields.includes(request.schema_attribute.name)) {
            widget.quickAddFields.push(request.schema_attribute.name);
          }
          if (!widget.columns.some(c => c.key === request.schema_attribute!.name)) {
            widget.columns.push({
              key: request.schema_attribute.name,
              label: request.schema_attribute.label,
              type: request.schema_attribute.type === 'number' ? 'number' : request.schema_attribute.type === 'boolean' ? 'boolean' : 'string',
              editable: true,
            });
          }
        }
      }
      message = `Extended schema "${targetSchemaId}" with attribute "${request.schema_attribute.name}" (${request.schema_attribute.label}).`;
      break;
    }

    case 'update_metadata': {
      if (request.title) updatedManifest.title = request.title;
      if (request.description) updatedManifest.description = request.description;
      message = `Updated metadata for workspace "${updatedManifest.title}".`;
      break;
    }
  }

  const updatedPlugin: WorkspacePlugin = {
    id: updatedManifest.id,
    name: updatedManifest.title,
    description: updatedManifest.description,
    version: existingPlugin?.version || '1.0.0',
    category: updatedManifest.category || existingPlugin?.category || 'custom',
    icon: updatedManifest.icon || existingPlugin?.icon || 'sparkles',
    author: existingPlugin?.author || 'Flowmate Autonomous Generator',
    manifest: updatedManifest,
    enabled: true,
    createdAt: updatedManifest.createdAt,
    updatedAt: updatedManifest.updatedAt,
  };

  generativeWorkspaceManager.registerDashboard(updatedManifest);
  globalWorkspacePluginRegistry.registerPlugin(updatedPlugin);
  try {
    syncWorkspacePluginToCloud(updatedPlugin);
  } catch {
    // Offline / test safe fallback
  }

  return {
    success: true,
    plugin: updatedPlugin,
    message,
  };
}
