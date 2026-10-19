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

import { getAiClient, getEphemeralApiKey, hasAiApiKey, GEMINI_RETRY_CONFIG, DEFAULT_MODEL } from "./client";
import { defaultReasoningForIdentity } from './modelCatalog';
import { hasManagedAiIdentity } from "./managedClient";
import { FLOWMATE_TOOLS, ACTIVE_AI_TOOLS } from "./tools";
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
  buildFoodContext,
  buildHistory,
  summarizeOlderMessages,
} from "./context";
import { contextResolver } from "../context";
import { auth } from "../firebase";
import { generateManagedContent, ManagedAiError, type ReasoningLevel } from "./managedClient";
import { generateArgonByokContent } from './argon';
import { getManagedAiUser } from '../firebase';
import { v4 as uuidv4 } from "uuid";
import { getManagedAiLimitCopy } from './managedAiLimitCopy';
import { getOptedInOnboardingContext } from '../onboardingProfile';

// These legacy tools directly mutate local state. Managed AI receives only
// read-only tools and apply_changes, which remains behind the existing review UI.
const MANAGED_BLOCKED_MUTATION_TOOLS = new Set(['configure_commitment', 'record_commitment_evidence']);
const MANAGED_AI_TOOLS = ACTIVE_AI_TOOLS.map(tool => ({
  ...tool,
  functionDeclarations: tool.functionDeclarations?.filter(declaration => !MANAGED_BLOCKED_MUTATION_TOOLS.has(declaration.name)),
})).filter(tool => tool.functionDeclarations?.length);
const MANAGED_AI_TOOL_NAMES = new Set(MANAGED_AI_TOOLS.flatMap(tool => tool.functionDeclarations?.map(declaration => declaration.name) || []));

// ---------------------------------------------------------------------------
// Orchestration Callbacks & orchestrateMessage
// ---------------------------------------------------------------------------

export interface OrchestrationCallbacks {
  onChunk?: (chunk: string) => void;
  onManagedAiLimit?: (code: 'GUEST_TURN_ALLOWANCE_EXHAUSTED' | 'TURN_ALLOWANCE_EXHAUSTED') => void;
  onThinking?: (thinkingText: string) => void;
  onToolCall?: (tool: { name: string; latency_ms: number; success: boolean }) => void;
  onMetrics?: (metrics: {
    ttft_ms?: number;
    thinking_ms?: number;
    total_ms?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  }) => void;
  signal?: AbortSignal;
}

export const orchestrateMessage = async (
  history: Message[],
  userMessage: string,
  snapshot: { entities: Entity[]; relationships: Relationship[] },
  attachmentDataUrl?: string | null,
  callbacks?: OrchestrationCallbacks,
): Promise<ToonResponse> => {
  const { addDebugLog, settings, universalTags } = useStore.getState();
  const modelName = settings?.preferred_model || DEFAULT_MODEL;
  const usesArgon = modelName === 'gemini-4-argon';
  const customInstructions = settings?.custom_instructions || '';

  // Never present deterministic local rules as generated AI output.
  const useManagedAi = !hasAiApiKey() && hasManagedAiIdentity();
  if (!hasAiApiKey() && !useManagedAi) {
    const unavailableMessage = 'Gemini is not configured, so Flowmate did not generate an AI response. Your message is saved in this conversation. Configure an authorized provider in Settings to use AI assistance; your local workspace remains available.';
    callbacks?.onChunk?.(unavailableMessage);
    return {
      ops: [],
      assistant: {
        message: unavailableMessage,
        tone: 'neutral',
        follow_up: ['Open Settings'],
      },
      provider: 'unavailable',
    };
  }

  const managedUser = useManagedAi ? await getManagedAiUser() : null;
  const anonymousAiAccess = Boolean(managedUser?.isAnonymous);
  const reasoningLevel = defaultReasoningForIdentity(
    anonymousAiAccess,
    settings?.preferred_reasoning_level as ReasoningLevel | undefined,
  );

  const ai = useManagedAi ? null : getAiClient();
  const managedTurnId = useManagedAi ? uuidv4() : '';

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

  // --- P1-07 Unified Context & Memory Resolution ---
  const resolvedContext = await contextResolver.resolveContext({
    userMessage,
    source: 'text_chat',
  });

  const entityContext = buildEntityContext(
    snapshot.entities,
    snapshot.relationships,
    userMessage,
  );
  const tagList = (universalTags || [])
    .slice(0, 20)
    .map(t => `${t.title} (${t.kind[0]})`)
    .join(', ');

  const promptSections: string[] = [
    resolvedContext.serializedPromptSection,
    `[Graph] ${JSON.stringify(entityContext)}`,
    tagList ? `[Tags] ${tagList}` : '',
    getOptedInOnboardingContext(useStore.getState().currentUser?.uid || 'guest'),
  ];

  if (featureToggles.food_tracking) {
    const food = buildFoodContext();
    if (food.summary) promptSections.push(`[Food] ${food.summary}`);
    if (food.recentMeals) promptSections.push(`[Recent meals] ${food.recentMeals}`);
  }

  const contextPrompt = promptSections.filter(Boolean).join('\n\n');

  // --- Conversation History (with rolling summary) ---
  const conversationSummary = summarizeOlderMessages(history);
  const contents = buildHistory(history, conversationSummary, attachmentDataUrl);

  // Attach context to the latest user message or append one
  let lastUserEntry: Content | null = null;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === 'user') {
      lastUserEntry = contents[i];
      break;
    }
  }

  if (lastUserEntry && lastUserEntry.parts && lastUserEntry.parts[0]) {
    const firstPart = lastUserEntry.parts[0];
    if (typeof firstPart === 'object' && firstPart !== null && 'text' in firstPart) {
      (firstPart as { text: string }).text = `${contextPrompt}\n\n${(firstPart as { text: string }).text}`;
    }
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

  const turnStartTime = performance.now();
  let firstTokenTime: number | null = null;
  let accumulatedStreamingText = '';
  let previousToolExchange = '';

  try {
    // --- Multi-turn function-calling loop ---
    while (true) {
      if (performance.now() - turnStartTime > 270_000) {
        throw new Error('This request reached Flowmate’s safe execution window while continuing tool work. Your message and workspace remain available; please review the result before retrying.');
      }
      if (callbacks?.signal?.aborted) {
        throw new DOMException('Aborted by user', 'AbortError');
      }

      let responseText = '';
      const functionCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
      let candidateContent: Content | null = null;

      const aiConfig = {
        ...(!usesArgon ? {
          tools: useManagedAi ? MANAGED_AI_TOOLS : ACTIVE_AI_TOOLS,
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        } : {}),
        systemInstruction,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: reasoningLevel.toUpperCase() as any },
      };

      if (useManagedAi) {
        // A retry must carry the same idempotency key. If the server completed
        // the call but the response was lost, a fresh id would bill and execute
        // the same model round a second time.
        const callId = uuidv4();
        const response = await withRetry(
          () => generateManagedContent(contents, aiConfig, managedTurnId, callId, callbacks?.signal, {
            model: modelName,
            reasoningLevel,
            purpose: 'chat',
          }),
          GEMINI_RETRY_CONFIG,
          (attempt, error, delay) => {
            console.warn(`[Managed Gemini] Retry ${attempt} after ${delay}ms:`, error?.message);
          },
        );
        if (response.functionCalls.some(call => !MANAGED_AI_TOOL_NAMES.has(call.name))) {
          throw new ManagedAiError('UNSUPPORTED_TOOL_CALL', 502);
        }
        candidateContent = response.candidates[0]?.content as Content | null;
        functionCalls.push(...response.functionCalls.map(fc => ({ name: fc.name, args: fc.args })));
        responseText = response.text || '';
        if (responseText) {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
            callbacks?.onMetrics?.({ ttft_ms: Math.round(firstTokenTime - turnStartTime) });
          }
          accumulatedStreamingText += responseText;
          callbacks?.onChunk?.(responseText);
        }
      } else if (usesArgon) {
        if (!ai) throw new Error('AI provider unavailable');
        const apiKey = getEphemeralApiKey();
        if (!apiKey) throw new Error('Your Gemini key is no longer available in this browser session. Re-enter it in Settings; no other model was selected.');
        const response = await generateArgonByokContent(
          apiKey,
          contents,
          aiConfig,
          reasoningLevel,
          callbacks?.signal,
        );
        candidateContent = response.candidates[0]?.content as Content | null;
        responseText = response.text;
        if (responseText) {
          firstTokenTime = performance.now();
          callbacks?.onMetrics?.({ ttft_ms: Math.round(firstTokenTime - turnStartTime) });
          accumulatedStreamingText += responseText;
          callbacks?.onChunk?.(responseText);
        }
      } else if (ai && typeof ai.models.generateContentStream === 'function') {
        const stream = await withRetry(
          () =>
            ai.models.generateContentStream({
              model: modelName,
              contents,
              config: aiConfig,
            }),
          GEMINI_RETRY_CONFIG,
          (attempt, error, delay) => {
            console.warn(`[Gemini] Stream retry ${attempt} after ${delay}ms:`, error?.message);
          },
        );

        for await (const chunk of stream) {
          if (callbacks?.signal?.aborted) {
            throw new DOMException('Aborted by user', 'AbortError');
          }

          if (chunk.candidates && chunk.candidates[0]?.content) {
            candidateContent = chunk.candidates[0].content;
          }

          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            for (const fc of chunk.functionCalls) {
              functionCalls.push({ name: fc.name!, args: fc.args as Record<string, unknown> | undefined });
            }
          }

          const chunkText = chunk.text;
          if (chunkText) {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
              const ttft = Math.round(firstTokenTime - turnStartTime);
              callbacks?.onMetrics?.({ ttft_ms: ttft });
            }
            responseText += chunkText;
            accumulatedStreamingText += chunkText;
            callbacks?.onChunk?.(chunkText);
          }
        }
      } else {
        if (!ai) throw new Error('AI provider unavailable');
        const response = await withRetry(
          () =>
            ai.models.generateContent({
              model: modelName,
              contents,
              config: aiConfig,
            }),
          GEMINI_RETRY_CONFIG,
          (attempt, error, delay) => {
            console.warn(`[Gemini] Retry ${attempt} after ${delay}ms:`, error?.message);
          },
        );

        if (response.candidates && response.candidates[0]?.content) {
          candidateContent = response.candidates[0].content;
        }
        if (response.functionCalls && response.functionCalls.length > 0) {
          for (const fc of response.functionCalls) {
            functionCalls.push({ name: fc.name!, args: fc.args as Record<string, unknown> | undefined });
          }
        }
        responseText = response.text || '';
        if (responseText) {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
            const ttft = Math.round(firstTokenTime - turnStartTime);
            callbacks?.onMetrics?.({ ttft_ms: ttft });
          }
          callbacks?.onChunk?.(responseText);
        }
      }

      // --- Handle apply_changes (write tool) ---
      const applyCall = functionCalls.find(c => c.name === 'apply_changes');
      if (applyCall) {
        const rawArgs = applyCall.args;
        const ops: ToonOperation[] = Array.isArray(rawArgs?.ops)
          ? (rawArgs.ops as ToonOperation[])
          : [];
        const explanation = typeof rawArgs?.explanation === 'string'
          ? rawArgs.explanation
          : '';

        // Execute read-only calls that came in the same turn
        const otherCalls = functionCalls.filter(c => c.name !== 'apply_changes');
        if (otherCalls.length > 0) {
          const otherResponses = await Promise.all(
            otherCalls.map(async c => {
              const t0 = performance.now();
              const res = await dispatchToolCall(
                { name: c.name!, args: c.args as Record<string, unknown> | undefined },
                snapshot.entities,
              );
              const lat = Math.round(performance.now() - t0);
              callbacks?.onToolCall?.({ name: c.name!, latency_ms: lat, success: true });
              return res;
            }),
          );
          contents.push({
            role: 'user',
            parts: otherResponses.map(r => ({
              functionResponse: { name: r.name, response: r.response },
            })),
          });
        }

        const total_ms = Math.round(performance.now() - turnStartTime);
        callbacks?.onMetrics?.({
          total_ms,
          ttft_ms: firstTokenTime ? Math.round(firstTokenTime - turnStartTime) : undefined,
        });

        return {
          ops,
          assistant: {
            message: explanation,
            tone: 'neutral',
            follow_up: [],
          },
          provider: useManagedAi ? 'managed' : 'byok',
          model: modelName,
          reasoningLevel,
        };
      }

      // --- Handle read-only function calls (continue loop) ---
      if (functionCalls.length > 0) {
        if (candidateContent) {
          contents.push(candidateContent);
        } else {
          contents.push({
            role: 'model',
            parts: functionCalls.map(call => ({
              functionCall: { name: call.name, args: call.args },
            })),
          });
        }

        const functionResponses = await Promise.all(
          functionCalls.map(async call => {
            const t0 = performance.now();
            const res = await dispatchToolCall(
              { name: call.name, args: call.args },
              snapshot.entities,
            );
            const lat = Math.round(performance.now() - t0);
            callbacks?.onToolCall?.({ name: call.name, latency_ms: lat, success: true });
            return res;
          }),
        );

        const exchangeFingerprint = JSON.stringify({
          calls: functionCalls.map(call => ({ name: call.name, args: call.args || {} })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          responses: functionResponses.map(response => ({ name: response.name, response: response.response })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        });
        if (exchangeFingerprint === previousToolExchange) {
          throw new Error('Flowmate stopped a repeated identical tool exchange to prevent an AI loop. Your message and workspace remain available.');
        }
        previousToolExchange = exchangeFingerprint;

        contents.push({
          role: 'user',
          parts: functionResponses.map(r => ({
            functionResponse: { name: r.name, response: r.response },
          })),
        });

        continue;
      }

      // --- Handle pure text response ---
      const text = responseText;
      if (!text.trim()) throw new Error('The selected model returned no visible response. No substitute response was generated.');

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

      const total_ms = Math.round(performance.now() - turnStartTime);
      callbacks?.onMetrics?.({
        total_ms,
        ttft_ms: firstTokenTime ? Math.round(firstTokenTime - turnStartTime) : undefined,
      });

      return {
        ops: toonOps,
        assistant: {
          message: text,
          tone: 'neutral',
          follow_up: [],
        },
        provider: useManagedAi ? 'managed' : 'byok',
        model: modelName,
        reasoningLevel,
      };
    }

  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        ops: [],
        assistant: {
          message: accumulatedStreamingText || 'Generation stopped.',
          tone: 'neutral',
          follow_up: [],
        },
      };
    }

    const managedLimitCodes = ['GUEST_TURN_ALLOWANCE_EXHAUSTED', 'TURN_ALLOWANCE_EXHAUSTED'] as const;
    if (error instanceof ManagedAiError && managedLimitCodes.includes(error.code as (typeof managedLimitCodes)[number])) {
      const message = getManagedAiLimitCopy(error.code as (typeof managedLimitCodes)[number]).description;
      callbacks?.onManagedAiLimit?.(error.code as (typeof managedLimitCodes)[number]);
      callbacks?.onChunk?.(message);
      return { ops: [], assistant: { message, tone: 'neutral', follow_up: ['Open Gemini settings'] }, provider: 'managed-limited' };
    }

    if (error instanceof ManagedAiError) {
      const managedErrors: Record<string, string> = {
        AUTH_REQUIRED: 'Flowmate could not establish an AI session. Your message is saved; retry or use your own Gemini key in Settings.',
        APP_CHECK_REQUIRED: 'Flowmate could not verify this app for managed AI. Your message is saved; try again later or use your own Gemini key in Settings.',
        RATE_LIMITED: 'Managed AI is receiving requests too quickly. Wait a moment and try again; your message is saved.',
        MODEL_CONTEXT_LIMIT: 'This request exceeds the selected model’s current context capacity. Choose a model with a larger context or shorten the conversation; your message is saved.',
        OUTPUT_TOKEN_LIMIT: 'This response is longer than Flowmate’s managed limit for this tier. Ask for a shorter answer or use your own Gemini key; your message is saved.',
        TURN_GENERATION_LIMIT: 'This turn reached its safe multi-step limit. Start a new chat turn to continue; your message is saved.',
        TURN_COST_ENVELOPE_EXHAUSTED: 'This turn would exceed its managed generation budget. Start a new turn or use your own Gemini key; your workspace is unchanged.',
        USER_MANAGED_BUDGET_EXHAUSTED: 'Your managed AI monthly spending allowance is used. It resets next month; your message is saved, and your own Gemini key remains available.',
        MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE: 'Flowmate’s managed AI spending protection is at its current monthly limit. Try again next month or use your own Gemini key; your message is saved.',
        MANAGED_AI_BUDGET_UNAVAILABLE: 'Flowmate’s managed AI spending protection is temporarily unavailable. Your message is saved; please try again later or use your own Gemini key.',
        PRICING_POLICY_UNAVAILABLE: 'Flowmate could not verify current model pricing, so it did not send this managed request. Your message is saved; please try again later or use your own Gemini key.',
        MODEL_NOT_ALLOWED_FOR_ACCOUNT: 'That model or reasoning level needs a privileged account or your own key. Choose an available option in the model control; your message is saved.',
        MODEL_UNAVAILABLE: 'The selected model is not currently available for this provider. Choose another validated model; your message is saved.',
        MODEL_TOOL_CALLING_UNAVAILABLE: 'The selected model cannot perform Flowmate tool-assisted requests. Choose a model with function calling; your message is saved.',
        UNSUPPORTED_REASONING_LEVEL: 'That reasoning level is not supported for the selected model and access tier. Choose a listed level; your message is saved.',
        MANAGED_AI_DISABLED: 'Flowmate managed AI is temporarily unavailable. Your message is saved; you can use your own Gemini key in Settings.',
        MANAGED_AI_NOT_CONFIGURED: 'Flowmate managed AI is not configured here. Your message is saved; you can use your own Gemini key in Settings.',
        USER_CALL_IN_PROGRESS: 'Another Flowmate AI request is still running for this account. Wait a moment and try again; your message is saved.',
        UNSUPPORTED_TOOL_CALL: 'Flowmate stopped an unsupported AI action before changing your workspace. Your message is saved.',
        MODEL_CATALOG_UNAVAILABLE: 'Flowmate could not confirm which models this provider currently supports. No alternate model was selected; your message is saved.',
        MODEL_INPUT_UNSUPPORTED: 'The selected model rejected this input format. No alternate model was selected; your message is saved.',
        PROVIDER_RATE_LIMITED: 'The selected model is temporarily rate-limited by Google. No alternate model was selected; your message is saved.',
      };
      const message = managedErrors[error.code] || 'Flowmate could not reach Gemini. No local AI fallback was used; your message is saved. Please retry later or add your own Gemini key in Settings.';
      callbacks?.onChunk?.(message);
      return { ops: [], assistant: { message, tone: 'error', follow_up: [] }, provider: 'unavailable' };
    }
    console.error('Orchestrator failed:', error);

    const errObj = error as { message?: string } | null;
    const errorMsg = errObj?.message?.includes('quota')
      ? 'API quota exceeded. Please wait a moment and try again.'
      : errObj?.message?.includes('network') || errObj?.message?.includes('fetch')
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

export interface GeneratedBriefing {
  content: string;
  source: 'local' | 'managed' | 'byok';
}

export const generateBriefing = async (
  snapshot: { entities: Entity[]; relationships: Relationship[] },
): Promise<GeneratedBriefing> => {
  const { settings } = useStore.getState();
  // Briefings have their own allowance and a predictable, economical model
  // policy. They never inherit a user's potentially expensive chat selection.
  const briefingModel = DEFAULT_MODEL;
  const timezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date();
  const useManagedAi = !hasAiApiKey() && hasManagedAiIdentity();

  if (!hasAiApiKey() && !useManagedAi) {
    const activeTasks = snapshot.entities.filter(e => e.kind === EntityKind.TASK && e.status === EntityStatus.ACTIVE);
    const eventsToday = snapshot.entities.filter(
      e => e.kind === EntityKind.EVENT && e.start_time && new Date(e.start_time).toDateString() === now.toDateString(),
    );
    return {
      content: `Local briefing: you have ${activeTasks.length} active task${activeTasks.length === 1 ? '' : 's'} and ${eventsToday.length} scheduled event${eventsToday.length === 1 ? '' : 's'} today. Calculated from your current workspace, without an AI request.`,
      source: 'local',
    };
  }

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

  if (useManagedAi) {
    const turnId = uuidv4();
    const callId = uuidv4();
    const response = await withRetry(
      () => generateManagedContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { temperature: 0.7, maxOutputTokens: 512 },
        turnId,
        callId,
        undefined,
        { model: DEFAULT_MODEL, reasoningLevel: 'low', purpose: 'briefing' },
      ),
      GEMINI_RETRY_CONFIG,
      (attempt, error, delay) => {
        console.warn(`[Managed Gemini Briefing] Retry ${attempt} after ${delay}ms:`, error?.message);
      },
    );
    const content = response.text.trim();
    if (!content) throw new ManagedAiError('GENERATION_FAILED', 502);
    return { content, source: 'managed' };
  }

  const ai = getAiClient();
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: briefingModel,
          contents: prompt,
          config: { temperature: 0.7, thinkingConfig: { thinkingLevel: 'LOW' as any } },
        }),
      GEMINI_RETRY_CONFIG,
      (attempt, _error, delay) => {
        console.warn(`[Gemini Briefing] Retry ${attempt} after ${delay}ms`);
      },
    );
    const content = response.text?.trim();
    if (!content) throw new Error('Gemini returned an empty briefing.');
    return { content, source: 'byok' };
  } catch (err) {
    console.error('Briefing generation failed:', err);
    throw err;
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
