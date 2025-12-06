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
  Network,
  PlusCircle,
  Library,
  Zap,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface SidebarProps {
  onCreateClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onCreateClick }) => {
  const { currentView, setView, getXP, undo, redo, canUndo, canRedo, toggleZenMode, isZenMode } = useStore();
  
  // Gamification Logic
  const xp = getXP();
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const nextLevelXp = Math.pow(level, 2) * 100;
  const prevLevelXp = Math.pow(level - 1, 2) * 100;
  const progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;

  return (
    <div className={`h-full bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ${isZenMode ? 'w-16' : 'w-16 md:w-64'}`}>
      <div className={`p-4 flex items-center gap-3 border-b border-slate-800 ${isZenMode ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <Network className="text-white w-5 h-5" />
        </div>
        {!isZenMode && <span className="font-bold text-xl tracking-tight hidden md:block text-slate-100">Flowmate</span>}
      </div>

      <div className="p-4 pb-0">
          <button 
            onClick={onCreateClick}
            className={`w-full bg-indigo-600 hover:bg-indigo-500 text-white p-2 md:py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-indigo-500/20 group ${isZenMode ? 'md:px-2' : 'md:px-4'}`}
            title="Create New Entity"
          >
              <PlusCircle size={20} />
              {!isZenMode && <span className="hidden md:inline font-medium text-sm">New Entity</span>}
          </button>
      </div>

      <nav className="flex-1 p-2 md:p-4 space-y-1 overflow-y-auto">
        <NavItem 
          icon={<LayoutDashboard size={20} />} 
          label="Dashboard" 
          active={currentView === 'dashboard'} 
          onClick={() => setView('dashboard')}
          compact={isZenMode}
        />
        <NavItem 
          icon={<MessageSquare size={20} />} 
          label="Graph & Chat" 
          active={currentView === 'chat_graph'} 
          onClick={() => setView('chat_graph')}
          compact={isZenMode}
        />
        <NavItem 
          icon={<Target size={20} />} 
          label="Goals" 
          active={currentView === 'goals'} 
          onClick={() => setView('goals')}
          compact={isZenMode}
        />
        <NavItem 
          icon={<BookOpen size={20} />} 
          label="Projects" 
          active={currentView === 'projects'} 
          onClick={() => setView('projects')}
          compact={isZenMode}
        />
        <NavItem 
          icon={<Library size={20} />} 
          label="Knowledge" 
          active={currentView === 'knowledge'} 
          onClick={() => setView('knowledge')}
          compact={isZenMode}
        />
        <NavItem 
          icon={<Calendar size={20} />} 
          label="Calendar" 
          active={currentView === 'calendar'} 
          onClick={() => setView('calendar')}
          compact={isZenMode}
        />
      </nav>
      
      {/* Undo/Redo Controls */}
      <div className={`p-2 flex gap-1 justify-center border-t border-slate-800 ${isZenMode ? 'flex-col' : ''}`}>
          <button 
             onClick={undo} 
             disabled={!canUndo()}
             className="p-2 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
             title="Undo"
          >
              <Undo2 size={18} />
          </button>
          <button 
             onClick={redo} 
             disabled={!canRedo()}
             className="p-2 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
             title="Redo"
          >
              <Redo2 size={18} />
          </button>
      </div>

      {/* Gamification Profile */}
      {!isZenMode && (
        <div className="p-4 border-t border-slate-800 bg-slate-900 hidden md:block">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-indigo-900 flex items-center justify-center text-indigo-300 font-bold border border-indigo-500/30">
                    {level}
                </div>
                <div className="flex-1">
                    <div className="text-xs font-bold text-slate-300">Productivity Level</div>
                    <div className="text-[10px] text-slate-500 font-mono">{Math.floor(xp)} XP</div>
                </div>
                <Zap size={16} className="text-yellow-500 fill-yellow-500" />
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
            </div>
        </div>
      )}

      <div className="p-2 md:p-4 border-t border-slate-800 flex flex-col gap-1">
        <NavItem 
          icon={<Settings size={20} />} 
          label="Settings" 
          active={currentView === 'settings'} 
          onClick={() => setView('settings')}
          compact={isZenMode}
        />
        <button 
            onClick={toggleZenMode}
            className="w-full flex items-center gap-3 p-3 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-all mt-2"
            title="Toggle Zen Mode"
        >
            {isZenMode ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
            {!isZenMode && <span className="hidden md:block font-medium text-sm">Zen Mode</span>}
        </button>
      </div>
    </div>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  compact?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, compact }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
      active 
        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    } ${compact ? 'justify-center' : ''}`}
    title={compact ? label : ''}
  >
    <span className="shrink-0">{icon}</span>
    {!compact && <span className="hidden md:block font-medium text-sm">{label}</span>}
  </button>
);

export default Sidebar;