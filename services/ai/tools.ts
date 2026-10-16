/**
 * AI Tool Definitions
 *
 * Function declarations that tell the Gemini model what tools are available.
 * Each tool maps to an executor function in ./executors.ts.
 */

import { FunctionDeclaration, Type, Tool } from "@google/genai";

// ---------------------------------------------------------------------------
// Read-only Tools
// ---------------------------------------------------------------------------

export const readCalendarTool: FunctionDeclaration = {
  name: "read_calendar",
  description:
    "Retrieve calendar events, scheduled tasks, and deadlines within a specific date range.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      start_date: { type: Type.STRING, description: "Start date (ISO 8601 YYYY-MM-DD)" },
      end_date: { type: Type.STRING, description: "End date (ISO 8601 YYYY-MM-DD)" },
    },
    required: ["start_date", "end_date"],
  },
};

export const searchEntitiesTool: FunctionDeclaration = {
  name: "search_entities",
  description:
    "Search for entities by title, tag, kind, or status. Useful for finding IDs or checking active goals.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Text to match in title or description" },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of tags to filter by (e.g., ['urgent', 'academics'])",
      },
      kind: { type: Type.STRING, description: "Entity kind (e.g., 'GOAL', 'TASK', 'PROJECT')" },
      status: { type: Type.STRING, description: "Entity status (e.g., 'ACTIVE', 'COMPLETED')" },
      limit: { type: Type.NUMBER, description: "Max results (default 10)" },
    },
    required: [],
  },
};

export const lookupFoodHistoryTool: FunctionDeclaration = {
  name: "lookup_food_history",
  description:
    "Get food logs with health tags, vendors, and quality notes. Use for food recommendations, spending analysis, or checking past meals.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      days: { type: Type.NUMBER, description: "Number of days to look back (default 30)" },
      source: { type: Type.STRING, description: "Filter by source: mess | ordered | homemade | outside" },
      vendor: { type: Type.STRING, description: "Filter by vendor name" },
      limit: { type: Type.NUMBER, description: "Max results (default 20)" },
    },
    required: [],
  },
};

export const getProductivityStatsTool: FunctionDeclaration = {
  name: "get_productivity_stats",
  description:
    "Get productivity metrics: focus score, productive hours, streaks. Can query specific date ranges.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      start_date: { type: Type.STRING, description: "Start date (ISO 8601 YYYY-MM-DD). Defaults to 30 days ago." },
      end_date: { type: Type.STRING, description: "End date (ISO 8601 YYYY-MM-DD). Defaults to today." },
    },
    required: [],
  },
};

export const lookupGoalsTool: FunctionDeclaration = {
  name: "lookup_goals",
  description:
    "Get goals with their progress, subtasks, and status. Use for progress queries or motivation.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, description: "Filter by status: ACTIVE | COMPLETED | ALL" },
      include_subtasks: { type: Type.BOOLEAN, description: "Include subtask details (default false)" },
      limit: { type: Type.NUMBER, description: "Max results (default 10)" },
    },
    required: [],
  },
};

export const lookupHabitsTool: FunctionDeclaration = {
  name: "lookup_habits",
  description:
    "Get habits with streak info and recent activity. Use for habit tracking queries.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      include_streaks: { type: Type.BOOLEAN, description: "Calculate and include streak info (default true)" },
      limit: { type: Type.NUMBER, description: "Max results (default 10)" },
    },
    required: [],
  },
};

export const lookupTravelRouteTool: FunctionDeclaration = {
  name: "lookup_travel_route",
  description:
    "Calculate grounded distance, road travel duration, and backward-scheduled journey itineraries between origin and destination. MUST be called whenever the user asks about travel time, distance, or plans a journey/train/flight.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      origin: {
        type: Type.STRING,
        description:
          "Starting location/address/campus/place. If omitted by user, leave blank to use configured home location.",
      },
      destination: {
        type: Type.STRING,
        description: "Destination location/station/airport/place.",
      },
      mode: {
        type: Type.STRING,
        description: "Travel mode: 'driving' (default), 'transit', or 'walking'.",
      },
      target_departure_time: {
        type: Type.STRING,
        description:
          "Target departure time in ISO 8601 format (e.g. '2026-10-07T21:30:00+05:30') for train or flight.",
      },
      station_buffer_minutes: {
        type: Type.NUMBER,
        description: "Minutes to arrive before train departure (default: 45).",
      },
      airport_buffer_minutes: {
        type: Type.NUMBER,
        description: "Minutes to arrive before flight departure (default: 120).",
      },
    },
    required: ["destination"],
  },
};

// ---------------------------------------------------------------------------
// Write Tool
// ---------------------------------------------------------------------------

export const applyChangesTool: FunctionDeclaration = {
  name: "apply_changes",
  description: "Propose changes to the graph (creating, updating, deleting, or linking entities) for user confirmation and kernel execution.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      explanation: {
        type: Type.STRING,
        description: "A brief, friendly message describing what changes are proposed/prepared for the user to review and confirm. Do NOT claim actions are already scheduled, created, or executed.",
      },
      ops: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              enum: [
                // Short aliases (token-optimized)
                'c', 'u', 'd', 'l', 's', 'f', 'log', 'arc',
                // Full names (backward compatibility)
                'create_entity', 'update_entity', 'delete_entity',
                'link_entities', 'unlink_entities',
                'add_subtask', 'toggle_subtask', 'delete_subtask',
                'log_to_entity', 'archive_entity', 'log_food',
                // Deprecated (still supported)
                'log_activity', 'schedule_event', 'set_goal_progress', 'tag_update',
              ],
            },
            payload: {
              type: Type.OBJECT,
              description: "The data for the operation. See schema rules.",
            },
          },
          required: ['type', 'payload'],
        },
      },
    },
    required: ['ops', 'explanation'],
  },
};

// ---------------------------------------------------------------------------
// Greenfield Kernel Tools (Schema Reflection & Unified Entity Query)
// ---------------------------------------------------------------------------

export const queryEntitiesTool: FunctionDeclaration = {
  name: "query_entities",
  description:
    "Unified query engine for entities in the personal knowledge graph. Filter by schema ID, capability, status, tags, keywords, or date ranges.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Text to search in title, description, or attributes" },
      schema_id: {
        type: Type.STRING,
        description: "Schema ID (e.g., 'system/task', 'system/event', 'system/goal', 'system/habit', 'system/note')",
      },
      capability: {
        type: Type.STRING,
        description: "Capability filter (e.g., 'temporal', 'schedulable', 'actionable', 'recurrent', 'locational')",
      },
      status: { type: Type.STRING, description: "Lifecycle status (e.g., 'active', 'completed', 'archived')" },
      date_range: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING, description: "Start date/datetime (ISO 8601)" },
          end: { type: Type.STRING, description: "End date/datetime (ISO 8601)" },
        },
        description: "Date range window for temporal entities",
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Tags to filter by",
      },
      limit: { type: Type.NUMBER, description: "Max results (bounded to 25 max, default 10)" },
    },
    required: [],
  },
};

export const reflectSchemasTool: FunctionDeclaration = {
  name: "reflect_schemas",
  description:
    "Inspect the schema registry to discover available entity schemas, capability contracts, and attribute definitions.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      scope: { type: Type.STRING, description: "Filter by scope: 'system', 'user', or 'all' (default: 'all')" },
      schema_id: { type: Type.STRING, description: "Optional specific schema ID to inspect in detail" },
    },
    required: [],
  },
};

export const queryCommitmentTool: FunctionDeclaration = {
  name: "query_commitment",
  description:
    "Query the progress, streak projection, evidence, and reminder status of an entity's recurring commitment (e.g. weekly or daily goals/habits).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      entity_id: { type: Type.STRING, description: "ID of the entity to query" },
      reference_date: { type: Type.STRING, description: "Optional ISO date to evaluate period progress against (defaults to today)" },
    },
    required: ["entity_id"],
  },
};

export const configureCommitmentTool: FunctionDeclaration = {
  name: "configure_commitment",
  description:
    "Configure a recurring commitment, cadence, and reminder policy on an entity (e.g. 'work on Flowmate once a week', 'exercise 3 times a week').",
  parameters: {
    type: Type.OBJECT,
    properties: {
      entity_id: { type: Type.STRING, description: "ID of the target entity" },
      target_count: { type: Type.NUMBER, description: "Target count per period (e.g. 1, 3, 5)" },
      period: { type: Type.STRING, description: "Cadence period: 'day', 'week', 'month', or 'year'" },
      target_unit: { type: Type.STRING, description: "Unit of target (e.g. 'times', 'hours', 'pages')" },
      reminder_enabled: { type: Type.BOOLEAN, description: "Whether to enable reminders" },
      reminder_time: { type: Type.STRING, description: "Preferred reminder time of day (e.g. '18:00')" },
      reminder_day: { type: Type.NUMBER, description: "Preferred reminder day of week (0 = Sunday .. 6 = Saturday)" },
    },
    required: ["entity_id", "target_count", "period"],
  },
};

export const recordCommitmentEvidenceTool: FunctionDeclaration = {
  name: "record_commitment_evidence",
  description:
    "Record timestamped evidence toward an entity's commitment (e.g. 'I worked on Flowmate today', 'Ran 5km'). Includes provenance.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      entity_id: { type: Type.STRING, description: "ID of the entity" },
      quantity: { type: Type.NUMBER, description: "Quantity or count to record (default: 1)" },
      timestamp: { type: Type.STRING, description: "Optional ISO timestamp (defaults to current time)" },
      note: { type: Type.STRING, description: "Optional description or note of what was done" },
      user_confirmed: { type: Type.BOOLEAN, description: "True if user explicitly confirmed, false if inferred by AI" },
    },
    required: ["entity_id"],
  },
};

export const searchMemoryTool: FunctionDeclaration = {
  name: "search_memory",
  description:
    "Search persistent user memories and situational states by keyword, category, or status. Use when user asks 'what do you remember about me', 'what are my preferences', or to check past context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Keyword or phrase to match in memory content" },
      category: {
        type: Type.STRING,
        enum: ["preference", "fact", "project_context", "relationship", "goal_aspiration", "routine"],
        description: "Filter by memory category",
      },
      include_situational: { type: Type.BOOLEAN, description: "Whether to include temporary situational states (default true)" },
      include_superseded: { type: Type.BOOLEAN, description: "Whether to include superseded, halted, or historical memories (default false)" },
      limit: { type: Type.NUMBER, description: "Max results to return (default 10)" },
    },
  },
};

export const getRelevantContextTool: FunctionDeclaration = {
  name: "get_relevant_context",
  description:
    "Retrieve the current unified context snapshot including user profile, active situational state, durable memories, and device context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      include_entities: { type: Type.BOOLEAN, description: "Whether to include domain entities (default true)" },
      include_memories: { type: Type.BOOLEAN, description: "Whether to include persistent memories (default true)" },
    },
  },
};

export const proposeMemoryUpdateTool: FunctionDeclaration = {
  name: "propose_memory_update",
  description:
    "Propose saving a durable user preference, fact, or temporary situational state. NOTE: Inferences CANNOT self-confirm; this generates an ActionProposal that requires user review/confirmation.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: { type: Type.STRING, description: "The memory fact, preference, or situational detail to store" },
      category: {
        type: Type.STRING,
        enum: ["preference", "fact", "project_context", "relationship", "goal_aspiration", "routine"],
        description: "Category of the memory",
      },
      is_situational: { type: Type.BOOLEAN, description: "True if this is temporary (e.g. traveling this week, sick today), false if durable" },
      valid_until: { type: Type.STRING, description: "Optional ISO date when situational state expires" },
      privacy_tier: {
        type: Type.STRING,
        enum: ["public", "private", "sensitive", "device_local"],
        description: "Sensitivity classification of the memory (default: private)",
      },
    },
    required: ["content"],
  },
};

// ---------------------------------------------------------------------------
// Bundled Tool Set
// ---------------------------------------------------------------------------

export const FLOWMATE_MEMORY_TOOLS: FunctionDeclaration[] = [
  searchMemoryTool,
  getRelevantContextTool,
  proposeMemoryUpdateTool,
];

export const queryRelationshipsTool: FunctionDeclaration = {
  name: "query_relationships",
  description:
    "Query explicit, persisted relationships in the personal knowledge graph (1-hop). Look up links by entity ID, endpoints ('from'/'to'), or relationship type (e.g. 'FULFILLS', 'PART_OF', 'PRECEDES', 'DEPENDS_ON', 'SCHEDULED_FOR', 'TAGGED_WITH', 'ASSIGNED_TO', 'RELATED_TO').",
  parameters: {
    type: Type.OBJECT,
    properties: {
      entity_id: {
        type: Type.STRING,
        description: "Find relationships where this entity is either the source ('from') or target ('to').",
      },
      from: {
        type: Type.STRING,
        description: "Filter by source entity ID.",
      },
      to: {
        type: Type.STRING,
        description: "Filter by target entity ID.",
      },
      type: {
        type: Type.STRING,
        description: "Relationship type (e.g., 'FULFILLS', 'PART_OF', 'PRECEDES', 'DEPENDS_ON', 'SCHEDULED_FOR', 'TAGGED_WITH', 'ASSIGNED_TO', 'RELATED_TO').",
      },
      limit: {
        type: Type.NUMBER,
        description: "Maximum number of relationships to return (default 20, max 50).",
      },
    },
    required: [],
  },
};

export const FLOWMATE_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      queryEntitiesTool,
      reflectSchemasTool,
      queryCommitmentTool,
      configureCommitmentTool,
      recordCommitmentEvidenceTool,
      readCalendarTool,
      searchEntitiesTool,
      lookupFoodHistoryTool,
      getProductivityStatsTool,
      lookupGoalsTool,
      lookupHabitsTool,
      lookupTravelRouteTool,
      applyChangesTool,
    ],
  },
];

export const ACTIVE_AI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      queryEntitiesTool,
      queryRelationshipsTool,
      reflectSchemasTool,
      queryCommitmentTool,
      configureCommitmentTool,
      recordCommitmentEvidenceTool,
      searchMemoryTool,
      getRelevantContextTool,
      proposeMemoryUpdateTool,
      readCalendarTool,
      searchEntitiesTool,
      lookupFoodHistoryTool,
      getProductivityStatsTool,
      lookupGoalsTool,
      lookupHabitsTool,
      lookupTravelRouteTool,
      applyChangesTool,
    ],
  },
];



