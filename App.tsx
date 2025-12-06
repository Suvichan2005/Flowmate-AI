import React, { useState, useRef, useEffect } from 'react';
import { useStore } from './store';
import { orchestrateMessage } from './services/geminiService';
import { processFileAttachment } from './utils/imageProcessing';
import { onAuthChange, signOut } from './services/firebase';
import { Send, Bot, User, RefreshCw, Cloud, CheckCircle2, Loader2, Mic, Paperclip, X, FileAudio, Activity, Plus, Link, Calendar, PanelLeftClose, Upload, PanelLeftOpen, MessageSquare, LogOut, UserCircle, Menu, ChevronLeft } from 'lucide-react';
import Sidebar from './components/Sidebar';
import GraphView from './components/GraphView';
import PreviewModal from './components/PreviewModal';
import Dashboard from './components/Dashboard';
import EntityList from './components/EntityList';
import CalendarView from './components/CalendarView';
import SettingsView from './components/SettingsView';
import EntityDetailPanel from './components/EntityDetailPanel';
import DebugConsole from './components/DebugConsole';
import LiveVoiceModal from './components/LiveVoiceModal';
import CreateEntityModal from './components/CreateEntityModal';
import CommandPalette from './components/CommandPalette';
import FocusTimer from './components/FocusTimer';
import KnowledgeView from './components/KnowledgeView';
import MarkdownText from './components/MarkdownText';
import ToastNotification from './components/ToastNotification';
import Confetti from './components/Confetti';
import AuthModal from './components/AuthModal';
import AnalyticsView from './components/AnalyticsView';
import UnifiedChatInput from './components/UnifiedChatInput';
import { EntityKind, ToonOperation } from './types';

const App: React.FC = () => {
  const {
    isHydrated,
    messages,
    addMessage,
    entities,
    relationships,
    getSnapshot,
    pendingOps,
    setPendingOps,
    clearPendingOps,
    applyOperations,
    syncQueue,
    currentView,
    isZenMode,
    selectedEntityId,
    settings
  } = useStore();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<'image' | 'audio' | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const { currentUser, setCurrentUser, loadFromCloud, syncToCloud } = useStore();

  // Detect mobile viewport
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Resize handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarWidth = 64; // Sidebar width
      const newWidth = e.clientX - sidebarWidth;
      setChatWidth(Math.min(Math.max(newWidth, 300), 600));
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, selectedAttachment]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Force close chat if Zen Mode is active
  useEffect(() => {
    if (isZenMode) setIsChatOpen(false);
    else setIsChatOpen(true);
  }, [isZenMode]);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setCurrentUser(user);
      if (user) {
        // Load data from cloud when user signs in
        loadFromCloud();
      }
    });
    return () => unsubscribe();
  }, [setCurrentUser, loadFromCloud]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle Chat: Cmd+B or Ctrl+B
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setIsChatOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-slate-950 text-slate-400">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Restoring your graph...</p>
        </div>
      </div>
    );
  }

  const queue = syncQueue || [];
  const pendingSyncCount = queue.filter(i => i.status === 'pending' || i.status === 'in_progress').length;
  const isSyncing = pendingSyncCount > 0;
  const syncStatusLabel = isSyncing ? 'Syncing...' : 'Synced';
  const safeEntities = entities || [];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    try {
      const base64 = await processFileAttachment(file);
      setSelectedAttachment(base64);
      setAttachmentType(file.type.startsWith('audio') ? 'audio' : 'image');
    } catch (err) {
      console.error("File processing failed", err);
      addMessage('assistant', 'Failed to process attachment. Please try a valid image or audio file.');
    }
  };

  const handleRemoveAttachment = () => {
    setSelectedAttachment(null);
    setAttachmentType(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Drag and Drop Handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && !selectedAttachment) || loading) return;

    const userText = input.trim();
    const attachment = selectedAttachment;

    // Grab history before adding new message
    const history = messages;

    setInput('');
    setSelectedAttachment(null);
    setAttachmentType(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setLoading(true);

    // Add user message to store
    const msgId = addMessage('user', userText, undefined, attachment);

    try {
      const snapshot = getSnapshot();
      // Pass the previous history and the new message content
      const toon = await orchestrateMessage(history, userText || (attachment ? "Analyze this attachment." : ""), snapshot, attachment);

      if (toon.ops && toon.ops.length > 0) {
        setPendingOps(toon.ops, msgId);
        addMessage('assistant', toon.assistant.message || "I've prepared some updates for your review.", toon.ops);
      } else {
        addMessage('assistant', toon.assistant.message || "I've noted that.");
      }
    } catch (err) {
      console.error(err);
      addMessage('assistant', 'Sorry, I encountered an internal error.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleConfirmOps = (selectedOps: ToonOperation[]) => {
    if (selectedOps && selectedOps.length > 0) {
      applyOperations(selectedOps);
    }
    clearPendingOps();
  };

  const renderMainContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'analytics':
        return <AnalyticsView />;
      case 'goals':
        return <EntityList kinds={[EntityKind.GOAL]} title="Goals" />;
      case 'projects':
        return <EntityList kinds={[EntityKind.PROJECT]} title="Projects" />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'calendar':
        return <CalendarView />;
      case 'settings':
        return <SettingsView />;
      case 'chat_graph':
      default:
        return (
          <div className="flex-1 flex flex-col bg-slate-950 p-4 relative h-full">
            {safeEntities.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 border border-dashed border-slate-800 rounded-xl m-2">
                <Cloud className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm">Graph is empty.</p>
                <p className="text-xs mt-1 text-slate-500">
                  <button onClick={() => setIsChatOpen(true)} className="text-indigo-400 hover:underline">
                    Open Chat
                  </button> to create your first entities.
                </p>
              </div>
            ) : (
              <GraphView entities={safeEntities} relationships={relationships || []} />
            )}
          </div>
        );
    }
  };

  const renderAttachmentPreview = (msg: any) => {
    if (!msg.attachment) return null;
    const isAudio = msg.attachment.startsWith('data:audio');

    return (
      <div className="mb-2 rounded-lg overflow-hidden border border-slate-700/50 max-w-[240px]">
        {isAudio ? (
          <div className="bg-slate-800 p-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-indigo-400 px-1">
              <FileAudio size={16} />
              <span className="text-xs text-slate-300 font-medium">Audio Clip</span>
            </div>
            <audio src={msg.attachment} controls className="w-full h-8" />
          </div>
        ) : (
          <img src={msg.attachment} alt="Attachment" className="w-full h-auto object-cover" />
        )}
      </div>
    );
  };

  const renderOpsSummary = (ops: any[]) => {
    return (
      <div className="mt-3 space-y-2">
        {ops.map((op, idx) => {
          let icon = <CheckCircle2 size={12} className="text-slate-500" />;
          let text = "Operation";
          let sub = "";

          if (op.type === 'create_entity') {
            icon = <Plus size={12} className="text-emerald-400" />;
            text = `Create ${op.payload.kind}`;
            sub = op.payload.title;
          } else if (op.type === 'update_entity') {
            icon = <RefreshCw size={12} className="text-indigo-400" />;
            text = "Update";
            const fields = Object.keys(op.payload.fields || {}).join(", ");
            sub = fields ? `Updated: ${fields}` : "Updated entity";
          } else if (op.type === 'link_entities') {
            icon = <Link size={12} className="text-blue-400" />;
            text = "Link";
            sub = `${op.payload.type} connection`;
          } else if (op.type === 'schedule_event') {
            icon = <Calendar size={12} className="text-purple-400" />;
            text = "Schedule";
            sub = op.payload.title;
          } else if (op.type === 'log_activity') {
            icon = <Activity size={12} className="text-orange-400" />;
            text = "Log";
            sub = op.payload.title;
          }

          return (
            <div key={idx} className="flex items-center gap-2 text-xs bg-slate-900/50 p-1.5 rounded border border-slate-700/50">
              {icon}
              <span className="font-semibold text-slate-300">{text}:</span>
              <span className="text-slate-400 truncate max-w-[150px]">{sub}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`flex h-screen w-full bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 ${isMobile ? 'flex-col' : 'flex-row'}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-[100] bg-indigo-500/10 backdrop-blur-sm border-4 border-dashed border-indigo-500 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-indigo-300">
            <Upload size={48} className="animate-bounce" />
            <h2 className="text-2xl font-bold">Drop to attach</h2>
          </div>
        </div>
      )}

      <Confetti />

      {/* Mobile Header Bar */}
      {isMobile && (
        <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0 z-30">
          {/* Left: Always hamburger menu */}
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
          >
            <Menu size={22} />
          </button>

          {/* Center: Title */}
          <span className="font-bold text-lg text-slate-100">
            {isChatOpen ? 'Chat' : 'Flowmate'}
          </span>

          {/* Right: Chat button or Back button */}
          {isChatOpen ? (
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 transition-colors"
            >
              <X size={22} />
            </button>
          ) : (
            <button
              onClick={() => setIsChatOpen(true)}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
            >
              <MessageSquare size={22} />
            </button>
          )}
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && isMobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div className="fixed left-0 top-0 h-full w-64 bg-slate-900 border-r border-slate-800 z-50 shadow-2xl animate-slide-in-left flex flex-col overflow-hidden">
            {/* Close Button Header */}
            <div className="p-3 border-b border-slate-800 flex items-center justify-end shrink-0">
              <button onClick={() => setIsMobileSidebarOpen(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400">
                <X size={20} />
              </button>
            </div>
            {/* Scrollable Sidebar Content */}
            <div className="flex-1 overflow-y-auto">
              <Sidebar
                forceExpanded
                onCreateClick={() => { setShowCreateModal(true); setIsMobileSidebarOpen(false); }}
                onNavigate={() => setIsMobileSidebarOpen(false)}
              />
            </div>
            {/* Fixed Bottom Auth Section */}
            <div className={`p-4 border-t border-slate-800 shrink-0 ${isZenMode ? 'hidden' : ''}`}>
              {currentUser ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <UserCircle size={16} />
                  <span className="truncate">{currentUser.email}</span>
                </div>
              ) : (
                <button onClick={() => { setShowAuthModal(true); setIsMobileSidebarOpen(false); }} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors">
                  Sign in to sync
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Desktop Sidebar */}
      {!isMobile && (
        <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 shrink-0 z-20">
          <Sidebar onCreateClick={() => setShowCreateModal(true)} />
          <div className={`p-4 border-t border-slate-800 bg-slate-900/80 ${isZenMode ? 'hidden' : ''}`}>
            <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
              {isSyncing ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <Cloud className="w-4 h-4 text-emerald-500" />
              )}
              <div className="flex flex-col">
                <span className={isSyncing ? "text-indigo-400" : "text-emerald-500"}>{syncStatusLabel}</span>
                <span className="text-[10px] text-slate-600">{queue.length} ops</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800">
              {currentUser ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCircle size={14} className="text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-400 truncate">{currentUser.email}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={syncToCloud} className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-indigo-400 transition-all" title="Sync">
                      <Cloud size={12} />
                    </button>
                    <button onClick={() => signOut()} className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-all" title="Sign out">
                      <LogOut size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAuthModal(true)} className="w-full flex items-center justify-center gap-2 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-lg text-xs font-medium transition-all">
                  <UserCircle size={12} /> Sign in
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Desktop Layout: Sidebar + Chat + Content */}
      {!isMobile && (
        <main className="flex-1 flex flex-row h-full overflow-hidden">
          {/* Desktop Chat Panel */}
          {isChatOpen && !isZenMode && (
            <div
              className="flex flex-col bg-slate-900 border-r border-slate-800 shrink-0 h-full relative"
              style={{ width: `${chatWidth}px`, minWidth: '300px', maxWidth: '600px' }}
            >
              {/* Resize Handle */}
              <div
                onMouseDown={handleMouseDown}
                className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/40 transition-colors z-20 ${isResizing ? 'bg-indigo-500' : ''}`}
              />
              <div className="h-14 border-b border-slate-800 flex items-center px-4 justify-between bg-slate-900/95 shrink-0">
                <h1 className="font-semibold text-base flex items-center gap-2">
                  <MessageSquare size={16} className="text-indigo-400" />
                  Orchestrator
                </h1>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/80 px-2 py-1 rounded border border-slate-700">
                    <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-indigo-500 animate-pulse' : 'bg-green-500'}`} />
                    {settings.preferred_model || 'gemini-2.5-flash'}
                  </div>
                  <button
                    onClick={() => setIsChatOpen(false)}
                    className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-white transition-colors"
                    title="Close (Cmd+B)"
                  >
                    <PanelLeftClose size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {(messages || []).map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 self-start mt-0.5 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    <div className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {renderAttachmentPreview(msg)}
                      <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${msg.role === 'user'
                        ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/20 rounded-tr-sm'
                        : 'bg-slate-800 border border-slate-700 rounded-tl-sm text-slate-200'
                        }`}>
                        {msg.text ? <MarkdownText content={msg.text} /> : <em className="text-slate-400">Attachment</em>}
                        {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                      </div>
                      <span className="text-[9px] text-slate-600 mt-1">{new Date(msg.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center"><Bot size={14} /></div>
                    <div className="bg-slate-800/50 px-3 py-2 rounded-xl border border-slate-800">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Desktop Chat Input - Unified ChatGPT-style */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
                <UnifiedChatInput
                  onSend={(msg) => {
                    if (msg.trim() || selectedAttachment) {
                      setInput(msg);
                      // Use setTimeout to let state update before submit
                      setTimeout(() => handleSubmit(), 0);
                    }
                  }}
                  onAttach={(file) => processFile(file)}
                  loading={loading}
                  placeholder="Ask AI anything..."
                  attachment={selectedAttachment}
                  onRemoveAttachment={handleRemoveAttachment}
                  isMobile={false}
                />
              </div>
            </div>
          )}

          {/* Chat Toggle Column */}
          {!isChatOpen && !isZenMode && (
            <div className="w-10 shrink-0 h-full flex flex-col items-center pt-4 bg-slate-950">
              <button
                onClick={() => setIsChatOpen(true)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition-all"
                title="Open Chat (Cmd+B)"
              >
                <PanelLeftOpen size={16} />
              </button>
            </div>
          )}

          {/* Desktop Main Content */}
          <div className="flex-1 overflow-auto relative">
            {renderMainContent()}
          </div>
        </main>
      )}

      {/* Mobile Layout: Full Content + Bottom Chat Bar */}
      {isMobile && (
        <>
          {/* Mobile Full-Screen Chat - No header, direct messages */}
          {isChatOpen ? (
            <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">

              <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={!isMobile ? undefined : scrollRef}>
                {(messages || []).map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {renderAttachmentPreview(msg)}
                      <div className={`px-3 py-2 rounded-xl text-sm ${msg.role === 'user' ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/20' : 'bg-slate-800 border border-slate-700 text-slate-200'}`}>
                        {msg.text ? <MarkdownText content={msg.text} /> : <em className="text-slate-400">Attachment</em>}
                        {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                      </div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center"><Bot size={16} /></div>
                    <div className="bg-slate-800/50 px-3 py-2 rounded-xl border border-slate-800">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile Chat Input */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
                <form onSubmit={handleSubmit} className="flex items-end gap-2">
                  <input type="file" accept="image/*,audio/*" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 bg-slate-800 text-slate-400 hover:bg-slate-700 rounded-xl"><Paperclip size={20} /></button>
                  <div className="flex-1 relative">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Message..."
                      rows={1}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl py-3 pl-4 pr-12 focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none min-h-[46px]"
                    />
                    <button type="submit" disabled={!input.trim() && !selectedAttachment} className="absolute right-2 bottom-2 p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-slate-700 text-white rounded-lg">
                      <Send size={16} />
                    </button>
                  </div>
                </form>
              </div>
            </main>
          ) : (
            /* Mobile Main Content with Bottom Chat Bar */
            <main className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="flex-1 overflow-auto">
                {renderMainContent()}
              </div>

              {/* Persistent Bottom Chat Bar */}
              <div
                onClick={() => setIsChatOpen(true)}
                className="shrink-0 p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-3 cursor-pointer active:bg-slate-800 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
                  <MessageSquare size={18} />
                </div>
                <div className="flex-1 bg-slate-800 border border-slate-700 rounded-xl py-2.5 px-4 text-slate-500 text-sm">
                  Ask AI anything...
                </div>
              </div>
            </main>
          )}
        </>
      )}

      {/* Overlays and Modals */}
      {selectedEntityId && <EntityDetailPanel />}

      {pendingOps && (
        <PreviewModal
          ops={pendingOps.ops}
          onConfirm={handleConfirmOps}
          onCancel={clearPendingOps}
        />
      )}

      {showCreateModal && (
        <CreateEntityModal onClose={() => setShowCreateModal(false)} />
      )}

      {isLiveMode && (
        <LiveVoiceModal onClose={() => setIsLiveMode(false)} />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}

      <CommandPalette />
      <FocusTimer />
      <DebugConsole />
      <ToastNotification />
    </div>
  );
};

export default App;