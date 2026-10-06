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

const createEntityTool: FunctionDeclaration = {
  name: 'create_entity',
  description: 'Create a new item in the database. Use this for goals, projects, tasks, or notes.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'The title of the entity' },
      kind: { 
        type: Type.STRING, 
        enum: ['GOAL', 'PROJECT', 'TASK', 'NOTE', 'EVENT', 'CONTEXT'],
        description: 'The type of entity. IMPORTANT: If user mentions a domain like "IEEE" or "Gym", use "CONTEXT".'
      },
      description: { type: Type.STRING, description: 'Additional details' }
    },
    required: ['title', 'kind']
  }
};

const logActivityTool: FunctionDeclaration = {
  name: 'log_activity',
  description: 'Log a completed activity or progress.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'What was done' },
      minutes: { type: Type.NUMBER, description: 'Duration in minutes' }
    },
    required: ['title']
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

  constructor() {
    this.ai = getAiClient();
  }

  async connect() {
    try {
      this.onStatusChange('connecting');

      // Fetch User Settings for Persona
      const { settings } = useStore.getState();
      const customInst = settings.custom_instructions 
        ? `\nImportant User Instructions:\n${settings.custom_instructions}` 
        : "";
      
      const systemInstructionText = `
      You are Flowmate, a helpful productivity assistant. 
      Keep responses concise and friendly. 
      You have access to tools to create entities and log activity.
      CRITICAL: If the user creates a broad area or group (e.g. "Work", "School", "IEEE"), create a CONTEXT entity, NOT a PROJECT.
      ${customInst}`;
      
      // 1. Audio Setup
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Ensure audio contexts are active (browsers suspend contexts created without recent user gesture)
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
          tools: [{ functionDeclarations: [createEntityTool, logActivityTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
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
            this.onStatusChange('disconnected');
            this.cleanup();
          },
          onerror: (err) => {
            console.error("[LiveManager] Live Error:", err);
            this.onStatusChange('error');
            this.cleanup();
          }
        }
      });
      
      // Wait for session to be established before starting audio streaming
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
        // Correct Gemini Live realtime audio payload format
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

    // Connect Graph: Source -> Analyser -> Processor -> Destination
    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  private async handleMessage(msg: LiveServerMessage) {
    // 0. Interruption Handling
    if (msg.serverContent?.interrupted) {
      this.nextStartTime = 0;
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
          this.onTranscription(part.text, 'model');
        }
      }
    }

    // 2. Transcription
    const outTrans = msg.serverContent?.outputTranscription;
    if (outTrans?.text) {
      this.onTranscription(outTrans.text, 'model');
    }
    const inTrans = msg.serverContent?.inputTranscription;
    if (inTrans?.text) {
      this.onTranscription(inTrans.text, 'user');
    }

    // 3. Tool Calls
    if (msg.toolCall?.functionCalls && this.session) {
      const { applyOperations, addDebugLog } = useStore.getState();
      const responses: Array<{ name: string; id?: string; response: Record<string, any> }> = [];

      for (const fc of msg.toolCall.functionCalls) {
        addDebugLog('system', `Live Tool Call: ${fc.name}`, fc.args);
        
        let result: Record<string, any> = { status: 'ok' };
        const id = uuidv4();

        if (fc.name === 'create_entity') {
          const { title, kind, description } = (fc.args || {}) as any;
          applyOperations([{
            type: 'create_entity',
            payload: { id, title, kind, description }
          }]);
          result = { status: 'created', id };
        } else if (fc.name === 'log_activity') {
          const { title, minutes } = (fc.args || {}) as any;
          applyOperations([{
            type: 'log_activity',
            payload: { title, duration_minutes: minutes }
          }]);
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