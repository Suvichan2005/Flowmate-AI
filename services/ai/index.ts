/**
 * Flowmate AI Service — Public API
 *
 * Exports:
 *   orchestrateMessage  — Main chat loop with function calling
 *   generateBriefing    — Daily productivity briefing
 *   improveText         — Text improvement (grammar, expand, etc.)
 *   queryKnowledgeBase  — RAG-style knowledge search
 *   ImprovementType     — Union type for text improvements
 */

export type { ImprovementType } from "./prompts";
export { generateContextualSuggestions, getInstantContextualSuggestions, type ContextualSuggestion } from "./suggestions";

import { FunctionCallingConfigMode } from "@google/genai";
import type { Content } from "@google/genai";
import type { Entity, Relationship, Message, ToonResponse, ToonOperation } from "../../types";
import { EntityKind, EntityStatus } from "../../types";
import { useStore } from "../../store";
import { withRetry } from "../../utils/apiRetry";

import { getAiClient, GEMINI_RETRY_CONFIG, DEFAULT_MODEL, MAX_FUNCTION_TURNS } from "./client";
import { FLOWMATE_TOOLS } from "./tools";
import { dispatchToolCall, calculateRelevance } from "./executors";
import {
  SYSTEM_INSTRUCTION,
  FOOD_INSTRUCTIONS,
  buildBriefingPrompt,
  IMPROVEMENT_INSTRUCTIONS,
  type ImprovementType,
} from "./prompts";
import {
  buildEntityContext,
  buildContextPrompt,
  buildHistory,
  summarizeOlderMessages,
} from "./context";

// ---------------------------------------------------------------------------
// orchestrateMessage
// ---------------------------------------------------------------------------

export const orchestrateMessage = async (
  history: Message[],
  userMessage: string,
  snapshot: { entities: Entity[]; relationships: Relationship[] },
  attachmentDataUrl?: string | null,
): Promise<ToonResponse> => {
  const { addDebugLog, settings, universalTags } = useStore.getState();
  const modelName = settings?.preferred_model || DEFAULT_MODEL;
  const customInstructions = settings?.custom_instructions || '';
  const ai = getAiClient();

  // --- System Instruction ---
  const featureToggles = settings?.feature_toggles || {
    food_tracking: true,
    attendance_tracking: true,
    people_tracking: true,
  };

  let systemInstruction = SYSTEM_INSTRUCTION;
  if (featureToggles.food_tracking) systemInstruction += FOOD_INSTRUCTIONS;
  if (customInstructions) {
    systemInstruction += `\n\nUSER CUSTOM INSTRUCTIONS:\n${customInstructions}`;
  }

  // --- Context ---
  const timezone = settings.timezone || 'Asia/Kolkata';
  const entityContext = buildEntityContext(
    snapshot.entities,
    snapshot.relationships,
    userMessage,
  );
  const tagList = (universalTags || [])
    .slice(0, 20)
    .map(t => `${t.title} (${t.kind[0]})`)
    .join(', ');

  const contextPrompt = buildContextPrompt(
    entityContext,
    tagList,
    !!featureToggles.food_tracking,
    timezone,
  );

  // --- Conversation History (with rolling summary) ---
  const conversationSummary = summarizeOlderMessages(history);
  const contents = buildHistory(history, conversationSummary, attachmentDataUrl);

  // Attach context to the latest user message or append one
  let lastUserEntry: any = null;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === 'user') {
      lastUserEntry = contents[i];
      break;
    }
  }

  if (lastUserEntry && lastUserEntry.parts && lastUserEntry.parts[0]) {
    const textPart = lastUserEntry.parts[0] as { text: string };
    textPart.text = `${contextPrompt}\n\n${textPart.text}`;
  } else {
    // If contents has no user message or ended on a model message, append a fresh user turn
    contents.push({
      role: 'user',
      parts: [{ text: `${contextPrompt}\n\n${userMessage || 'Hello'}` }],
    });
  }

  // Ensure Gemini payload NEVER ends with a model turn
  while (contents.length > 0 && contents[contents.length - 1].role === 'model') {
    contents.pop();
  }

  // Debug logging
  if (addDebugLog) {
    addDebugLog(
      'orchestrator',
      `Model: ${modelName} | Entities: ${entityContext.entities.length} | History: ${contents.length} msgs` +
        (conversationSummary ? ' | Has rolling summary' : ''),
    );
  }

  try {
    // --- Multi-turn function-calling loop ---
    for (let turn = 0; turn < MAX_FUNCTION_TURNS; turn++) {
      const response = await withRetry(
        () =>
          ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              tools: FLOWMATE_TOOLS,
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
              systemInstruction,
              temperature: 0.7,
            },
          }),
        GEMINI_RETRY_CONFIG,
        (attempt, error, delay) => {
          console.warn(`[Gemini] Retry ${attempt} after ${delay}ms:`, error?.message);
        },
      );

      // --- Handle apply_changes (write tool) ---
      const applyCall = response.functionCalls?.find(c => c.name === 'apply_changes');
      if (applyCall) {
        const ops: ToonOperation[] = (applyCall.args as any).ops || [];
        const explanation = (applyCall.args as any).explanation || '';

        // Execute read-only calls that came in the same turn
        const otherCalls = (response.functionCalls || []).filter(c => c.name !== 'apply_changes');
        if (otherCalls.length > 0) {
          const otherResponses = otherCalls.map(c =>
            dispatchToolCall({ name: c.name!, args: c.args }, snapshot.entities),
          );
          contents.push({
            role: 'function' as any,
            parts: otherResponses.map(r => ({
              functionResponse: { name: r.name, response: r.response },
            })),
          });
        }

        return {
          ops,
          assistant: {
            message: explanation,
            tone: 'neutral',
            follow_up: [],
          },
        };
      }

      // --- Handle read-only function calls (continue loop) ---
      if (response.functionCalls && response.functionCalls.length > 0) {
        // First append the model turn that invoked the function calls
        if (response.candidates && response.candidates[0]?.content) {
          contents.push(response.candidates[0].content);
        } else {
          contents.push({
            role: 'model',
            parts: response.functionCalls.map(call => ({
              functionCall: { name: call.name!, args: call.args },
            })),
          });
        }

        const functionResponses = response.functionCalls.map(call =>
          dispatchToolCall({ name: call.name!, args: call.args }, snapshot.entities),
        );

        contents.push({
          role: 'user',
          parts: functionResponses.map(r => ({
            functionResponse: { name: r.name, response: r.response },
          })),
        });

        continue;
      }

      // --- Handle pure text response ---
      let text = response.text || '';

      if (!text.trim()) {
        const upcoming = snapshot.entities
          .filter(
            e =>
              e.kind === 'EVENT' &&
              e.start_time &&
              new Date(e.start_time) > new Date(),
          )
          .slice(0, 3)
          .map(e => e.title)
          .join(', ');

        text = upcoming
          ? `I'm here to help! Your upcoming events include: ${upcoming}. What would you like to work on?`
          : "I'm here to help organize your productivity! Try asking me to create a task, schedule an event, or track a goal.";
      }

      // Parse stray JSON output (rare edge case)
      let toonOps: ToonOperation[] = [];
      try {
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        if (cleaned.startsWith('{') && cleaned.includes('"ops"')) {
          const parsed = JSON.parse(cleaned);
          if (parsed.ops) toonOps = parsed.ops;
        }
      } catch {
        // Not JSON — expected for normal text responses
      }

      return {
        ops: toonOps,
        assistant: {
          message: text,
          tone: 'neutral',
          follow_up: [],
        },
      };
    }

    throw new Error('Max function-calling turns exceeded');
  } catch (error: any) {
    console.error('Orchestrator failed:', error);

    const errorMsg = error?.message?.includes('quota')
      ? 'API quota exceeded. Please wait a moment and try again.'
      : error?.message?.includes('network') || error?.message?.includes('fetch')
        ? 'Network error. Please check your connection.'
        : "I encountered a temporary issue. Please try again — I'm ready to help!";

    return {
      ops: [],
      assistant: { message: errorMsg, tone: 'error', follow_up: [] },
    };
  }
};

// ---------------------------------------------------------------------------
// generateBriefing
// ---------------------------------------------------------------------------

export const generateBriefing = async (
  snapshot: { entities: Entity[]; relationships: Relationship[] },
): Promise<string> => {
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || DEFAULT_MODEL;
  const ai = getAiClient();
  const timezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date();

  const timeContext = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
    timeZone: timezone,
  });

  const activeTasks = snapshot.entities
    .filter(e => e.kind === EntityKind.TASK && e.status === EntityStatus.ACTIVE)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  const eventsToday = snapshot.entities.filter(
    e =>
      e.kind === EntityKind.EVENT &&
      e.start_time &&
      new Date(e.start_time).toDateString() === now.toDateString(),
  );

  const prompt = buildBriefingPrompt({
    timeContext,
    timezone,
    activeTasks: activeTasks.map(t => ({
      title: t.title,
      priority: t.priority,
      deadline: t.deadline,
    })),
    eventsToday: eventsToday.map(e => ({ title: e.title, time: e.start_time })),
  });

  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { temperature: 0.7 },
        }),
      GEMINI_RETRY_CONFIG,
      (attempt, _error, delay) => {
        console.warn(`[Gemini Briefing] Retry ${attempt} after ${delay}ms`);
      },
    );
    return response.text || 'Could not generate briefing.';
  } catch (err) {
    console.error('Briefing generation failed:', err);
    return 'Unable to connect to AI for briefing.';
  }
};

// ---------------------------------------------------------------------------
// improveText
// ---------------------------------------------------------------------------

export const improveText = async (
  text: string,
  type: ImprovementType,
): Promise<string> => {
  if (!text) return '';
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || DEFAULT_MODEL;
  const ai = getAiClient();

  const prompt = `
TASK: ${IMPROVEMENT_INSTRUCTIONS[type]}

INPUT TEXT:
"${text}"

OUTPUT:
Return only the improved text. Do not add conversational filler.`.trim();

  try {
    const response = await withRetry(
      () => ai.models.generateContent({ model: modelName, contents: prompt }),
      GEMINI_RETRY_CONFIG,
      (attempt, _error, delay) => {
        console.warn(`[Gemini Text] Retry ${attempt} after ${delay}ms`);
      },
    );
    return response.text?.trim() || text;
  } catch (err) {
    console.error('Improve text failed:', err);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// queryKnowledgeBase
// ---------------------------------------------------------------------------

export const queryKnowledgeBase = async (
  query: string,
  entities: Entity[],
): Promise<string> => {
  const { settings } = useStore.getState();
  const modelName = settings?.preferred_model || DEFAULT_MODEL;
  const ai = getAiClient();

  // Rank candidates by relevance, exclude hidden
  const candidates = entities
    .filter(e => !e.metadata?.hidden)
    .map(e => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      content: e.description || '',
      tags: e.canonical_tags?.join(', ') || '',
      score: calculateRelevance(e, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // Fallback to title matching if no relevance hits
  const hasRelevant = candidates.some(c => c.score > 0);
  const finalCandidates = hasRelevant
    ? candidates.filter(c => c.score > 0).slice(0, 15)
    : candidates
        .filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);

  if (finalCandidates.length === 0) {
    return "I couldn't find any relevant items in your knowledge base for that query.";
  }

  const contextText = finalCandidates
    .map(
      c => `Title: ${c.title}\nKind: ${c.kind}\nTags: ${c.tags}\nContent: ${c.content}\n---`,
    )
    .join('\n');

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
- Keep it concise.`.trim();

  try {
    const response = await withRetry(
      () => ai.models.generateContent({ model: modelName, contents: prompt }),
      GEMINI_RETRY_CONFIG,
      (attempt, _error, delay) => {
        console.warn(`[Gemini Knowledge] Retry ${attempt} after ${delay}ms`);
      },
    );
    return response.text?.trim() || 'No answer generated.';
  } catch (err) {
    console.error('Knowledge query failed:', err);
    return 'Error querying knowledge base.';
  }
};
