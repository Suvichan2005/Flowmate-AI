import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useStore } from './store';
import { getActiveEntities, getActiveChatSessions, isChatSessionActive } from './store/helpers';
import { orchestrateMessage, generateContextualSuggestions, getInstantContextualSuggestions, type ContextualSuggestion } from './services/ai';
import { hasAiApiKey } from './services/ai/client';
import { processFileAttachment } from './utils/imageProcessing';
import { onAuthChange, signOut } from './services/firebase';
import { initializeSync, startRealtimeSync, loadInitialData, cleanupSync, forceSync, scheduleSync, syncFoodLogsToCloud, syncAttendanceToCloud } from './services/syncManager';
import { mergeData, mergeMessages, mergeChatSessions } from './services/firestoreSync';
import { preventDoubleClick } from './utils/debounce';
import { Send, Bot, User, RefreshCw, Cloud, CheckCircle2, Loader2, Mic, Paperclip, X, FileAudio, Activity, Plus, Link, Calendar, PanelLeftClose, Upload, PanelLeftOpen, MessageSquare, LogOut, UserCircle, Menu, ChevronLeft, ChevronDown, Utensils, IndianRupee, Table2, Layers, Sparkles, LayoutDashboard } from 'lucide-react';
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
import ChatSessionBar from './components/ChatSessionBar';
import ConnectionStatus from './components/ConnectionStatus';
import WorkspaceStatus from './components/WorkspaceStatus';
import { MessageVersionNav } from './components/MessageVersionNav';
import { DeveloperModeDrawer } from './components/DeveloperModeDrawer';
import { resolveBranchHistory } from './utils/conversationGraph';
import { EntityKind, ToonOperation, ChatSession, Entity, TurnExecutor, BranchQueueItem } from './types';
import { v4 as uuidv4 } from 'uuid';
import { ConfirmedExecutionPlan } from './services/kernel';

import { reconcileEntityCollection, globalPendingMutationQueue } from './services/sync';
import { projectKernelEntitiesToLegacy } from './store/kernelProjection';
import { setupCrossTabSync } from './services/storage';
import { getLatestReviewDraft, deleteReviewDraft, revalidateReviewDraft, type ReviewDraft } from './services/action-review';

// Helper to safely load dynamic chunks across deployments
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const component = await factory();
      sessionStorage.removeItem('lazy_chunk_retry');
      return component;
    } catch (err: any) {
      const isChunkError =
        err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('error loading dynamically imported module') ||
        err?.message?.includes('Importing a module script failed');
      const hasRetried = sessionStorage.getItem('lazy_chunk_retry');
      if (isChunkError && !hasRetried) {
        sessionStorage.setItem('lazy_chunk_retry', 'true');
        window.location.reload();
      }
      throw err;
    }
  });
}

// Lazy load heavier components with auto-recovery on deployment chunk hash changes
const GraphView = lazyWithRetry(() => import('./components/GraphView'));
const CalendarView = lazyWithRetry(() => import('./components/CalendarView'));
const SettingsView = lazyWithRetry(() => import('./components/SettingsView'));
const EntityList = lazyWithRetry(() => import('./components/EntityList'));
const LiveVoiceModal = lazyWithRetry(() => import('./components/LiveVoiceModal'));
const CreateEntityModal = lazyWithRetry(() => import('./components/CreateEntityModal'));
const KnowledgeView = lazyWithRetry(() => import('./components/KnowledgeView'));
const AnalyticsView = lazyWithRetry(() => import('./components/AnalyticsView'));
const TimelineView = lazyWithRetry(() => import('./components/TimelineView'));
const SchedulesView = lazyWithRetry(() => import('./components/SchedulesView'));
const FoodTracker = lazyWithRetry(() => import('./components/FoodTracker'));
const AttendanceTracker = lazyWithRetry(() => import('./components/AttendanceTracker'));
const GraphFixingModal = lazyWithRetry(() => import('./components/GraphFixingModal'));

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
    executeConfirmedPlan,
    currentView,
    setView,
    isZenMode,
    selectedEntityId,
    settings,
    pendingOrchestration,
    setPendingOrchestration,
    chatSessions,
    activeSessionId,
    setActiveSessionId,
    foodLogs,
    subjects,
    branches,
    activeBranchId,
    branchQueues,
    developerModeEnabled,
    toggleDeveloperMode,
    updateMessageText,
    updateMessageTurnMetadata,
    setIsStreaming,
    isStreaming,
    setLastTurnDiagnostics,
    addToast,
  } = useStore();

  const input = useStore(state => state.unsentDrafts[state.activeBranchId]?.text || '');
  const setInput = useCallback((text: string) => {
    const state = useStore.getState();
    state.setUnsentDraft(state.activeBranchId, text);
  }, []);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false, null);
    setLoading(false);
  }, [setIsStreaming]);

  // Keyboard shortcut Ctrl+Shift+D for Developer Diagnostics
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        toggleDeveloperMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleDeveloperMode]);
  const [contextualSuggestions, setContextualSuggestions] = useState<ContextualSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGraphFixingModal, setShowGraphFixingModal] = useState(false);
  const selectedAttachment = useStore(state => state.unsentDrafts[state.activeBranchId]?.attachment || null);
  const setSelectedAttachment = (attachment: string | null) => {
    const state = useStore.getState(); state.setDraftAttachment(state.activeBranchId, attachment);
  };
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  const mobileSidebarCloseRef = useRef<HTMLButtonElement>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const dialog = mobileSidebarRef.current;
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    mobileSidebarCloseRef.current?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsMobileSidebarOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [isMobileSidebarOpen]);
  // Dynamic context-aware suggestions (time of day, events, tasks, meals)
  useEffect(() => {
    const ctx = { entities: getActiveEntities(entities), foodLogs, subjects };
    setContextualSuggestions(getInstantContextualSuggestions(ctx));
    generateContextualSuggestions(ctx).then(res => {
      if (res && res.length > 0) setContextualSuggestions(res);
    }).catch(err => console.warn('[App] Suggestions generation failed:', err));
  }, [entities.length, foodLogs?.length, subjects?.length]);

  const handleSelectSuggestion = (suggestion: ContextualSuggestion) => {
    setInput(suggestion.prompt);
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  };

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

  // Cross-Tab Snapshot Synchronization (Prevents stale multi-tab overwrites)
  useEffect(() => {
    return setupCrossTabSync(() => {
      useStore.persist.rehydrate();
    });
  }, []);

  // Recoverable Action Review Drafts (detects unconfirmed drafts on reload)
  const [restoredDraft, setRestoredDraft] = useState<ReviewDraft | null>(null);

  useEffect(() => {
    getLatestReviewDraft().then(draft => {
      if (!draft || draft.ops.length === 0) return;
      const kernelEntities = useStore.getState().kernelEntities || {};
      const validation = revalidateReviewDraft(draft, kernelEntities);
      if (validation.isValid || validation.validOpCount > validation.conflictCount) {
        setRestoredDraft(draft);
      }
    }).catch(() => {});
  }, []);

  const handleResumeDraft = () => {
    if (!restoredDraft) return;
    setPendingOps(restoredDraft.ops, (restoredDraft.metadata?.originalMessageId as string) || 'restored-draft');
    setRestoredDraft(null);
  };

  const handleDiscardDraft = async () => {
    if (!restoredDraft) return;
    await deleteReviewDraft(restoredDraft.id).catch(() => {});
    setRestoredDraft(null);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(messages?.length || 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom <= 80;
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    const currentLen = messages?.length || 0;
    const isNewUserMessage = currentLen > prevMessagesLengthRef.current &&
      messages[messages.length - 1]?.role === 'user';
    prevMessagesLengthRef.current = currentLen;

    if (isNewUserMessage) {
      isAtBottomRef.current = true;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      return;
    }

    if (isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, selectedAttachment, currentView]);

  useEffect(() => {
    if (scrollRef.current) {
      isAtBottomRef.current = true;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSessionId]);

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
            // Reconcile remote changes into canonical kernel state (P1-09)
            const state = useStore.getState();
            const { nextKernelEntities, conflicts: newConflicts } = reconcileEntityCollection(
              state.kernelEntities,
              remoteData.entities || [],
              globalPendingMutationQueue
            );
            const projectedEntities = projectKernelEntitiesToLegacy(nextKernelEntities);

            const merged = mergeData(
              { entities: projectedEntities as unknown as Entity[], relationships: state.relationships },
              { entities: remoteData.entities, relationships: remoteData.relationships }
            );
            const rawMergedMsgs = remoteData.messages
              ? mergeMessages(state.messages || [], remoteData.messages)
              : state.messages;

            const mergedChatSessions = remoteData.chatSessions
              ? mergeChatSessions(state.chatSessions || [], remoteData.chatSessions)
              : (state.chatSessions || []);

            const deletedSessionIds = new Set(
              mergedChatSessions.filter(s => s.deleted).map(s => s.id)
            );

            // Strip messages belonging to deleted sessions to prevent zombie resurrects
            const mergedMsgs = (rawMergedMsgs || []).filter(
              m => !m.channelId || !deletedSessionIds.has(m.channelId)
            );

            const existingSessionIds = new Set(mergedChatSessions.map(s => s.id));
            const missingSessions: ChatSession[] = (mergedMsgs || [])
              .filter(m => m.channelId && !existingSessionIds.has(m.channelId) && !deletedSessionIds.has(m.channelId))
              .map(m => {
                existingSessionIds.add(m.channelId!);
                return {
                  id: m.channelId!,
                  title: 'Chat ' + m.channelId!.slice(0, 8),
                  created_at: m.created_at,
                  updated_at: m.created_at,
                  deleted: false,
                };
              });

            const finalChatSessions = [...mergedChatSessions, ...missingSessions];
            const activeSessions = getActiveChatSessions(finalChatSessions);
            const currentActive = state.activeSessionId;
            const nextActive = (activeSessions.length > 0 && (!currentActive || !activeSessions.some(s => s.id === currentActive)))
              ? activeSessions[0].id
              : (activeSessions.length === 0 ? 'general' : currentActive);

            const sessionsUnchanged = (state.chatSessions || []).length === finalChatSessions.length &&
              (state.chatSessions || []).every((s, i) =>
                s.id === finalChatSessions[i].id &&
                s.title === finalChatSessions[i].title &&
                s.deleted === finalChatSessions[i].deleted &&
                s.updated_at === finalChatSessions[i].updated_at
              );

            const messagesUnchanged = (state.messages || []).length === (mergedMsgs || []).length &&
              (state.messages || []).every((m, i) =>
                m.id === mergedMsgs[i].id &&
                m.text === mergedMsgs[i].text &&
                m.created_at === mergedMsgs[i].created_at
              );

            useStore.setState({
              kernelEntities: nextKernelEntities,
              entities: projectedEntities,
              relationships: merged.relationships,
              conflicts: [...(state.conflicts || []), ...newConflicts],
              universalTags: remoteData.universalTags || state.universalTags,
              messages: messagesUnchanged ? state.messages : mergedMsgs,
              chatSessions: sessionsUnchanged ? state.chatSessions : finalChatSessions,
              ...(nextActive !== currentActive ? { activeSessionId: nextActive } : {}),
              ...(remoteData.settings ? { settings: { ...state.settings, ...remoteData.settings } } : {}),
            });
          }
        );

        // Load initial cloud data then start real-time sync
        loadInitialData().then(data => {
          if (data) {
            // Reconcile initial data into canonical kernel state (P1-09)
            const state = useStore.getState();
            const { nextKernelEntities, conflicts: newConflicts } = reconcileEntityCollection(
              state.kernelEntities,
              data.entities || [],
              globalPendingMutationQueue
            );
            const projectedEntities = projectKernelEntitiesToLegacy(nextKernelEntities);

            const merged = mergeData(
              { entities: projectedEntities as unknown as Entity[], relationships: state.relationships },
              { entities: data.entities, relationships: data.relationships }
            );
            const rawMergedMsgs = mergeMessages(state.messages || [], data.messages || []);

            const mergedChatSessions = data.chatSessions?.length
              ? mergeChatSessions(state.chatSessions || [], data.chatSessions)
              : (state.chatSessions || []);

            const deletedSessionIds = new Set(
              mergedChatSessions.filter(s => s.deleted).map(s => s.id)
            );

            // Strip messages belonging to deleted sessions to prevent zombie resurrects
            const mergedMsgs = (rawMergedMsgs || []).filter(
              m => !m.channelId || !deletedSessionIds.has(m.channelId)
            );

            const existingSessionIds = new Set(mergedChatSessions.map(s => s.id));
            const missingSessions: ChatSession[] = (mergedMsgs || [])
              .filter(m => m.channelId && !existingSessionIds.has(m.channelId) && !deletedSessionIds.has(m.channelId))
              .map(m => {
                existingSessionIds.add(m.channelId!);
                return {
                  id: m.channelId!,
                  title: 'Chat ' + m.channelId!.slice(0, 8),
                  created_at: m.created_at,
                  updated_at: m.created_at,
                  deleted: false,
                };
              });

            const finalChatSessions = [...mergedChatSessions, ...missingSessions];
            const activeSessions = getActiveChatSessions(finalChatSessions);
            const currentActive = state.activeSessionId;
            const nextActive = (activeSessions.length > 0 && (!currentActive || !activeSessions.some(s => s.id === currentActive)))
              ? activeSessions[0].id
              : (activeSessions.length === 0 ? 'general' : currentActive);

            const sessionsUnchanged = (state.chatSessions || []).length === finalChatSessions.length &&
              (state.chatSessions || []).every((s, i) =>
                s.id === finalChatSessions[i].id &&
                s.title === finalChatSessions[i].title &&
                s.deleted === finalChatSessions[i].deleted &&
                s.updated_at === finalChatSessions[i].updated_at
              );

            const messagesUnchanged = (state.messages || []).length === (mergedMsgs || []).length &&
              (state.messages || []).every((m, i) =>
                m.id === mergedMsgs[i].id &&
                m.text === mergedMsgs[i].text &&
                m.created_at === mergedMsgs[i].created_at
              );

            useStore.setState({
              kernelEntities: nextKernelEntities,
              entities: projectedEntities,
              relationships: merged.relationships,
              conflicts: [...(state.conflicts || []), ...newConflicts],
              universalTags: data.universalTags || state.universalTags,
              messages: messagesUnchanged ? state.messages : mergedMsgs,
              chatSessions: sessionsUnchanged ? state.chatSessions : finalChatSessions,
              ...(nextActive !== currentActive ? { activeSessionId: nextActive } : {}),
              ...(data.settings ? { settings: { ...state.settings, ...data.settings } } : {}),
              ...(data.foodLogs?.length ? { foodLogs: data.foodLogs } : {}),
              ...(data.subjects?.length ? { subjects: data.subjects } : {}),
              ...(data.classSchedule?.length ? { classSchedule: data.classSchedule } : {}),
              ...(data.holidays?.length ? { holidays: data.holidays } : {}),
              ...(data.attendanceLogs?.length ? { attendanceLogs: data.attendanceLogs } : {}),
            });

            // If local state had entities that aren't on the cloud yet (e.g. initial login on new cloud db), push them up immediately
            if (merged.entities.length > 0 && (!data.entities || data.entities.length === 0) && !useStore.getState().isDemoMode) {
              console.log('[SyncManager] Seeding local entities to cloud');
              scheduleSync(() => ({
                entities: merged.entities,
                relationships: merged.relationships,
                universalTags: data.universalTags || state.universalTags,
                settings: state.settings,
              }));
            }
          }
          // Start real-time listener after initial load
          if (!useStore.getState().isDemoMode) {
            startRealtimeSync();
          }
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

  // Auto-sync entities, relationships, food logs and attendance data to cloud when they change
  useEffect(() => {
    let foodDebounce: ReturnType<typeof setTimeout> | null = null;
    let attDebounce: ReturnType<typeof setTimeout> | null = null;
    let prevFood = useStore.getState().foodLogs;
    let prevSubjects = useStore.getState().subjects;
    let prevSchedule = useStore.getState().classSchedule;
    let prevHolidays = useStore.getState().holidays;
    let prevAttLogs = useStore.getState().attendanceLogs;
    let prevEntities = useStore.getState().entities;
    let prevRelationships = useStore.getState().relationships;
    let prevTags = useStore.getState().universalTags;
    let prevSettings = useStore.getState().settings;

    const unsub = useStore.subscribe((state) => {
      // Demo Mode Isolation: Never trigger auto-sync while exploring demo workspace
      if (!state.currentUser || state.isDemoMode) return;

      // Entities, relationships, tags, or settings changed -> auto-sync to Firestore
      if (
        state.entities !== prevEntities ||
        state.relationships !== prevRelationships ||
        state.universalTags !== prevTags ||
        state.settings !== prevSettings
      ) {
        prevEntities = state.entities;
        prevRelationships = state.relationships;
        prevTags = state.universalTags;
        prevSettings = state.settings;
        scheduleSync(() => ({
          entities: state.entities,
          relationships: state.relationships,
          universalTags: state.universalTags,
          settings: state.settings,
        }));
      }

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
      if (state.currentUser && !state.isDemoMode) {
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

  // Sync URL hash with currentView for direct navigation & browser history
  const isSyncingHashRef = useRef(false);

  useEffect(() => {
    if (!isHydrated) return;

    const syncFromHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'archive-intelligence') {
        return;
      }
      const validViews = [
        'dashboard', 'chat', 'chat_graph', 'analytics', 'goals',
        'projects', 'knowledge', 'calendar', 'timeline', 'schedules',
        'food', 'attendance', 'settings'
      ];
      if (validViews.includes(hash)) {
        if (useStore.getState().currentView !== hash) {
          isSyncingHashRef.current = true;
          setView(hash as any);
        }
      } else if (useStore.getState().currentView) {
        window.history.replaceState(null, '', `#${useStore.getState().currentView}`);
      }
    };

    if (window.location.hash) {
      syncFromHash();
    } else if (currentView) {
      window.history.replaceState(null, '', `#${currentView}`);
    }

    const handleHashChange = () => {
      syncFromHash();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [isHydrated, setView]);

  // Keep URL hash updated when view changes in state via UI clicks
  useEffect(() => {
    if (!isHydrated || !currentView) return;
    if (isSyncingHashRef.current) {
      isSyncingHashRef.current = false;
      return;
    }
    const currentHash = window.location.hash.replace('#', '');
    if (currentHash === 'archive-intelligence') {
      return;
    }
    if (currentHash !== currentView) {
      window.history.replaceState(null, '', `#${currentView}`);
    }
  }, [isHydrated, currentView]);

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

  const safeEntities = getActiveEntities(entities);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    try {
      const base64 = await processFileAttachment(file);
      setSelectedAttachment(base64);
    } catch (err) {
      console.error("File processing failed", err);
      addMessage('assistant', 'Failed to process attachment. Please try a valid image or audio file.');
    }
  };

  const handleRemoveAttachment = () => {
    setSelectedAttachment(null);
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

  const formatPendingProposalMessage = (rawMessage?: string): string => {
    if (!rawMessage || !rawMessage.trim()) {
      return "I've prepared the following action proposal for your review:";
    }
    let msg = rawMessage.trim();
    if (/^scheduled\b/i.test(msg)) {
      msg = msg.replace(/^scheduled\s+/i, "Prepared event: ");
    } else if (/^created\b/i.test(msg)) {
      msg = msg.replace(/^created\s+/i, "Prepared: ");
    } else if (/^added\b/i.test(msg)) {
      msg = msg.replace(/^added\s+/i, "Prepared: ");
    } else if (/^deleted\b/i.test(msg)) {
      msg = msg.replace(/^deleted\s+/i, "Proposed deletion: ");
    } else if (/^updated\b/i.test(msg)) {
      msg = msg.replace(/^updated\s+/i, "Prepared updates: ");
    }
    if (!msg.toLowerCase().includes('review') && !msg.toLowerCase().includes('confirm')) {
      msg = `${msg} (Awaiting your review and confirmation)`;
    }
    return msg;
  };

  useEffect(() => {
    const turnExecutor: TurnExecutor = async ({
      branchId,
      channelId,
      userMessage,
      assistantMessageId,
      signal,
      onChunk,
      onMetrics,
    }) => {
      setLoading(true);
      const state = useStore.getState();
      const snapshot = state.getSnapshot();
      const currentHistory = resolveBranchHistory(state.messages || [], userMessage.id, channelId);

      let accumulatedText = '';
      let collectedMetrics: any = {};

      try {
        const toon = await orchestrateMessage(
          currentHistory,
          userMessage.text || (userMessage.attachment ? "Analyze this attachment." : ""),
          snapshot,
          userMessage.attachment || undefined,
          {
            signal: signal || abortControllerRef.current?.signal,
            onChunk: (chunk) => {
              accumulatedText += chunk;
              if (onChunk) onChunk(chunk);
              updateMessageText(assistantMessageId, accumulatedText);
            },
            onMetrics: (metrics) => {
              collectedMetrics = { ...collectedMetrics, ...metrics };
              if (onMetrics) onMetrics(metrics);
              setLastTurnDiagnostics(collectedMetrics);
            },
          }
        );

        const latestState = useStore.getState();
        const currentSession = (latestState.chatSessions || []).find(s => s.id === channelId);
        if (currentSession && currentSession.deleted) {
          console.warn(`[App] Session ${channelId} was deleted during turn. Discarding reply.`);
          return;
        }

        if (toon.ops && toon.ops.length > 0) {
          setPendingOps(toon.ops, userMessage.id);
          updateMessageText(assistantMessageId, formatPendingProposalMessage(toon.assistant.message));
          useStore.setState(s => ({
            messages: s.messages.map(m => m.id === assistantMessageId ? { ...m, ops_preview: toon.ops } : m)
          }));
        } else {
          const fallbackMessage = toon.assistant.message || accumulatedText ||
            "I received your message but I'm not sure how to help with that. Try asking me to create a task, schedule an event, or update your goals!";
          updateMessageText(assistantMessageId, fallbackMessage);
        }

        updateMessageTurnMetadata(assistantMessageId, {
          ...collectedMetrics,
          model: hasAiApiKey() ? settings?.preferred_model : undefined,
          response_source: hasAiApiKey() ? 'gemini' : 'unavailable',
        });
      } finally {
        setLoading(false);
      }
    };

    useStore.getState().registerTurnExecutor(turnExecutor);
    return () => {
      useStore.getState().registerTurnExecutor(null);
    };
  }, [settings?.preferred_model, updateMessageText, updateMessageTurnMetadata, setPendingOps, setLastTurnDiagnostics]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() && !selectedAttachment) return;

    const userText = input.trim();
    const attachment = selectedAttachment;

    setInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    await sendDirectMessage(userText, attachment);
  };

  // Direct send function for UnifiedChatInput - bypasses state sync issues
  // Includes rate limiting to prevent API abuse while allowing queued follow-ups
  const sendDirectMessage = (text: string, attachment?: string | null): boolean => {
    if (!text.trim() && !attachment) return false;

    // Rate limiting: prevent rapid-fire API calls within cooldown
    const now = Date.now();
    if (hasAiApiKey() && now - lastApiCallRef.current < API_COOLDOWN_MS) {
      addToast('Please wait a moment before sending again; your draft is retained', 'info');
      return false;
    }
    lastApiCallRef.current = now;

    const userText = text.trim();
    setSelectedAttachment(null);

    if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
      abortControllerRef.current = new AbortController();
    }

    const currentChannel = activeSessionId || 'general';
    const effectiveBranchId = activeBranchId || `b_main_${currentChannel}`;
    const userMsgId = addMessage('user', userText, undefined, attachment || undefined, currentChannel);
    const userMsg = useStore.getState().messages.find(m => m.id === userMsgId);

    if (userMsg) {
      const queueItem: BranchQueueItem = {
        id: uuidv4(),
        branch_id: effectiveBranchId,
        user_message: userMsg,
        status: 'queued',
        enqueued_at: Date.now()
      };

      useStore.setState(s => ({
        branchQueues: {
          ...s.branchQueues,
          [effectiveBranchId]: [...(s.branchQueues[effectiveBranchId] || []), queueItem]
        }
      }));

      void useStore.getState().processBranchQueue(effectiveBranchId);
    }
    return Boolean(userMsg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleConfirmOps = async (proposal: NonNullable<typeof pendingOps>, confirmedPlan: ConfirmedExecutionPlan): Promise<boolean> => {
    if (useStore.getState().pendingOps !== proposal || confirmedPlan.plan.validated_mutations.length === 0) return false;
    const success = await executeConfirmedPlan(confirmedPlan);
    if (!success) return false;
    if (useStore.getState().pendingOps === proposal) clearPendingOps();
    getLatestReviewDraft().then(d => {
      if (d) deleteReviewDraft(d.id).catch(() => {});
    }).catch(() => {});
    const originalMessage = useStore.getState().messages.find(message => message.id === proposal.originalMessageId);
    addMessage('assistant', 'Confirmed and applied: Successfully executed '+confirmedPlan.plan.validated_mutations.length+' action(s).', undefined, null, originalMessage?.channelId || activeSessionId || 'general');
    return true;
  };

  const handleCancelOps = () => {
    clearPendingOps();
    getLatestReviewDraft().then(d => {
      if (d) deleteReviewDraft(d.id).catch(() => {});
    }).catch(() => {});
    const currentChannel = activeSessionId || 'general';
    addMessage(
      'assistant',
      'Proposal cancelled: No changes were applied.',
      undefined,
      null,
      currentChannel
    );
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
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-2xl m-2 bg-slate-900/20 backdrop-blur-sm">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-inner">
                  <Layers className="w-7 h-7" />
                </div>
                <h3 className="text-base font-semibold text-slate-200 mb-1">Knowledge Graph is Empty</h3>
                <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
                  Your goals, projects, tasks, habits, and events will dynamically connect here as an interactive visual network.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-all active:scale-95"
                  >
                    <Plus size={14} />
                    <span>Create Entity</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!hasAiApiKey()) {
                        addToast('Gemini API key required for AI generation. Configure in Settings or create manually.', 'info');
                        return;
                      }
                      if (!isChatOpen) setIsChatOpen(true);
                      sendDirectMessage("Create 3 starter goals and tasks for my productivity system");
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-xs font-medium transition-all active:scale-95"
                    title={hasAiApiKey() ? "Generate starter goals and tasks with Gemini" : "Gemini is not configured"}
                  >
                    <Sparkles size={14} className={hasAiApiKey() ? "text-indigo-400" : "text-slate-500"} />
                    <span>{hasAiApiKey() ? "Generate with AI" : "Generate with AI (Requires Key)"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <GraphView entities={safeEntities} relationships={relationships || []} />
            )}
          </div>
        );
      case 'analytics':
        return <AnalyticsView />;
      case 'goals':
        return <EntityList kinds={[EntityKind.GOAL]} schemaId="system/goal" capability="trackable_progress" title="Goals" />;
      case 'projects':
        return <EntityList kinds={[EntityKind.PROJECT]} title="Projects" />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'calendar':
        return <CalendarView />;
      case 'timeline':
        return <TimelineView entities={safeEntities} />;
      case 'schedules':
      case 'food':
      case 'attendance':
        return <Dashboard />;
      case 'settings':
        return <SettingsView />;
      case 'chat_graph':
      default:
        return (
          <div className="flex-1 flex flex-col bg-slate-950 p-4 relative h-full">
            {safeEntities.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-2xl m-2 bg-slate-900/20 backdrop-blur-sm">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-inner">
                  <Layers className="w-7 h-7" />
                </div>
                <h3 className="text-base font-semibold text-slate-200 mb-1">Knowledge Graph is Empty</h3>
                <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
                  Your goals, projects, tasks, habits, and events will dynamically connect here as an interactive visual network.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-all active:scale-95"
                  >
                    <Plus size={14} />
                    <span>Create Entity</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!hasAiApiKey()) {
                        addToast('Gemini API key required for AI generation. Configure in Settings or create manually.', 'info');
                        return;
                      }
                      if (!isChatOpen) setIsChatOpen(true);
                      sendDirectMessage("Create 3 starter goals and tasks for my productivity system");
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-xs font-medium transition-all active:scale-95"
                    title={hasAiApiKey() ? "Generate starter goals and tasks with Gemini" : "Gemini is not configured"}
                  >
                    <Sparkles size={14} className={hasAiApiKey() ? "text-indigo-400" : "text-slate-500"} />
                    <span>{hasAiApiKey() ? "Generate with AI" : "Generate with AI (Requires Key)"}</span>
                  </button>
                </div>
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
      className={`flex h-[100dvh] w-full bg-ideapad-base text-ideapad-text font-sans selection:bg-emerald-500/30 selection:text-emerald-200 overflow-hidden ${isMobile ? 'flex-col' : 'flex-row'}`}
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
        <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3 shrink-0 z-30">
          {/* Left: If chat view, show Back button, else hamburger */}
          {currentView === 'chat' ? (
            <button
              onClick={() => setView('dashboard')}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors flex items-center gap-1"
              aria-label="Back to dashboard"
            >
              <ChevronLeft size={20} />
              <span className="text-xs font-medium">Home</span>
            </button>
          ) : (
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu size={22} />
            </button>
          )}

          {/* Center: Dynamic Title based on current view */}
          <span className="font-bold text-base text-slate-100">
            {currentView === 'chat' ? 'Chat' :
              currentView === 'dashboard' ? 'Flowmate' :
                currentView === 'calendar' ? 'Calendar' :
                  currentView === 'knowledge' ? 'Library' :
                    currentView === 'analytics' ? 'Analytics' :
                      currentView === 'chat_graph' ? 'Graph' :
                        currentView === 'schedules' ? 'Schedules' :
                          currentView === 'food' ? 'Food' :
                            currentView === 'attendance' ? 'Attendance' :
                              currentView === 'settings' ? 'Settings' :
                                'Flowmate'}
          </span>

          {/* Right: Quick action */}
          {currentView !== 'chat' ? (
            <button
              onClick={() => setView('chat')}
              className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 transition-colors"
              aria-label="Open chat"
              title="Open Chat"
            >
              <MessageSquare size={19} />
            </button>
          ) : (
            <div className="w-12" />
          )}
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && isMobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={mobileSidebarRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            tabIndex={-1}
            className="fixed left-0 top-0 h-full w-64 bg-slate-900 border-r border-slate-800 z-50 shadow-2xl animate-slide-in-left flex flex-col overflow-hidden"
          >
            {/* Close Button Header */}
            <div className="p-3 border-b border-slate-800 flex items-center justify-end shrink-0">
              <button ref={mobileSidebarCloseRef} type="button" aria-label="Close navigation menu" onClick={() => setIsMobileSidebarOpen(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400">
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
            <WorkspaceStatus />
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
        <div data-layout="desktop" className="flex-1 flex flex-row h-full overflow-hidden">
          {/* Desktop Chat Panel - Full width when Chat view, otherwise side panel */}
          {(currentView === 'chat' || (isChatOpen && !isZenMode)) && (
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
              {/* Desktop Chat Header & Session Switcher */}
              <ChatSessionBar
                onCloseChat={() => setIsChatOpen(false)}
                showCloseButton={currentView !== 'chat'}
              />

              {restoredDraft && !pendingOps && (
                <div className="mx-3 my-2 p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-500/40 flex items-center justify-between text-xs animate-fade-in shadow-lg shrink-0">
                  <div className="flex items-center gap-2 text-indigo-200 min-w-0 mr-2">
                    <Sparkles size={14} className="text-indigo-400 shrink-0" />
                    <span className="truncate">
                      Restored draft ({restoredDraft.ops.length}): <span className="font-semibold text-slate-100">{restoredDraft.ops[0]?.payload?.title || 'Pending Actions'}</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[10px] text-emerald-400 font-mono shrink-0">
                      Revalidated
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={handleResumeDraft}
                      className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] transition-colors"
                    >
                      Review
                    </button>
                    <button
                      onClick={handleDiscardDraft}
                      className="px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 text-[11px] transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef} onScroll={handleChatScroll}>
                {(() => {
                  const currentChannel = activeSessionId || 'general';
                  const currentBranch = (branches || []).find(b => b.id === activeBranchId && (b.conversation_id === currentChannel));
                  const activeMsgs = resolveBranchHistory(messages || [], currentBranch?.head_message_id, currentChannel);
                  
                  if (activeMsgs.length === 0) {
                    return (
                      <div className="h-full flex flex-col items-center justify-center p-6 text-center my-auto min-h-[360px]">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-inner">
                          <Sparkles size={22} />
                        </div>
                        <h3 className="text-sm font-semibold text-slate-200 mb-1">Flowmate AI Assistant</h3>
                        <p className="text-xs text-slate-400 max-w-xs mb-5">
                          Schedule events, manage tasks, track meals, or talk in real-time.
                        </p>
                        <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
                          {contextualSuggestions.map((item, i) => (
                            <button
                              key={i}
                              onClick={() => handleSelectSuggestion(item)}
                              className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/30 text-left transition-all text-xs group active:scale-[0.98]"
                              title="Click to pre-fill prompt"
                            >
                              <span className="text-base shrink-0 p-1.5 rounded-lg bg-slate-700/50 group-hover:bg-indigo-500/20 transition-colors">{item.icon}</span>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-slate-300 group-hover:text-indigo-300 transition-colors truncate">{item.label}</div>
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">{item.prompt}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return activeMsgs.map((msg) => (
                    <div key={msg.id} data-message-id={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 self-start mt-0.5 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                        {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                      </div>
                      <div className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {renderAttachmentPreview(msg)}
                        <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${msg.role === 'user'
                          ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/20 rounded-tr-sm'
                          : 'bg-slate-800 border border-slate-700 rounded-tl-sm text-slate-200'
                          }`}>
                          {msg.role === 'assistant' && msg.turn_metadata?.response_source && <p className="text-[10px] text-slate-400 mb-1">{msg.turn_metadata.response_source === 'unavailable' ? 'No AI response · provider not configured' : msg.turn_metadata.response_source === 'local' ? 'Local rules · no AI request' : 'Gemini response'}</p>}
                          {msg.text ? <MarkdownText content={msg.text} /> : (isStreaming && msg.id === useStore.getState().streamingMessageId ? <span className="text-slate-400 italic">Thinking...</span> : <em className="text-slate-400">Attachment</em>)}
                          {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <MessageVersionNav message={msg} />
                          <span className="text-[9px] text-slate-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
                {loading && !isStreaming && (
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
                    <LiveVoiceModal 
                      onClose={() => setIsLiveMode(false)} 
                      onFallbackToChat={(draftText) => {
                        if (draftText) setInput(draftText);
                        setIsLiveMode(false);
                      }}
                    />
                  </Suspense>
                ) : (
                  <UnifiedChatInput
                    value={input}
                    onChange={setInput}
                    textareaRef={chatInputRef}
                    onSend={(msg) => sendDirectMessage(msg, selectedAttachment)}
                    onAttach={(file) => processFile(file)}
                    onLiveVoice={() => setIsLiveMode(true)}
                    onStop={handleStopGeneration}
                    isStreaming={isStreaming}
                    queueCount={(branchQueues?.[activeBranchId] || []).filter(q => q.status === 'queued' || q.status === 'leased').length}
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

      {/* Mobile Layout: Full Content + Persistent Bottom Navigation */}
      {isMobile && (
        <div data-layout="mobile" className="flex-1 flex flex-col h-[calc(100dvh-3.5rem)] overflow-hidden relative">
          {/* Main content or full screen chat */}
          <div className="flex-1 flex flex-col overflow-hidden pb-14">
            {currentView === 'chat' ? (
              <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
                <ChatSessionBar />

                {restoredDraft && !pendingOps && (
                  <div className="mx-3 my-2 p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-500/40 flex items-center justify-between text-xs animate-fade-in shadow-lg shrink-0">
                    <div className="flex items-center gap-2 text-indigo-200 min-w-0 mr-2">
                      <Sparkles size={14} className="text-indigo-400 shrink-0" />
                      <span className="truncate">
                        Restored draft ({restoredDraft.ops.length}): <span className="font-semibold text-slate-100">{restoredDraft.ops[0]?.payload?.title || 'Pending Actions'}</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[10px] text-emerald-400 font-mono shrink-0">
                        Revalidated
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={handleResumeDraft}
                        className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] transition-colors"
                      >
                        Review
                      </button>
                      <button
                        onClick={handleDiscardDraft}
                        className="px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 text-[11px] transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={!isMobile ? undefined : scrollRef} onScroll={handleChatScroll}>
                  {(() => {
                    const currentChannel = activeSessionId || 'general';
                    const currentBranch = (branches || []).find(b => b.id === activeBranchId && (b.conversation_id === currentChannel));
                    const activeMsgs = resolveBranchHistory(messages || [], currentBranch?.head_message_id, currentChannel);

                    if (activeMsgs.length === 0) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center my-auto min-h-[300px]">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3 text-indigo-400 shadow-inner">
                            <Sparkles size={22} />
                          </div>
                          <h3 className="text-sm font-semibold text-slate-200 mb-1">Flowmate AI Assistant</h3>
                          <p className="text-xs text-slate-400 max-w-xs mb-4">
                            Schedule events, manage tasks, track meals, or talk in real-time.
                          </p>
                          <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
                            {contextualSuggestions.map((item, i) => (
                              <button
                                key={i}
                                onClick={() => handleSelectSuggestion(item)}
                                className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-800 text-left transition-all text-xs active:scale-[0.98]"
                                title="Tap to pre-fill prompt"
                              >
                                <span className="text-base shrink-0 p-1 rounded-lg bg-slate-700/50">{item.icon}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-slate-300 truncate">{item.label}</div>
                                  <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.prompt}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    return activeMsgs.map((msg) => (
                      <div key={msg.id} data-message-id={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                          {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                        </div>
                        <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          {renderAttachmentPreview(msg)}
                          <div className={`px-3 py-2 rounded-xl text-sm ${msg.role === 'user' ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/20' : 'bg-slate-800 border border-slate-700 text-slate-200'}`}>
                            {msg.role === 'assistant' && msg.turn_metadata?.response_source && <p className="text-[10px] text-slate-400 mb-1">{msg.turn_metadata.response_source === 'unavailable' ? 'No AI response · provider not configured' : msg.turn_metadata.response_source === 'local' ? 'Local rules · no AI request' : 'Gemini response'}</p>}
                          {msg.text ? <MarkdownText content={msg.text} /> : (isStreaming && msg.id === useStore.getState().streamingMessageId ? <span className="text-slate-400 italic">Thinking...</span> : <em className="text-slate-400">Attachment</em>)}
                            {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <MessageVersionNav message={msg} />
                            <span className="text-[9px] text-slate-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>
                    ));
                  })()}
                  {loading && !isStreaming && (
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
                <div className="p-2.5 bg-slate-900 border-t border-slate-800 shrink-0">
                  {isLiveMode ? (
                    <Suspense fallback={<div className="p-3 text-center text-xs text-slate-400">Loading Gemini Live...</div>}>
                      <LiveVoiceModal 
                        onClose={() => setIsLiveMode(false)} 
                        onFallbackToChat={(draftText) => {
                          if (draftText) setInput(draftText);
                          setIsLiveMode(false);
                        }}
                      />
                    </Suspense>
                  ) : (
                    <UnifiedChatInput
                      value={input}
                      onChange={setInput}
                      textareaRef={chatInputRef}
                      onSend={(msg) => sendDirectMessage(msg, selectedAttachment)}
                      onAttach={(file) => processFile(file)}
                      onLiveVoice={() => setIsLiveMode(true)}
                      onStop={handleStopGeneration}
                      isStreaming={isStreaming}
                      queueCount={(branchQueues?.[activeBranchId] || []).filter(q => q.status === 'queued' || q.status === 'leased').length}
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
              <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <div className="flex-1 overflow-auto">
                  <Suspense fallback={<LazyLoadFallback />}>
                    {renderMainContent()}
                  </Suspense>
                </div>
              </main>
            )}
          </div>

          {/* Persistent Mobile Bottom Navigation Bar with tactile animations */}
          <nav className="fixed bottom-0 left-0 right-0 h-14 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/80 flex items-center justify-around px-2 z-30 shadow-2xl safe-area-bottom" aria-label="Mobile Navigation">
            <button
              onClick={() => setView('dashboard')}
              aria-current={currentView === 'dashboard' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-medium transition-all active:scale-95 ${
                currentView === 'dashboard' ? 'text-indigo-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard size={18} className={currentView === 'dashboard' ? 'stroke-[2.5]' : ''} />
              <span className="mt-0.5">Home</span>
            </button>
            <button
              onClick={() => setView('chat')}
              aria-current={currentView === 'chat' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-medium transition-all active:scale-95 ${
                currentView === 'chat' ? 'text-indigo-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare size={18} className={currentView === 'chat' ? 'stroke-[2.5]' : ''} />
              <span className="mt-0.5">Chat</span>
            </button>
            <button
              onClick={() => setView('chat_graph')}
              aria-current={currentView === 'chat_graph' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-medium transition-all active:scale-95 ${
                currentView === 'chat_graph' ? 'text-indigo-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers size={18} className={currentView === 'chat_graph' ? 'stroke-[2.5]' : ''} />
              <span className="mt-0.5">Graph</span>
            </button>
            <button
              onClick={() => setView('calendar')}
              aria-current={currentView === 'calendar' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-medium transition-all active:scale-95 ${
                currentView === 'calendar' ? 'text-indigo-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar size={18} className={currentView === 'calendar' ? 'stroke-[2.5]' : ''} />
              <span className="mt-0.5">Calendar</span>
            </button>
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-medium text-slate-400 hover:text-slate-200 transition-all active:scale-95"
            >
              <Menu size={18} />
              <span className="mt-0.5">More</span>
            </button>
          </nav>
        </div>
      )}

      {/* Overlays and Modals */}
      {selectedEntityId && <EntityDetailPanel />}

      {pendingOps && (
        <OpsPreviewForm
          key={pendingOps.reviewId}
          ops={pendingOps.ops}
          onConfirm={(confirmedPlan) => handleConfirmOps(pendingOps, confirmedPlan)}
          onCancel={handleCancelOps}
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

      <CommandPalette onSendToChat={text => { const draft = useStore.getState().getUnsentDraft(useStore.getState().activeBranchId); setInput(draft ? draft + '\n' + text : text); setView('chat'); requestAnimationFrame(() => chatInputRef.current?.focus()); }} />
      <FocusTimer />
      <DebugConsole onOpenGraphFixer={() => setShowGraphFixingModal(true)} />
      <ToastNotification />
      {import.meta.env.DEV && <DeveloperModeDrawer />}
    </div>
  );
};

export default App;
