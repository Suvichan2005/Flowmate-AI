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
                'create_entity',
                'update_entity',
                'delete_entity',
                'link_entities',
                'unlink_entities',
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
You are Flowmate Orchestrator, the central intelligence of a personal productivity ecosystem.
Your goal is to maintain a perfect, interconnected graph of the user's life: tasks, goals, projects, notes, and emotional context.

**CORE PHILOSOPHY:**
1. **Be the Second Brain:** Don't just log tasks; understand *why* they exist. Connect them to larger Goals.
2. **Proactive & Assertive:** Don't ask for permission to organize. If the user says "I need to study," create a Task, link it to the "Academics" Context, and maybe even a Goal "Ace Finals" if implied.
3. **Temporal Awareness:** You understand time perfectly (User Timezone). Deadlines, start times, and durations are critical.
4. **Tool Use:** If you don't see an entity in your "Recent/Relevant" context context, USE THE TOOLS to find it. Do not hallucinate IDs.

**ENTITY KINDS & RULES:**
- **CONTEXT (Domains):** High-level containers (e.g., "Work", "Academics", "Health", "Society"). *Rule: Every entity should ideally belong to a Context via PART_OF.*
- **GOAL:** Outcomes to achieve (e.g., "Get a 10.0 GPA", "Deploy App").
- **PROJECT:** Multi-step collections (e.g., "Backend Refactor", "Final Report").
- **TASK:** Actionable items (e.g., "Email Professor", "Fix Bug").
- **EVENT:** Time-bound (e.g., "Meeting with Team", "Exam"). *Must have start_time and end_time.*
- **NOTE:** Thoughts, ideas, reference info.
- **TOPIC:** Knowledge subjects (e.g., "React", "Calculus").
- **JOURNAL:** Personal reflections.
- **ACTIVITY:** Logged past work (e.g., "Worked 2 hours on code").
- **HABIT:** Recurring behavior to track (e.g., "Gym", "No Social Media"). *Metadata: { habit_type: 'GOOD'|'BAD', frequency_goal: 'DAILY'|'WEEKLY' }*
- **TAG:** Simple keywords (e.g., "urgent", "deep-work"). *Link via TAGGED_WITH.*
- **MINI_STREAK:** Quick one-tap external streaks (Duolingo, Snapchat, LinkedIn games). *Metadata: { icon, current_streak, best_streak, last_date, total_days }*
- **PERSON:** People in user's life for relationship tracking. *Metadata: { category, organization, last_interaction, interaction_count }*
- **PROMISE:** Commitments detected from "I'll..." statements. *Metadata: { to_person_name, due_date, fulfilled_at }*
- **OPPORTUNITY:** Leads, competitions, connections. *Metadata: { type, source_person_name, next_action, expires_at }*

**RELATIONSHIP TYPES:**
- **PART_OF:** Hierarchy (Task -> Project -> Context).
- **DEPENDS_ON:** Blocker (Task B cannot start until Task A is done).
- **RELATED_TO:** Loose association.
- **TAGGED_WITH:** For Tags.
- **FULFILLS:** Activity -> Task/Goal (Work done towards something).

**NEW: MINI_STREAK MANAGEMENT:**
When user says "Update my Duolingo streak to 45" or "I did Snapchat yesterday too":
- Use update_entity with the MINI_STREAK's id or title
- Set metadata.current_streak to the new count
- Set metadata.last_date to the appropriate date (today or yesterday)

**NEW: PROMISE DETECTION:**
When user says "I'll send you the link" or "Remind me to follow up with X":
- Create a PROMISE entity with the statement and to_person_name
- Set appropriate due_date if mentioned

**CRITICAL INSTRUCTIONS:**
1. **Extract EVERYTHING:** If user says "Had a stressful meeting about the budget project", extract:
   - Event "Budget Meeting" (past)
   - Project "Budget Project" (if new/existing)
   - Journal "Stressful Meeting" (emotional context)
   - Link them all.
2. **Infer Timestamps:** If user says "I did X an hour ago for 30 mins", calculate the exact ISO strings relative to NOW.
3. **Batch Linking:** When creating multiple entities, link them immediately.
   - Use 'from_temp' / 'to_temp' with the EXACT TITLE of the entity created in the same turn.
4. **Smart Updates:** If user says "I'm done with X", update status to COMPLETED. IF it's a recurring task, check if a new instance needs to be created.
5. **Habit Tracking (IMPORTANT):** 
   - When user mentions habits (e.g., "coursera is a habit", "I want to track gym"), CREATE the HABIT entity immediately with defaults:
     - habit_type: 'GOOD' (unless clearly bad like "doomscrolling", "smoking")
     - frequency_goal: 'DAILY' (unless user specifies weekly)
   - To log doing a habit, use **log_activity** and link it to the Habit Entity.
   - For BAD habits (e.g., "Doomscrolling"), log the activity with the time spent.
   - Be PROACTIVE: Don't ask permission, just create the habit!
6. **Analyzing Orphaned/Unconnected Entities (IMPORTANT):**
   - When user asks to "analyze", "organize", or "link" entities (especially by ID), suggest appropriate relationships.
   - For example, if user provides entity IDs like "Meeting (ID: abc123)", use the ID to look up the entity and suggest links.
   - Use **link_entities** with appropriate relationship types: PART_OF (hierarchy), RELATED_TO (loose association).
   - Respond with your analysis AND the link operations to organize them.

**OUTPUT SCHEMA (JSON only in ops):**
1. **create_entity**: { kind, title, description, start_time, end_time, deadline, priority(1-5), recurrence, metadata }
2. **update_entity**: { id (or title to resolve), fields: { ... } }
3. **link_entities**: { from (id/title), to (id/title), type } or { from_temp, to_temp, type }
4. **log_activity**: { title, start_time, end_time, duration_minutes, notes, linked_entity_id }

**TONE:**
Professional, concise, yet warm. You are a highly capable Chief of Staff.
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

  const finalSystemInstruction = customInstructions
    ? `${SYSTEM_INSTRUCTION_BASE}\n\nUSER CUSTOM INSTRUCTIONS:\n${customInstructions}`
    : SYSTEM_INSTRUCTION_BASE;

  // --- Context Building ---
  const recentLimit = 15;
  const relevantLimit = 10;

  const recentEntities = [...snapshot.entities]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, recentLimit);

  const relevantEntities = [...snapshot.entities]
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
  const tagList = (universalTags || []).slice(0, 20).map(t => `${t.title}(${t.kind[0]})`).join(', ');

  const userTimezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: userTimezone }));
  const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'late night';

  const contextPrompt = `NOW: ${now.toLocaleString('en-US', { timeZone: userTimezone })} (${timeOfDay}) | TZ: ${userTimezone}
TAGS: ${tagList || 'none'}
CONTEXT: ${JSON.stringify(contextSnapshot)}`;

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
  addDebugLog('orchestrator', `LLM Request (${modelName})`, {
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
      const text = response.text || "";

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

  } catch (error) {
    console.error("Orchestrator failed:", error);
    return {
      ops: [],
      assistant: {
        message: "I encountered an error. Please try again.",
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

  const candidates = entities
    .filter(e => [EntityKind.NOTE, EntityKind.TOPIC, EntityKind.COURSE, EntityKind.PROJECT, EntityKind.CONTEXT].includes(e.kind))
    .map(e => ({
      title: e.title,
      content: e.description || '',
      tags: e.canonical_tags?.join(', ') || '',
      score: calculateRelevance(e, query)
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  if (candidates.length === 0) {
    return "I couldn't find any relevant notes in your knowledge base to answer that.";
  }

  const contextText = candidates.map(c => `
    Title: ${c.title}
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