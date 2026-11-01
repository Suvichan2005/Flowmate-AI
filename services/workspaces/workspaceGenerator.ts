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

import { SchemaDefinition, AttributeDefinition } from '../kernel/types';
import { dynamicSchemaRegistry } from '../kernel/dynamicSchemaRegistry';
import { DashboardManifest, DashboardWidgetConfig } from './generativeDashboardTypes';
import { WorkspacePlugin, globalWorkspacePluginRegistry } from './workspacePluginRegistry';
import { generativeWorkspaceManager } from './workspaceManager';
import { useStore } from '../../store';
import { syncWorkspacePluginToCloud } from '../syncManager';

export interface WorkspaceGenerationRequest {
  topic: string;
  category?: 'fitness' | 'productivity' | 'wellness' | 'education' | 'finance' | 'custom';
  description?: string;
  icon?: string;
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

  // If matches literature / research
  if (topicLower.includes('paper') || topicLower.includes('research') || topicLower.includes('literature') || topicLower.includes('reading')) {
    const plugin = createResearchPaperWorkspace();
    globalWorkspacePluginRegistry.registerPlugin(plugin);
    return plugin;
  }

  // If matches career / jobs / placement
  if (topicLower.includes('job') || topicLower.includes('career') || topicLower.includes('interview') || topicLower.includes('placement') || topicLower.includes('application')) {
    const plugin = createJobApplicationWorkspace();
    globalWorkspacePluginRegistry.registerPlugin(plugin);
    return plugin;
  }

  // Dynamic Generator for arbitrary topics (e.g. "Personal Finance Budget", "Travel Bucket List", "Language Learning")
  const sanitizedSlug = request.topic.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 24);
  const schemaId = `user/${sanitizedSlug}_item`;
  const now = new Date().toISOString();
  const schema: SchemaDefinition = {
    id: schemaId,
    version: 1,
    displayName: `${request.topic} Item`,
    description: `Dynamic domain schema for ${request.topic}`,
    scope: 'user',
    privacy_tier: 'private',
    created_at: now,
    updated_at: now,
    capabilities: ['schedulable', 'actionable'],
    attributes: {
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
    id: `dash-${sanitizedSlug}`,
    title: request.topic,
    description: request.description || `Autonomously generated workspace tailored for ${request.topic}.`,
    category: request.category || 'custom',
    icon: request.icon || 'sparkles',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    associatedSchemas: [schema],
    widgets: [
      {
        id: `widget-${sanitizedSlug}-timer`,
        type: 'interactive_timer',
        title: `${request.topic} Focus Timer`,
        gridSpan: 2,
        defaultSeconds: 1500, // 25 min
        presetSeconds: [300, 900, 1500, 3000],
        alertSound: true,
      },
      {
        id: `widget-${sanitizedSlug}-metrics`,
        type: 'metric_counter',
        title: `${request.topic} Progress Targets`,
        gridSpan: 2,
        counters: [
          { id: 'target_count', label: 'Milestones Completed', unit: 'items', current: 0, target: 10, step: 1, color: 'indigo' },
          { id: 'hours_invested', label: 'Hours Invested', unit: 'hrs', current: 0, target: 20, step: 1, color: 'emerald' },
        ],
      },
      {
        id: `widget-${sanitizedSlug}-logs`,
        type: 'entity_log_list',
        title: `${request.topic} Active Items & Records`,
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
    ],
  };

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
