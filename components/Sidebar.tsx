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
  Network,
  Search
} from 'lucide-react';

interface SidebarProps {
  onCreateClick?: () => void;
  onNavigate?: () => void;
  forceExpanded?: boolean;
  hideBranding?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onCreateClick, onNavigate, forceExpanded = false, hideBranding = false }) => {
  const { currentView, setView, getXP, undo, redo, canUndo, canRedo, toggleZenMode, isZenMode, settings } = useStore();

  const handleNav = (view: ViewType) => {
    setView(view);
    onNavigate?.();
  };

  const toggles = settings.feature_toggles || { food_tracking: false, attendance_tracking: false, gamification: false, quick_streaks: true, people_tracking: true };

  // Gamification (if enabled)
  const xp = getXP();
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const nextLevelXp = Math.pow(level, 2) * 100;
  const prevLevelXp = Math.pow(level - 1, 2) * 100;
  const progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;

  const showLabels = forceExpanded || !isZenMode;
  const isCompact = !forceExpanded && isZenMode;

  // Clean navigation items without Food Tracking or Schedules
  const navItems: Array<{ icon: any; label: string; view: ViewType; mobileOnly?: boolean }> = [
    { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' as ViewType },
    { icon: MessageSquare, label: 'Chat', view: 'chat' as ViewType },
    { icon: Network, label: 'Graph', view: 'chat_graph' as ViewType },
    { icon: Calendar, label: 'Calendar', view: 'calendar' as ViewType },
    { icon: TrendingUp, label: 'Analytics', view: 'analytics' as ViewType },
    { icon: Library, label: 'Library', view: 'knowledge' as ViewType },
  ];

  return (
    <div data-surface="sidebar" style={{ borderColor: 'var(--border-hairline)' }} className={`h-full flex flex-col bg-ideapad-base border-r transition-all duration-300 ${forceExpanded ? 'w-full' : (isZenMode ? 'w-14' : 'w-14 md:w-56')
      }`}>

      {!hideBranding && (
        <div className={`p-3 flex items-center gap-2.5 ${isCompact ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
            <Sparkles className="text-ideapad-text w-4 h-4" />
          </div>
          {showLabels && (
            <span className={`font-serif font-bold text-lg tracking-tight text-ideapad-text ${forceExpanded ? '' : 'hidden md:block'}`}>
              Flowmate
            </span>
          )}
        </div>
      )}

      {/* Create Button */}
      <div className="px-2 pb-1">
        <button
          onClick={onCreateClick}
          className={`w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-ideapad-text py-2 rounded-lg flex items-center justify-center gap-2 transition-all text-sm font-medium shadow-md shadow-emerald-600/20 active:scale-98 ${isCompact ? 'px-2' : 'px-3'}`}
          title="Create New"
        >
          <PlusCircle size={18} className="text-ideapad-mint" />
          {showLabels && <span className={forceExpanded ? '' : 'hidden md:inline'}>New</span>}
        </button>
      </div>

      <button aria-label="Open command palette" title="Search and commands (Ctrl+K / Cmd+K)"
        onClick={() => { window.dispatchEvent(new Event('flowmate:commands-open')); onNavigate?.(); }}
        className={`mx-2 my-2 px-2 py-2 text-xs text-slate-300 border border-slate-700 rounded-lg flex items-center gap-2 min-w-0 ${isCompact ? 'justify-center' : 'justify-between'}`}>
        {isCompact ? <Search size={16} aria-hidden="true" /> : <><span className="truncate">Search / Commands</span><kbd className="shrink-0">Ctrl/⌘ K</kbd></>}
      </button>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {navItems
          .filter(item => !item.mobileOnly || forceExpanded)
          .map(({ icon: Icon, label, view }) => {
            const isActive = currentView === view;
            return (
              <button
                key={view}
                onClick={() => handleNav(view)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`Navigate to ${label}`}
                style={isActive ? { borderColor: 'var(--border-accent)' } : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg transition-all duration-200 text-sm relative group ${isActive
                  ? 'bg-ideapad-surface-variant text-ideapad-mint font-medium border'
                  : 'text-ideapad-muted hover:bg-ideapad-surface hover:text-ideapad-text'
                  } ${isCompact ? 'justify-center' : ''}`}
                title={isCompact ? label : ''}
              >
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-ideapad-mint rounded-r-full" />
                )}
                <Icon size={18} className={`transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-ideapad-mint' : 'text-ideapad-muted'}`} />
                {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>{label}</span>}
              </button>
            );
          })}
      </nav>

      {/* Undo/Redo */}
      <div style={{ borderColor: 'var(--border-hairline)' }} className={`px-2 py-1.5 flex gap-1 ${isCompact ? 'flex-col items-center' : 'justify-center'} border-t`}>
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="p-1.5 rounded-lg hover:bg-ideapad-surface text-ideapad-muted hover:text-ideapad-text disabled:text-slate-600 disabled:hover:bg-transparent transition-all"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="p-1.5 rounded-lg hover:bg-ideapad-surface text-ideapad-muted hover:text-ideapad-text disabled:text-slate-600 disabled:hover:bg-transparent transition-all"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      {/* XP Section (gamification toggle controlled) */}
      {toggles.gamification && showLabels && (
        <div className={`px-3 py-2.5 border-t border-[var(--border-hairline)] ${forceExpanded ? '' : 'hidden md:block'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <div style={{ borderColor: 'var(--border-hairline)' }} className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center text-ideapad-mint text-xs font-bold border">
              {level}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-ideapad-muted truncate">Level {level}</div>
              <div className="text-[9px] text-slate-400 font-mono">{Math.floor(xp)} XP</div>
            </div>
          </div>
          <div className="w-full h-1 bg-ideapad-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Settings & Zen Mode */}
      <div style={{ borderColor: 'var(--border-hairline)' }} className="p-2 space-y-0.5 border-t">
        <button
          onClick={() => handleNav('settings')}
          aria-current={currentView === 'settings' ? 'page' : undefined}
          aria-label="Navigate to Settings"
          style={currentView === 'settings' ? { borderColor: 'var(--border-accent)' } : undefined}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-sm ${currentView === 'settings'
            ? 'bg-ideapad-surface-variant text-ideapad-mint font-medium border'
            : 'text-ideapad-muted hover:bg-ideapad-surface hover:text-ideapad-text'
            } ${isCompact ? 'justify-center' : ''}`}
          title={isCompact ? 'Settings' : ''}
        >
          <Settings size={18} className={currentView === 'settings' ? 'text-ideapad-mint' : 'text-ideapad-muted'} />
          {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>Settings</span>}
        </button>

        {!forceExpanded && (
          <button
            onClick={toggleZenMode}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-ideapad-muted hover:bg-ideapad-surface hover:text-ideapad-text transition-all text-sm ${isCompact ? 'justify-center' : ''}`}
            title="Zen Mode"
          >
            {isZenMode ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
            {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>Zen</span>}
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
