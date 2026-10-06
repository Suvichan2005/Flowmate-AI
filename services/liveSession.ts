import { 
  GoogleGenAI, 
  LiveServerMessage, 
  Modality, 
  Type, 
  FunctionDeclaration
} from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useStore } from "../store";
import { EntityKind } from "../types";
import { getAiClient } from './ai/client';

const MODEL_NAME = 'gemini-3.8-live';

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

// --- Tool Definitions ---

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

// --- Live Manager Class ---

export class LiveManager {
  private ai: GoogleGenAI;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private session: any = null;
  private stream: MediaStream | null = null;
  
  // Public Analyser for UI Visualization
  public analyser: AnalyserNode | null = null;

  public onStatusChange: (status: string) => void = () => {};
  public onTranscription: (text: string, source: 'user' | 'model') => void = () => {};

  // Turn buffers for saving to store messages
  private userTurnBuffer: string = '';
  private modelTurnBuffer: string = '';
  private turnPendingOps: any[] = [];
  private lastTurnMessageId: string = '';

  constructor() {
    this.ai = getAiClient();
  }

  async connect() {
    try {
      this.onStatusChange('connecting');

      // Fetch User Settings & Context
      const { settings, entities } = useStore.getState();
      const timezone = settings.timezone || 'Asia/Kolkata';
      const now = new Date();
      const localTimeString = now.toLocaleString('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'medium'
      });
      const localIsoString = now.toISOString();

      // Recent upcoming events for context
      const upcomingEvents = (entities || [])
        .filter(e => e.kind === 'EVENT' && e.start_time && new Date(e.start_time) >= now)
        .slice(0, 5)
        .map(e => `${e.title} (${e.start_time})`)
        .join(', ');

      const customInst = settings.custom_instructions 
        ? `\nImportant User Instructions:\n${settings.custom_instructions}` 
        : "";
      
      const systemInstructionText = `
You are Flowmate, a helpful personal productivity assistant.
Keep responses concise, natural, and friendly.

CURRENT TIME & DATE:
- Local Time: ${localTimeString}
- ISO Timestamp: ${localIsoString}
- Timezone: ${timezone}
${upcomingEvents ? `- Upcoming Events: ${upcomingEvents}` : ''}

CRITICAL RULES FOR CREATING EVENTS & SCHEDULING:
1. When the user asks to schedule an event, travel/train/flight journey, meeting, or appointment:
   You MUST call the \`schedule_event\` or \`create_entity\` tool with kind="EVENT".
2. You MUST compute the exact \`start_time\` and \`end_time\` as ISO 8601 strings with timezone offset (+05:30).
   - Example: If current local time is ${localTimeString}, and user says "tomorrow 9:30 PM... reach at 5:15",
     compute tomorrow's date at 21:30:00+05:30 for start_time, and the arrival time (e.g. 05:15:00+05:30 next morning) for end_time.
   - NEVER put the times in description or title alone! Setting start_time and end_time is required for the event to show up in the user's schedule.
3. You have full capability to schedule events and manage the calendar. An operation preview will be displayed to the user on their screen for review.
4. If the user creates a broad area or group (e.g. "Work", "School", "IEEE"), create a CONTEXT entity, NOT a PROJECT.
${customInst}`;
      
      // 1. Audio Setup
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      if (this.inputContext.state === 'suspended') {
        await this.inputContext.resume();
      }
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume();
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 2. Connect to Gemini Live
      const sessionPromise = this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{
            functionDeclarations: [
              scheduleEventTool,
              createEntityTool,
              logActivityTool,
              readCalendarTool,
              searchEntitiesTool
            ]
          }],
          systemInstruction: {
             parts: [{ text: systemInstructionText }]
          }
        },
        callbacks: {
          onopen: () => {
            console.log('[LiveManager] Connected to Gemini Live');
            this.onStatusChange('active');
          },
          onmessage: async (msg: LiveServerMessage) => {
            this.handleMessage(msg);
          },
          onclose: (e) => {
            console.log('[LiveManager] Connection closed', e);
            this.flushBuffers();
            this.onStatusChange('disconnected');
            this.cleanup();
          },
          onerror: (err) => {
            console.error("[LiveManager] Live Error:", err);
            this.flushBuffers();
            this.onStatusChange('error');
            this.cleanup();
          }
        }
      });
      
      this.session = await sessionPromise;
      this.startAudioInput();

    } catch (err) {
      console.error("[LiveManager] Failed to connect:", err);
      this.onStatusChange('error');
      this.cleanup();
    }
  }

  private startAudioInput() {
    if (!this.inputContext || !this.stream) return;

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

  private flushUserTurn() {
    if (this.userTurnBuffer.trim()) {
      const { addMessage, activeSessionId } = useStore.getState();
      const msgId = addMessage('user', this.userTurnBuffer.trim(), undefined, null, activeSessionId || 'general');
      this.lastTurnMessageId = msgId;
      this.userTurnBuffer = '';
    }
  }

  private flushModelTurn() {
    if (this.modelTurnBuffer.trim()) {
      const { addMessage, setPendingOps, activeSessionId } = useStore.getState();
      const ops = this.turnPendingOps.length > 0 ? [...this.turnPendingOps] : undefined;
      const msgId = addMessage('assistant', this.modelTurnBuffer.trim(), ops, null, activeSessionId || 'general');
      
      if (ops && ops.length > 0) {
        setPendingOps(ops, msgId);
      }

      this.modelTurnBuffer = '';
      this.turnPendingOps = [];
    }
  }

  private flushBuffers() {
    this.flushUserTurn();
    this.flushModelTurn();
  }

  private async handleMessage(msg: LiveServerMessage) {
    // 0. Interruption Handling
    if (msg.serverContent?.interrupted) {
      this.nextStartTime = 0;
      this.flushModelTurn();
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
          
          this.nextStartTime += buffer.duration;
        }
        if (part.text) {
          this.modelTurnBuffer += part.text;
          this.onTranscription(part.text, 'model');
        }
      }
    }

    // 2. Transcription
    const outTrans = msg.serverContent?.outputTranscription;
    if (outTrans?.text) {
      this.modelTurnBuffer += outTrans.text;
      this.onTranscription(outTrans.text, 'model');
    }

    const inTrans = msg.serverContent?.inputTranscription;
    if (inTrans?.text) {
      // If user starts speaking while previous model turn wasn't flushed, flush it
      if (this.modelTurnBuffer.trim()) {
        this.flushModelTurn();
      }
      this.userTurnBuffer += inTrans.text;
      this.onTranscription(inTrans.text, 'user');
    }

    // 3. Turn Complete
    if (msg.serverContent?.turnComplete) {
      // Ensure user turn was logged before the model turn
      this.flushUserTurn();
      this.flushModelTurn();
    }

    // 4. Tool Calls
    if (msg.toolCall?.functionCalls && this.session) {
      const { setPendingOps, addDebugLog, entities } = useStore.getState();
      const responses: Array<{ name: string; id?: string; response: Record<string, any> }> = [];

      // Make sure user's utterance before the tool call is saved
      this.flushUserTurn();

      for (const fc of msg.toolCall.functionCalls) {
        addDebugLog('system', `Live Tool Call: ${fc.name}`, fc.args);
        
        let result: Record<string, any> = { status: 'ok' };
        const id = uuidv4();

        if (fc.name === 'schedule_event') {
          const { title, start_time, end_time, description, location, recurrence } = (fc.args || {}) as any;
          const op: any = {
            type: 'create_entity',
            payload: {
              id,
              kind: EntityKind.EVENT,
              title: title || 'Scheduled Event',
              description: description || null,
              start_time: start_time || null,
              end_time: end_time || null,
              recurrence: recurrence || null,
              metadata: location ? { location } : {}
            }
          };

          this.turnPendingOps.push(op);
          setPendingOps([op], this.lastTurnMessageId || id);
          result = {
            status: 'prepared_for_preview',
            id,
            title,
            start_time,
            end_time,
            message: `Event "${title}" from ${start_time} to ${end_time} prepared for user review on screen.`
          };
        } else if (fc.name === 'create_entity') {
          const { title, kind, description, start_time, end_time, deadline, duration_minutes, recurrence } = (fc.args || {}) as any;
          const resolvedKind = (kind || 'TASK').toUpperCase();
          const op: any = {
            type: 'create_entity',
            payload: {
              id,
              title,
              kind: resolvedKind,
              description: description || null,
              start_time: start_time || null,
              end_time: end_time || null,
              deadline: deadline || null,
              duration_minutes: duration_minutes || null,
              recurrence: recurrence || null
            }
          };

          this.turnPendingOps.push(op);
          setPendingOps([op], this.lastTurnMessageId || id);
          result = {
            status: 'prepared_for_preview',
            id,
            title,
            kind: resolvedKind,
            message: `Entity "${title}" prepared for user review on screen.`
          };
        } else if (fc.name === 'log_activity') {
          const { title, minutes, productivity } = (fc.args || {}) as any;
          const op: any = {
            type: 'log_activity',
            payload: {
              title,
              duration_minutes: minutes,
              metadata: productivity ? { productivity } : {}
            }
          };

          this.turnPendingOps.push(op);
          setPendingOps([op], this.lastTurnMessageId || id);
          result = { status: 'logged', title, minutes };
        } else if (fc.name === 'read_calendar') {
          const { start_date, end_date } = (fc.args || {}) as any;
          const s = start_date ? new Date(start_date).getTime() : 0;
          const e = end_date ? new Date(end_date).getTime() : Infinity;
          const matched = (entities || []).filter(item => {
            if (item.kind !== 'EVENT' || !item.start_time) return false;
            const t = new Date(item.start_time).getTime();
            return t >= s && t <= e;
          }).map(i => ({ id: i.id, title: i.title, start: i.start_time, end: i.end_time }));
          result = { events: matched };
        } else if (fc.name === 'search_entities') {
          const { query: q, kind } = (fc.args || {}) as any;
          const qLower = (q || '').toLowerCase();
          const matched = (entities || []).filter(item => {
            if (kind && item.kind !== kind) return false;
            return item.title.toLowerCase().includes(qLower) || (item.description || '').toLowerCase().includes(qLower);
          }).slice(0, 10).map(i => ({ id: i.id, title: i.title, kind: i.kind }));
          result = { results: matched };
        }

        responses.push({
          name: fc.name,
          id: fc.id,
          response: { result }
        });
      }

      try {
        this.session.sendToolResponse({
          functionResponses: responses
        });
      } catch (err) {
        console.error("[LiveManager] Failed to send tool response:", err);
      }
    }
  }

  disconnect() {
    this.flushBuffers();
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        console.warn("[LiveManager] Error closing session:", err);
      }
      this.session = null;
    }
    this.cleanup();
    this.onStatusChange('disconnected');
  }

  private cleanup() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.processor?.disconnect();
    this.analyser?.disconnect();
    this.source?.disconnect();
    this.inputContext?.close();
    this.outputContext?.close();
    
    this.stream = null;
    this.processor = null;
    this.analyser = null;
    this.source = null;
    this.inputContext = null;
    this.outputContext = null;
  }
}