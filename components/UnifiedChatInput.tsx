import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Mic, MicOff, Send, X, Image, Loader2 } from 'lucide-react';

interface UnifiedChatInputProps {
    onSend: (message: string, attachment?: string | null) => void;
    onAttach?: (file: File) => void;
    loading?: boolean;
    placeholder?: string;
    attachment?: string | null;
    onRemoveAttachment?: () => void;
    isMobile?: boolean;
}

/**
 * Unified Chat Input - ChatGPT-style input with:
 * - Attachment button on left
 * - Auto-expanding textarea in center
 * - Mic button (uses Web Speech API - FREE!)
 * - Send button on right (always visible on desktop, shown when has content on mobile)
 */
const UnifiedChatInput: React.FC<UnifiedChatInputProps> = ({
    onSend,
    onAttach,
    loading = false,
    placeholder = "Message...",
    attachment = null,
    onRemoveAttachment,
    isMobile = false
}) => {
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [speechSupported, setSpeechSupported] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const recognitionRef = useRef<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Check for Web Speech API support
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        setSpeechSupported(!!SpeechRecognition);

        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event: any) => {
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
                    setInput(prev => prev + finalTranscript);
                }
            };

            recognitionRef.current.onerror = (event: any) => {
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
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        }
    }, [input]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() && !attachment) return;

        onSend(input, attachment);
        setInput('');

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
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
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
                    disabled={loading}
                    style={{ lineHeight: '1.5' }}
                />

                {/* Right buttons - Vertically centered */}
                <div className="flex items-center gap-1 shrink-0 self-center">
                    {/* Mic Button */}
                    {speechSupported && (
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

                    {/* Send Button - Always visible, styled nicely */}
                    {(!isMobile || hasContent) && (
                        <button
                            type="submit"
                            disabled={!hasContent || loading}
                            className={`
                                ${isMobile ? 'p-2' : 'p-2.5'}
                                rounded-xl
                                transition-all duration-150
                                active:scale-95
                                ${hasContent && !loading
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/30'
                                    : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                                }
                            `}
                            title="Send message"
                        >
                            {loading ? <Loader2 size={isMobile ? 18 : 20} className="animate-spin" /> : <Send size={isMobile ? 18 : 20} />}
                        </button>
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
