/**
 * Flowmate — Memory, Preference & Decision Provenance Inspector
 * 
 * Realizes Reference Workflow 4 from PRODUCT_DIRECTION_AND_EXPERIENCE.md:
 * "Retrieve a previously stated preference or decision, inspect its source
 * and distinguish it from superseded beliefs or assistant proposals."
 * 
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Two-phase confirmation on state mutations
 * - Clear visual distinction between User Decision vs Assistant Proposal vs Superseded Belief
 * - Bi-temporal validity and source excerpt inspection
 */

import React from 'react';
import {
  Brain,
  CheckCircle2,
  AlertTriangle,
  Bot,
  UserCheck,
  Clock,
  Shield,
  Trash2,
  ArrowRight,
  Sparkles,
  Quote,
  History,
  X,
  Lock,
  Target,
  ChevronLeft,
} from 'lucide-react';
import { PersistentMemoryItem } from '../services/context/memoryTypes';
import { Entity as KernelEntity } from '../services/kernel/types';
import { useStore } from '../store';
import { ToonOperation } from '../types';

interface MemoryDetailViewProps {
  memory: PersistentMemoryItem;
  kernelEntity: KernelEntity;
  onClose: () => void;
  onNavigateToEntity?: (id: string) => void;
  onBack?: () => void;
}

export const MemoryDetailView: React.FC<MemoryDetailViewProps> = ({
  memory,
  kernelEntity,
  onClose,
  onNavigateToEntity,
  onBack,
}) => {
  const { setPendingOps, kernelEntities, entities } = useStore();

  const isUserStated =
    memory.speaker === 'user' ||
    memory.source_type === 'user_explicit' ||
    memory.source_type === 'user_confirmed' ||
    memory.epistemic_status === 'user_decision';

  const isAssistantProposal =
    memory.speaker === 'assistant' ||
    memory.source_type === 'inferred' ||
    memory.epistemic_status === 'assistant_proposal';

  const isSuperseded =
    memory.status === 'superseded' ||
    Boolean(memory.superseded_by);

  const supersededTarget = memory.superseded_by
    ? kernelEntities[memory.superseded_by]
    : null;

  const priorBeliefTarget = memory.supersedes
    ? kernelEntities[memory.supersedes]
    : null;

  // Handle Promote Inferred Proposal to User-Confirmed Decision
  const handlePromoteToConfirmed = () => {
    const op: ToonOperation = {
      type: 'update_entity',
      payload: {
        id: kernelEntity.id,
        fields: {
          source_type: 'user_confirmed',
          confidence: 1.0,
          speaker: 'user',
          epistemic_status: 'user_decision',
          user_confirmed: true,
        },
      },
    };

    setPendingOps([op]);
  };

  // Handle Mark as Superseded
  const handleMarkAsSuperseded = () => {
    const op: ToonOperation = {
      type: 'update_entity',
      payload: {
        id: kernelEntity.id,
        fields: {
          status: 'superseded',
          reversal_reason: 'User manual override in Provenance Inspector',
        },
      },
    };

    setPendingOps([op]);
  };

  // Handle Delete (Tombstone)
  const handleDeleteTombstone = () => {
    const op: ToonOperation = {
      type: 'delete_entity',
      payload: {
        id: kernelEntity.id,
      },
    };

    setPendingOps([op]);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-100 overflow-y-auto">
      {/* Top Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors mr-0.5"
              aria-label="Back to previous entity"
              title="Back"
            >
              <ChevronLeft size={17} />
            </button>
          )}
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
            <Brain size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              Belief &amp; Decision Inspector
            </div>
            <h2 className="text-sm font-semibold text-slate-100 truncate max-w-[240px]">
              {memory.category.toUpperCase()} • {memory.id}
            </h2>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          aria-label="Close memory inspector"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-5 space-y-5 flex-1">
        {/* Epistemic Status Banner (Workflow 4 core distinction) */}
        {isSuperseded ? (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertTriangle size={15} />
              <span>SUPERSEDED BELIEF (Historical Record)</span>
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              This stated preference or belief was superseded and is no longer active in live context.
            </p>
            {memory.reversal_reason && (
              <div className="text-[10px] text-amber-300 font-mono bg-amber-950/40 p-1.5 rounded border border-amber-500/20">
                Reason: {memory.reversal_reason}
              </div>
            )}
            {supersededTarget && onNavigateToEntity && (
              <button
                onClick={() => onNavigateToEntity(supersededTarget.id)}
                className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 hover:text-amber-100 transition-colors cursor-pointer"
              >
                <span>Inspect Active Replacement: {supersededTarget.title || supersededTarget.id}</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        ) : isUserStated ? (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2.5">
            <UserCheck size={16} className="text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-emerald-300">User Explicit Decision (Canonical Truth)</div>
              <div className="text-[11px] text-emerald-200/70">
                Confirmed directly by user. 100% confidence weight in context synthesis.
              </div>
            </div>
          </div>
        ) : isAssistantProposal ? (
          <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-indigo-300">
                <Bot size={15} className="text-indigo-400" />
                <span>Assistant Inferred Proposal</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                {Math.round(memory.confidence * 100)}% Confidence
              </span>
            </div>
            <p className="text-[11px] text-indigo-200/80 leading-relaxed">
              Inferred from your behavior or context. Requires your explicit ratification to become permanent.
            </p>
            <button
              onClick={handlePromoteToConfirmed}
              className="w-full py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <CheckCircle2 size={13} />
              <span>Confirm as Permanent User Preference</span>
            </button>
          </div>
        ) : null}

        {/* Content Box */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Stated Content
          </label>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 font-medium leading-relaxed">
            {memory.content}
          </div>
        </div>

        {/* Source Excerpt & Conversation Grounding */}
        {memory.source_excerpt && (
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Quote size={13} className="text-indigo-400" /> Grounding Source Excerpt
            </label>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 italic border-l-2 border-l-indigo-500">
              &quot;{memory.source_excerpt}&quot;
            </div>
            {typeof memory.source_turn === 'number' && (
              <div className="text-[10px] text-slate-500 font-mono">
                Observed in session turn #{memory.source_turn}
              </div>
            )}
          </div>
        )}

        {/* Prior Belief Superseded Link */}
        {priorBeliefTarget && onNavigateToEntity && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              <History size={12} /> Lineage Predecessor
            </div>
            <div className="text-slate-300 font-medium truncate">
              Supersedes: {priorBeliefTarget.title || priorBeliefTarget.id}
            </div>
            <button
              onClick={() => onNavigateToEntity(priorBeliefTarget.id)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mt-1 cursor-pointer"
            >
              <span>Inspect prior belief</span>
              <ArrowRight size={11} />
            </button>
          </div>
        )}

        {/* Associated Goals & Workstream Linkage (Workflow 3) */}
        {memory.associated_entity_ids && memory.associated_entity_ids.length > 0 && onNavigateToEntity && (
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2" data-testid="memory-associated-workstream-card">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <Target size={12} /> Associated Goals &amp; Entities ({memory.associated_entity_ids.length})
              </span>
              <span className="text-[10px] text-slate-500 font-mono">1-Click Return</span>
            </div>
            <div className="space-y-1.5">
              {memory.associated_entity_ids.map(assocId => {
                const targetEntity = entities.find(e => e.id === assocId) || kernelEntities[assocId];
                const title = targetEntity
                  ? ('title' in targetEntity && targetEntity.title ? targetEntity.title : assocId)
                  : assocId;
                const kind = targetEntity && 'kind' in targetEntity ? targetEntity.kind : 'ENTITY';
                return (
                  <div
                    key={assocId}
                    data-testid={`memory-associated-entity-${assocId}`}
                    onClick={() => onNavigateToEntity(assocId)}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-2 min-w-0 mr-2">
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-indigo-400 border border-slate-700 shrink-0">
                        {kind}
                      </span>
                      <span className="text-xs font-medium text-slate-200 group-hover:text-indigo-300 truncate">
                        {title}
                      </span>
                    </div>
                    <ArrowRight size={12} className="text-slate-500 group-hover:text-indigo-300 shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Metadata & Bi-temporal Validity Grid */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Bi-Temporal Provenance
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] text-slate-500">Category</div>
              <div className="text-slate-200 font-medium capitalize">{memory.category}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Source Type</div>
              <div className="text-slate-200 font-mono capitalize">{memory.source_type}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                <Clock size={10} /> Valid From
              </div>
              <div className="text-slate-200 font-mono text-[11px]">
                {memory.valid_from ? new Date(memory.valid_from).toLocaleDateString() : 'Always'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                <Clock size={10} /> Valid Until
              </div>
              <div className="text-slate-200 font-mono text-[11px]">
                {memory.valid_until ? new Date(memory.valid_until).toLocaleDateString() : 'Permanent'}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Shield size={12} className="text-cyan-400" />
              <span>Privacy Tier: {memory.privacy_tier}</span>
            </span>
            <span className="font-mono text-[10px]">Rev v{kernelEntity.version}</span>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          {!isSuperseded && (
            <button
              onClick={handleMarkAsSuperseded}
              className="w-full py-2 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <AlertTriangle size={13} className="text-amber-400" />
              <span>Mark as Superseded (Archive Belief)</span>
            </button>
          )}

          <button
            onClick={handleDeleteTombstone}
            className="w-full py-2 px-3 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 size={13} className="text-rose-400" />
            <span>Delete with Tombstone</span>
          </button>
        </div>
      </div>
    </div>
  );
};
