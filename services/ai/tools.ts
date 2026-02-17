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

// ---------------------------------------------------------------------------
// Write Tool
// ---------------------------------------------------------------------------

export const applyChangesTool: FunctionDeclaration = {
  name: "apply_changes",
  description: "Commit changes to the graph. Use this to create, update, delete, or link entities.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      explanation: {
        type: Type.STRING,
        description: "A brief, friendly message to the user summarizing the actions taken.",
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
// Bundled Tool Set
// ---------------------------------------------------------------------------

export const FLOWMATE_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      readCalendarTool,
      searchEntitiesTool,
      lookupFoodHistoryTool,
      getProductivityStatsTool,
      lookupGoalsTool,
      lookupHabitsTool,
      applyChangesTool,
    ],
  },
];
