import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useStore } from './store';
import { orchestrateMessage } from './services/ai';
import { processFileAttachment } from './utils/imageProcessing';
import { onAuthChange, signOut } from './services/firebase';
import { initializeSync, startRealtimeSync, loadInitialData, cleanupSync, forceSync, scheduleSync, syncFoodLogsToCloud, syncAttendanceToCloud } from './services/syncManager';
import { mergeData, mergeMessages } from './services/firestoreSync';
import { preventDoubleClick } from './utils/debounce';
import { Send, Bot, User, RefreshCw, Cloud, CheckCircle2, Loader2, Mic, Paperclip, X, FileAudio, Activity, Plus, Link, Calendar, PanelLeftClose, Upload, PanelLeftOpen, MessageSquare, LogOut, UserCircle, Menu, ChevronLeft, ChevronDown, Utensils, IndianRupee, Table2, Layers } from 'lucide-react';
import Sidebar from './components/Sidebar';
import OpsPreviewForm from './components/OpsPreviewForm';
import Dashboard from './components/Dashboard';
import EntityDetailPanel from './components/EntityDetailPanel';
import DebugConsole from './components/DebugConsole';
import CommandPalette from './components/CommandPalette';
import FocusTimer from './components/FocusTimer';
import MarkdownText from './components/MarkdownText';
import ToastNotification from './components/ToastNotification';
import Confetti from './components/Confetti';
import AuthModal from './components/AuthModal';
import UnifiedChatInput from './components/UnifiedChatInput';
import ConnectionStatus from './components/ConnectionStatus';
import { EntityKind, ToonOperation } from './types';

// Lazy load heavier components for better initial load performance
const GraphView = lazy(() => import('./components/GraphView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const EntityList = lazy(() => import('./components/EntityList'));
const LiveVoiceModal = lazy(() => import('./components/LiveVoiceModal'));
const CreateEntityModal = lazy(() => import('./components/CreateEntityModal'));
const KnowledgeView = lazy(() => import('./components/KnowledgeView'));
const AnalyticsView = lazy(() => import('./components/AnalyticsView'));
const TimelineView = lazy(() => import('./components/TimelineView'));
const SchedulesView = lazy(() => import('./components/SchedulesView'));
const FoodTracker = lazy(() => import('./components/FoodTracker'));
const AttendanceTracker = lazy(() => import('./components/AttendanceTracker'));
const GraphFixingModal = lazy(() => import('./components/GraphFixingModal'));

// Loading fallback for lazy components
const LazyLoadFallback = () => (
  <div className="flex items-center justify-center h-full">
    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
  </div>
);

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
    settings,
    pendingOrchestration,
    setPendingOrchestration
  } = useStore();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGraphFixingModal, setShowGraphFixingModal] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<'image' | 'audio' | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeChannel, setActiveChannel] = useState('general'); // 'general', 'schedules', 'food', 'finance'

  // Rate limiting: track last API call time to prevent abuse
  const lastApiCallRef = useRef<number>(0);
  const API_COOLDOWN_MS = 1000; // Minimum 1 second between API calls

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
  }, [messages, loading, selectedAttachment, currentView]);

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

  // Auth State Listener + Sync Integration
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setCurrentUser(user);
      if (user) {
        // Initialize sync manager
        initializeSync(
          user.uid,
          (status, error) => {
            useStore.setState({
              syncStatus: status,
              syncError: error || null,
              lastSyncedAt: status === 'idle' ? new Date().toISOString() : useStore.getState().lastSyncedAt
            });
          },
          (remoteData) => {
            // Merge remote changes with local
            const state = useStore.getState();
            const merged = mergeData(
              { entities: state.entities, relationships: state.relationships },
              { entities: remoteData.entities, relationships: remoteData.relationships }
            );
            const mergedMsgs = remoteData.messages
              ? mergeMessages(state.messages || [], remoteData.messages)
              : state.messages;
            useStore.setState({
              entities: merged.entities,
              relationships: merged.relationships,
              universalTags: remoteData.universalTags || state.universalTags,
              messages: mergedMsgs,
              ...(remoteData.settings ? { settings: { ...state.settings, ...remoteData.settings } } : {}),
            });
          }
        );

        // Load initial cloud data then start real-time sync
        loadInitialData().then(data => {
          if (data) {
            // Merge initial data directly (loadFromCloud would double-fetch)
            const state = useStore.getState();
            const merged = mergeData(
              { entities: state.entities, relationships: state.relationships },
              { entities: data.entities, relationships: data.relationships }
            );
            const mergedMsgs = mergeMessages(state.messages || [], data.messages || []);
            useStore.setState({
              entities: merged.entities,
              relationships: merged.relationships,
              universalTags: data.universalTags || state.universalTags,
              messages: mergedMsgs,
              ...(data.settings ? { settings: { ...state.settings, ...data.settings } } : {}),
              ...(data.foodLogs?.length ? { foodLogs: data.foodLogs } : {}),
              ...(data.subjects?.length ? { subjects: data.subjects } : {}),
              ...(data.classSchedule?.length ? { classSchedule: data.classSchedule } : {}),
              ...(data.holidays?.length ? { holidays: data.holidays } : {}),
              ...(data.attendanceLogs?.length ? { attendanceLogs: data.attendanceLogs } : {}),
            });
          }
          // Start real-time listener after initial load
          startRealtimeSync();
        });
      } else {
        cleanupSync();
      }
    });
    return () => {
      unsubscribe();
      cleanupSync();
    };
  }, [setCurrentUser, loadFromCloud]);

  // Auto-sync food logs and attendance data to cloud when they change
  useEffect(() => {
    let foodDebounce: ReturnType<typeof setTimeout> | null = null;
    let attDebounce: ReturnType<typeof setTimeout> | null = null;
    let prevFood = useStore.getState().foodLogs;
    let prevSubjects = useStore.getState().subjects;
    let prevSchedule = useStore.getState().classSchedule;
    let prevHolidays = useStore.getState().holidays;
    let prevAttLogs = useStore.getState().attendanceLogs;

    const unsub = useStore.subscribe((state) => {
      if (!state.currentUser) return;

      // Food logs changed
      if (state.foodLogs !== prevFood) {
        prevFood = state.foodLogs;
        if (foodDebounce) clearTimeout(foodDebounce);
        foodDebounce = setTimeout(() => {
          syncFoodLogsToCloud(state.foodLogs);
        }, 3000);
      }

      // Attendance data changed
      if (state.subjects !== prevSubjects || state.classSchedule !== prevSchedule ||
          state.holidays !== prevHolidays || state.attendanceLogs !== prevAttLogs) {
        prevSubjects = state.subjects;
        prevSchedule = state.classSchedule;
        prevHolidays = state.holidays;
        prevAttLogs = state.attendanceLogs;
        if (attDebounce) clearTimeout(attDebounce);
        attDebounce = setTimeout(() => {
          syncAttendanceToCloud({
            subjects: state.subjects,
            classSchedule: state.classSchedule,
            holidays: state.holidays,
            attendanceLogs: state.attendanceLogs,
          });
        }, 3000);
      }
    });

    return () => {
      unsub();
      if (foodDebounce) clearTimeout(foodDebounce);
      if (attDebounce) clearTimeout(attDebounce);
    };
  }, []);

  // Sync on page unload — use sendBeacon for reliability since beforeunload
  // does not wait for async operations to complete.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useStore.getState();
      if (state.currentUser) {
        // Best-effort: sendBeacon is fire-and-forget and survives page unload
        // Firestore SDK's internal cache also handles pending writes
        forceSync(() => ({
          entities: state.entities,
          relationships: state.relationships,
          universalTags: state.universalTags,
          settings: state.settings,
        }));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Online/Offline status tracking
  useEffect(() => {
    const { setOnline } = useStore.getState();

    const handleOnline = () => {
      setOnline(true);
      // Trigger sync when coming back online
      const state = useStore.getState();
      if (state.currentUser) {
        scheduleSync(() => ({
          entities: state.entities,
          relationships: state.relationships,
          universalTags: state.universalTags,
          settings: state.settings,
        }));
      }
    };

    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  // Process pending orchestration messages (from Dashboard "Ask AI" button)
  useEffect(() => {
    if (pendingOrchestration && !loading) {
      // Clear pending immediately to prevent loops
      setPendingOrchestration(null);
      // Trigger LLM orchestration  
      sendDirectMessage(pendingOrchestration);
    }
  }, [pendingOrchestration, loading]);

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
    // Ensure we default to 'general' if activeChannel is undefined
    const currentChannel = activeChannel || 'general';
    const msgId = addMessage('user', userText, undefined, attachment, currentChannel);

    try {
      const snapshot = getSnapshot();
      // Pass the previous history and the new message content
      // Filter history for context? Maybe beneficial to keep some cross-context, but for now strict separation.
      const channelHistory = history.filter(m => (m.channelId || 'general') === currentChannel);
      const toon = await orchestrateMessage(channelHistory, userText || (attachment ? "Analyze this attachment." : ""), snapshot, attachment);

      if (toon.ops && toon.ops.length > 0) {
        setPendingOps(toon.ops, msgId);
        addMessage('assistant', toon.assistant.message || "I've prepared some updates for your review.", toon.ops, null, currentChannel);
      } else {
        // Provide more helpful fallback if LLM didn't return a message
        const fallbackMessage = toon.assistant.message ||
          "I received your message but I'm not sure how to help with that. Try asking me to create a task, schedule an event, or update your goals!";
        addMessage('assistant', fallbackMessage, undefined, null, currentChannel);
      }
    } catch (err) {
      console.error(err);
      addMessage('assistant', 'Sorry, I encountered an internal error.');
    } finally {
      setLoading(false);
    }
  };

  // Direct send function for UnifiedChatInput - bypasses state sync issues
  // Includes rate limiting to prevent API abuse
  const sendDirectMessage = async (text: string, attachment?: string | null) => {
    if ((!text.trim() && !attachment) || loading) return;

    // Rate limiting: prevent rapid-fire API calls
    const now = Date.now();
    if (now - lastApiCallRef.current < API_COOLDOWN_MS) {
      console.warn('[RateLimit] Chat message blocked - too fast');
      return;
    }
    lastApiCallRef.current = now;

    const userText = text.trim();
    const history = messages;

    setSelectedAttachment(null);
    setAttachmentType(null);
    setLoading(true);

    const currentChannel = activeChannel || 'general';
    const msgId = addMessage('user', userText, undefined, attachment || undefined, currentChannel);

    try {
      const snapshot = getSnapshot();
      const channelHistory = history.filter(m => (m.channelId || 'general') === currentChannel);
      const toon = await orchestrateMessage(channelHistory, userText || (attachment ? "Analyze this attachment." : ""), snapshot, attachment || undefined);

      if (toon.ops && toon.ops.length > 0) {
        setPendingOps(toon.ops, msgId);
        addMessage('assistant', toon.assistant.message || "I've prepared some updates for your review.", toon.ops, null, currentChannel);
      } else {
        const fallbackMessage = toon.assistant.message ||
          "I received your message but I'm not sure how to help with that. Try asking me to create a task, schedule an event, or update your goals!";
        addMessage('assistant', fallbackMessage, undefined, null, currentChannel);
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
      case 'chat':
        // Mobile: 'chat' view should show chat panel + graph
        if (!isChatOpen) setIsChatOpen(true);
        return (
          <div className="flex-1 flex flex-col bg-slate-950 p-4 relative h-full">
            {safeEntities.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 border border-dashed border-slate-800 rounded-xl m-2">
                <Cloud className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm">Graph is empty.</p>
                <p className="text-xs mt-1 text-slate-500">Use the chat to create entities.</p>
              </div>
            ) : (
              <GraphView entities={safeEntities} relationships={relationships || []} />
            )}
          </div>
        );
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
      case 'timeline':
        return <TimelineView entities={safeEntities} />;
      case 'schedules':
        return <SchedulesView />;
      case 'food':
        return <FoodTracker />;
      case 'attendance':
        return <AttendanceTracker />;
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
    // Expand short op types
    const getOpType = (type: string) => {
      const shortMap: Record<string, string> = {
        'c': 'create_entity', 'u': 'update_entity', 'd': 'delete_entity',
        'l': 'link_entities', 's': 'add_subtask', 'f': 'log_food',
        'log': 'log_to_entity', 'arc': 'archive_entity'
      };
      return shortMap[type] || type;
    };

    // Expand short kind codes
    const getKind = (k: string) => {
      const kindMap: Record<string, string> = {
        'CTX': 'CONTEXT', 'GOL': 'GOAL', 'PRJ': 'PROJECT', 'TSK': 'TASK',
        'EVT': 'EVENT', 'HAB': 'HABIT', 'NOT': 'NOTE', 'PER': 'PERSON'
      };
      return kindMap[k?.toUpperCase()] || k || '?';
    };

    return (
      <div className="mt-3 space-y-2">
        {ops.map((op, idx) => {
          const opType = getOpType(op.type);
          const p = op.payload || {};
          let icon = <CheckCircle2 size={12} className="text-slate-500" />;
          let text = opType;
          let sub = "";

          // Get title from various possible fields
          const title = p.title || p.t || p.food_name || '';
          const kind = getKind(p.kind || p.k);

          if (opType === 'create_entity' || opType === 'c') {
            icon = <Plus size={12} className="text-emerald-400" />;
            text = `Create ${kind}`;
            sub = title;
          } else if (opType === 'update_entity' || opType === 'u') {
            icon = <RefreshCw size={12} className="text-indigo-400" />;
            text = "Update";
            const fields = Object.keys(p.fields || {}).join(", ");
            sub = fields ? `Updated: ${fields}` : (p.id?.slice(-6) || "entity");
          } else if (opType === 'link_entities' || opType === 'l') {
            icon = <Link size={12} className="text-blue-400" />;
            text = "Link";
            sub = `${p.type || 'RELATED_TO'} connection`;
          } else if (opType === 'add_subtask' || opType === 's') {
            icon = <Plus size={12} className="text-cyan-400" />;
            text = "Add Subtask";
            sub = title;
          } else if (opType === 'log_food' || opType === 'f') {
            icon = <Activity size={12} className="text-orange-400" />;
            text = "Log Food";
            sub = title + (p.cost ? ` (₹${p.cost})` : '');
          } else if (opType === 'log_to_entity' || opType === 'log') {
            icon = <Activity size={12} className="text-yellow-400" />;
            text = "Log Activity";
            sub = title + (p.dur || p.duration_minutes ? ` (${p.dur || p.duration_minutes}m)` : '');
          } else if (opType === 'archive_entity' || opType === 'arc') {
            icon = <CheckCircle2 size={12} className="text-gray-400" />;
            text = "Archive";
            sub = p.entity_id?.slice(-6) || "";
          } else if (opType === 'toggle_subtask') {
            icon = <RefreshCw size={12} className="text-green-400" />;
            text = "Toggle Subtask";
            sub = p.subtask_id?.slice(-6) || "";
          } else if (opType === 'delete_entity' || opType === 'd') {
            icon = <X size={12} className="text-red-400" />;
            text = "Delete";
            sub = p.id?.slice(-6) || "";
          }

          return (
            <details key={idx} className="group">
              <summary className="flex items-center gap-2 text-xs bg-slate-900/50 p-1.5 rounded border border-slate-700/50 cursor-pointer hover:bg-slate-800/50 transition-colors list-none">
                {icon}
                <span className="font-semibold text-slate-300">{text}:</span>
                <span className="text-slate-400 truncate max-w-[150px]">{sub}</span>
                <ChevronDown size={10} className="ml-auto text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-1 p-2 bg-slate-950/80 rounded border border-slate-800 text-[10px] font-mono text-slate-400 max-h-32 overflow-auto">
                <pre className="whitespace-pre-wrap">{JSON.stringify(op.payload, null, 2)}</pre>
              </div>
            </details>
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
      <ConnectionStatus />

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

          {/* Center: Dynamic Title based on current view */}
          <span className="font-bold text-lg text-slate-100">
            {currentView === 'chat' ? 'Chat' :
              currentView === 'dashboard' ? 'Flowmate' :
                currentView === 'calendar' ? 'Calendar' :
                  currentView === 'knowledge' ? 'Library' :
                    currentView === 'analytics' ? 'Analytics' :
                      currentView === 'chat_graph' ? 'Graph' :
                        'Flowmate'}
          </span>

          {/* Right spacer for centering title */}
          <div className="w-10" />
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
        <div className="flex-1 flex flex-row h-full overflow-hidden">
          {/* Desktop Chat Panel - Full width when Chat view, otherwise side panel */}
          {(isChatOpen || currentView === 'chat') && !isZenMode && (
            <div
              className={`flex flex-col bg-slate-900 border-r border-slate-800 shrink-0 h-full relative ${currentView === 'chat' ? 'flex-1' : ''
                }`}
              style={currentView === 'chat' ? {} : { width: `${chatWidth}px`, minWidth: '300px', maxWidth: '600px' }}
            >
              {/* Resize Handle - only show when not full-screen chat */}
              {currentView !== 'chat' && (
                <div
                  onMouseDown={handleMouseDown}
                  className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/40 transition-colors z-20 ${isResizing ? 'bg-indigo-500' : ''}`}
                />
              )}
              <div className="flex flex-col border-b border-slate-800 bg-slate-900/95 shrink-0 z-10">
                <div className="h-14 flex items-center px-4 justify-between">
                  <h1 className="font-semibold text-base flex items-center gap-2">
                    <MessageSquare size={16} className="text-indigo-400" />
                    Orchestrator
                  </h1>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/80 px-2 py-1 rounded border border-slate-700">
                      <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-indigo-500 animate-pulse' : 'bg-green-500'}`} />
                      {settings.preferred_model || 'gemini-3.8-flash'}
                    </div>
                    {/* Only show close button when not in full-screen Chat view */}
                    {currentView !== 'chat' && (
                      <button
                        onClick={() => setIsChatOpen(false)}
                        className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-white transition-colors"
                        title="Close (Cmd+B)"
                      >
                        <PanelLeftClose size={18} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Channel Header - Simplified to just General */}
                <div className="flex items-center px-4 py-2 border-b border-slate-800/50">
                  <span className="text-sm font-medium text-slate-300">Chat</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {(messages || [])
                  .filter(msg => (msg.channelId || 'general') === activeChannel)
                  .map((msg) => (
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

              {/* Desktop Chat Input - In-chat Live Voice or Unified ChatGPT-style */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
                {isLiveMode ? (
                  <Suspense fallback={<div className="p-3 text-center text-xs text-slate-400">Loading Gemini Live...</div>}>
                    <LiveVoiceModal onClose={() => setIsLiveMode(false)} />
                  </Suspense>
                ) : (
                  <UnifiedChatInput
                    onSend={(msg) => sendDirectMessage(msg, selectedAttachment)}
                    onAttach={(file) => processFile(file)}
                    onLiveVoice={() => setIsLiveMode(true)}
                    loading={loading}
                    placeholder="Ask AI anything..."
                    attachment={selectedAttachment}
                    onRemoveAttachment={handleRemoveAttachment}
                    isMobile={false}
                  />
                )}
              </div>
            </div>
          )}

          {/* Desktop Main Content - Hidden when in full-screen Chat view */}
          {currentView !== 'chat' && (
            <main id="main-content" className="flex-1 overflow-auto relative" role="main" aria-label="Main content">
              <Suspense fallback={<LazyLoadFallback />}>
                {renderMainContent()}
              </Suspense>

              {/* Floating Chat Toggle Button - positioned inside content area */}
              {!isChatOpen && !isZenMode && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="absolute left-4 top-4 z-20 p-2.5 rounded-xl bg-slate-800/90 backdrop-blur-sm text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition-all shadow-lg border border-slate-700"
                  title="Open Chat (Cmd+B)"
                  aria-label="Open chat panel"
                >
                  <PanelLeftOpen size={18} />
                </button>
              )}
            </main>
          )}
        </div>
      )}

      {/* Mobile Layout: Full Content + Bottom Chat Bar */}
      {isMobile && (
        <>
          {/* Mobile Full-Screen Chat when Chat view is selected */}
          {currentView === 'chat' ? (
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

              {/* Mobile Chat Input - In-chat Live Voice or UnifiedChatInput */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
                {isLiveMode ? (
                  <Suspense fallback={<div className="p-3 text-center text-xs text-slate-400">Loading Gemini Live...</div>}>
                    <LiveVoiceModal onClose={() => setIsLiveMode(false)} />
                  </Suspense>
                ) : (
                  <UnifiedChatInput
                    onSend={(msg) => sendDirectMessage(msg, selectedAttachment)}
                    onAttach={(file) => processFile(file)}
                    onLiveVoice={() => setIsLiveMode(true)}
                    loading={loading}
                    placeholder="Message..."
                    attachment={selectedAttachment}
                    onRemoveAttachment={handleRemoveAttachment}
                    isMobile={true}
                  />
                )}
              </div>
            </main>
          ) : (
            /* Mobile Main Content - Show regular views */
            <main className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="flex-1 overflow-auto">
                <Suspense fallback={<LazyLoadFallback />}>
                  {renderMainContent()}
                </Suspense>
              </div>
            </main>
          )}
        </>
      )}

      {/* Overlays and Modals */}
      {selectedEntityId && <EntityDetailPanel />}

      {pendingOps && (
        <OpsPreviewForm
          ops={pendingOps.ops}
          onConfirm={handleConfirmOps}
          onCancel={clearPendingOps}
        />
      )}

      <Suspense fallback={null}>
        {showCreateModal && (
          <CreateEntityModal onClose={() => setShowCreateModal(false)} />
        )}

        {showGraphFixingModal && (
          <GraphFixingModal onClose={() => setShowGraphFixingModal(false)} />
        )}
      </Suspense>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}

      <CommandPalette />
      <FocusTimer />
      <DebugConsole onOpenGraphFixer={() => setShowGraphFixingModal(true)} />
      <ToastNotification />
    </div>
  );
};

export default App;