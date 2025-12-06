import React from 'react';
import { useStore } from '../store';
import { ViewType } from '../types';
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Target,
  BookOpen,
  Settings,
  Sparkles,
  PlusCircle,
  Library,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface SidebarProps {
  onCreateClick?: () => void;
  onNavigate?: () => void;
  forceExpanded?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onCreateClick, onNavigate, forceExpanded = false }) => {
  const { currentView, setView, getXP, undo, redo, canUndo, canRedo, toggleZenMode, isZenMode } = useStore();

  const handleNav = (view: ViewType) => {
    setView(view);
    onNavigate?.();
  };

  // Gamification
  const xp = getXP();
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const nextLevelXp = Math.pow(level, 2) * 100;
  const prevLevelXp = Math.pow(level - 1, 2) * 100;
  const progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;

  const showLabels = forceExpanded || !isZenMode;
  const isCompact = !forceExpanded && isZenMode;

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' as ViewType },
    { icon: MessageSquare, label: 'Graph', view: 'chat_graph' as ViewType },
    { icon: Target, label: 'Goals', view: 'goals' as ViewType },
    { icon: BookOpen, label: 'Projects', view: 'projects' as ViewType },
    { icon: Library, label: 'Knowledge', view: 'knowledge' as ViewType },
    { icon: Calendar, label: 'Calendar', view: 'calendar' as ViewType },
  ];

  return (
    <div className={`h-screen flex flex-col bg-gradient-to-b from-slate-900 to-slate-950 transition-all duration-300 ${forceExpanded ? 'w-full' : (isZenMode ? 'w-14' : 'w-14 md:w-56')
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
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map(({ icon: Icon, label, view }) => {
          const isActive = currentView === view;
          return (
            <button
              key={view}
              onClick={() => handleNav(view)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-sm ${isActive
                  ? 'bg-indigo-500/15 text-indigo-300 font-medium'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                } ${isCompact ? 'justify-center' : ''}`}
              title={isCompact ? label : ''}
            >
              <Icon size={18} className={isActive ? 'text-indigo-400' : ''} />
              {showLabels && <span className={forceExpanded ? '' : 'hidden md:block'}>{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Undo/Redo */}
      <div className={`px-2 py-1.5 flex gap-0.5 ${isCompact ? 'flex-col items-center' : 'justify-center'} border-t border-slate-800/50`}>
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="p-1.5 rounded-md hover:bg-slate-800 text-slate-500 disabled:opacity-30 transition-colors"
          title="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="p-1.5 rounded-md hover:bg-slate-800 text-slate-500 disabled:opacity-30 transition-colors"
          title="Redo"
        >
          <Redo2 size={16} />
        </button>
      </div>

      {/* XP Section */}
      {showLabels && (
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
      </div>
    </div>
  );
};

export default Sidebar;