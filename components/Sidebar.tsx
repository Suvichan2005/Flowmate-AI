import React from 'react';
import { useStore } from '../store';
import { ViewType } from '../types';
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Settings,
  Sparkles,
  PlusCircle,
  Library,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  TrendingUp,
  MessageCircle,
  Clock,
  UtensilsCrossed,
  GraduationCap,
  Table2,
  Cloud,
  Loader2,
  AlertTriangle,
  Check,
  Network
} from 'lucide-react';

interface SidebarProps {
  onCreateClick?: () => void;
  onNavigate?: () => void;
  forceExpanded?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onCreateClick, onNavigate, forceExpanded = false }) => {
  const { currentView, setView, getXP, undo, redo, canUndo, canRedo, toggleZenMode, isZenMode, settings, syncStatus, currentUser } = useStore();

  const handleNav = (view: ViewType) => {
    setView(view);
    onNavigate?.();
  };

  // Feature toggles for conditional nav
  const toggles = settings.feature_toggles || { food_tracking: true, attendance_tracking: false, gamification: false, quick_streaks: true, people_tracking: true };

  // Gamification (if enabled)
  const xp = getXP();
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const nextLevelXp = Math.pow(level, 2) * 100;
  const prevLevelXp = Math.pow(level - 1, 2) * 100;
  const progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;

  const showLabels = forceExpanded || !isZenMode;
  const isCompact = !forceExpanded && isZenMode;

  // Navigation items with feature toggle control
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' as ViewType },
    { icon: MessageSquare, label: 'Chat', view: 'chat' as ViewType },
    { icon: Network, label: 'Graph', view: 'chat_graph' as ViewType },
    { icon: Clock, label: 'Timeline', view: 'timeline' as ViewType },
    { icon: Calendar, label: 'Calendar', view: 'calendar' as ViewType },
    { icon: TrendingUp, label: 'Analytics', view: 'analytics' as ViewType },
    { icon: Library, label: 'Library', view: 'knowledge' as ViewType },
    ...(toggles.food_tracking ? [{ icon: Table2, label: 'Schedules', view: 'schedules' as ViewType }] : []),
    ...(toggles.food_tracking ? [{ icon: UtensilsCrossed, label: 'Food', view: 'food' as ViewType }] : []),
    ...(toggles.attendance_tracking ? [{ icon: GraduationCap, label: 'Attendance', view: 'attendance' as ViewType }] : []),
  ];

  return (
    <div className={`h-full flex flex-col bg-gradient-to-b from-slate-900 to-slate-950 transition-all duration-300 ${forceExpanded ? 'w-full' : (isZenMode ? 'w-14' : 'w-14 md:w-56')
      }`}>

      {/* Logo */}
      <div className={`p-3 flex items-center gap-2.5 ${isCompact ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
          <Sparkles className="text-white w-4 h-4" />
        </div>
        {showLabels && (
          <span className={`font-bold text-lg tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent ${forceExpanded ? '' : 'hidden md:block'}`}>
            Flowmate
          </span>
        )}
      </div>

      {/* Create Button */}
      <div className="px-2 pb-1">
        <button
          onClick={onCreateClick}
          className={`w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white py-2 rounded-lg flex items-center justify-center gap-2 transition-all text-sm font-medium shadow-md shadow-indigo-500/20 ${isCompact ? 'px-2' : 'px-3'}`}
          title="Create New"
        >
          <PlusCircle size={18} />
          {showLabels && <span className={forceExpanded ? '' : 'hidden md:inline'}>New</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {navItems
          .filter(item => !item.mobileOnly || forceExpanded) // Hide mobileOnly items on desktop
          .map(({ icon: Icon, label, view }) => {
            const isActive = currentView === view;
            return (
              <button
                key={view}
                onClick={() => handleNav(view)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`Navigate to ${label}`}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg transition-all duration-200 text-sm relative group ${isActive
                  ? 'bg-indigo-500/15 text-indigo-300 font-medium'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                  } ${isCompact ? 'justify-center' : ''}`}
                title={isCompact ? label : ''}
              >
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-400 rounded-r-full" />
                )}
                <Icon size={18} className={`transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-indigo-400' : ''}`} />
                {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>{label}</span>}
              </button>
            );
          })}
      </nav>

      {/* Undo/Redo */}
      <div className={`px-2 py-1.5 flex gap-1 ${isCompact ? 'flex-col items-center' : 'justify-center'} border-t border-slate-800/60`}>
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent transition-all"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent transition-all"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      {/* XP Section (gamification toggle controlled) */}
      {toggles.gamification && showLabels && (
        <div className={`px-3 py-2.5 border-t border-slate-800/50 ${forceExpanded ? '' : 'hidden md:block'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-300 text-xs font-bold border border-indigo-500/30">
              {level}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-slate-400 truncate">Level {level}</div>
              <div className="text-[9px] text-slate-600 font-mono">{Math.floor(xp)} XP</div>
            </div>
          </div>
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Settings & Zen Mode */}
      <div className="p-2 space-y-0.5 border-t border-slate-800/50">
        <button
          onClick={() => handleNav('settings')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-sm ${currentView === 'settings'
            ? 'bg-indigo-500/15 text-indigo-300 font-medium'
            : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            } ${isCompact ? 'justify-center' : ''}`}
          title={isCompact ? 'Settings' : ''}
        >
          <Settings size={18} className={currentView === 'settings' ? 'text-indigo-400' : ''} />
          {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>Settings</span>}
        </button>

        {!forceExpanded && (
          <button
            onClick={toggleZenMode}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-500 hover:bg-slate-800/50 hover:text-slate-300 transition-all text-sm ${isCompact ? 'justify-center' : ''}`}
            title="Zen Mode"
          >
            {isZenMode ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
            {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>Zen</span>}
          </button>
        )}

        {/* Sync Status Indicator */}
        {currentUser && showLabels && (
          <div className={`px-2.5 py-2 border-t border-slate-800/50 ${forceExpanded ? '' : 'hidden md:flex'} items-center gap-2`}>
            {syncStatus === 'syncing' && (
              <>
                <Loader2 size={14} className="text-blue-400 animate-spin" />
                <span className="text-xs text-blue-400">Syncing...</span>
              </>
            )}
            {syncStatus === 'idle' && (
              <>
                <Check size={14} className="text-emerald-400" />
                <span className="text-xs text-emerald-400">Synced</span>
              </>
            )}
            {syncStatus === 'error' && (
              <>
                <AlertTriangle size={14} className="text-red-400" />
                <span className="text-xs text-red-400">Sync error</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;