import { 
  Behavior,
  GoogleGenAI, 
  LiveServerMessage, 
  Modality, 
  ThinkingLevel,
  Type, 
  FunctionDeclaration,
  Session,
  type LiveConnectConfig,
} from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useStore } from "../store";
import { EntityKind, ToonOperation, UserSettings } from "../types";
import { getByokLiveClient, getByokLiveModelOptions, getEphemeralApiKey, hasAiApiKey, AI_MODELS } from './ai/client';
import { createManagedLiveSession, hasManagedAiIdentity, ManagedAiError } from './ai/managedClient';
import { contextResolver, selectEligibleMemories, isEntityExcludedFromEgress } from './context';
import { convertOperationsToActionProposal } from './kernel';
import { getOptedInOnboardingContext } from './onboardingProfile';

const MODEL_NAME = AI_MODELS.LIVE;

type ManagedLiveGrant = Awaited<ReturnType<typeof createManagedLiveSession>>;

function connectManagedRelay(
  grant: ManagedLiveGrant,
  setup: LiveConnectConfig,
  callbacks: { onopen: () => void; onmessage: (message: LiveServerMessage) => Promise<void>; onclose: () => void; onerror: (code?: string) => void },
): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${grant.webSocketUrl}?ticket=${encodeURIComponent(grant.ticket)}`);
    let ready = false;
    let closed = false;
    let closingForError = false;
    const fail = (code: string) => {
      if (!ready) reject(new ManagedAiError(code, 503));
      else { closingForError = true; callbacks.onerror(code); }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(4400, code.slice(0, 100));
    };
    const transport = {
      sendRealtimeInput: (params: { audio?: { mimeType?: string; data?: unknown } }) => {
        if (socket.readyState !== WebSocket.OPEN || !params.audio || typeof params.audio.data !== 'string') return;
        if (socket.bufferedAmount > 65_536) { fail('LIVE_SESSION_LIMIT_REACHED'); return; }
        socket.send(JSON.stringify({ type: 'inputAudio', payload: params.audio }));
      },
      sendToolResponse: (params: unknown) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'toolResponse', payload: params }));
      },
      close: () => {
        closed = true;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, 'client-ended');
      },
    };
    socket.onopen = () => {
      callbacks.onopen();
      const systemInstruction = setup.systemInstruction && typeof setup.systemInstruction === 'object'
        ? (setup.systemInstruction as { parts?: Array<{ text?: string }> }).parts?.map(part => part.text || '').join('\n') || ''
        : String(setup.systemInstruction || '');
      socket.send(JSON.stringify({
        type: 'setup',
        payload: {
          model: grant.model,
          reasoningLevel: grant.reasoningLevel || 'medium',
          systemInstruction,
          tools: setup.tools?.flatMap(tool => 'functionDeclarations' in tool ? tool.functionDeclarations || [] : []) || [],
        },
      }));
    };
    socket.onmessage = event => {
      let envelope: unknown;
      try { envelope = JSON.parse(String(event.data)); } catch { fail('LIVE_RELAY_UNAVAILABLE'); return; }
      if (!envelope || typeof envelope !== 'object') { fail('LIVE_RELAY_UNAVAILABLE'); return; }
      const frame = envelope as { type?: string; error?: { code?: string }; message?: LiveServerMessage };
      if (frame.type === 'error') { fail(frame.error?.code || 'LIVE_RELAY_UNAVAILABLE'); return; }
      if (frame.type !== 'message' || !frame.message) { fail('LIVE_RELAY_UNAVAILABLE'); return; }
      // Managed sessions are one-shot server-owned sockets; never expose a
      // provider resumption handle that could invite a second paid connection.
      if (frame.message.sessionResumptionUpdate) return;
      void callbacks.onmessage(frame.message);
      if (!ready && frame.message.setupComplete) {
        ready = true;
        resolve(transport as unknown as Session);
      }
    };
    socket.onerror = () => {
      if (!ready) reject(new ManagedAiError('LIVE_RELAY_UNAVAILABLE', 503));
      else { closingForError = true; callbacks.onerror('LIVE_RELAY_UNAVAILABLE'); }
    };
    socket.onclose = () => {
      if (!ready) reject(new ManagedAiError('LIVE_RELAY_UNAVAILABLE', 503));
      else if (!closed && !closingForError) callbacks.onclose();
    };
  });
}

function managedLiveFailureCopy(code: string): string {
  const copy: Record<string, string> = {
    AUTH_REQUIRED: 'Your sign-in session expired. Sign in again, then start Live when ready.',
    APP_CHECK_REQUIRED: 'Flowmate could not verify this app session. Reload Flowmate and try again; this is an app verification issue, not a usage limit.',
    MANAGED_AI_DISABLED: 'Managed Live is currently unavailable. Your workspace is still available; you can choose your own Gemini key in Settings.',
    RATE_LIMITED: 'Too many Live starts were requested. Wait a minute, then start one session again.',
    LIVE_SESSION_ALREADY_ACTIVE: 'A managed Live session is still closing. Wait a moment before starting another.',
    LIVE_SESSION_LIMIT_REACHED: 'This managed Live session reached its safety limit and has been closed. You can start another session when the current allowance permits.',
    USER_MANAGED_BUDGET_EXHAUSTED: 'Your managed-AI monthly safety allowance is used. Check Settings for its reset; you can use your own Gemini key meanwhile.',
    MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE: 'Flowmate’s included AI is temporarily at its monthly safety limit. This cannot be cleared by changing your request; your workspace is unchanged.',
    LIVE_USAGE_UNAVAILABLE: 'Flowmate could not verify this Live session’s usage, so it closed the session and kept the safety hold. This needs server-side review; Chat and your workspace remain available.',
    LIVE_PROVIDER_UNAVAILABLE: 'The Gemini Live connection ended unexpectedly. Flowmate kept the safety hold while usage is checked; no automatic reconnect or duplicate session was started.',
    LIVE_RELAY_UNAVAILABLE: 'The managed Live connection could not be started. This needs an application-side service check; try again later or use your own Gemini key.',
    LIVE_RELAY_REQUIRED: 'Managed Live is being moved to a protected connection and is not available in this build yet.',
    LIVE_TICKET_INVALID: 'This Live start expired before connecting. Start a new session when ready.',
    LIVE_SETUP_MISMATCH: 'Flowmate could not verify the Live session setup. Reload the app; if it continues, it needs an application-side fix.',
    MANAGED_AI_NOT_CONFIGURED: 'Managed Live is not configured for this app yet. Your workspace remains available; use your own Gemini key or try later.',
  };
  return copy[code] || 'Managed Live could not start. Your workspace remains available; try later or use your own Gemini key in Settings.';
}

// --- Audio Utils (PCM 16kHz/24kHz processing) ---

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Float32 (Web Audio) to Int16 (PCM)
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output.buffer;
}

// Convert Int16 (PCM) to Float32 (Web Audio) safely using DataView
function pcmToAudioBuffer(
  data: Uint8Array, 
  ctx: AudioContext, 
  sampleRate: number
): AudioBuffer {
  const numSamples = Math.floor(data.byteLength / 2);
  const buffer = ctx.createBuffer(1, Math.max(1, numSamples), sampleRate);
  const channelData = buffer.getChannelData(0);
  const dataView = new DataView(data.buffer, data.byteOffset, numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    // Little-endian 16-bit signed PCM normalized to [-1.0, 1.0]
    channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
  }
  return buffer;
}

// --- Live Voice Status Definition ---

export type LiveVoiceStatus =
  | 'idle'
  | 'initializing'
  | 'connecting'
  | 'active'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'confirming_action'
  | 'interrupted'
  | 'error'
  | 'disconnected'
  | 'offline_fallback';

// --- Tool Argument Interfaces (ZERO any) ---

export interface ScheduleEventArgs {
  title: string;
  start_time: string;
  end_time?: string;
  description?: string;
  location?: string;
  recurrence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
}

export interface CreateEntityArgs {
  title: string;
  kind?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  deadline?: string;
  duration_minutes?: number;
  recurrence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
}

export interface LogActivityArgs {
  title: string;
  minutes?: number;
  productivity?: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
}

export interface ReadCalendarArgs {
  start_date: string;
  end_date: string;
}

export interface SearchEntitiesArgs {
  query: string;
  kind?: string;
}

export interface SearchMemoryArgs {
  query?: string;
  category?: string;
  include_situational?: boolean;
  limit?: number;
}

export interface ProposeMemoryUpdateArgs {
  content: string;
  category?: 'preference' | 'fact' | 'project_context' | 'relationship' | 'goal_aspiration' | 'routine';
  is_situational?: boolean;
  valid_until?: string;
  privacy_tier?: 'public' | 'private' | 'sensitive' | 'device_local';
}

export interface RecordCommitmentEvidenceArgs {
  entity_id: string;
  quantity?: number;
  timestamp?: string;
  note?: string;
  user_confirmed?: boolean;
}

// --- Tool Declarations ---

const scheduleEventTool: FunctionDeclaration = {
  name: 'schedule_event',
  description: 'Schedule an event, trip, train or flight journey, meeting, or appointment in the user\'s calendar and schedule. MUST include start_time and end_time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'The title of the event, e.g. "Train to Kolkata"' },
      start_time: { type: Type.STRING, description: 'Start time in ISO 8601 format with timezone offset, e.g. "2026-10-07T21:30:00+05:30"' },
      end_time: { type: Type.STRING, description: 'End time in ISO 8601 format with timezone offset, e.g. "2026-10-08T05:15:00+05:30"' },
      description: { type: Type.STRING, description: 'Additional details or notes about the journey/event' },
      location: { type: Type.STRING, description: 'Location, origin, or destination' },
      recurrence: { type: Type.STRING, enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'], description: 'Optional recurrence frequency' }
    },
    required: ['title', 'start_time']
  }
};

const createEntityTool: FunctionDeclaration = {
  name: 'create_entity',
  description: 'Create an entity in the user\'s life graph. For EVENT items, start_time and end_time MUST be provided.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'The title of the entity' },
      kind: { 
        type: Type.STRING, 
        enum: ['GOAL', 'PROJECT', 'TASK', 'NOTE', 'EVENT', 'CONTEXT', 'HABIT'],
        description: 'The type of entity. Use EVENT for meetings, trips, train journeys, appointments.'
      },
      description: { type: Type.STRING, description: 'Additional details' },
      start_time: { type: Type.STRING, description: 'Start time in ISO 8601 format with timezone offset (+05:30)' },
      end_time: { type: Type.STRING, description: 'End time in ISO 8601 format with timezone offset (+05:30)' },
      deadline: { type: Type.STRING, description: 'Due date / deadline for tasks (ISO 8601)' },
      duration_minutes: { type: Type.NUMBER, description: 'Estimated duration in minutes' },
      recurrence: { type: Type.STRING, enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] }
    },
    required: ['title', 'kind']
  }
};

const logActivityTool: FunctionDeclaration = {
  name: 'log_activity',
  description: 'Log completed activity, workout, study session, or habit progress.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'What was done' },
      minutes: { type: Type.NUMBER, description: 'Duration in minutes' },
      productivity: { type: Type.STRING, enum: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE'], description: 'Productivity rating' }
    },
    required: ['title']
  }
};

const readCalendarTool: FunctionDeclaration = {
  name: 'read_calendar',
  description: 'Check calendar events and scheduled tasks in a date range.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      start_date: { type: Type.STRING, description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: Type.STRING, description: 'End date (YYYY-MM-DD)' }
    },
    required: ['start_date', 'end_date']
  }
};

const searchEntitiesTool: FunctionDeclaration = {
  name: 'search_entities',
  description: 'Search existing items in the database by title, keyword, or kind.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Query text to search for' },
      kind: { type: Type.STRING, description: 'Filter by kind' }
    },
    required: ['query']
  }
};

const searchMemoryTool: FunctionDeclaration = {
  name: 'search_memory',
  description: 'Search user memories, stated preferences, or persistent facts by keyword or category.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Keyword to search in memory' },
      category: { type: Type.STRING, enum: ['preference', 'fact', 'project_context', 'relationship', 'goal_aspiration', 'routine'] },
      limit: { type: Type.NUMBER, description: 'Max results to return' }
    }
  }
};

const proposeMemoryUpdateTool: FunctionDeclaration = {
  name: 'propose_memory_update',
  description: 'Propose saving a durable user preference, belief, or situational context. Stages an action for explicit user confirmation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: { type: Type.STRING, description: 'The preference or fact stated by the user' },
      category: { type: Type.STRING, enum: ['preference', 'fact', 'project_context', 'relationship', 'goal_aspiration', 'routine'] },
      is_situational: { type: Type.BOOLEAN, description: 'True if temporary situational state' },
      valid_until: { type: Type.STRING, description: 'Expiration date for temporary context' },
      privacy_tier: { type: Type.STRING, enum: ['public', 'private', 'sensitive', 'device_local'] }
    },
    required: ['content']
  }
};

const recordCommitmentEvidenceTool: FunctionDeclaration = {
  name: 'record_commitment_evidence',
  description: 'Record progress or evidence towards a commitment or recurring goal.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      entity_id: { type: Type.STRING, description: 'ID of the target entity' },
      quantity: { type: Type.NUMBER, description: 'Quantity completed (default 1)' },
      timestamp: { type: Type.STRING, description: 'ISO timestamp of evidence' },
      note: { type: Type.STRING, description: 'Note on what was accomplished' },
      user_confirmed: { type: Type.BOOLEAN, description: 'True if confirmed by user' }
    },
    required: ['entity_id']
  }
};

// --- Live Manager Class ---

export class LiveManager {
  private ai: GoogleGenAI;
  private managedRelayGrant: ManagedLiveGrant | null = null;
  private liveSessionReady = false;
  private liveUsage: Record<string, unknown> | null = null;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private session: Session | null = null;
  private stream: MediaStream | null = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];
  
  // Public Analyser for UI Visualization
  public analyser: AnalyserNode | null = null;

  public onStatusChange: (status: LiveVoiceStatus, details?: string) => void = () => {};
  public onTranscription: (text: string, source: 'user' | 'model') => void = () => {};
  public onPendingOpsChange?: (ops: ToonOperation[]) => void;
  public onUsageChange: (usage: Record<string, unknown> | null) => void = () => {};

  // Turn buffers for saving to store messages
  private userTurnBuffer: string = '';
  private modelTurnBuffer: string = '';
  private turnPendingOps: ToonOperation[] = [];
  private lastTurnMessageId: string = '';
  private currentStatus: LiveVoiceStatus = 'idle';
  private liveModel: 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking' = MODEL_NAME;
  private liveConfig: LiveConnectConfig | null = null;
  private resumptionHandle: string | null = null;
  private resumeAttempts = 0;
  private reconnecting = false;
  private intentionallyStopped = false;

  constructor() {
    this.ai = getByokLiveClient();
  }

  public getStatus(): LiveVoiceStatus {
    return this.currentStatus;
  }

  private setStatus(status: LiveVoiceStatus, details?: string) {
    this.currentStatus = status;
    this.onStatusChange(status, details);
  }

  private openLiveConnection(resumptionHandle?: string): Promise<Session> {
    if (!this.liveConfig) return Promise.reject(new Error('Live session configuration is unavailable.'));
    const callbacks = {
      onopen: () => this.setStatus('connecting', 'Connected to Gemini Live; waiting for session setup.'),
      onmessage: async (message: LiveServerMessage) => { await this.handleMessage(message); },
      onclose: () => { void this.handleUnexpectedDisconnect(); },
    };
    if (this.managedRelayGrant) return connectManagedRelay(this.managedRelayGrant, this.liveConfig, {
      ...callbacks,
      onerror: code => { void this.handleUnexpectedDisconnect(code ? managedLiveFailureCopy(code) : undefined); },
    });
    const config: LiveConnectConfig = {
      ...this.liveConfig,
      sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
    };
    return this.ai.live.connect({
      model: this.liveModel,
      config,
      callbacks: { ...callbacks, onerror: () => { void this.handleUnexpectedDisconnect(); } },
    });
  }

  private async handleUnexpectedDisconnect(details?: string): Promise<void> {
    this.flushBuffers();
    if (this.reconnecting) return;
    if (this.intentionallyStopped) {
      this.cleanup();
      this.setStatus('disconnected');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.liveSessionReady = false;
      this.stopAllAudioPlayback();
      this.stopMicrophoneCapture();
      this.setStatus('offline_fallback', this.managedRelayGrant
        ? 'The managed Live connection ended while offline. Start a new session after reconnecting; it will not resume automatically.'
        : 'Connection lost. Flowmate will try to resume when the device reconnects.');
      return;
    }
    if (this.resumptionHandle && this.resumeAttempts < 2) {
      await this.resumeLiveConnection();
      return;
    }
    this.setStatus('error', details || 'The Live session ended and could not be resumed. Retry to start a new session.');
    this.cleanup();
  }

  private async resumeLiveConnection(): Promise<void> {
    if (!this.resumptionHandle || !this.liveConfig || this.reconnecting || this.intentionallyStopped || this.resumeAttempts >= 2) return;
    const handle = this.resumptionHandle;
    this.reconnecting = true;
    this.resumeAttempts += 1;
    this.liveSessionReady = false;
    this.setStatus('connecting', 'Resuming your Gemini Live session…');
    const previous = this.session;
    this.session = null;
    try { previous?.close(); } catch { /* The transport may already be closed. */ }
    try {
      await new Promise(resolve => window.setTimeout(resolve, 150));
      if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.session = await this.openLiveConnection(handle);
      if (this.liveSessionReady) this.startAudioInput();
    } catch {
      this.setStatus('error', 'Live session resumption failed. Retry to start a new session.');
      this.cleanup();
    } finally {
      this.reconnecting = false;
    }
  }

  private handleOnline = () => {
    if (this.currentStatus === 'offline_fallback') {
      if (this.resumptionHandle) void this.resumeLiveConnection();
      else {
        this.setStatus('error', 'Network restored, but this Live session has no resumable checkpoint. Retry to start a new session.');
        this.cleanup();
      }
    }
  };

  private handleOffline = () => {
    this.stopAllAudioPlayback();
    this.stopMicrophoneCapture();
    if (this.managedRelayGrant) {
      try { this.session?.close(); } catch { /* server observes the relay close and ends Gemini */ }
      this.setStatus('offline_fallback', 'Managed Live stopped because the network disconnected. Reconnect, then start a new session.');
      return;
    }
    this.setStatus('offline_fallback', 'Network connection lost. Live voice requires an active internet connection.');
  };

  private stopMicrophoneCapture() {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  async connect() {
    try {
      this.intentionallyStopped = false;
      this.resumeAttempts = 0;
      if (!hasAiApiKey() && !hasManagedAiIdentity()) {
        this.setStatus('error', 'Gemini Live is unavailable because no managed session or personal Gemini key is configured.');
        return;
      }

      // 0b. Offline Check
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        this.setStatus('offline_fallback', 'Device is offline. Gemini Live voice requires an active internet connection.');
        return;
      }

      this.setStatus('connecting');

      // Bind network listeners
      if (typeof window !== 'undefined') {
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);
      }

      // Fetch User Settings & Context
      const settings = useStore.getState().settings || ({} as Partial<UserSettings>);
      const liveModel = settings.preferred_live_model || MODEL_NAME;
      const liveReasoning = settings.preferred_live_reasoning_level || 'medium';

      // P1-07 Unified Context & Memory Engine for Voice Session
      const resolved = await contextResolver.resolveContext({ source: 'voice_session' });
      const voiceContextSummary = contextResolver.formatForVoiceSession(resolved);

      const customInst = settings.custom_instructions 
        ? `\nImportant User Instructions:\n${settings.custom_instructions}` 
        : "";
      
      const systemInstructionText = `${voiceContextSummary}

${getOptedInOnboardingContext(useStore.getState().currentUser?.uid || 'guest')}

DOMAIN ARCHITECTURE & CAPABILITIES:
- Calendar & Scheduling: Flowmate's calendar and daily schedule use EVENT entities. For events, meetings, or time blocks the user asks to schedule, invoke the \`schedule_event\` tool with ISO 8601 \`start_time\` and \`end_time\` in the user's configured timezone from context. Ask if a required time or timezone is unclear.
- Actions & Operations: Tool calls generate interactive confirmation previews on the user's screen before persisting changes. User authority is strictly preserved.
- Contexts & Projects: Domains or broad life areas (e.g., Work, Academics, Club) are CONTEXT entities. Specific initiatives with deliverables are PROJECT entities.
- Activity Logging: Track habits and tasks with \`log_activity\` including duration and productivity classification (PRODUCTIVE, NEUTRAL, UNPRODUCTIVE).
- Memory & Preferences: When user states preferences, routines, or durable facts, invoke \`propose_memory_update\` to stage for user confirmation.
${customInst}`;

      if (hasAiApiKey()) {
        const availableModels = await getByokLiveModelOptions();
        if (!availableModels.some(option => option.id === liveModel)) {
          throw new Error(`The saved Live model “${liveModel}” is not available to the current key. Select a model shown in Settings; Flowmate did not switch models.`);
        }
        this.ai = getByokLiveClient();
      }
      
      // 1. Audio Setup (ZERO any)
      type WindowWithWebkitAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const win = window as WindowWithWebkitAudio;
      const AudioCtx = window.AudioContext || win.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this browser environment');
      }

      this.inputContext = new AudioCtx({ sampleRate: 16000 });
      this.outputContext = new AudioCtx({ sampleRate: 24000 });
      
      if (this.inputContext.state === 'suspended') {
        await this.inputContext.resume();
      }
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume();
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const declarations: FunctionDeclaration[] = [
        scheduleEventTool, createEntityTool, logActivityTool, readCalendarTool,
        searchEntitiesTool, searchMemoryTool, proposeMemoryUpdateTool, recordCommitmentEvidenceTool,
      ];
      if (!hasAiApiKey()) {
        const grant = await createManagedLiveSession(
          liveModel,
          liveReasoning,
          systemInstructionText,
          declarations.map(declaration => ({
            name: declaration.name || '',
            description: declaration.description || '',
            parameters: (declaration.parameters || {}) as Record<string, unknown>,
          })),
        );
        this.managedRelayGrant = grant;
      } else if (!getEphemeralApiKey()) {
        throw new Error('The personal Gemini key is no longer available in this browser session. Re-enter it in Settings.');
      }
      
      // 2. Connect to Gemini Live
      this.liveModel = liveModel;
      this.liveConfig = {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: declarations.map(declaration => ({
            ...declaration,
            ...(liveModel === 'gemini-3.8-live-extended-thinking' ? { behavior: Behavior.NON_BLOCKING } : {}),
          })) }],
          systemInstruction: {
             parts: [{ text: systemInstructionText }]
          },
          ...(!this.managedRelayGrant ? { sessionResumption: {} } : {}),
          ...(liveModel === 'gemini-3.8-live-extended-thinking'
            ? { thinkingConfig: { thinkingLevel: liveReasoning.toUpperCase() as ThinkingLevel } }
            : {}),
        };

      this.session = await this.openLiveConnection();
      if (this.liveSessionReady) this.startAudioInput();

    } catch (err) {
      console.error("[LiveManager] Failed to connect:", err);
      let errorMsg = 'Failed to connect to Gemini Live voice service.';
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        errorMsg = 'Microphone access denied. Please grant microphone permissions in browser settings.';
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        errorMsg = 'No microphone input device found.';
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        this.setStatus('offline_fallback', 'Device is offline.');
        this.cleanup();
        return;
      } else if (err instanceof ManagedAiError) {
        errorMsg = managedLiveFailureCopy(err.code);
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }
      this.setStatus('error', errorMsg);
      this.cleanup();
    }
  }

  private startAudioInput() {
    if (!this.inputContext || !this.stream || this.processor) return;

    this.source = this.inputContext.createMediaStreamSource(this.stream);
    
    // Create Analyser
    this.analyser = this.inputContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    
    // Create Processor
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.session) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(inputData);
      const uint8 = new Uint8Array(pcm16);
      const base64 = bytesToBase64(uint8);

      try {
        this.session.sendRealtimeInput({
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64
          }
        });
      } catch (err) {
        console.warn("[LiveManager] Failed to send audio chunk:", err);
      }
    };

    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  public stopAllAudioPlayback() {
    for (const src of this.activeAudioSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeAudioSources = [];
    if (this.outputContext) {
      this.nextStartTime = this.outputContext.currentTime;
    } else {
      this.nextStartTime = 0;
    }
  }

  public flushUserTurn(): string | null {
    const text = this.userTurnBuffer.trim();
    if (text) {
      this.userTurnBuffer = '';
      if (useStore.getState().settings.save_voice_transcripts !== true) return null;
      const { addMessage, activeSessionId } = useStore.getState();
      const effectiveSessionId = activeSessionId || 'general';
      const msgId = addMessage('user', text, undefined, null, effectiveSessionId);
      this.lastTurnMessageId = msgId;
      return msgId;
    }
    return null;
  }

  public flushModelTurn(): string | null {
    const text = this.modelTurnBuffer.trim();
    const persistedText = useStore.getState().settings.save_voice_transcripts === true ? text : '';
    const ops = this.turnPendingOps.length > 0 ? [...this.turnPendingOps] : undefined;
    
    if (persistedText || (ops && ops.length > 0)) {
      const { addMessage, setPendingOps, activeSessionId } = useStore.getState();
      const effectiveSessionId = activeSessionId || 'general';
      const msgText = persistedText || (ops ? `Prepared ${ops.length} operation(s) for preview.` : '');
      const msgId = addMessage('assistant', msgText, ops, null, effectiveSessionId);
      
      if (ops && ops.length > 0) {
        setPendingOps(ops, msgId);
      }

      this.modelTurnBuffer = '';
      this.turnPendingOps = [];
      return msgId;
    }
    this.modelTurnBuffer = '';
    this.turnPendingOps = [];
    return null;
  }

  public flushBuffers() {
    this.flushUserTurn();
    this.flushModelTurn();
  }

  public getUserTurnBuffer(): string {
    return this.userTurnBuffer;
  }

  public getModelTurnBuffer(): string {
    return this.modelTurnBuffer;
  }

  public getPendingOps(): ToonOperation[] {
    return [...this.turnPendingOps];
  }

  public async handleMessage(msg: LiveServerMessage) {
    if (msg.sessionResumptionUpdate) {
      const update = msg.sessionResumptionUpdate;
      this.resumptionHandle = update.resumable === true && update.newHandle ? update.newHandle : null;
    }
    if (msg.goAway && this.resumptionHandle && !this.reconnecting) {
      void this.resumeLiveConnection();
    }
    if (msg.setupComplete) {
      this.liveSessionReady = true;
      this.resumeAttempts = 0;
      this.setStatus('active', 'Gemini Live session is ready.');
      if (this.session) this.startAudioInput();
    }
    if (msg.usageMetadata) {
      this.liveUsage = msg.usageMetadata as unknown as Record<string, unknown>;
      this.onUsageChange(this.liveUsage);
    }
    const interactionStatus = (msg as unknown as { interactionStatus?: string }).interactionStatus;
    if (interactionStatus === 'IN_PROGRESS' && !msg.serverContent?.modelTurn?.parts?.some(part => part.inlineData?.data)) {
      this.setStatus('thinking');
    } else if (interactionStatus === 'IDLE' && this.liveSessionReady && !this.activeAudioSources.length) {
      this.setStatus('listening');
    }

    // 0. Audio Interruption Handling
    if (msg.serverContent?.interrupted) {
      this.stopAllAudioPlayback();
      this.flushModelTurn();
      this.setStatus('interrupted', 'Voice output interrupted by speech');
      setTimeout(() => {
        if (this.session && this.currentStatus === 'interrupted') {
          this.setStatus('listening');
        }
      }, 350);
    }

    // 1. Audio Output and Inline Text from parts
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData?.data && this.outputContext) {
          const bytes = base64ToBytes(part.inlineData.data);
          const buffer = pcmToAudioBuffer(bytes, this.outputContext, 24000);
          
          this.nextStartTime = Math.max(this.outputContext.currentTime, this.nextStartTime);
          
          const source = this.outputContext.createBufferSource();
          source.buffer = buffer;
          source.connect(this.outputContext.destination);
          source.start(this.nextStartTime);
          
          this.activeAudioSources.push(source);
          source.onended = () => {
            this.activeAudioSources = this.activeAudioSources.filter(s => s !== source);
          };

          this.nextStartTime += buffer.duration;
          this.setStatus('speaking');
        }
        if (part.text && !msg.serverContent?.outputTranscription?.text) {
          if (this.userTurnBuffer.trim()) {
            this.flushUserTurn();
          }
          this.modelTurnBuffer += part.text;
          this.onTranscription(part.text, 'model');
          this.setStatus('speaking');
        }
      }
    }

    // 2. Transcription Handling
    // A. Output Transcription (Model speech)
    const outTrans = msg.serverContent?.outputTranscription;
    if (outTrans?.text) {
      if (this.userTurnBuffer.trim()) {
        this.flushUserTurn();
      }
      this.modelTurnBuffer += outTrans.text;
      this.onTranscription(outTrans.text, 'model');
      this.setStatus('speaking');
    }

    // B. Input Transcription (User speech)
    const inTrans = msg.serverContent?.inputTranscription;
    if (inTrans?.text) {
      if (this.modelTurnBuffer.trim() || this.turnPendingOps.length > 0) {
        this.flushModelTurn();
      }
      if (!this.userTurnBuffer.trim()) this.lastTurnMessageId = '';
      this.userTurnBuffer += inTrans.text;
      this.onTranscription(inTrans.text, 'user');
      this.setStatus('listening');
    }

    // 3. Turn Complete
    if (msg.serverContent?.turnComplete) {
      this.flushUserTurn();
      this.flushModelTurn();
      const extendedThinkingIdle = this.liveModel !== 'gemini-3.8-live-extended-thinking' || interactionStatus === 'IDLE';
      if (this.turnPendingOps.length === 0 && extendedThinkingIdle) {
        this.setStatus('active');
      }
    }

    // 4. Tool Calls — Two-Phase Cryptographic Confirmation Gate
    if (msg.toolCall?.functionCalls) {
      const { setPendingOps, addDebugLog, kernelEntities } = useStore.getState();
      const activeEntities = useStore.getState().getActiveEntities();
      const responses: Array<{ name: string; id?: string; response: Record<string, unknown> }> = [];

      // Ensure user's utterance before the tool call is saved
      this.flushUserTurn();

      for (const fc of msg.toolCall.functionCalls) {
        addDebugLog('system', `Live Tool Call: ${fc.name}`, fc.args as Record<string, unknown> | undefined);
        
        let result: Record<string, unknown> = { status: 'ok' };
        const id = uuidv4();
        const rawArgs = (fc.args || {}) as Record<string, unknown>;

        if (fc.name === 'schedule_event') {
          const scheduleArgs = rawArgs as unknown as ScheduleEventArgs;
          const op: ToonOperation = {
            type: 'create_entity',
            payload: {
              id,
              kind: EntityKind.EVENT,
              title: scheduleArgs.title || 'Scheduled Event',
              description: scheduleArgs.description || null,
              start_time: scheduleArgs.start_time || null,
              end_time: scheduleArgs.end_time || null,
              recurrence: scheduleArgs.recurrence || null,
              metadata: scheduleArgs.location ? { location: scheduleArgs.location } : {}
            }
          };

          this.turnPendingOps.push(op);
          this.onPendingOpsChange?.([...this.turnPendingOps]);

          // Compute cryptographic plan fingerprint
          const proposal = convertOperationsToActionProposal([op], {
            source: 'ai_agent',
            intent: `Schedule event: ${scheduleArgs.title}`,
            currentEntities: kernelEntities
          });

          setPendingOps([...this.turnPendingOps], this.lastTurnMessageId || id);
          this.setStatus('confirming_action', `Event "${scheduleArgs.title}" staged for review`);

          result = {
            status: 'prepared_for_preview',
            requires_user_confirmation: true,
            plan_fingerprint: proposal.id,
            id,
            title: scheduleArgs.title,
            start_time: scheduleArgs.start_time,
            end_time: scheduleArgs.end_time,
            message: `Event "${scheduleArgs.title}" staged on user screen with cryptographic verification gate. Awaiting explicit user confirmation.`
          };
        } else if (fc.name === 'create_entity') {
          const createArgs = rawArgs as unknown as CreateEntityArgs;
          const resolvedKind = (createArgs.kind || 'TASK').toUpperCase();
          const op: ToonOperation = {
            type: 'create_entity',
            payload: {
              id,
              title: createArgs.title,
              kind: resolvedKind,
              description: createArgs.description || null,
              start_time: createArgs.start_time || null,
              end_time: createArgs.end_time || null,
              deadline: createArgs.deadline || null,
              duration_minutes: createArgs.duration_minutes || null,
              recurrence: createArgs.recurrence || null
            }
          };

          this.turnPendingOps.push(op);
          this.onPendingOpsChange?.([...this.turnPendingOps]);

          const proposal = convertOperationsToActionProposal([op], {
            source: 'ai_agent',
            intent: `Create entity: ${createArgs.title}`,
            currentEntities: kernelEntities
          });

          setPendingOps([...this.turnPendingOps], this.lastTurnMessageId || id);
          this.setStatus('confirming_action', `Entity "${createArgs.title}" staged for review`);

          result = {
            status: 'prepared_for_preview',
            requires_user_confirmation: true,
            plan_fingerprint: proposal.id,
            id,
            title: createArgs.title,
            kind: resolvedKind,
            message: `Entity "${createArgs.title}" staged on user screen with cryptographic verification gate. Awaiting explicit user confirmation.`
          };
        } else if (fc.name === 'log_activity') {
          const logArgs = rawArgs as unknown as LogActivityArgs;
          const op: ToonOperation = {
            type: 'log_activity',
            payload: {
              title: logArgs.title,
              duration_minutes: logArgs.minutes,
              metadata: logArgs.productivity ? { productivity: logArgs.productivity } : {}
            }
          };

          this.turnPendingOps.push(op);
          this.onPendingOpsChange?.([...this.turnPendingOps]);

          setPendingOps([...this.turnPendingOps], this.lastTurnMessageId || id);
          this.setStatus('confirming_action', `Activity "${logArgs.title}" staged for review`);

          result = {
            status: 'prepared_for_preview',
            requires_user_confirmation: true,
            title: logArgs.title,
            minutes: logArgs.minutes,
            message: `Activity "${logArgs.title}" staged for user confirmation.`
          };
        } else if (fc.name === 'propose_memory_update') {
          const memArgs = rawArgs as unknown as ProposeMemoryUpdateArgs;
          const op: ToonOperation = {
            type: 'create_entity',
            payload: {
              id,
              schema_id: 'system/memory_item',
              title: memArgs.content.slice(0, 60),
              fields: {
                content: memArgs.content,
                category: memArgs.category || 'preference',
                epistemic_status: 'assistant_inferred',
                user_confirmed: false,
                confidence_score: 0.85,
                privacy_tier: memArgs.privacy_tier || 'private',
                valid_from: new Date().toISOString(),
                valid_until: memArgs.valid_until || null,
                source_turn: 1,
                source_excerpt: memArgs.content,
                speaker: 'assistant'
              }
            }
          };

          this.turnPendingOps.push(op);
          this.onPendingOpsChange?.([...this.turnPendingOps]);

          setPendingOps([...this.turnPendingOps], this.lastTurnMessageId || id);
          this.setStatus('confirming_action', `Memory proposal staged for review`);

          result = {
            status: 'prepared_for_preview',
            requires_user_confirmation: true,
            content: memArgs.content,
            category: memArgs.category || 'preference',
            message: `Proposed memory staged for user confirmation.`
          };
        } else if (fc.name === 'record_commitment_evidence') {
          const recArgs = rawArgs as unknown as RecordCommitmentEvidenceArgs;
          const op: ToonOperation = {
            type: 'record_evidence',
            payload: {
              entity_id: recArgs.entity_id,
              quantity: recArgs.quantity ?? 1,
              timestamp: recArgs.timestamp || new Date().toISOString(),
              note: recArgs.note || null,
              user_confirmed: recArgs.user_confirmed ?? false
            }
          };

          this.turnPendingOps.push(op);
          this.onPendingOpsChange?.([...this.turnPendingOps]);

          setPendingOps([...this.turnPendingOps], this.lastTurnMessageId || id);
          this.setStatus('confirming_action', `Commitment evidence staged for review`);

          result = {
            status: 'prepared_for_preview',
            requires_user_confirmation: true,
            entity_id: recArgs.entity_id,
            quantity: recArgs.quantity ?? 1,
            message: `Commitment evidence staged for user confirmation.`
          };
        } else if (fc.name === 'read_calendar') {
          const calArgs = rawArgs as unknown as ReadCalendarArgs;
          const s = calArgs.start_date ? new Date(calArgs.start_date).getTime() : 0;
          const e = calArgs.end_date ? new Date(calArgs.end_date).getTime() : Infinity;
          const matched = (activeEntities || []).filter(item => {
            if (item.kind !== 'EVENT' || !item.start_time) return false;
            if (isEntityExcludedFromEgress(item)) return false;
            const t = new Date(item.start_time).getTime();
            return t >= s && t <= e;
          }).map(i => ({ id: i.id, title: i.title, start: i.start_time, end: i.end_time }));
          result = { events: matched };
        } else if (fc.name === 'search_entities') {
          const searchArgs = rawArgs as unknown as SearchEntitiesArgs;
          const qLower = (searchArgs.query || '').toLowerCase();
          const matched = (activeEntities || []).filter(item => {
            if (isEntityExcludedFromEgress(item)) return false;
            if (searchArgs.kind && item.kind !== searchArgs.kind) return false;
            return item.title.toLowerCase().includes(qLower) || (item.description || '').toLowerCase().includes(qLower);
          }).slice(0, 10).map(i => ({ id: i.id, title: i.title, kind: i.kind }));
          result = { results: matched };
        } else if (fc.name === 'search_memory') {
          const searchMemArgs = rawArgs as unknown as SearchMemoryArgs;
          const kEntities = Object.values(kernelEntities || {});
          const matched = selectEligibleMemories(kEntities, {
            query: searchMemArgs.query,
            category: searchMemArgs.category,
            limit: searchMemArgs.limit || 10,
            include_superseded: false, // Voice models strictly never receive superseded beliefs
            include_situational: false,
            include_expired: false,    // Expiration bounds strictly enforced
            allow_device_local: false, // Strict device-local isolation: never transmitted over the wire
            max_privacy_tier: 'sensitive',
          });
          result = {
            memories: matched.map(m => ({
              id: m.id,
              content: m.content,
              category: m.category,
              epistemic_status: m.epistemic_status,
            })),
          };
        }

        responses.push({
          name: fc.name,
          id: fc.id,
          response: { result }
        });
      }

      if (this.session) {
        try {
          this.session.sendToolResponse({
            functionResponses: responses
          });
        } catch (err) {
          console.error("[LiveManager] Failed to send tool response:", err);
        }
      }
    }
  }

  disconnect() {
    this.intentionallyStopped = true;
    this.flushBuffers();
    this.stopAllAudioPlayback();
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        console.warn("[LiveManager] Error closing session:", err);
      }
      this.session = null;
    }
    this.cleanup();
    this.setStatus('disconnected');
  }

  private cleanup() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this.processor?.disconnect();
    this.analyser?.disconnect();
    this.source?.disconnect();
    this.inputContext?.close();
    this.outputContext?.close();

    this.managedRelayGrant = null;
    this.liveSessionReady = false;
    this.resumptionHandle = null;
    this.liveConfig = null;
    this.reconnecting = false;
    this.session = null;
    
    this.stream = null;
    this.processor = null;
    this.analyser = null;
    this.source = null;
    this.inputContext = null;
    this.outputContext = null;
  }
}

declare global {
  interface Window {
    LiveManager?: typeof LiveManager;
  }
}

if (typeof window !== 'undefined') {
  window.LiveManager = LiveManager;
}
