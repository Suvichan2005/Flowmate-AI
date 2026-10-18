import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Mic, MicOff, Send, X, Loader2, Square } from 'lucide-react';
import { sanitizeUserInput } from '../utils/validation';
import { hasAiApiKey } from '../services/ai/client';
import { hasManagedAiIdentity } from '../services/ai/managedClient';
import AiModelSelector from './AiModelSelector';

interface UnifiedChatInputProps {
    value?: string;
    onChange?: (value: string) => void;
    onSend: (message: string, attachment?: string | null) => boolean | void;
    onAttach?: (file: File) => void;
    onLiveVoice?: () => void;
    onStop?: () => void;
    isStreaming?: boolean;
    queueCount?: number;
    loading?: boolean;
    placeholder?: string;
    attachment?: string | null;
    onRemoveAttachment?: () => void;
    isMobile?: boolean;
    textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

/**
 * Unified Chat Input - ChatGPT-style input with:
 * - Attachment button on left
 * - Auto-expanding textarea in center (non-blocking composer)
 * - Mic button (starts Gemini Live session or fallback STT)
 * - Stop / Send / Queue button on right
 */
interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: {
        length: number;
        [index: number]: {
            isFinal: boolean;
            [index: number]: {
                transcript: string;
            };
        };
    };
}

interface SpeechRecognitionErrorEventLike {
    error: string;
}

interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
}

type WindowWithSpeech = Window & typeof globalThis & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const UnifiedChatInput: React.FC<UnifiedChatInputProps> = ({
    value,
    onChange,
    onSend,
    onAttach,
    onLiveVoice,
    onStop,
    isStreaming = false,
    queueCount = 0,
    loading = false,
    placeholder = "Message...",
    attachment = null,
    onRemoveAttachment,
    isMobile = false,
    textareaRef: externalTextareaRef
}) => {
    const [internalInput, setInternalInput] = useState('');
    const input = value !== undefined ? value : internalInput;
    const [isListening, setIsListening] = useState(false);
    const [speechSupported, setSpeechSupported] = useState(false);
    const localTextareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = externalTextareaRef || localTextareaRef;
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const updateInput = (newVal: string) => {
        if (value === undefined) {
            setInternalInput(newVal);
        }
        onChange?.(newVal);
    };

    // Check for Web Speech API support
    useEffect(() => {
        const win = window as unknown as WindowWithSpeech;
        const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
        setSpeechSupported(!!SpeechRecognition);

        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event: SpeechRecognitionEventLike) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                if (finalTranscript) {
                    updateInput(input + finalTranscript);
                }
            };

            recognitionRef.current.onerror = (event: SpeechRecognitionErrorEventLike) => {
                console.error('Speech recognition error:', event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };
        }

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [input]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        }
    }, [input]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmedInput = input.trim();
        if (!trimmedInput && !attachment) return;

        // Sanitize user input before sending to AI
        const sanitizedInput = sanitizeUserInput(trimmedInput);
        
        const admitted = onSend(sanitizedInput, attachment);
        if (admitted === false) return;
        updateInput('');

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const toggleListening = () => {
        if (!recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && onAttach) {
            onAttach(file);
        }
        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const hasContent = input.trim().length > 0 || attachment;
    const draftCharacterCount = Array.from(input).length;
    const draftTokenEstimate = Math.ceil(draftCharacterCount / 4);
    const canUseLiveVoice = hasAiApiKey() || hasManagedAiIdentity();

    return (
        <form onSubmit={handleSubmit} className="relative mx-auto w-full max-w-[860px]" aria-label="Chat composer">
            {attachment && (
                <div className="mb-2 relative inline-flex items-center gap-2 rounded-xl border border-ideapad-border bg-ideapad-surface p-2">
                    <img src={attachment} alt="Attachment preview" className="h-14 w-14 rounded-lg object-cover" />
                    {onRemoveAttachment && <button type="button" onClick={onRemoveAttachment} aria-label="Remove attachment" className="rounded-lg p-2 text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-text"><X size={16} /></button>}
                </div>
            )}

            <div className="min-w-0 rounded-[1.35rem] border border-ideapad-border bg-ideapad-surface shadow-sm transition-[border-color,box-shadow] focus-within:border-ideapad-mint/60 focus-within:ring-2 focus-within:ring-ideapad-mint/10" data-testid="chat-composer">
                <textarea
                    aria-label="Message Flowmate"
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => updateInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? 'Listening…' : placeholder}
                    rows={1}
                    className={`block w-full min-w-0 resize-none bg-transparent px-4 pt-2 pb-0 text-ideapad-text outline-none placeholder:text-ideapad-muted ${isMobile ? 'text-base' : 'text-sm'} max-h-[160px] min-h-[40px] leading-6`}
                    style={{ lineHeight: '1.5' }}
                />

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*,.txt,.pdf,.doc,.docx,.md,.json,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="chat-file-input"
                />
                <div data-testid="chat-composer-actions" className="flex min-w-0 items-center justify-between gap-2 px-2 pb-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach file" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ideapad-muted transition-colors hover:bg-ideapad-surface-variant hover:text-ideapad-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ideapad-mint">
                        <Paperclip size={19} />
                    </button>

                    <div className="flex min-w-0 items-center gap-1">
                        <AiModelSelector compact />

                        {onLiveVoice && <button
                            type="button"
                            onClick={onLiveVoice}
                            disabled={!canUseLiveVoice}
                            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${canUseLiveVoice ? 'text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-ideapad-mint' : 'cursor-not-allowed text-ideapad-muted/50'}`}
                            title={canUseLiveVoice ? 'Start Gemini Live voice' : 'Gemini Live is unavailable for this session'}
                            aria-label={canUseLiveVoice ? 'Start Gemini Live voice' : 'Gemini Live voice unavailable'}
                        ><Mic size={19} /></button>}

                        {!onLiveVoice && speechSupported && <button
                            type="button"
                            onClick={toggleListening}
                            aria-label={isListening ? 'Stop voice input' : 'Voice input'}
                            title={isListening ? 'Stop listening' : 'Voice input'}
                            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ideapad-mint ${isListening ? 'bg-rose-500/15 text-rose-300' : 'text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-text'}`}
                        >{isListening ? <MicOff size={19} /> : <Mic size={19} />}</button>}

                        {(loading || isStreaming) && !hasContent && onStop ? <button type="button" onClick={onStop} aria-label="Stop generating" title="Stop generating" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 transition-colors hover:bg-rose-500/20"><Square size={16} className="fill-current" /></button> : <button
                            type="submit"
                            disabled={!hasContent}
                            title={(loading || isStreaming) ? 'Queue message' : 'Send message'}
                            aria-label={(loading || isStreaming) ? 'Queue message' : 'Send message'}
                            className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-[background-color,color,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint active:scale-95 ${hasContent ? 'bg-ideapad-mint text-ideapad-base hover:brightness-110' : 'cursor-not-allowed bg-ideapad-surface-variant text-ideapad-muted/60'}`}
                        >
                            {(loading || isStreaming) && !hasContent ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                            {queueCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{queueCount}</span>}
                        </button>}
                    </div>
                </div>
            </div>
            {isListening && <div role="status" className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full border border-rose-400/30 bg-rose-950/90 px-3 py-1 text-xs text-rose-200 shadow-lg">Listening</div>}
            <output aria-live="polite" className="sr-only">{draftCharacterCount > 0 ? `${draftCharacterCount} characters in draft, approximately ${draftTokenEstimate} tokens` : ''}</output>
        </form>
    );
};

export default UnifiedChatInput;
