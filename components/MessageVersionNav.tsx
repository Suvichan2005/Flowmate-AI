import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, GitBranch, Check, X, RotateCw, ImageOff } from 'lucide-react';
import { Message } from '../types';
import { getSiblingVersions } from '../utils/conversationGraph';
import { useStore } from '../store';

interface MessageVersionNavProps {
  message: Message;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  className?: string;
}

export const MessageVersionNav: React.FC<MessageVersionNavProps> = ({
  message,
  onEditStart,
  onEditEnd,
  className = '',
}) => {
  const {
    messages,
    switchSiblingVersion,
    forkBranch,
    forkAndSendMessage,
    retryQueuedUserMessage,
    branches,
    activeBranchId,
  } = useStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removeAttachment, setRemoveAttachment] = useState(false);

  const { currentIndex, totalCount, siblings } = getSiblingVersions(messages || [], message.id);

  const currentBranch = (branches || []).find(b => b.id === (message.branch_id || activeBranchId));
  const isBranchHead = currentBranch?.head_message_id === message.id;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex > 1) {
      const prevSibling = siblings[currentIndex - 2];
      if (prevSibling) {
        switchSiblingVersion(prevSibling.id);
      }
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex < totalCount) {
      const nextSibling = siblings[currentIndex];
      if (nextSibling) {
        switchSiblingVersion(nextSibling.id);
      }
    }
  };

  const handleForkAlone = (e: React.MouseEvent) => {
    e.stopPropagation();
    forkBranch(message.id);
    setIsEditing(false);
    onEditEnd?.();
  };

  const handleForkAndSend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSubmitting) return;
    const trimmed = editText.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    try {
      await forkAndSendMessage(message.id, trimmed, { removeAttachment });
      setIsEditing(false);
      onEditEnd?.();
    } catch (err) {
      console.error('[MessageVersionNav] Fork & Send failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(message.text);
    setRemoveAttachment(false);
    setIsEditing(false);
    onEditEnd?.();
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(message.text);
    setRemoveAttachment(false);
    setIsEditing(true);
    onEditStart?.();
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    retryQueuedUserMessage(message.id);
  };

  if (isEditing) {
    return (
      <div className={`mt-2 p-2 rounded-xl bg-slate-900/90 border border-indigo-500/40 shadow-xl ${className}`}>
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          disabled={isSubmitting}
          className="w-full bg-slate-800/80 text-slate-100 text-sm rounded-lg p-2.5 outline-none border border-slate-700 focus:border-indigo-500 resize-none min-h-[60px] disabled:opacity-60"
          rows={2}
          autoFocus
        />
        {message.attachment && (
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={removeAttachment}
              onChange={event => setRemoveAttachment(event.target.checked)}
              disabled={isSubmitting}
              className="accent-emerald-500"
            />
            <ImageOff size={13} />
            Retry without attached image
          </label>
        )}
        <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800 text-xs gap-2">
          <span className="text-slate-400 flex items-center gap-1 truncate text-[11px]">
            <GitBranch size={12} className="text-indigo-400 shrink-0" />
            <span className="truncate">Will fork into a new branch</span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCancelEdit}
              disabled={isSubmitting}
              className="px-2.5 py-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              onClick={handleForkAlone}
              disabled={isSubmitting}
              title="Create branch without sending message"
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <GitBranch size={12} />
              Fork
            </button>
            <button
              onClick={handleForkAndSend}
              disabled={isSubmitting || !editText.trim()}
              className="px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm transition-colors flex items-center gap-1 disabled:opacity-50 active:scale-95"
            >
              <Check size={12} />
              {isSubmitting ? 'Sending...' : 'Fork & Send'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Only render navigation controls if there are alternatives, user edit option, or failed status
  if (totalCount <= 1 && message.role !== 'user' && message.status !== 'failed') {
    return null;
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs text-slate-400 select-none ${className}`}>
      {/* Sibling navigation pill (e.g. ◀ 1/2 ▶) */}
      {totalCount > 1 && (
        <div className="inline-flex items-center bg-slate-800/80 backdrop-blur-sm border border-slate-700/60 rounded-full px-1.5 py-0.5 text-[11px] shadow-sm">
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 1}
            aria-label="Previous version"
            className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="px-1 text-slate-300 font-mono tracking-tight">
            {currentIndex}/{totalCount}
          </span>
          <button
            onClick={handleNext}
            disabled={currentIndex >= totalCount}
            aria-label="Next version"
            className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}

      {/* Edit button for user messages */}
      {message.role === 'user' && (
        <button
          onClick={handleStartEdit}
          title="Edit message (creates a new branch)"
          aria-label="Edit message"
          className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60 transition-colors opacity-70 hover:opacity-100"
        >
          <Pencil size={12} />
        </button>
      )}

      {/* Interrupted managed requests need an explicit user retry because the
          provider may have completed even though the browser missed its reply. */}
      {(message.status === 'failed' || message.status === 'interrupted') && (
        <button
          onClick={handleRetry}
          title={message.status === 'interrupted' ? 'The previous result may be unknown. Retrying can create a second response.' : 'Retry sending message'}
          aria-label={message.status === 'interrupted' ? 'Retry interrupted message anyway' : 'Retry sending message'}
          className="inline-flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 px-1.5 py-0.5 rounded-full transition-colors cursor-pointer"
        >
          <RotateCw size={10} />
          {message.status === 'interrupted' ? 'Retry anyway' : 'Retry'}
        </button>
      )}

      {/* Branch indication if diverged */}
      {currentBranch && currentBranch.name && currentBranch.name !== 'Main' && (
        <span
          title={`Branch: ${currentBranch.name}`}
          className="inline-flex items-center gap-1 text-[10px] text-indigo-400/80 bg-indigo-950/40 border border-indigo-800/40 px-1.5 py-0.2 rounded-full"
        >
          <GitBranch size={10} />
          {currentBranch.name}
        </span>
      )}
    </div>
  );
};
