import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Mic, MicOff, Send, X, Image, Loader2, Square } from 'lucide-react';
import { sanitizeUserInput } from '../utils/validation';
import { hasAiApiKey } from '../services/ai/client';

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

    return (
        <form onSubmit={handleSubmit} className="relative">
            {/* Attachment Preview */}
            {attachment && (
                <div className="mb-3 relative inline-block">
                    <img
                        src={attachment}
                        alt="Attachment"
                        className="h-20 w-20 object-cover rounded-xl border border-slate-600 shadow-lg"
                    />
                    {onRemoveAttachment && (
                        <button
                            type="button"
                            onClick={onRemoveAttachment}
                            className="absolute -top-2 -right-2 p-1.5 bg-red-500 rounded-full text-white hover:bg-red-400 transition-colors shadow-lg"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            )}

            {/* Input Row - Premium ChatGPT-style */}
            <div className={`
                flex items-center gap-2
                bg-gradient-to-r from-slate-800/90 to-slate-800/70
                backdrop-blur-sm
                border border-slate-600/50
                rounded-2xl
                ${isMobile ? 'p-2' : 'p-2.5'}
                shadow-lg
                focus-within:border-indigo-500/60
                focus-within:shadow-indigo-500/10
                focus-within:shadow-xl
                transition-all duration-200
            `}>
                {/* Attachment Button */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*,.txt,.pdf,.doc,.docx,.md,.json,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="chat-file-input"
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`
                        ${isMobile ? 'p-2' : 'p-2.5'}
                        text-slate-400 hover:text-indigo-400
                        hover:bg-slate-700/50
                        rounded-xl
                        transition-all duration-150
                        active:scale-95
                        shrink-0
                    `}
                    title="Attach file"
                >
                    <Paperclip size={isMobile ? 18 : 20} />
                </button>

                {/* Textarea - Properly aligned */}
                <textarea
                    aria-label="Message Flowmate"
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => updateInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? "Listening..." : placeholder}
                    rows={1}
                    className={`
                        flex-1
                        bg-transparent
                        text-slate-100
                        ${isMobile ? 'text-base' : 'text-sm'}
                        resize-none
                        outline-none
                        placeholder-slate-500
                        min-h-[28px]
                        max-h-[150px]
                        py-1.5
                        leading-relaxed
                        self-center
                    `}
                    disabled={false}
                    style={{ lineHeight: '1.5' }}
                />

                {/* Right buttons - Vertically centered */}
                <div className="flex items-center gap-1 shrink-0 self-center">
                    {/* Live Voice Button (Gemini Live Mode) */}
                    {onLiveVoice && (
                        <button
                            type="button"
                            onClick={onLiveVoice}
                            className={`
                                ${isMobile ? 'p-2' : 'p-2.5'}
                                rounded-xl
                                transition-all duration-150
                                active:scale-95
                                ${hasAiApiKey()
                                    ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-600/20'
                                    : 'text-slate-500 hover:text-slate-400 hover:bg-slate-800/40'}
                                relative group
                            `}
                            title={hasAiApiKey() ? "Start Gemini Live Voice Session" : "Gemini voice requires configuration in Settings"}
                            aria-label={hasAiApiKey() ? "Start Gemini Live Voice Session" : "Gemini Live Voice unavailable without API key"}
                        >
                            <Mic size={isMobile ? 18 : 20} />
                            {hasAiApiKey() && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                        </button>
                    )}

                    {/* Speech Recognition (STT text typing into input box) when no Live Voice */}
                    {!onLiveVoice && speechSupported && (
                        <button
                            type="button"
                            onClick={toggleListening}
                            className={`
                                ${isMobile ? 'p-2' : 'p-2.5'}
                                rounded-xl
                                transition-all duration-150
                                active:scale-95
                                ${isListening
                                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse'
                                    : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50'
                                }
                            `}
                            title={isListening ? "Stop listening" : "Voice input"}
                        >
                            {isListening ? <MicOff size={isMobile ? 18 : 20} /> : <Mic size={isMobile ? 18 : 20} />}
                        </button>
                    )}

                    {/* Stop / Send / Queue Button */}
                    {(loading || isStreaming) && !hasContent && onStop ? (
                        <button
                            type="button"
                            onClick={onStop}
                            className={`
                                ${isMobile ? 'p-2' : 'p-2.5'}
                                rounded-xl
                                transition-all duration-150
                                active:scale-95
                                bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 hover:text-rose-300
                                border border-rose-500/40
                                shadow-lg shadow-rose-500/10
                            `}
                            title="Stop generating"
                            aria-label="Stop generating"
                        >
                            <Square size={isMobile ? 16 : 18} className="fill-current" />
                        </button>
                    ) : (
                        (!isMobile || hasContent) && (
                            <button
                                type="submit"
                                disabled={!hasContent}
                                className={`
                                    ${isMobile ? 'p-2' : 'p-2.5'}
                                    rounded-xl
                                    transition-all duration-150
                                    active:scale-95
                                    relative
                                    ${hasContent
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/30'
                                        : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                                    }
                                `}
                                title={(loading || isStreaming) ? "Queue message" : "Send message"}
                                aria-label={(loading || isStreaming) ? "Queue message" : "Send message"}
                            >
                                {(loading || isStreaming) && !hasContent ? (
                                    <Loader2 size={isMobile ? 18 : 20} className="animate-spin" />
                                ) : (
                                    <Send size={isMobile ? 18 : 20} />
                                )}
                                {queueCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-bold rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                                        {queueCount}
                                    </span>
                                )}
                            </button>
                        )
                    )}
                </div>
            </div>

            {/* Voice indicator */}
            {isListening && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-red-500/20 border border-red-500/50 rounded-full text-red-400 text-xs font-medium flex items-center gap-2 backdrop-blur-sm">
                    <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                    Listening...
                </div>
            )}
        </form>
    );
};

export default UnifiedChatInput;
