import { GoogleGenAI, FunctionDeclaration, Type, Tool, Content } from "@google/genai";
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
You are Flowmate Orchestrator v2.4.
Your goal is to maintain a perfect, interconnected graph of the user's life.

**CRITICAL RULES FOR "CONTEXT" vs "TAGS":**
1. **Domains are CONTEXTS**: If the user mentions an organization, society, company, class group, workspace, club, role-domain, or broad area (e.g., “IEEE CS”, “E-Cell”, “Academics”, "Gym", "Semester 5"), ALWAYS create it as \`kind: 'CONTEXT'\`.
   - **NEVER** create these as TAG, PROJECT, GOAL, or ROLE.
   - **NEVER** create more than 1 context unless user explicitly implies multiple domains.

2. **TAGS are Atomic**: Use \`kind: 'TAG'\` ONLY for simple keywords like "urgent", "exam", "revision", "teamwork", "coding".

3. **Linking to Context/Tags**:
   - Every new GOAL, PROJECT, TASK, ROLE, or EVENT that semantically relates to a Context/Tag MUST be linked to it.
   - **MUST USE**: \`type: 'TAGGED_WITH'\` for these links.
   - **FORBIDDEN**: Do NOT use \`PART_OF\` to link a Role/Goal to a Context. \`PART_OF\` is strictly for structural hierarchy (Project->Task).
   - The system will automatically sync \`canonical_tags\` based on these \`TAGGED_WITH\` relationships.

**LINKING RULES (Batch Creation):**
When creating multiple entities in one batch, you don't know their IDs yet.
- Use the **exact title** of the new entity in \`from_temp\` or \`to_temp\` fields.
- Example: 
  \`create_entity(title="IEEE CS", kind="CONTEXT")\`
  \`create_entity(title="Deploy Project", kind="GOAL")\`
  \`link_entities(from_temp="Deploy Project", to_temp="IEEE CS", type="TAGGED_WITH")\`

**PAYLOAD SCHEMAS:**
1. create_entity: { kind: 'TASK'|'PROJECT'|'EVENT'|'GOAL'|'CONTEXT'|'TAG', title: string, description?: string, start_time?: string, deadline?: string, priority?: number }
2. update_entity: { id: string, fields: { ...subset of props } }
3. link_entities: { from_temp?: string, to_temp?: string, from?: string, to?: string, type: 'PART_OF'|'DEPENDS_ON'|'TAGGED_WITH' }
   * Use \`from_temp\`/\`to_temp\` if referring to an entity created *in this same turn*.
   * Use \`from\`/\`to\` (UUIDs) if referring to *existing* entities from context.
4. log_activity: { title: string, duration_minutes?: number, notes?: string }

**GENERAL RULES:**
- Extract EVERYTHING: Meetings, goals, feelings.
- Container First: Create the Context/Project first, then children.
- Temporal Accuracy:
  * ALWAYS use the USER_TIMEZONE provided in context (currently Asia/Kolkata = IST = UTC+5:30)
  * Output dates as ISO8601 WITH the user's timezone OFFSET, NOT "Z" (UTC)
  * Example: If user says "10 PM tomorrow" and date is 2025-12-07, output: "2025-12-08T22:00:00+05:30"
  * NEVER use "Z" suffix - always use explicit offset like "+05:30" for IST
  * The offset ensures the time displays correctly in the user's local timezone
- Corrections: If user says "update it", find the entity in context and call \`update_entity\`.
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

  const contextSnapshot = {
    entities: truncatedEntities.map(e => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      status: e.status,
      deadline: e.deadline,
      start_time: e.start_time,
      tags: e.canonical_tags // Ensure AI sees tags
    })),
    relationships: truncatedRelationships.map(r => ({
      from: r.from,
      to: r.to,
      type: r.type
    }))
  };

  // Provide available tags for reuse
  const availableTags = (universalTags || []).map(t => ({ title: t.title, kind: t.kind, count: t.usage_count }));

  const userTimezone = settings.timezone || 'Asia/Kolkata'; // Use stored settings
  const now = new Date();
  const temporalContext = {
    iso: now.toISOString(),
    local_display: now.toLocaleString('en-US', { timeZone: userTimezone }),
    weekday: now.toLocaleString('en-US', { weekday: 'long', timeZone: userTimezone }),
    date: now.toLocaleDateString('en-US', { timeZone: userTimezone })
  };

  const contextPrompt = `
CURRENT_TIME_CONTEXT:
${JSON.stringify(temporalContext, null, 2)}
USER_TIMEZONE: ${userTimezone}

EXISTING_TAGS_AND_CONTEXTS:
${JSON.stringify(availableTags.slice(0, 30), null, 2)}

IMMEDIATE_CONTEXT_SNAPSHOT:
${JSON.stringify(contextSnapshot, null, 2)}
`;

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
    addDebugLog('orchestrator', 'Sending MULTIMODAL request', { mimeType, model: modelName });
  } else {
    addDebugLog('orchestrator', 'Sending request', { historyLength: recentHistory.length, model: modelName });
  }

  contents.push({ role: 'user', parts: currentParts });

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
          // We provide both tools. The model chooses apply_changes to act.
          tools: [{ functionDeclarations: [readCalendarTool, applyChangesTool] }],
        },
      });

      const functionCalls = response.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        addDebugLog('orchestrator', 'Tool Called', { calls: functionCalls });

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

        // 2. Handle Retrieval (read_calendar)
        contents.push(response.candidates?.[0]?.content as Content);

        const functionResponses = functionCalls.map(call => {
          if (call.name === 'read_calendar') {
            const result = executeReadCalendar(call.args, snapshot.entities);
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

  const activeTasks = snapshot.entities
    .filter(e => e.kind === EntityKind.TASK && e.status === EntityStatus.ACTIVE)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  const eventsToday = snapshot.entities
    .filter(e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time).toDateString() === new Date().toDateString());

  const userTimezone = settings.timezone || 'Asia/Kolkata';

  const prompt = `
    You are a strategic productivity coach. 
    Analyze the following snapshot of the user's graph and generate a "Daily Briefing" in clear, motivating Markdown.
    
    CONTEXT:
    Date: ${new Date().toLocaleDateString()}
    Timezone: ${userTimezone}
    
    Active Tasks (Top 10): ${JSON.stringify(activeTasks.map(t => ({ title: t.title, priority: t.priority, deadline: t.deadline })))}
    Events Today: ${JSON.stringify(eventsToday.map(e => ({ title: e.title, time: e.start_time })))}
    
    STRUCTURE:
    1. **Greeting**: Short, motivating hook.
    2. **Focus of the Day**: Pick 1-2 key tasks based on priority/deadline.
    3. **Schedule Highlights**: Briefly mention events if any.
    4. **Quick Win**: Suggest one small task.
    
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