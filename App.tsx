import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useStore } from './store';
import { getActiveEntities, getActiveChatSessions, isChatSessionActive } from './store/helpers';
import { orchestrateMessage, generateContextualSuggestions, getInstantContextualSuggestions, type ContextualSuggestion } from './services/ai';
import { hasAiApiKey, hasAiProviderAvailable } from './services/ai/client';
import { processFileAttachment } from './utils/imageProcessing';
import { completeGoogleRedirectSignIn, onAuthChange, signOut } from './services/firebase';
import { initializeSync, setWorkspaceCloudSyncConsent as setSyncWorkspaceCloudSyncConsent, cleanupSync, forceSync, scheduleSync, syncFoodLogsToCloud, syncAttendanceToCloud, syncMessage } from './services/syncManager';
import { mergeData, mergeMessages, mergeChatSessions, mergeCloudSettings } from './services/firestoreSync';
import { hasWorkspaceCloudSyncConsent, subscribeToWorkspaceCloudSyncConsent } from './services/workspaceSyncConsent';
import { preventDoubleClick } from './utils/debounce';
import { Send, Bot, User, RefreshCw, Cloud, CheckCircle2, Loader2, Mic, Paperclip, X, FileAudio, Activity, Plus, Link, Calendar, PanelLeftClose, Upload, PanelLeftOpen, MessageSquare, LogOut, UserCircle, Menu, ChevronLeft, ChevronDown, Utensils, IndianRupee, Table2, Layers, Sparkles, LayoutDashboard, Settings, Library } from 'lucide-react';
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
import { ManagedRequestNotice } from './components/ManagedRequestNotice';
import { DeveloperModeDrawer } from './components/DeveloperModeDrawer';
import { resolveBranchHistory } from './utils/conversationGraph';
import { EntityKind, ToonOperation, ChatSession, Entity, TurnExecutor, BranchQueueItem, ViewType } from './types';
import { v4 as uuidv4 } from 'uuid';
import { ConfirmedExecutionPlan } from './services/kernel';

import { reconcileEntityCollection, globalPendingMutationQueue } from './services/sync';
import { projectKernelEntitiesToLegacy } from './store/kernelProjection';
import { setupCrossTabSync } from './services/storage';
import { getLatestReviewDraft, deleteReviewDraft, revalidateReviewDraft, type ReviewDraft } from './services/action-review';
import { mobileGestureThreshold, mobileSidebarCloseThreshold, mobileSidebarOpenThreshold, resolveMobileGestureIntent } from './utils/mobileNavigationGestures';
import OnboardingFlow from './components/OnboardingFlow';
import { buildOnboardingChatDraft, hasCompletedOnboarding } from './services/onboardingProfile';
import { getManagedAiLimitCopy, type ManagedAiLimitCode } from './services/ai/managedAiLimitCopy';

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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [managedAiLimit, setManagedAiLimit] = useState<ManagedAiLimitCode | null>(null);
  const managedAiDialogRef = useRef<HTMLElement | null>(null);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [mobileSidebarDragX, setMobileSidebarDragX] = useState(0);
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  const mobileSidebarCloseRef = useRef<HTMLButtonElement>(null);
  const mobileSidebarGestureRef = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  const suppressSidebarClickRef = useRef(false);
  const mobileNavigationLockUntilRef = useRef(0);
  const mobileSidebarCloseTimerRef = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobileGestureOffset, setMobileGestureOffset] = useState({ x: 0, y: 0 });
  const [isMobileRefreshing, setIsMobileRefreshing] = useState(false);
  const lastNonChatViewRef = useRef<ViewType>(currentView === 'chat' ? 'dashboard' : currentView);
  const mobileCurrentViewRef = useRef<ViewType>(currentView);
  const mobileTouchStartRef = useRef<{
    touchId: number;
    gestureTarget: Element | null;
    x: number;
    y: number;
    startX: number;
    startedAtTop: boolean;
    canNavigateToChat: boolean;
    canReturnToView: boolean;
    canOpenSidebar: boolean;
    sidebarDragActive: boolean;
  } | null>(null);

  useEffect(() => () => {
    if (mobileSidebarCloseTimerRef.current !== null) window.clearTimeout(mobileSidebarCloseTimerRef.current);
  }, []);

  useEffect(() => {
    mobileCurrentViewRef.current = currentView;
    if (currentView !== 'chat') lastNonChatViewRef.current = currentView;
  }, [currentView]);

  const getMobileReturnView = () => lastNonChatViewRef.current === 'chat'
    ? 'dashboard' as ViewType
    : lastNonChatViewRef.current;

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
    const ctx = { entities: getActiveEntities(entities), foodLogs, subjects, timezone: settings.timezone };
    setContextualSuggestions(getInstantContextualSuggestions(ctx));
    generateContextualSuggestions(ctx).then(res => {
      if (res && res.length > 0) setContextualSuggestions(res);
    }).catch(err => console.warn('[App] Suggestions generation failed:', err));
  }, [entities.length, foodLogs?.length, subjects?.length, settings.timezone]);

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

  const handleMobileTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || Date.now() < mobileNavigationLockUntilRef.current || isMobileSidebarOpen || loading || isStreaming || isLiveMode) {
      mobileTouchStartRef.current = null;
      return;
    }
    if (event.touches.length !== 1) {
      mobileTouchStartRef.current = null;
      setMobileGestureOffset({ x: 0, y: 0 });
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (
      !target ||
      target.closest('button, a, input, textarea, select, svg, canvas, [contenteditable="true"], [role="dialog"], [data-mobile-gesture-lock], [data-graph-drag], [data-swipe-lock]')
    ) return;

    const touch = event.touches[0];
    // Pull-to-refresh is only armed when every scrollable ancestor is at its
    // top. Looking only for the nearest app marker misfires in nested scroll
    // regions and on components that use their own overflow container.
    let node: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
    let startedAtTop = true;
    while (node && node !== event.currentTarget.parentElement) {
      const style = window.getComputedStyle(node);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      if (scrollable && node.scrollTop > 0) startedAtTop = false;
      node = node.parentElement;
    }
    const activeView = mobileCurrentViewRef.current;
    mobileTouchStartRef.current = {
      touchId: touch.identifier,
      gestureTarget: target,
      x: touch.clientX,
      y: touch.clientY,
      startX: touch.clientX,
      startedAtTop,
      canNavigateToChat: activeView !== 'chat',
      canReturnToView: activeView === 'chat',
      canOpenSidebar: activeView !== 'chat',
      sidebarDragActive: false,
    };
  };

  const handleMobileTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileTouchStartRef.current;
    if (!start) return;
    const selection = document.getSelection();
    const selectionIntersectsTouchTarget = Boolean(
      selection && !selection.isCollapsed && selection.rangeCount > 0 && start.gestureTarget
      && selection.getRangeAt(0).intersectsNode(start.gestureTarget),
    );
    if (selectionIntersectsTouchTarget) {
      mobileTouchStartRef.current = null;
      setMobileGestureOffset({ x: 0, y: 0 });
      return;
    }
    if (event.touches.length !== 1) {
      mobileTouchStartRef.current = null;
      setMobileGestureOffset({ x: 0, y: 0 });
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    const isPullingDown = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2 && start.startedAtTop;

    if (isHorizontal && deltaX > 0 && start.canOpenSidebar) {
      // Reveal the real drawer over a stationary page. The page itself only
      // slides for Chat navigation, which has a separate destination preview.
      if (deltaX > 8) {
        start.sidebarDragActive = true;
        setIsMobileSidebarOpen(true);
        setMobileSidebarDragX(Math.min(0, -256 + deltaX));
      }
      setMobileGestureOffset({ x: 0, y: 0 });
    } else if (isHorizontal && ((deltaX < 0 && start.canNavigateToChat) || (deltaX > 0 && start.canReturnToView))) {
      const dragLimit = Math.max(150, window.innerWidth * 0.78);
      setMobileGestureOffset({ x: Math.max(-dragLimit, Math.min(dragLimit, deltaX * 0.94)), y: 0 });
    } else if (isPullingDown && !loading && !isStreaming && !isLiveMode) {
      // Keep the release state reachable: the previous 44px visual cap was
      // below the 47px arm point on a 390px viewport, so it could never say
      // "Release to update" even though the gesture itself could commit.
      setMobileGestureOffset({ x: 0, y: Math.min(88, deltaY * 0.72) });
    } else {
      setMobileGestureOffset({ x: 0, y: 0 });
    }
  };

  const finishMobileGesture = (deltaX: number, deltaY: number) => {
    const start = mobileTouchStartRef.current;
    mobileTouchStartRef.current = null;
    if (!start) {
      setMobileGestureOffset({ x: 0, y: 0 });
      return;
    }

    if (start.sidebarDragActive) {
      mobileNavigationLockUntilRef.current = Date.now() + 300;
      const shouldOpen = deltaX >= mobileSidebarOpenThreshold(window.innerWidth) && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (shouldOpen) {
        mobileNavigationLockUntilRef.current = Date.now() + 260;
        setIsMobileSidebarOpen(true);
        setMobileSidebarDragX(0);
      } else {
        setMobileSidebarDragX(-256);
        mobileSidebarCloseTimerRef.current = window.setTimeout(() => {
          setIsMobileSidebarOpen(false);
          setMobileSidebarDragX(0);
          mobileSidebarCloseTimerRef.current = null;
        }, 180);
      }
      return;
    }

    const intent = resolveMobileGestureIntent({
      deltaX,
      deltaY,
      startX: start.startX,
      startedAtTop: start.startedAtTop,
      canNavigateToChat: start.canNavigateToChat,
      canReturnToView: start.canReturnToView,
      canOpenSidebar: start.canOpenSidebar,
      distanceThresholdPx: start.canOpenSidebar
        ? mobileSidebarOpenThreshold(window.innerWidth)
        : mobileGestureThreshold(window.innerWidth),
    });
    setMobileGestureOffset({ x: 0, y: 0 });
    if (intent === 'open-menu') {
      mobileNavigationLockUntilRef.current = Date.now() + 260;
      openMobileSidebar();
    }
    if (intent === 'open-chat') {
      // Keep a short settle window beyond the 220ms page transition so a
      // rapid reverse drag cannot race the view swap / gesture preview.
      mobileNavigationLockUntilRef.current = Date.now() + 560;
      const activeView = mobileCurrentViewRef.current;
      if (activeView !== 'chat') lastNonChatViewRef.current = activeView;
      mobileCurrentViewRef.current = 'chat';
      setView('chat');
    }
    if (intent === 'return-view') {
      mobileNavigationLockUntilRef.current = Date.now() + 560;
      const destination = getMobileReturnView();
      lastNonChatViewRef.current = destination;
      mobileCurrentViewRef.current = destination;
      setView(destination);
    }
    if (intent === 'refresh' && !loading && !isStreaming && !isLiveMode) {
      try {
        sessionStorage.setItem('flowmate-mobile-refresh-draft', input);
      } catch {
        setIsMobileRefreshing(false);
        addToast('Refresh cancelled because this browser could not preserve the chat draft.', 'warning');
        return;
      }
      setIsMobileRefreshing(true);
      window.setTimeout(() => window.location.reload(), 240);
    }
  };

  const handleMobileTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileTouchStartRef.current;
    const touch = start && Array.from(event.changedTouches).find(item => item.identifier === start.touchId);
    if (start && touch) finishMobileGesture(touch.clientX - start.x, touch.clientY - start.y);
  };

  const handleMobileTouchCancel = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileTouchStartRef.current;
    if (start && !Array.from(event.changedTouches).some(item => item.identifier === start.touchId)) return;
    mobileTouchStartRef.current = null;
    setMobileGestureOffset({ x: 0, y: 0 });
  };

  const openMobileSidebar = () => {
    if (mobileSidebarCloseTimerRef.current !== null) {
      window.clearTimeout(mobileSidebarCloseTimerRef.current);
      mobileSidebarCloseTimerRef.current = null;
    }
    mobileNavigationLockUntilRef.current = Date.now() + 300;
    setMobileSidebarDragX(-256);
    setIsMobileSidebarOpen(true);
    window.requestAnimationFrame(() => setMobileSidebarDragX(0));
  };

  const navigateFromMobileControl = (view: ViewType) => {
    // An explicit tap is a fresh, unambiguous navigation action. It should
    // clear the short gesture-settling lock so a following swipe can begin.
    mobileNavigationLockUntilRef.current = 0;
    if (view !== 'chat') lastNonChatViewRef.current = view;
    else if (mobileCurrentViewRef.current !== 'chat') lastNonChatViewRef.current = mobileCurrentViewRef.current;
    mobileCurrentViewRef.current = view;
    setView(view);
  };

  // The fixed mobile header sits outside the page gesture surface. Track edge
  // swipes there too, so starting beside the hamburger does not silently miss.
  const handleMobileHeaderTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!isMobile || Date.now() < mobileNavigationLockUntilRef.current || isMobileSidebarOpen || loading || isStreaming || isLiveMode || event.touches.length !== 1 || !touch) {
      mobileTouchStartRef.current = null;
      return;
    }
    mobileTouchStartRef.current = {
      touchId: touch.identifier,
      gestureTarget: event.target instanceof Element ? event.target : null,
      x: touch.clientX,
      y: touch.clientY,
      startX: touch.clientX,
      startedAtTop: false,
      canNavigateToChat: mobileCurrentViewRef.current !== 'chat',
      canReturnToView: mobileCurrentViewRef.current === 'chat',
      canOpenSidebar: mobileCurrentViewRef.current !== 'chat',
      sidebarDragActive: false,
    };
  };

  const handleMobileHeaderTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileTouchStartRef.current;
    const touch = start && Array.from(event.changedTouches).find(item => item.identifier === start.touchId);
    if (start && touch) {
      const deltaX = touch.clientX - start.startX;
      const deltaY = touch.clientY - start.y;
      const commitThreshold = currentView === 'chat'
        ? mobileGestureThreshold(window.innerWidth)
        : mobileSidebarOpenThreshold(window.innerWidth);
      if (deltaX >= commitThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) event.preventDefault();
      finishMobileGesture(deltaX, deltaY);
    }
  };

  const handleMobileSidebarTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (Date.now() < mobileNavigationLockUntilRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target instanceof Element ? event.target : null;
    // Navigation rows are the main usable swipe surface in the drawer, so a
    // horizontal drag may begin on a button. Keep text-entry and explicit
    // gesture-locked controls native.
    if (target?.closest('input, textarea, select, [data-swipe-lock]')) {
      return;
    }
    suppressSidebarClickRef.current = false;
    mobileSidebarGestureRef.current = { x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastY: touch.clientY };
  };

  const handleMobileSidebarTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileSidebarGestureRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    start.lastX = touch.clientX;
    start.lastY = touch.clientY;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaX < -8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      suppressSidebarClickRef.current = true;
      setMobileSidebarDragX(Math.max(-256, deltaX));
    } else {
      setMobileSidebarDragX(0);
    }
  };

  const finishMobileSidebarGesture = (touch?: Pick<Touch, 'clientX' | 'clientY'>) => {
    const start = mobileSidebarGestureRef.current;
    mobileSidebarGestureRef.current = null;
    if (!start) {
      setMobileSidebarDragX(0);
      return;
    }
    const end = touch || { clientX: start.lastX, clientY: start.lastY };
    const intent = resolveMobileGestureIntent({
      deltaX: end.clientX - start.x,
      deltaY: end.clientY - start.y,
      startX: start.x,
      startedAtTop: false,
      canNavigateToChat: false,
      isSidebarOpen: true,
      startedInSidebar: true,
      distanceThresholdPx: mobileSidebarCloseThreshold(window.innerWidth),
    });
    if (intent === 'close-menu') {
      mobileNavigationLockUntilRef.current = Date.now() + 300;
      setMobileSidebarDragX(-256);
      suppressSidebarClickRef.current = true;
      mobileSidebarCloseTimerRef.current = window.setTimeout(() => {
        setIsMobileSidebarOpen(false);
        setMobileSidebarDragX(0);
        suppressSidebarClickRef.current = false;
        mobileSidebarCloseTimerRef.current = null;
      }, 180);
      return;
    }
    setMobileSidebarDragX(0);
    window.setTimeout(() => { suppressSidebarClickRef.current = false; }, 300);
  };

  const handleMobileSidebarTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (mobileSidebarGestureRef.current && touch) finishMobileSidebarGesture(touch);
  };

  const handleMobileSidebarTouchCancel = () => {
    if (!mobileSidebarGestureRef.current) return;
    mobileSidebarGestureRef.current = null;
    setMobileSidebarDragX(0);
  };

  useEffect(() => {
    try {
      const savedDraft = sessionStorage.getItem('flowmate-mobile-refresh-draft');
      if (savedDraft !== null) {
        setInput(savedDraft);
        sessionStorage.removeItem('flowmate-mobile-refresh-draft');
      }
    } catch {
      // Draft restoration is best effort when browser storage is unavailable.
    }
  }, [setInput]);

  useEffect(() => {
    if (!managedAiLimit) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = managedAiDialogRef.current;
    const actions = dialog?.querySelectorAll<HTMLElement>('button');
    actions?.[1]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setManagedAiLimit(null);
      } else if (event.key === 'Tab' && actions?.length) {
        const first = actions[0];
        const last = actions[actions.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [managedAiLimit]);


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
      const paneLeft = chatPaneRef.current?.getBoundingClientRect().left ?? 224;
      const newWidth = e.clientX - paneLeft;
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

  // Auth State Listener + Sync Integration
  useEffect(() => {
    void completeGoogleRedirectSignIn().then(result => {
      if (result.error) addToast('Google sign-in could not be completed. Please try again.', 'error');
    });
    const unsubscribe = onAuthChange((user) => {
      setCurrentUser(user);
      setAuthResolved(true);
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
            if (remoteData.initialReadFailed) {
              useStore.setState({ syncStatus: 'error', syncError: 'Could not load cloud workspace' });
              return;
            }
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
              ...(remoteData.settings ? { settings: mergeCloudSettings(state.settings, remoteData.settings) as typeof state.settings } : {}),
              ...(remoteData.foodLogs?.length ? { foodLogs: remoteData.foodLogs } : {}),
              ...(remoteData.subjects?.length ? { subjects: remoteData.subjects } : {}),
              ...(remoteData.classSchedule?.length ? { classSchedule: remoteData.classSchedule } : {}),
              ...(remoteData.holidays?.length ? { holidays: remoteData.holidays } : {}),
              ...(remoteData.attendanceLogs?.length ? { attendanceLogs: remoteData.attendanceLogs } : {}),
            });

            // Only an explicit opt-in permits initial cloud reads or a seed
            // upload. If this is a genuinely empty account, preserve the old
            // local-first merge behavior and seed through the same gated queue.
            if (remoteData.isInitialLoad && !useStore.getState().isDemoMode &&
                (!remoteData.entities || remoteData.entities.length === 0) && merged.entities.length > 0) {
              scheduleSync(() => ({
                entities: merged.entities,
                relationships: merged.relationships,
                universalTags: remoteData.universalTags || state.universalTags,
                settings: state.settings,
              }));
            }
          },
          hasWorkspaceCloudSyncConsent(user.uid),
        );
      } else {
        cleanupSync();
      }
    });
    return () => {
      unsubscribe();
      cleanupSync();
    };
  }, [setCurrentUser, loadFromCloud, addToast]);

  // Consent changes are local, identity-scoped events. Revoke stops listeners
  // and debounced uploads immediately; enabling triggers a gated initial read.
  useEffect(() => subscribeToWorkspaceCloudSyncConsent(({ uid, enabled }) => {
    if (useStore.getState().currentUser?.uid !== uid) return;
    setSyncWorkspaceCloudSyncConsent(enabled);
    useStore.setState({ syncError: null, syncStatus: enabled ? 'syncing' : 'idle' });
  }), []);

  const onboardingIdentity = currentUser?.uid || 'guest';
  useEffect(() => {
    if (!isHydrated || !authResolved) return;
    const deepLinked = Boolean(window.location.hash && !['#', '#dashboard'].includes(window.location.hash));
    if (deepLinked || currentView !== 'dashboard') return;
    setShowOnboarding(!hasCompletedOnboarding(onboardingIdentity));
  }, [isHydrated, authResolved, onboardingIdentity, currentView]);

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

    const unsubscribeConsent = subscribeToWorkspaceCloudSyncConsent(({ uid, enabled }) => {
      if (enabled || useStore.getState().currentUser?.uid !== uid) return;
      if (foodDebounce) clearTimeout(foodDebounce);
      if (attDebounce) clearTimeout(attDebounce);
      foodDebounce = null;
      attDebounce = null;
    });

    return () => {
      unsub();
      unsubscribeConsent();
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
      const validViews = [
        'dashboard', 'chat', 'chat_graph', 'analytics', 'goals',
        'projects', 'knowledge', 'calendar', 'schedules',
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
      const branchHistory = resolveBranchHistory(state.messages || [], userMessage.id, channelId);
      const currentHistory = userMessage.turn_metadata?.context_recovery === 'recent'
        ? branchHistory.slice(-12)
        : branchHistory;

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

        if (toon.provider === 'unavailable' || toon.provider === 'managed-limited') {
          // Keep the reason beside this exact submission as durable metadata,
          // but never turn a rejection into assistant content or a later turn.
          const failureOutcome = toon.failureOutcome || 'uncertain';
          useStore.setState(current => ({
            messages: current.messages.map(message =>
              message.id === assistantMessageId
                ? { ...message, text: '', status: 'failed' as const, turn_metadata: { ...message.turn_metadata, response_source: 'unavailable' } }
                : message.id === userMessage.id
                  ? { ...message, status: failureOutcome === 'uncertain' ? 'interrupted' as const : 'failed' as const, turn_metadata: { ...message.turn_metadata, managed_failure: { code: toon.failureCode || 'GENERATION_FAILED', outcome: failureOutcome, recorded_at: new Date().toISOString() } } }
                  : message
            ),
            branches: current.branches.map(branch => branch.id === branchId && branch.head_message_id === assistantMessageId
              ? { ...branch, head_message_id: userMessage.id, updated_at: new Date().toISOString() }
              : branch),
          }));
          const failedTurnState = useStore.getState();
          if (!failedTurnState.isDemoMode) {
            for (const failedMessage of failedTurnState.messages.filter(message => message.id === assistantMessageId || message.id === userMessage.id)) {
              void syncMessage(failedMessage).catch(error => console.warn('[App] Failed-turn history sync failed:', error));
            }
          }
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
          model: toon.provider === 'managed' || toon.provider === 'byok' ? toon.model : undefined,
          reasoning_level: toon.reasoningLevel,
          response_source: toon.provider === 'managed' || toon.provider === 'byok' ? 'gemini' : 'unavailable',
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

    const accepted = sendDirectMessage(userText, attachment);
    if (!accepted) return;
    setInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  // Direct send function for UnifiedChatInput - bypasses state sync issues
  // Includes rate limiting to prevent API abuse while allowing queued follow-ups
  const sendDirectMessage = (text: string, attachment?: string | null): boolean => {
    if (!text.trim() && !attachment) return false;

    // Rate limiting: prevent rapid-fire API calls within cooldown
    const now = Date.now();
    if (hasAiProviderAvailable() && now - lastApiCallRef.current < API_COOLDOWN_MS) {
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
        owner_uid: useStore.getState().currentUser?.uid ?? 'local',
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
        return <Dashboard onManagedAiLimit={setManagedAiLimit} onRequestSignIn={() => setShowAuthModal(true)} />;
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
                      if (!hasAiProviderAvailable()) {
                        addToast('Sign in for included AI access or configure your own Gemini key in Settings.', 'info');
                        return;
                      }
                      if (!isChatOpen) setIsChatOpen(true);
                      sendDirectMessage("Create 3 starter goals and tasks for my productivity system");
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-xs font-medium transition-all active:scale-95"
                    title={hasAiProviderAvailable() ? "Generate starter goals and tasks with Gemini" : "Sign in for included AI or configure a Gemini key"}
                  >
                    <Sparkles size={14} className={hasAiProviderAvailable() ? "text-indigo-400" : "text-slate-500"} />
                    <span>{hasAiProviderAvailable() ? "Generate with AI" : "Generate with AI (Sign in or add a key)"}</span>
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
      case 'schedules':
      case 'food':
      case 'attendance':
        return <Dashboard />;
      case 'settings':
        return <SettingsView onShowOnboarding={() => setShowOnboarding(true)} />;
      case 'chat_graph':
      default:
        return (
          <div className="flex-1 flex flex-col bg-slate-950 relative h-full min-w-0">
            {safeEntities.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 bg-slate-900/20 backdrop-blur-sm">
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
                      if (!hasAiProviderAvailable()) {
                        addToast('Sign in for included AI access or configure your own Gemini key in Settings.', 'info');
                        return;
                      }
                      if (!isChatOpen) setIsChatOpen(true);
                      sendDirectMessage("Create 3 starter goals and tasks for my productivity system");
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-xs font-medium transition-all active:scale-95"
                    title={hasAiProviderAvailable() ? "Generate starter goals and tasks with Gemini" : "Sign in for included AI or configure a Gemini key"}
                  >
                    <Sparkles size={14} className={hasAiProviderAvailable() ? "text-indigo-400" : "text-slate-500"} />
                    <span>{hasAiProviderAvailable() ? "Generate with AI" : "Generate with AI (Sign in or add a key)"}</span>
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
        <div
          className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3 shrink-0 z-30"
          onTouchStart={handleMobileHeaderTouchStart}
          onTouchMove={handleMobileTouchMove}
          onTouchEnd={handleMobileHeaderTouchEnd}
          onTouchCancel={handleMobileTouchCancel}
          style={{ touchAction: 'pan-y' }}
        >
          {/* Left: If chat view, show Back button, else hamburger */}
          {currentView === 'chat' ? (
            <button
              onClick={() => navigateFromMobileControl(lastNonChatViewRef.current)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors flex items-center gap-1"
              aria-label={`Back to ${lastNonChatViewRef.current === 'dashboard' ? 'Home' : lastNonChatViewRef.current === 'knowledge' ? 'Library' : lastNonChatViewRef.current}`}
            >
              <ChevronLeft size={20} />
              <span className="text-xs font-medium">{lastNonChatViewRef.current === 'dashboard' ? 'Home' : lastNonChatViewRef.current === 'knowledge' ? 'Library' : lastNonChatViewRef.current}</span>
            </button>
          ) : (
            <button
              onClick={openMobileSidebar}
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
              onClick={() => navigateFromMobileControl('chat')}
              className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 transition-colors"
              aria-label="Open chat"
              title="Open Chat"
            >
              <MessageSquare size={19} />
            </button>
          ) : (
            <button
              onClick={openMobileSidebar}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              aria-label="Open navigation menu"
              title="Open navigation menu"
            >
              <Menu size={22} />
            </button>
          )}
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && isMobileSidebarOpen && (
        <>
          <div
            data-testid="mobile-sidebar-backdrop"
            className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
            onTouchStart={handleMobileSidebarTouchStart}
            onTouchMove={handleMobileSidebarTouchMove}
            onTouchEnd={handleMobileSidebarTouchEnd}
            onTouchCancel={handleMobileSidebarTouchCancel}
            onClick={event => {
              if (suppressSidebarClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressSidebarClickRef.current = false;
                return;
              }
              setIsMobileSidebarOpen(false);
            }}
            style={{ opacity: Math.max(0, 1 - Math.abs(mobileSidebarDragX) / 280) }}
            aria-hidden="true"
          />
          <div
            ref={mobileSidebarRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            tabIndex={-1}
            className="fixed left-0 top-0 h-full w-64 bg-ideapad-surface border-r border-ideapad-border z-50 shadow-2xl flex flex-col overflow-hidden"
            onTouchStart={handleMobileSidebarTouchStart}
            onTouchMove={handleMobileSidebarTouchMove}
            onTouchEnd={handleMobileSidebarTouchEnd}
            onTouchCancel={handleMobileSidebarTouchCancel}
            style={{
              transform: `translate3d(${mobileSidebarDragX}px, 0, 0)`,
              transition: mobileSidebarGestureRef.current || mobileTouchStartRef.current?.sidebarDragActive ? 'none' : 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
              touchAction: 'pan-y',
            }}
            data-testid="mobile-sidebar-panel"
            onClickCapture={event => {
              if (!suppressSidebarClickRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressSidebarClickRef.current = false;
            }}
          >
            {/* Close Button Header */}
            <div data-testid="mobile-sidebar-brand-header" className="h-12 px-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex min-w-0 items-center gap-2.5 text-ideapad-text">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700"><Sparkles size={16} /></span>
                <span className="font-serif text-base font-bold">Flowmate</span>
              </div>
              <button ref={mobileSidebarCloseRef} type="button" aria-label="Close navigation menu" onClick={() => setIsMobileSidebarOpen(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400">
                <X size={20} />
              </button>
            </div>
            {/* Scrollable Sidebar Content */}
            <div className="flex-1 overflow-y-auto">
              <Sidebar
                forceExpanded
                hideBranding
                onCreateClick={() => { setShowCreateModal(true); setIsMobileSidebarOpen(false); }}
                onNavigate={() => setIsMobileSidebarOpen(false)}
              />
            </div>
            {/* Fixed Bottom Auth Section */}
            <div className={`w-full min-w-0 overflow-hidden p-4 border-t border-slate-800 shrink-0 ${isZenMode ? 'hidden' : ''}`}>
              {currentUser ? (
                <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden text-xs text-slate-400">
                  <UserCircle size={16} className="shrink-0" />
                  <span className="block min-w-0 flex-1 truncate" title={currentUser.email || undefined}>{currentUser.email}</span>
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
        <div className="flex w-56 min-w-0 flex-col h-full bg-slate-900 border-r border-slate-800 shrink-0 z-20">
          <Sidebar onCreateClick={() => setShowCreateModal(true)} />
          <div className={`w-full min-w-0 overflow-hidden p-4 border-t border-slate-800 bg-slate-900/80 ${isZenMode ? 'hidden' : ''}`}>
            <WorkspaceStatus />
            <div className="mt-3 pt-3 border-t border-slate-800">
              {currentUser ? (
                <div className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden">
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <UserCircle size={14} className="text-slate-400 shrink-0" />
                    <span className="block min-w-0 flex-1 truncate text-[10px] text-slate-400" title={currentUser.email || undefined}>{currentUser.email}</span>
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
          {(currentView === 'chat' || isChatOpen) && (
            <div
              ref={chatPaneRef}
              className={`flex min-w-0 flex-col bg-slate-900 border-r border-slate-800 shrink-0 h-full relative ${currentView === 'chat' ? 'flex-1' : ''
                }`}
              data-testid="desktop-chat-pane"
              style={currentView === 'chat' ? {} : { width: `${chatWidth}px`, minWidth: '300px', maxWidth: '600px' }}
            >
              {/* Resize Handle - only show when not full-screen chat */}
              {currentView !== 'chat' && (
                <div
                  onMouseDown={handleMouseDown}
                  data-testid="chat-pane-resizer"
                  role="separator"
                  aria-label="Resize conversation pane"
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
                  const activeMsgs = resolveBranchHistory(messages || [], currentBranch?.head_message_id, currentChannel)
                    .filter(message => !(message.role === 'assistant' && message.status === 'failed' && message.turn_metadata?.response_source === 'unavailable' && !message.text.trim()));
                  
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
                          {msg.role === 'assistant' && msg.turn_metadata?.response_source && msg.turn_metadata.response_source !== 'gemini' && <p className="text-[10px] text-slate-400 mb-1">{msg.turn_metadata.response_source === 'unavailable' ? 'No AI response · unavailable' : 'Local rules · no AI request'}</p>}
                          {msg.text ? <MarkdownText content={msg.text} /> : (isStreaming && msg.id === useStore.getState().streamingMessageId ? <span className="text-slate-400 italic">Thinking...</span> : <em className="text-slate-400">Attachment</em>)}
                          {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <MessageVersionNav message={msg} />
                          <span className="text-[9px] text-slate-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                        </div>
                        {msg.role === 'user' && msg.turn_metadata?.managed_failure && (
                          <ManagedRequestNotice
                            code={msg.turn_metadata.managed_failure.code}
                            outcome={msg.turn_metadata.managed_failure.outcome}
                            onNewChat={() => { useStore.getState().createChatSession(); setInput(''); setView('chat'); }}
                            onRetryWithRecentContext={() => { void useStore.getState().forkAndSendMessage(msg.id, msg.text || (msg.attachment ? 'Analyze this attachment.' : ''), { contextRecovery: 'recent' }); }}
                            onSettings={() => setView('settings')}
                            onSignIn={() => setShowAuthModal(true)}
                          />
                        )}
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
          queueCount={(branchQueues?.[activeBranchId] || []).filter(q => q.status === 'queued' || q.status === 'leased' || q.status === 'needs_action').length}
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
            <main id="main-content" className="min-w-0 flex-1 overflow-auto relative" role="main" aria-label="Main content">
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
          {/* Chat back-navigation reveals the previous page beneath the moving Chat screen. */}
          {!isMobileSidebarOpen && mobileGestureOffset.x > 18 && currentView === 'chat' && (
            <div aria-hidden="true" data-testid="return-navigation-preview" className="absolute inset-0 z-0 flex w-64 flex-col items-center justify-center bg-ideapad-base px-6 text-center text-ideapad-text">
              <div className="flex self-start flex-col items-center justify-center" style={{ width: `${Math.max(84, Math.min(256, mobileGestureOffset.x))}px` }}>
                <LayoutDashboard size={26} className="mb-3 text-ideapad-mint" />
                {mobileGestureOffset.x < 136 ? (
                  <p className="text-sm font-semibold">{getMobileReturnView() === 'dashboard' ? 'Home' : getMobileReturnView() === 'knowledge' ? 'Library' : getMobileReturnView()[0].toUpperCase() + getMobileReturnView().slice(1)}</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold">Back to {getMobileReturnView() === 'dashboard' ? 'Home' : getMobileReturnView() === 'knowledge' ? 'Library' : getMobileReturnView()[0].toUpperCase() + getMobileReturnView().slice(1)}</p>
                    <p className="mt-1 text-xs text-emerald-100/70">Release to return</p>
                  </>
                )}
              </div>
            </div>
          )}
          {mobileGestureOffset.x < -18 && currentView !== 'chat' && (
            <div aria-hidden="true" data-testid="chat-navigation-preview" className="absolute inset-y-0 left-full z-0 flex w-full flex-col overflow-hidden border-l border-slate-700/70 bg-slate-900 px-6 py-5 text-slate-300 shadow-2xl" style={{ transform: `translate3d(${mobileGestureOffset.x}px, 0, 0)` }}>
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><MessageSquare size={24} /></div>
                <p className="font-medium text-slate-100">Go to Chat</p>
                <p className="mt-1 text-xs text-slate-400">Release to open your conversation</p>
              </div>
              <div className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-500">Message…</div>
            </div>
          )}
          {mobileGestureOffset.y > 32 || isMobileRefreshing ? (
            <div
              data-testid="mobile-refresh-indicator"
              role="status"
              aria-live="polite"
              aria-label={isMobileRefreshing ? 'Refreshing workspace' : mobileGestureOffset.y >= Math.min(88, mobileGestureThreshold(window.innerWidth) * 0.72) ? 'Release to refresh' : 'Pull to refresh'}
              data-refresh-state={isMobileRefreshing ? 'refreshing' : mobileGestureOffset.y >= Math.min(88, mobileGestureThreshold(window.innerWidth) * 0.72) ? 'armed' : 'pulling'}
              className="pointer-events-none absolute left-1/2 z-50 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-emerald-300/30 bg-ideapad-surface text-ideapad-mint shadow-lg transition-[transform,opacity] duration-150"
              style={{
                top: `${Math.max(0, (mobileGestureOffset.y - 32) / 2)}px`,
                opacity: isMobileRefreshing ? 1 : Math.min(1, mobileGestureOffset.y / 34),
              }}
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={`transition-transform duration-150 ${isMobileRefreshing ? 'animate-spin' : mobileGestureOffset.y >= Math.min(88, mobileGestureThreshold(window.innerWidth) * 0.72) ? 'rotate-180' : 'opacity-75'}`}
              />
            </div>
          ) : null}
          {/* Main content or full screen chat */}
          <div
            className="relative z-10 flex-1 flex flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] bg-slate-950"
            onTouchStart={handleMobileTouchStart}
            onTouchMove={handleMobileTouchMove}
            onTouchEnd={handleMobileTouchEnd}
            onTouchCancel={handleMobileTouchCancel}
            style={{
              touchAction: 'pan-y',
              overscrollBehaviorY: 'contain',
              transform: `translate3d(${mobileGestureOffset.x}px, ${mobileGestureOffset.y}px, 0)`,
              transition: mobileTouchStartRef.current
                ? 'none'
                : typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
                  ? 'transform 0ms'
                  : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: mobileTouchStartRef.current ? 'transform' : 'auto',
            }}
            data-testid="mobile-gesture-surface"
          >
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

                <div className="flex-1 overflow-y-auto p-4 space-y-4" data-mobile-scroll ref={!isMobile ? undefined : scrollRef} onScroll={handleChatScroll}>
                  {(() => {
                    const currentChannel = activeSessionId || 'general';
                    const currentBranch = (branches || []).find(b => b.id === activeBranchId && (b.conversation_id === currentChannel));
                    const activeMsgs = resolveBranchHistory(messages || [], currentBranch?.head_message_id, currentChannel)
                      .filter(message => !(message.role === 'assistant' && message.status === 'failed' && message.turn_metadata?.response_source === 'unavailable' && !message.text.trim()));

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
                            {msg.role === 'assistant' && msg.turn_metadata?.response_source && msg.turn_metadata.response_source !== 'gemini' && <p className="text-[10px] text-slate-400 mb-1">{msg.turn_metadata.response_source === 'unavailable' ? 'No AI response · unavailable' : 'Local rules · no AI request'}</p>}
                          {msg.text ? <MarkdownText content={msg.text} /> : (isStreaming && msg.id === useStore.getState().streamingMessageId ? <span className="text-slate-400 italic">Thinking...</span> : <em className="text-slate-400">Attachment</em>)}
                            {msg.ops_preview && msg.ops_preview.length > 0 && renderOpsSummary(msg.ops_preview)}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <MessageVersionNav message={msg} />
                            <span className="text-[9px] text-slate-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                          </div>
                          {msg.role === 'user' && msg.turn_metadata?.managed_failure && (
                            <ManagedRequestNotice
                              code={msg.turn_metadata.managed_failure.code}
                              outcome={msg.turn_metadata.managed_failure.outcome}
                              onNewChat={() => { useStore.getState().createChatSession(); setInput(''); setView('chat'); }}
                              onRetryWithRecentContext={() => { void useStore.getState().forkAndSendMessage(msg.id, msg.text || (msg.attachment ? 'Analyze this attachment.' : ''), { contextRecovery: 'recent' }); }}
                              onSettings={() => setView('settings')}
                              onSignIn={() => setShowAuthModal(true)}
                            />
                          )}
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
                      queueCount={(branchQueues?.[activeBranchId] || []).filter(q => q.status === 'queued' || q.status === 'leased' || q.status === 'needs_action').length}
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
                <div className="flex-1 overflow-auto" data-mobile-scroll>
                  <Suspense fallback={<LazyLoadFallback />}>
                    {renderMainContent()}
                  </Suspense>
                </div>
              </main>
            )}
          </div>

          <nav className="fixed bottom-0 left-0 right-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 items-center border-t border-ideapad-border bg-ideapad-surface/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-xl" aria-label="Mobile Navigation" data-testid="mobile-bottom-navigation">
            <button onClick={() => navigateFromMobileControl('chat')} aria-current={currentView === 'chat' ? 'page' : undefined} aria-label="Open Chat" className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-colors active:scale-95 ${currentView === 'chat' ? 'text-ideapad-mint' : 'text-ideapad-muted hover:text-ideapad-text'}`}>
              <MessageSquare size={19} className={currentView === 'chat' ? 'stroke-[2.5]' : ''} /><span>Chat</span>
            </button>
            <button onClick={() => navigateFromMobileControl('knowledge')} aria-current={currentView === 'knowledge' ? 'page' : undefined} aria-label="Open Library" className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-colors active:scale-95 ${currentView === 'knowledge' ? 'text-ideapad-mint' : 'text-ideapad-muted hover:text-ideapad-text'}`}>
              <Library size={19} className={currentView === 'knowledge' ? 'stroke-[2.5]' : ''} /><span>Library</span>
            </button>
            <button onClick={() => navigateFromMobileControl('dashboard')} aria-current={currentView === 'dashboard' ? 'page' : undefined} aria-label="Open Home" className={`-mt-2 flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold transition-transform active:scale-95 ${currentView === 'dashboard' ? 'text-ideapad-mint' : 'text-ideapad-muted hover:text-ideapad-text'}`}>
              <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${currentView === 'dashboard' ? 'bg-ideapad-surface-variant' : ''}`}><LayoutDashboard size={21} className={currentView === 'dashboard' ? 'stroke-[2.5]' : ''} /></span><span>Home</span>
            </button>
            <button onClick={() => navigateFromMobileControl('calendar')} aria-current={currentView === 'calendar' ? 'page' : undefined} aria-label="Open Calendar" className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-colors active:scale-95 ${currentView === 'calendar' ? 'text-ideapad-mint' : 'text-ideapad-muted hover:text-ideapad-text'}`}>
              <Calendar size={19} className={currentView === 'calendar' ? 'stroke-[2.5]' : ''} /><span>Calendar</span>
            </button>
            <button onClick={() => navigateFromMobileControl('settings')} aria-current={currentView === 'settings' ? 'page' : undefined} aria-label="Open Settings" className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-colors active:scale-95 ${currentView === 'settings' ? 'text-ideapad-mint' : 'text-ideapad-muted hover:text-ideapad-text'}`}>
              <Settings size={19} className={currentView === 'settings' ? 'stroke-[2.5]' : ''} /><span>Settings</span>
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

      {showOnboarding && (
        <OnboardingFlow
          identity={onboardingIdentity}
          onClose={() => setShowOnboarding(false)}
          onSignIn={() => { setShowOnboarding(false); setShowAuthModal(true); }}
          onContinueInChat={() => { setInput(buildOnboardingChatDraft(onboardingIdentity)); setView('chat'); }}
        />
      )}

      {managedAiLimit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <section ref={managedAiDialogRef} role="dialog" aria-modal="true" aria-labelledby="managed-ai-limit-title" className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Gemini access</p>
            <h2 id="managed-ai-limit-title" className="mt-2 text-xl font-semibold text-slate-100">
              {getManagedAiLimitCopy(managedAiLimit).title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {getManagedAiLimitCopy(managedAiLimit).description}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setManagedAiLimit(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Later</button>
              {getManagedAiLimitCopy(managedAiLimit).signInLabel && <button type="button" onClick={() => { setManagedAiLimit(null); setShowAuthModal(true); }} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-950">{getManagedAiLimitCopy(managedAiLimit).signInLabel}</button>}
              <button type="button" onClick={() => { setManagedAiLimit(null); setView('settings'); }} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Use my Gemini key</button>
            </div>
          </section>
        </div>
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
