import { GoogleGenAI, FunctionDeclaration, Type, Tool, Content, FunctionCallingConfigMode } from "@google/genai";
import { ToonResponse, Entity, Relationship, EntityKind, EntityStatus, Message, ToonOperation } from "../types";
import { useStore } from "../store";
import { stripBase64Prefix, getMimeType } from "../utils/imageProcessing";

// Helper to get fresh AI client
const getAiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
};

// --- Tool Definitions ---

const readCalendarTool: FunctionDeclaration = {
  name: "read_calendar",
  description: "Retrieve calendar events, scheduled tasks, and deadlines within a specific date range.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      start_date: { type: Type.STRING, description: "Start date (ISO 8601 YYYY-MM-DD)" },
      end_date: { type: Type.STRING, description: "End date (ISO 8601 YYYY-MM-DD)" }
    },
    required: ["start_date", "end_date"]
  }
};

const searchEntitiesTool: FunctionDeclaration = {
  name: "search_entities",
  description: "Search for entities by title, tag, kind, or status. Useful for finding IDs or checking active goals.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Text to match in title or description" },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of tags to filter by (e.g., ['urgent', 'academics'])" },
      kind: { type: Type.STRING, description: "Entity kind (e.g., 'GOAL', 'TASK', 'PROJECT')" },
      status: { type: Type.STRING, description: "Entity status (e.g., 'ACTIVE', 'COMPLETED')" },
      limit: { type: Type.NUMBER, description: "Max results (default 10)" }
    },
    required: []
  }
};

const applyChangesTool: FunctionDeclaration = {
  name: "apply_changes",
  description: "Commit changes to the graph. Use this to create, update, delete, or link entities.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      explanation: { type: Type.STRING, description: "A brief, friendly message to the user summarizing the actions taken." },
      ops: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              enum: [
                // Short aliases (Flowmate 3.1 — Token Optimization)
                'c', 'u', 'd', 'l', 's', 'f', 'log', 'arc',
                // Full names (backward compat)
                'create_entity',
                'update_entity',
                'delete_entity',
                'link_entities',
                'unlink_entities',
                'add_subtask',
                'toggle_subtask',
                'delete_subtask',
                'log_to_entity',
                'archive_entity',
                'log_food',
                // Deprecated (still supported)
                'log_activity',
                'schedule_event',
                'set_goal_progress',
                'tag_update'
              ]
            },
            payload: {
              type: Type.OBJECT,
              description: "The data for the operation. See schema rules."
            }
          },
          required: ['type', 'payload']
        }
      }
    },
    required: ['ops', 'explanation']
  }
};

const SYSTEM_INSTRUCTION_BASE = `
You are Flowmate v3.1 — a personal productivity AI. Maintain the user's life graph via operations.

**OPERATION SHORTCUTS (USE THESE!):**
| Short | Full | Use For |
|-------|------|---------|
| c | create_entity | Create entities |
| u | update_entity | Update fields |
| l | link_entities | DEPENDS_ON, RELATED_TO only |
| s | add_subtask | Add subtask to entity |
| f | log_food | Food/meal logging |
| log | log_to_entity | Log activity to entity |

**COMPACT PAYLOAD FORMAT:**
\`\`\`
{ type: "c", payload: { k: "PRJ", t: "SQL Course", p: "Coursera Cert", context: "Academics" }}
\`\`\`

**FIELD SHORTCUTS:**
k→kind, t→title, d→description, p→parent, m→metadata, dur→duration_minutes, start→start_time, end→end_time, due→deadline

**KIND SHORTCUTS:**
CTX→CONTEXT, GOL→GOAL, PRJ→PROJECT, TSK→TASK, EVT→EVENT, HAB→HABIT, NOT→NOTE, PER→PERSON

**HIERARCHIES:**
Use \`p\` (parent) field for hierarchy. Creates parent_id directly, no link_entities needed.
\`\`\`
{ type: "c", payload: { k: "PRJ", t: "Course 1", p: "Certificate Goal" }}
\`\`\`

**CONTEXTS/TAGS:**
Use \`context\` or \`tags\` field. Auto-creates TAGGED_WITH.
\`\`\`
{ type: "c", payload: { k: "TSK", t: "Study", context: "Academics", tags: ["exam"] }}
\`\`\`

**SUBTASKS (not entities!):**
\`\`\`
{ type: "s", payload: { entity_id: "Goal Title", t: "Module 1", estimated_minutes: 600 }}
\`\`\`

**LOG ACTIVITY:**
\`\`\`
{ type: "log", payload: { entity_id: "Habit Name", t: "Did 30 min", dur: 30 }}
\`\`\`



**EVENTS (MUST have start/end, optional recurrence):**
\`\`\`
{ type: "c", payload: { k: "EVT", t: "Meeting", start: "2025-12-10T14:00:00+05:30", end: "2025-12-10T15:00:00+05:30" }}
{ type: "c", payload: { k: "EVT", t: "Weekly Standup", start: "...", end: "...", rec: "WEEKLY" }}
\`\`\`
Recurrence: rec: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
For complex patterns (metadata.rrule): "every 2nd Saturday" → metadata: { rrule: "FREQ=MONTHLY;BYDAY=2SA" }

**CONTEXT vs TAG:**
- CONTEXT (CTX): Domains/orgs (Academics, IEEE CS, Work, Gym)
- TAG: Keywords (urgent, exam, revision)

**DATES:** Always use +05:30 offset, never "Z".

**BEHAVIOR:** Be proactive, extract everything, don't ask permission. Respond naturally.
`;

// Separate food instructions - conditionally included based on feature_toggles
const FOOD_INSTRUCTIONS = `
**LOG FOOD (with source tracking):**
\`\`\`
{ type: "f", payload: { food_name: "Chhola Bhatura", cost: 130, vendor: "Sardarji", source: "ordered" }}
{ type: "f", payload: { food_name: "Rice Dal", meal_type: "lunch", source: "mess", skipped: false }}
\`\`\`
Fields: food_name, cost, vendor, source (mess/ordered/homemade/outside), meal_type, rating (1-5), skipped (bool)

**FOOD CONTEXT:** You have FOOD stats in context (meals, spending, vendors, top foods). Answer food questions using this data:
- "What's my favorite food?" → Check top_foods in FOOD context
- "How much did I spend?" → Use total_spent from FOOD context
- "Where do I order from?" → List vendors with counts
`;

function calculateRelevance(entity: Entity, userMessage: string): number {
  const terms = userMessage.toLowerCase().split(/\s+/);
  let score = 0;
  const title = (entity.title || '').toLowerCase();
  const kind = entity.kind.toLowerCase();

  // Boost Contexts generally as they are high-level containers
  if (entity.kind === EntityKind.CONTEXT) score += 8;

  terms.forEach(term => {
    if (term.length < 3) return;
    if (title.includes(term)) score += 5;
    if ((entity.canonical_tags || []).join(' ').toLowerCase().includes(term)) score += 3;
    if ((entity.description || '').toLowerCase().includes(term)) score += 1;
    if (kind.includes(term)) score += 1;
  });

  // Recency Boost
  const daysSinceUpdate = (Date.now() - new Date(entity.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 1) score += 2;
  if (daysSinceUpdate < 7) score += 1;

  return score;
}

function executeReadCalendar(args: any, allEntities: Entity[]): any[] {
  const start = new Date(args.start_date);
  const end = new Date(args.end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [{ error: "Invalid dates" }];

  return allEntities.filter(e => {
    if (e.status === EntityStatus.ARCHIVED || e.status === EntityStatus.CANCELED) return false;

    let dateToCheck: Date | null = null;
    if (e.kind === EntityKind.EVENT && e.start_time) {
      dateToCheck = new Date(e.start_time);
    } else if (e.kind === EntityKind.TASK && e.deadline) {
      dateToCheck = new Date(e.deadline);
    }

    if (dateToCheck) {
      return dateToCheck >= start && dateToCheck <= end;
    }
    return false;
  }).map(e => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    time: e.start_time || e.deadline,
    status: e.status
  }));
}

function executeSearchEntities(args: any, allEntities: Entity[]): any[] {
  const query = (args.query || '').toLowerCase();
  const tags = (args.tags || []) as string[];
  const kind = args.kind ? args.kind.toUpperCase() : null;
  const status = args.status ? args.status.toUpperCase() : null;
  const limit = args.limit || 15;

  let results = allEntities.filter(e => {
    // Status Filter
    if (status && e.status !== status) return false;

    // Kind Filter
    if (kind && e.kind !== kind) return false;

    // Tag Filter (OR logic for tags)
    if (tags.length > 0) {
      const entityTags = (e.canonical_tags || []).map(t => t.toLowerCase());
      const hasTag = tags.some(t => entityTags.includes(t.toLowerCase()));
      if (!hasTag) return false;
    }

    // Query Filter
    if (query) {
      const inTitle = (e.title || '').toLowerCase().includes(query);
      const inDesc = (e.description || '').toLowerCase().includes(query);
      if (!inTitle && !inDesc) return false;
    }

    return true;
  });

  // Sort by relevance (if query provided) or updated_at
  if (query) {
    results = results.sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase();
      const bTitle = (b.title || '').toLowerCase();
      if (aTitle === query) return -1;
      if (bTitle === query) return 1;
      if (aTitle.startsWith(query)) return -1;
      if (bTitle.startsWith(query)) return 1;
      return 0;
    });
  } else {
    results = results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  return results.slice(0, limit).map(e => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    status: e.status,
    tags: e.canonical_tags
  }));
}

export const orchestrateMessage = async (
  history: Message[],
  userMessage: string,
  snapshot: { entities: Entity[]; relationships: Relationship[] },
  attachmentDataUrl?: string | null
): Promise<ToonResponse> => {
  const { addDebugLog, settings, universalTags } = useStore.getState();
  const modelName = settings?.preferred_model || 'gemini-2.5-flash';
  const customInstructions = settings?.custom_instructions || '';
  const ai = getAiClient();

  // Build system instruction with optional food instructions based on feature toggles
  const featureToggles = settings?.feature_toggles || { food_tracking: true, attendance_tracking: true, people_tracking: true };

  let systemInstruction = SYSTEM_INSTRUCTION_BASE;
  if (featureToggles.food_tracking) {
    systemInstruction += FOOD_INSTRUCTIONS;
  }

  const finalSystemInstruction = customInstructions
    ? `${systemInstruction} \n\nUSER CUSTOM INSTRUCTIONS: \n${customInstructions} `
    : systemInstruction;

  // --- Context Building ---
  const recentLimit = 15;
  const relevantLimit = 10;

  // Filter out hidden entities from LLM context (they still appear in calendar)
  const visibleEntities = snapshot.entities.filter(e => !e.metadata?.hidden);

  const recentEntities = [...visibleEntities]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, recentLimit);

  const relevantEntities = [...visibleEntities]
    .map(e => ({ entity: e, score: calculateRelevance(e, userMessage) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, relevantLimit)
    .map(item => item.entity);

  const contextMap = new Map<string, Entity>();
  recentEntities.forEach(e => contextMap.set(e.id, e));
  relevantEntities.forEach(e => contextMap.set(e.id, e));

  const truncatedEntities = Array.from(contextMap.values());
  const truncatedRelationships = snapshot.relationships.filter(r =>
    contextMap.has(r.from) && contextMap.has(r.to)
  );

  // Compact entity representation - skip null fields
  const compactEntity = (e: Entity) => {
    const obj: Record<string, any> = { id: e.id, k: e.kind, t: e.title, s: e.status };
    if (e.deadline) obj.dl = e.deadline;
    if (e.start_time) obj.st = e.start_time;
    if (e.canonical_tags?.length) obj.tags = e.canonical_tags;
    return obj;
  };

  const contextSnapshot = {
    e: truncatedEntities.map(compactEntity),
    r: truncatedRelationships.map(r => ({ f: r.from, t: r.to, tp: r.type }))
  };

  // Compact tags list
  const tagList = (universalTags || []).slice(0, 20).map(t => `${t.title} (${t.kind[0]})`).join(', ');

  // --- FOOD CONTEXT ---
  const { foodLogs } = useStore.getState();
  const now = new Date();
  const last30DaysLogs = foodLogs.filter(l => {
    const d = new Date(l.timestamp);
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 30;
  });

  // Calculate food stats for AI
  const foodStats = {
    total_meals: last30DaysLogs.length,
    total_spent: last30DaysLogs.reduce((sum, l) => sum + (l.cost || 0), 0),
    vendors: {} as Record<string, { count: number; spent: number }>,
    top_foods: {} as Record<string, number>
  };

  last30DaysLogs.forEach(l => {
    const vendor = l.vendor || l.notes?.match(/from\s+(\w+)/i)?.[1] || 'unknown';
    if (!foodStats.vendors[vendor]) foodStats.vendors[vendor] = { count: 0, spent: 0 };
    foodStats.vendors[vendor].count++;
    foodStats.vendors[vendor].spent += l.cost || 0;

    const food = l.food_name.toLowerCase();
    foodStats.top_foods[food] = (foodStats.top_foods[food] || 0) + 1;
  });

  // Top 5 foods and vendors for context
  const topFoods = Object.entries(foodStats.top_foods)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  const topVendors = Object.entries(foodStats.vendors)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([name, data]) => `${name}:${data.count}x/₹${data.spent}`)
    .join(', ');

  // Recent 5 food logs for immediate context
  const recentFoods = last30DaysLogs.slice(-5).map(l =>
    `${l.food_name}${l.cost ? '/₹' + l.cost : ''}${l.vendor ? '@' + l.vendor : ''}`
  ).join(', ');

  const foodContext = last30DaysLogs.length > 0
    ? `FOOD(30d): ${foodStats.total_meals} meals, ₹${foodStats.total_spent} spent | Top: ${topFoods || 'none'} | Vendors: ${topVendors || 'none'} | Recent: ${recentFoods || 'none'}`
    : 'FOOD: No food logs yet';

  const userTimezone = settings.timezone || 'Asia/Kolkata';
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: userTimezone }));
  const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'late night';

  const contextPrompt = `NOW: ${now.toLocaleString('en-US', { timeZone: userTimezone })} (${timeOfDay}) | TZ: ${userTimezone}
TAGS: ${tagList || 'none'}
${foodContext}
CONTEXT: ${JSON.stringify(contextSnapshot)} `;

  // --- Sliding Window History ---
  const HISTORY_WINDOW = 12;
  const recentHistory = history.slice(-HISTORY_WINDOW);

  const contents: Content[] = recentHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  // Add current message
  const currentParts: any[] = [
    { text: contextPrompt },
    { text: userMessage }
  ];

  if (attachmentDataUrl) {
    const mimeType = getMimeType(attachmentDataUrl);
    const base64Data = stripBase64Prefix(attachmentDataUrl);
    currentParts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
  }

  contents.push({ role: 'user', parts: currentParts });

  // Log COMPLETE LLM input for debugging
  addDebugLog('orchestrator', `LLM Request(${modelName})`, {
    model: modelName,
    systemInstruction: finalSystemInstruction,
    contextPrompt: contextPrompt,
    userMessage: userMessage,
    historyLength: recentHistory.length,
    history: recentHistory.map(m => ({ role: m.role, text: m.text.substring(0, 200) + (m.text.length > 200 ? '...' : '') })),
    hasAttachment: !!attachmentDataUrl,
    attachmentMimeType: attachmentDataUrl ? getMimeType(attachmentDataUrl) : null
  });

  try {
    let turnCount = 0;
    const MAX_TURNS = 5;

    while (turnCount < MAX_TURNS) {
      turnCount++;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
          systemInstruction: finalSystemInstruction,
          temperature: 0.1,
          // We provide all tools. The model chooses apply_changes to act.
          tools: [{ functionDeclarations: [readCalendarTool, searchEntitiesTool, applyChangesTool] }],
          // AUTO mode lets model choose between function calls and plain text responses
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      });

      const functionCalls = response.functionCalls;
      const responseText = response.text;

      // Log COMPLETE LLM response for debugging
      addDebugLog('orchestrator', 'LLM Response', {
        turnCount,
        hasText: !!responseText,
        textPreview: responseText ? responseText.substring(0, 500) : null,
        hasFunctionCalls: !!(functionCalls && functionCalls.length > 0),
        functionCalls: functionCalls || [],
        rawCandidates: response.candidates?.map(c => ({
          finishReason: c.finishReason,
          safetyRatings: c.safetyRatings
        }))
      });

      // Log any unusual finish reasons for debugging
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        console.warn('LLM unusual finish reason:', finishReason);
      }

      if (functionCalls && functionCalls.length > 0) {

        // 1. Check for Action (apply_changes)
        const actionCall = functionCalls.find(fc => fc.name === 'apply_changes');
        if (actionCall) {
          const ops = actionCall.args['ops'] as ToonOperation[];
          const explanation = actionCall.args['explanation'] as string;

          return {
            ops: ops || [],
            assistant: {
              message: explanation || "Changes applied.",
              tone: "neutral",
              follow_up: []
            }
          };
        }

        // 2. Handle Retrieval (read_calendar / search_entities)
        contents.push(response.candidates?.[0]?.content as Content);

        const functionResponses = functionCalls.map(call => {
          if (call.name === 'read_calendar') {
            const result = executeReadCalendar(call.args, snapshot.entities);
            return {
              name: call.name,
              response: { result }
            };
          }
          if (call.name === 'search_entities') {
            const result = executeSearchEntities(call.args, snapshot.entities);
            return {
              name: call.name,
              response: { result }
            };
          }
          // If the model tried to call something else or we fell through
          return { name: call.name, response: { error: "Unknown tool or action handled separately." } };
        });

        contents.push({
          role: 'function',
          parts: functionResponses.map(r => ({
            functionResponse: {
              name: r.name,
              response: r.response
            }
          }))
        });

        continue;
      }

      // Handle Pure Text Response (No ops generated)
      let text = response.text || "";

      // If empty response, provide a contextual fallback
      if (!text.trim()) {
        const upcomingEvents = snapshot.entities
          .filter(e => e.kind === 'EVENT' && e.start_time && new Date(e.start_time) > new Date())
          .slice(0, 3)
          .map(e => e.title)
          .join(', ');

        if (upcomingEvents) {
          text = `I'm here to help! Your upcoming events include: ${upcomingEvents}. What would you like to work on?`;
        } else {
          text = "I'm here to help organize your productivity! Try asking me to create a task, schedule an event, or track a goal.";
        }
      }

      // Sometimes the model outputs JSON text anyway if it's confused, let's try to parse just in case
      let toonOps: ToonOperation[] = [];
      try {
        const potentialJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        if (potentialJson.startsWith('{') && potentialJson.includes('"ops"')) {
          const parsed = JSON.parse(potentialJson);
          if (parsed.ops) toonOps = parsed.ops;
        }
      } catch (e) {
        // Ignore, it was just text
      }

      return {
        ops: toonOps,
        assistant: {
          message: text,
          tone: "neutral",
          follow_up: []
        }
      };
    }

    throw new Error("Max turns exceeded");

  } catch (error: any) {
    console.error("Orchestrator failed:", error);
    console.error("Error details:", error?.message, error?.stack);

    // Provide a helpful message even on error
    const errorMsg = error?.message?.includes('quota')
      ? "API quota exceeded. Please wait a moment and try again."
      : error?.message?.includes('network') || error?.message?.includes('fetch')
        ? "Network error. Please check your connection."
        : "I encountered a temporary issue. Please try again - I'm ready to help!";

    return {
      ops: [],
      assistant: {
        message: errorMsg,
        tone: "error",
        follow_up: []
      }
    };
  }
};

export const generateBriefing = async (snapshot: { entities: Entity[]; relationships: Relationship[] }): Promise<string> => {
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || 'gemini-2.5-flash';
  const ai = getAiClient();

  const userTimezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date();

  // Natural Context for LLM
  const timeContext = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
    timeZone: userTimezone
  });

  const activeTasks = snapshot.entities
    .filter(e => e.kind === EntityKind.TASK && e.status === EntityStatus.ACTIVE)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  const eventsToday = snapshot.entities
    .filter(e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time).toDateString() === new Date().toDateString());

  const prompt = `
    You are a strategic productivity coach. 
    Analyze the following snapshot of the user's graph and generate a "Daily Briefing" in clear, motivating Markdown.
    
    CONTEXT:
    Current Time: ${timeContext}
    Timezone: ${userTimezone}
    
    Active Tasks (Top 10): ${JSON.stringify(activeTasks.map(t => ({ title: t.title, priority: t.priority, deadline: t.deadline })))}
    Events Today: ${JSON.stringify(eventsToday.map(e => ({ title: e.title, time: e.start_time })))}
    
    INSTRUCTIONS:
    1. **Dynamic Greeting**: Greet the user naturally based on the specific *Current Time*. 
       - If it's late night (e.g., 12 AM - 4 AM), acknowledge they are "working late" rather than saying "Good Morning". be encouraging but realistic about rest.
       - If it's early morning, be high energy.
       - If it's regular day, be focused.
    2. **Strategic Focus**: Pick 1-2 key tasks. Match the intensity to the time of day (e.g., lower intensity for late night).
       - **IMPORTANT**: Paraphrase task titles naturally (e.g., "Review your biology notes" instead of "Do 'Biology Revise'").
    3. **Schedule**: Briefly mention events. Clarify if events are for "later today" (upcoming daylight hours) vs "tonight".
    4. **Quick Win**: One small, actionable step.
    
    Keep it concise (max 150 words). Do not use JSON. Return raw string.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        temperature: 0.7
      }
    });
    return response.text || "Could not generate briefing.";
  } catch (err) {
    console.error(err);
    return "Unable to connect to AI for briefing.";
  }
};

export type ImprovementType = 'fix_grammar' | 'make_professional' | 'expand' | 'summarize';

export const improveText = async (text: string, type: ImprovementType): Promise<string> => {
  if (!text) return "";
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || 'gemini-2.5-flash';
  const ai = getAiClient();

  const instructions: Record<ImprovementType, string> = {
    fix_grammar: "Fix grammar and spelling mistakes. Keep the tone natural.",
    make_professional: "Rewrite the following text to be more professional, clear, and concise.",
    expand: "Expand upon the following ideas with relevant details and examples. Keep it grounded.",
    summarize: "Summarize the following text into key bullet points."
  };

  const prompt = `
    TASK: ${instructions[type]}
    
    INPUT TEXT:
    "${text}"
    
    OUTPUT:
    Return only the improved text. Do not add conversational filler.
    `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt
    });
    return response.text?.trim() || text;
  } catch (err) {
    console.error("Improve text failed", err);
    throw err;
  }
};

export const queryKnowledgeBase = async (query: string, entities: Entity[]): Promise<string> => {
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || 'gemini-2.5-flash';
  const ai = getAiClient();

  // Filter out hidden entities and prepare candidates from ALL kinds
  const candidates = entities
    .filter(e => !e.metadata?.hidden) // Exclude hidden items
    .map(e => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      content: e.description || '',
      tags: e.canonical_tags?.join(', ') || '',
      score: calculateRelevance(e, query)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // Get top 20

  // If no items have any relevance, try simple title match
  const hasRelevant = candidates.some(c => c.score > 0);
  const finalCandidates = hasRelevant
    ? candidates.filter(c => c.score > 0).slice(0, 15)
    : candidates.filter(c => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10);

  if (finalCandidates.length === 0) {
    return "I couldn't find any relevant items in your knowledge base for that query.";
  }

  const contextText = finalCandidates.map(c => `
    Title: ${c.title}
    Kind: ${c.kind}
    Tags: ${c.tags}
    Content: ${c.content}
    ---
    `).join('\n');

  const prompt = `
    You are Flowmate's Knowledge Assistant.
    Answer the user's question based ONLY on the provided context chunks from their personal notes or contexts.
    
    USER QUESTION: "${query}"
    
    RETRIEVED CONTEXT:
    ${contextText}
    
    INSTRUCTIONS:
    - Synthesize the answer from the context.
    - If the context doesn't contain the answer, say so.
    - Cite the Note/Context Titles where appropriate.
    - Keep it concise.
    `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt
    });
    return response.text?.trim() || "No answer generated.";
  } catch (err) {
    console.error("Knowledge query failed", err);
    return "Error querying knowledge base.";
  }
}; 