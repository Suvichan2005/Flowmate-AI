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

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

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

// Convert Int16 (PCM) to Float32 (Web Audio)
function pcmToAudioBuffer(
  data: Uint8Array, 
  ctx: AudioContext, 
  sampleRate: number
): AudioBuffer {
  const int16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, int16.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) {
    channelData[i] = int16[i] / 32768.0;
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
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
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
            this.onStatusChange('active');
            this.startAudioInput(sessionPromise);
          },
          onmessage: async (msg: LiveServerMessage) => {
            this.handleMessage(msg, sessionPromise);
          },
          onclose: () => {
            this.onStatusChange('disconnected');
            this.cleanup();
          },
          onerror: (err) => {
            console.error("Live Error:", err);
            this.onStatusChange('error');
            this.cleanup();
          }
        }
      });
      
      // Wait for session to be established before assigning
      this.session = await sessionPromise;

    } catch (err) {
      console.error("Failed to connect:", err);
      this.onStatusChange('error');
      this.cleanup();
    }
  }

  private startAudioInput(sessionPromise: Promise<any>) {
    if (!this.inputContext || !this.stream) return;

    this.source = this.inputContext.createMediaStreamSource(this.stream);
    
    // Create Analyser
    this.analyser = this.inputContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    
    // Create Processor
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(inputData);
      const uint8 = new Uint8Array(pcm16);
      const base64 = bytesToBase64(uint8);

      sessionPromise.then(session => {
         session.sendRealtimeInput({
            media: {
                mimeType: 'audio/pcm;rate=16000',
                data: base64
            }
         });
      });
    };

    // Connect Graph: Source -> Analyser -> Processor -> Destination
    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  private async handleMessage(msg: LiveServerMessage, sessionPromise: Promise<any>) {
    // 1. Audio Output
    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputContext) {
        const bytes = base64ToBytes(audioData);
        const buffer = pcmToAudioBuffer(bytes, this.outputContext, 24000);
        
        this.nextStartTime = Math.max(this.outputContext.currentTime, this.nextStartTime);
        
        const source = this.outputContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.outputContext.destination);
        source.start(this.nextStartTime);
        
        this.nextStartTime += buffer.duration;
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
    if (msg.toolCall) {
        const { applyOperations, addDebugLog } = useStore.getState();
        
        for (const fc of msg.toolCall.functionCalls) {
            addDebugLog('system', `Live Tool Call: ${fc.name}`, fc.args);
            
            let result = { status: 'ok' };
            const id = uuidv4();

            if (fc.name === 'create_entity') {
                 const { title, kind, description } = fc.args as any;
                 applyOperations([{
                     type: 'create_entity',
                     payload: { id, title, kind, description }
                 }]);
                 result = { status: 'created', id } as any;
            } else if (fc.name === 'log_activity') {
                 const { title, minutes } = fc.args as any;
                 applyOperations([{
                     type: 'log_activity',
                     payload: { title, duration_minutes: minutes }
                 }]);
            }

            sessionPromise.then(session => {
                session.sendToolResponse({
                    functionResponses: {
                        name: fc.name,
                        id: fc.id,
                        response: { result }
                    }
                });
            });
        }
    }
  }

  disconnect() {
    if (this.session) {
       // SDK specific close if available
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