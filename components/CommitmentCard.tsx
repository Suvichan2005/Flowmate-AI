/**
 * Flowmate Greenfield Domain Kernel — Commitment Capability Projection (P1-06)
 *
 * Generic UI projection component driven by entity + capability state.
 * Evaluates progress, streaks, evidence history, and reminder suppression.
 *
 * Reusable in Dashboard, Entity views, and Chat cards.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import React, { useState } from 'react';
import { Sliders, ArrowUpRight } from 'lucide-react';
import { useStore } from '../store';
import {
  parseCommitmentTarget,
  parseEvidenceItems,
  evaluateCommitmentProgress,
  calculateStreakProjection,
  EvidenceItem,
} from '../services/kernel/commitment';
import {
  parseReminderPolicy,
  evaluateReminderPolicy,
} from '../services/kernel/reminders';
import { AttributeValue } from '../services/kernel/types';

export interface CommitmentCardProps {
  entityId: string;
  compact?: boolean;
}

export const CommitmentCard: React.FC<CommitmentCardProps> = ({
  entityId,
  compact = false,
}) => {
  const kernelEntities = useStore((s) => s.kernelEntities);
  const applyOperations = useStore((s) => s.applyOperations);
  const addToast = useStore((s) => s.addToast);
  const selectEntity = useStore((s) => s.selectEntity);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const entity = kernelEntities[entityId];
  if (!entity || entity.lifecycle.status === 'deleted' || entity.attributes.deleted === true) {
    return null;
  }

  const rawCommitment = entity.attributes.commitment || entity.attributes;
  const commitment = parseCommitmentTarget(rawCommitment);
  if (!commitment) {
    return null;
  }

  const evidence = parseEvidenceItems(entity.attributes.evidence);
  const progress = evaluateCommitmentProgress(commitment, evidence);
  const streak = calculateStreakProjection(commitment, evidence, undefined, 6);

  const rawReminder = entity.attributes.reminder_policy || entity.attributes.reminder;
  const reminderPolicy = parseReminderPolicy(rawReminder);
  const reminderResult = reminderPolicy
    ? evaluateReminderPolicy(reminderPolicy, progress, entity.title, entity.id)
    : null;

  const handleMarkCompleted = (): void => {
    setIsRecording(true);
    const nowIso = new Date().toISOString();
    const newEvidenceItem: EvidenceItem = {
      id: `evidence-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: nowIso,
      quantity: 1,
      note: 'Marked completed via UI',
      provenance: {
        source_type: 'user',
        observed_at: nowIso,
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    const nextEvidence = [...evidence, newEvidenceItem];
    const attributeArray: AttributeValue[] = nextEvidence.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      quantity: e.quantity || 1,
      note: e.note || '',
      provenance: {
        source_type: e.provenance.source_type,
        observed_at: e.provenance.observed_at,
        confidence: e.provenance.confidence,
        is_inferred: e.provenance.is_inferred,
        user_confirmed: e.provenance.user_confirmed,
      },
    }));

    applyOperations([
      {
        type: 'update_entity',
        payload: {
          id: entityId,
          fields: {
            metadata: { evidence: attributeArray },
            attributes: { evidence: attributeArray },
          },
        },
      },
    ]);

    setIsRecording(false);
    addToast(`Recorded progress for "${entity.title}"!`, 'success');
  };

  return (
    <div
      data-testid={`commitment-card-${entityId}`}
      className={`rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md p-5 transition-all hover:border-violet-500/30 ${
        compact ? 'shadow-sm' : 'shadow-lg'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => selectEntity(entityId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectEntity(entityId);
            }
          }}
          className="cursor-pointer group/title min-w-0 flex-1"
          aria-label={`Open details for commitment ${entity.title}`}
          data-testid={`commitment-title-btn-${entityId}`}
        >
          <h3 className="text-base font-semibold text-white tracking-wide group-hover/title:text-violet-300 transition-colors flex items-center gap-1.5 truncate">
            {entity.title}
            <ArrowUpRight size={13} className="text-slate-500 group-hover/title:text-violet-400 opacity-60 group-hover/title:opacity-100 transition-opacity shrink-0" />
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 capitalize truncate">
            {commitment.min_count} {commitment.target_unit || 'times'} per {commitment.period}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
              progress.is_completed
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}
          >
            {progress.is_completed ? '✓ Completed' : 'In Progress'}
          </span>
          <button
            type="button"
            onClick={() => selectEntity(entityId)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800/40 hover:bg-slate-800 border border-white/5 hover:border-violet-500/30 transition-all cursor-pointer"
            title="Amend commitment details"
            aria-label={`Amend commitment ${entity.title}`}
            data-testid={`commitment-amend-btn-${entityId}`}
          >
            <Sliders size={13} />
          </button>
        </div>
      </div>

      {/* Current Period Progress */}
      <div className="bg-slate-800/40 rounded-xl p-3 mb-4 border border-white/5">
        <div className="flex justify-between items-center text-xs text-slate-300 mb-1.5">
          <span className="font-medium text-slate-400">{progress.period_window.label}</span>
          <span className="font-semibold text-white">
            {progress.current_count} / {progress.target_count} {progress.unit}
          </span>
        </div>
        {/* Progress Bar */}
        <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              progress.is_completed ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-violet-500 to-indigo-500'
            }`}
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      {/* Streaks & Historical Periods */}
      {!compact && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl bg-slate-800/30 p-2.5 border border-white/5">
            <span className="block text-[11px] text-slate-400">Current Streak</span>
            <span className="text-sm font-bold text-violet-400 mt-0.5 block">
              {streak.current_streak} {commitment.period}
              {streak.current_streak === 1 ? '' : 's'} 🔥
            </span>
          </div>
          <div className="rounded-xl bg-slate-800/30 p-2.5 border border-white/5">
            <span className="block text-[11px] text-slate-400">Best Streak</span>
            <span className="text-sm font-bold text-amber-400 mt-0.5 block">
              {streak.longest_streak} {commitment.period}
              {streak.longest_streak === 1 ? '' : 's'} 🏆
            </span>
          </div>
        </div>
      )}

      {/* Previous Periods History Tickers */}
      {!compact && streak.history.length > 0 && (
        <div className="mb-4">
          <span className="text-[11px] font-medium text-slate-400 block mb-1.5">Recent Periods</span>
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            {streak.history.map((hist, idx) => (
              <div
                key={hist.window.start || idx}
                title={`${hist.window.label}: ${hist.is_completed ? 'Completed' : 'Missed'}`}
                className={`flex-1 min-w-[28px] h-7 rounded-lg flex items-center justify-center text-xs font-bold border transition-colors ${
                  hist.is_completed
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                    : 'bg-rose-500/10 text-rose-400/80 border-rose-500/20'
                }`}
              >
                {hist.is_completed ? '✓' : '✗'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Button & Reminder Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={handleMarkCompleted}
          disabled={isRecording}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm ${
            progress.is_completed
              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/10'
              : 'bg-violet-600 text-white hover:bg-violet-500 shadow-violet-500/20'
          }`}
        >
          {progress.is_completed ? '+ Record Another' : '✓ Mark Completed'}
        </button>

        {reminderResult && (
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block">Next Reminder</span>
            <span
              className={`text-xs ${
                reminderResult.reason === 'suppressed_already_completed'
                  ? 'text-slate-500 line-through'
                  : 'text-indigo-400 font-medium'
              }`}
            >
              {reminderResult.reason === 'suppressed_already_completed'
                ? 'Suppressed (Done)'
                : reminderResult.scheduled_at
                ? new Date(reminderResult.scheduled_at).toLocaleDateString(undefined, {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Pending'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
