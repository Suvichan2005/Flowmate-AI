import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ToonOperation, Entity } from '../types';
import {
    Plus, RefreshCw, Link, Activity, X, ChevronDown, ChevronUp,
    Calendar, Clock, CheckCircle2, Edit3, Save, Repeat, Star, FileText,
    MapPin, Timer, ShieldCheck, AlertTriangle
} from 'lucide-react';
import { useStore } from '../store';
import { getActiveEntities } from '../store/helpers';
import { ConfirmedExecutionPlan } from '../services/kernel';
import { saveReviewDraft, deleteReviewDraft } from '../services/action-review';
import { evaluateCandidateSlot, findEarliestFreeSlot } from '../utils/calendarConflicts';

interface OpsPreviewFormProps {
    ops: ToonOperation[];
    onConfirm: (confirmedPlan: ConfirmedExecutionPlan) => Promise<boolean>;
    onCancel: () => void;
}

// Short code expanders
const expandOpType = (type: string): string => {
    const map: Record<string, string> = {
        'c': 'create_entity', 'u': 'update_entity', 'd': 'delete_entity',
        'l': 'link_entities', 's': 'add_subtask', 'f': 'log_food',
        'log': 'log_to_entity', 'arc': 'archive_entity'
    };
    return map[type] || type;
};

const expandKind = (k: string): string => {
    const map: Record<string, string> = {
        'CTX': 'CONTEXT', 'GOL': 'GOAL', 'PRJ': 'PROJECT', 'TSK': 'TASK',
        'EVT': 'EVENT', 'HAB': 'HABIT', 'NOT': 'NOTE', 'PER': 'PERSON'
    };
    return map[k?.toUpperCase()] || k || 'TASK';
};

// FIXED: Format ISO to local datetime-local input (no timezone conversion bug)
const toLocalDatetimeInput = (iso: string | null | undefined): string => {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        // Use local components, not UTC
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${mins}`;
    } catch { return ''; }
};

// FIXED: Format local input to ISO (preserves local time)
const fromLocalDatetimeInput = (val: string): string | null => {
    if (!val) return null;
    try {
        // This creates a Date in local timezone
        return new Date(val).toISOString();
    } catch { return null; }
};

type PayloadFieldChange = (index: number, field: string, value: unknown) => void;

    // Reusable field components
    const DateTimeField = ({ opIdx, field, label, value, onPayloadFieldChange }: { opIdx: number; field: string; label: string; value: unknown; onPayloadFieldChange: PayloadFieldChange }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Calendar size={12} className="text-slate-500 shrink-0" />
            <label htmlFor={"op-"+opIdx+"-"+field} className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input id={"op-"+opIdx+"-"+field}
                type="datetime-local"
                value={toLocalDatetimeInput(typeof value === 'string' ? value : null)}
                onChange={(e) => onPayloadFieldChange(opIdx, field, fromLocalDatetimeInput(e.target.value))}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const TextField = ({ opIdx, field, label, value, placeholder, onPayloadFieldChange }: { opIdx: number; field: string; label: string; value: unknown; onPayloadFieldChange: PayloadFieldChange; placeholder?: string }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Edit3 size={12} className="text-slate-500 shrink-0" />
            <label htmlFor={"op-"+opIdx+"-"+field} className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input id={"op-"+opIdx+"-"+field}
                type="text"
                value={typeof value === 'string' ? value : ''}
                placeholder={placeholder}
                onChange={(e) => onPayloadFieldChange(opIdx, field, e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const NumberField = ({ opIdx, field, label, value, placeholder, onPayloadFieldChange }: { opIdx: number; field: string; label: string; value: unknown; onPayloadFieldChange: PayloadFieldChange; placeholder?: string }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Timer size={12} className="text-slate-500 shrink-0" />
            <label htmlFor={"op-"+opIdx+"-"+field} className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input id={"op-"+opIdx+"-"+field}
                type="number"
                value={typeof value === 'number' ? value : (typeof value === 'string' ? value : '')}
                placeholder={placeholder}
                onChange={(e) => onPayloadFieldChange(opIdx, field, e.target.value ? parseInt(e.target.value) : null)}
                className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const SelectField = ({ opIdx, field, label, value, options, onPayloadFieldChange }: { opIdx: number; field: string; label: string; value: unknown; onPayloadFieldChange: PayloadFieldChange; options: { value: string; label: string }[] }) => (
        <div className="flex items-center gap-2 py-1.5">
            <ChevronDown size={12} className="text-slate-500 shrink-0" />
            <label htmlFor={"op-"+opIdx+"-"+field} className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <select id={"op-"+opIdx+"-"+field}
                value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                onChange={(e) => onPayloadFieldChange(opIdx, field, e.target.value || null)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
                <option value="">None</option>
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );

    interface EventConflictFeedbackProps {
        startTimeIso?: string | null;
        endTimeIso?: string | null;
        candidateId?: string;
        isAllDay?: boolean;
        entities: Entity[];
        onApplyAlternativeSlot?: (startIso: string, endIso: string) => void;
    }

    const EventConflictFeedback: React.FC<EventConflictFeedbackProps> = ({
        startTimeIso,
        endTimeIso,
        candidateId,
        isAllDay,
        entities,
        onApplyAlternativeSlot
    }) => {
        if (!startTimeIso || !endTimeIso) return null;

        const evaluation = evaluateCandidateSlot(
            {
                startTimeIso,
                endTimeIso,
                candidateId,
                isAllDay: Boolean(isAllDay)
            },
            entities
        );

        if (evaluation.status === 'invalid_interval') {
            return (
                <div
                    className="mt-2 p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 flex items-center gap-2 text-xs text-amber-300"
                    data-testid="review-invalid-interval"
                >
                    <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                    <span>Invalid Time Interval ({evaluation.validationError || 'End time must be after start time'})</span>
                </div>
            );
        }

        if (evaluation.status === 'conflict') {
            const altSlot = findEarliestFreeSlot(
                {
                    startTimeIso,
                    endTimeIso,
                    candidateId,
                    isAllDay: Boolean(isAllDay)
                },
                entities
            );

            return (
                <div
                    className="mt-2 p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 space-y-2 text-xs"
                    data-testid="review-calendar-conflict"
                >
                    <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                        <span>
                            Schedule Conflict Detected ({evaluation.conflicts.length} collision{evaluation.conflicts.length > 1 ? 's' : ''})
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        {evaluation.conflicts.map(conf => (
                            <div
                                key={conf.collidingEventId}
                                className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-900/60 border border-amber-500/20 text-slate-300"
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <Clock size={12} className="text-amber-400 shrink-0" />
                                    <span className="font-medium truncate text-white">{conf.collidingEventTitle}</span>
                                    <span className="text-slate-400 text-[11px] shrink-0">({conf.formattedTimeSpan})</span>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono shrink-0">
                                    {conf.overlapMinutes}m overlap
                                </span>
                            </div>
                        ))}
                    </div>
                    {altSlot && onApplyAlternativeSlot && (
                        <div className="pt-1.5 flex items-center justify-between gap-2 border-t border-amber-500/20">
                            <span className="text-[11px] text-indigo-300">
                                Next available slot: +{altSlot.displacementMinutes}m
                            </span>
                            <button
                                type="button"
                                onClick={() => onApplyAlternativeSlot(altSlot.startTimeIso, altSlot.endTimeIso)}
                                className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                                data-testid="shift-to-alternative-slot"
                            >
                                Shift to Free Slot
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div
                className="mt-2 px-2.5 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex items-center gap-1.5 text-xs text-emerald-300"
                data-testid="review-slot-clear"
            >
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <span>Time slot is clear (no collisions)</span>
            </div>
        );
    };

const OpsPreviewForm: React.FC<OpsPreviewFormProps> = ({ ops, onConfirm, onCancel }) => {
    const planOperations = useStore(state => state.planOperations);
    const confirmPlan = useStore(state => state.confirmPlan);
    const kernelEntities = useStore(state => state.kernelEntities);
    const pendingOps = useStore(state => state.pendingOps);
    const rawEntities = useStore(state => state.entities);
    const entities = useMemo(() => getActiveEntities(rawEntities), [rawEntities]);

    const [editableOps, setEditableOps] = useState<ToonOperation[]>(() =>
        ops.map(op => JSON.parse(JSON.stringify(op)))
    );
    const executionInFlight = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const draftIdRef = useRef<string | null>(null);

    // Persist unconfirmed draft whenever editableOps changes
    useEffect(() => {
        if (editableOps.length === 0) return;
        let isCurrent = true;
        saveReviewDraft(
            'component_form',
            'Pending action review',
            editableOps,
            kernelEntities || {},
            {
                proposalId: pendingOps?.reviewId,
                originalMessageId: pendingOps?.originalMessageId
            }
        ).then(draft => {
            if (isCurrent) {
                draftIdRef.current = draft.id;
            }
        }).catch(() => {});

        return () => {
            isCurrent = false;
        };
    }, [editableOps, kernelEntities, pendingOps?.reviewId, pendingOps?.originalMessageId]);

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        return () => previous?.focus();
    }, []);
    useEffect(() => { if (submitting) dialogRef.current?.focus(); }, [submitting]);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
    const [selectedOps, setSelectedOps] = useState<Set<number>>(() => new Set(ops.map((_, i) => i)));

    const selectedOpsList = useMemo(() => {
        return editableOps.filter((_, i) => selectedOps.has(i));
    }, [editableOps, selectedOps]);

    const planResult = useMemo(() => {
        if (selectedOpsList.length === 0) return null;
        return planOperations(selectedOpsList, 'ai_agent');
    }, [selectedOpsList, planOperations, kernelEntities]);

    const updatePayloadField = (opIdx: number, field: string, value: unknown) => {
        setEditableOps(prev => prev.map((op, i) => {
            if (i !== opIdx) return op;
            return {
                ...op,
                payload: { ...op.payload, [field]: value }
            };
        }));
    };

    const updateMetadataField = (opIdx: number, field: string, value: unknown) => {
        setEditableOps(prev => prev.map((op, i) => {
            if (i !== opIdx) return op;
            const currentMeta = (typeof op.payload?.metadata === 'object' && op.payload?.metadata !== null)
                ? (op.payload.metadata as Record<string, unknown>)
                : {};
            return {
                ...op,
                payload: {
                    ...op.payload,
                    metadata: { ...currentMeta, [field]: value }
                }
            };
        }));
    };

    const toggleOpSelection = (idx: number) => {
        setSelectedOps(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const handleConfirm = async () => {
        if (executionInFlight.current || !planResult?.success || !planResult.plan || planResult.plan.validated_mutations.length === 0) return;
        executionInFlight.current = true;
        setSubmitting(true);
        setExecutionError(null);
        try {
            const committed = await onConfirm(confirmPlan(planResult.plan));
            if (committed) {
                if (draftIdRef.current) {
                    deleteReviewDraft(draftIdRef.current).catch(() => {});
                }
            } else {
                setExecutionError('Changes could not be saved. Your proposal is still here; review it before trying again.');
            }
        } catch {
            setExecutionError('Changes could not be saved. Your proposal is still here; review it before trying again.');
        } finally {
            executionInFlight.current = false;
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (draftIdRef.current) {
            deleteReviewDraft(draftIdRef.current).catch(() => {});
        }
        onCancel();
    };

    const handleDialogKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && !submitting) { event.preventDefault(); handleCancel(); }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
        if (controls.length === 0) { event.preventDefault(); dialogRef.current?.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };

    const getOpInfo = (op: ToonOperation) => {
        const type = expandOpType(op.type);
        const p = op.payload || {};
        const title = p.title || p.t || p.food_name || '';
        const kind = expandKind(p.kind || p.k);

        let icon = <CheckCircle2 size={14} className="text-slate-500" />;
        let label = type;
        let description = '';

        switch (type) {
            case 'create_entity':
                if (p.schema_id === 'system/memory_item' || kind === 'MEMORY') {
                    icon = <Star size={14} className="text-amber-400" />;
                    label = 'Create Memory Item';
                    description = p.content || (p.attributes as Record<string, unknown> | undefined)?.content as string || title;
                } else if (p.schema_id === 'system/situational_state') {
                    icon = <Activity size={14} className="text-purple-400" />;
                    label = 'Create Situational State';
                    description = p.details || (p.attributes as Record<string, unknown> | undefined)?.details as string || title;
                } else {
                    icon = <Plus size={14} className="text-emerald-400" />;
                    label = `Create ${kind}`;
                    description = title;
                }
                break;
            case 'update_entity':
                icon = <RefreshCw size={14} className="text-indigo-400" />;
                label = 'Update Entity';
                description = title || (p.id?.slice(-8) || 'entity');
                break;
            case 'link_entities':
                icon = <Link size={14} className="text-blue-400" />;
                label = 'Link Entities';
                description = p.type || 'RELATED_TO';
                break;
            case 'add_subtask':
                icon = <Plus size={14} className="text-cyan-400" />;
                label = 'Add Subtask';
                description = title;
                break;
            case 'log_food':
                icon = <Activity size={14} className="text-orange-400" />;
                label = 'Log Food';
                description = title + (p.cost ? ` (₹${p.cost})` : '');
                break;
            case 'log_to_entity':
                icon = <Activity size={14} className="text-yellow-400" />;
                label = 'Log Activity';
                description = title + (p.dur ? ` (${p.dur}m)` : '');
                break;
            case 'delete_entity':
                icon = <X size={14} className="text-red-400" />;
                label = 'Delete';
                description = p.id?.slice(-8) || '';
                break;
        }

        return { icon, label, description, type, kind };
    };

    const renderOpEditor = (op: ToonOperation, idx: number) => {
        const { type, kind } = getOpInfo(op);
        const p = op.payload || {};
        const meta = p.metadata || {};
        const currentKind = expandKind(p.kind || p.k);

        if (type === 'create_entity') {
            return (
                <div className="space-y-0.5 px-3 pb-3 pt-2">
                    {/* Core Fields */}
                    <TextField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="title" label="Title" value={p.title || p.t} placeholder="Enter title..." />

                    <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="kind" label="Type" value={currentKind} options={[
                        { value: 'TASK', label: '📋 Task' },
                        { value: 'EVENT', label: '📅 Event' },
                        { value: 'PROJECT', label: '📁 Project' },
                        { value: 'GOAL', label: '🎯 Goal' },
                        { value: 'HABIT', label: '🔄 Habit' },
                        { value: 'NOTE', label: '📝 Note' }
                    ]} />

                    <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="priority" label="Priority" value={p.priority?.toString()} options={[
                        { value: '1', label: '🔴 High (1)' },
                        { value: '2', label: '🟠 Medium (2)' },
                        { value: '3', label: '🟡 Normal (3)' },
                        { value: '4', label: '🟢 Low (4)' },
                        { value: '5', label: '⚪ Minimal (5)' }
                    ]} />

                    {/* Description */}
                    <div className="py-1.5">
                        <div className="flex items-start gap-2">
                            <FileText size={12} className="text-slate-500 mt-1 shrink-0" />
                            <label className="text-xs text-slate-400 w-20 shrink-0 mt-1">Description</label>
                            <textarea
                                value={p.description || p.d || ''}
                                onChange={(e) => updatePayloadField(idx, 'description', e.target.value || null)}
                                placeholder="Add description..."
                                rows={2}
                                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none resize-none"
                            />
                        </div>
                    </div>

                    {/* Event-specific: Start/End Time and Certainty */}
                    {currentKind === 'EVENT' && (
                        <>
                            <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="start_time" label="Start" value={p.start_time || p.start} />
                            <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="end_time" label="End" value={p.end_time || p.end} />
                            <EventConflictFeedback
                                startTimeIso={typeof (p.start_time || p.start) === 'string' ? (p.start_time || p.start) : null}
                                endTimeIso={typeof (p.end_time || p.end) === 'string' ? (p.end_time || p.end) : null}
                                candidateId={p.id}
                                isAllDay={Boolean(p.all_day || p.is_all_day || meta.all_day || meta.is_all_day)}
                                entities={entities}
                                onApplyAlternativeSlot={(startIso, endIso) => {
                                    if ('start' in p) updatePayloadField(idx, 'start', startIso);
                                    updatePayloadField(idx, 'start_time', startIso);
                                    if ('end' in p) updatePayloadField(idx, 'end', endIso);
                                    updatePayloadField(idx, 'end_time', endIso);
                                }}
                            />
                            <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="scheduling_certainty" label="Certainty" value={p.scheduling_certainty || meta.scheduling_certainty || 'unknown'} options={[
                                { value: 'confirmed', label: '✅ Confirmed' },
                                { value: 'tentative', label: '❓ Tentative' },
                                { value: 'cancelled', label: '❌ Cancelled' },
                                { value: 'unknown', label: '❔ Unknown' }
                            ]} />
                            <TextField
                                onPayloadFieldChange={(opIdx, field, value) => updateMetadataField(opIdx, field,
                                    typeof meta.location === 'object' && meta.location !== null && !Array.isArray(meta.location)
                                        ? { ...meta.location, address: value }
                                        : value)}
                                opIdx={idx} field="location" label="Location"
                                value={typeof meta.location === 'object' && meta.location !== null
                                    ? (meta.location as Record<string, unknown>).address : meta.location}
                                placeholder="Add location..." />
                        </>
                    )}

                    {/* Memory-specific: Content and Category */}
                    {(p.schema_id === 'system/memory_item' || currentKind === 'MEMORY') && (
                        <div className="border-t border-slate-800 mt-2 pt-2 space-y-1">
                            <div className="py-1">
                                <label className="text-xs text-slate-400 block mb-1">Memory Content</label>
                                <textarea
                                    value={p.content || (p.attributes as Record<string, unknown> | undefined)?.content as string || ''}
                                    onChange={(e) => updatePayloadField(idx, 'content', e.target.value)}
                                    placeholder="Enter learned memory fact or preference..."
                                    rows={2}
                                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none resize-none"
                                />
                            </div>
                            <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="category" label="Category" value={p.category || (p.attributes as Record<string, unknown> | undefined)?.category as string || 'fact'} options={[
                                { value: 'preference', label: '⭐ Preference' },
                                { value: 'fact', label: '📌 Fact' },
                                { value: 'project_context', label: '📁 Project Context' },
                                { value: 'relationship', label: '👥 Relationship' },
                                { value: 'goal_aspiration', label: '🎯 Goal Aspiration' },
                                { value: 'routine', label: '🔄 Routine' }
                            ]} />
                        </div>
                    )}

                    {/* Task-specific: Deadline and Duration */}
                    {(currentKind === 'TASK' || currentKind === 'PROJECT' || currentKind === 'GOAL') && (
                        <>
                            <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="deadline" label="Deadline" value={p.deadline || p.due} />
                            <NumberField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="duration_minutes" label="Duration" value={p.duration_minutes || p.dur} placeholder="mins" />
                        </>
                    )}

                    {/* Recurrence for all types */}
                    <div className="border-t border-slate-800 mt-2 pt-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Repeat size={12} className="text-indigo-400" />
                            <span className="text-xs text-slate-300 font-medium">Recurrence</span>
                        </div>

                        <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="recurrence" label="Repeat" value={p.recurrence} options={[
                            { value: 'DAILY', label: '📆 Daily' },
                            { value: 'WEEKLY', label: '📅 Weekly' },
                            { value: 'MONTHLY', label: '🗓️ Monthly' },
                            { value: 'YEARLY', label: '🎂 Yearly' },
                            { value: 'INTERVAL', label: '🔢 Every N days...' }
                        ]} />

                        {/* Interval-specific: every N days/weeks */}
                        {p.recurrence === 'INTERVAL' && (
                            <div className="flex items-center gap-2 py-1.5 ml-8">
                                <span className="text-xs text-slate-400">Every</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={meta.interval_days || ''}
                                    onChange={(e) => updateMetadataField(idx, 'interval_days', e.target.value ? parseInt(e.target.value) : null)}
                                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                                    placeholder="N"
                                />
                                <select
                                    value={meta.interval_unit || 'days'}
                                    onChange={(e) => updateMetadataField(idx, 'interval_unit', e.target.value)}
                                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                                >
                                    <option value="days">days</option>
                                    <option value="weeks">weeks</option>
                                </select>
                                <label className="flex items-center gap-1 text-xs text-slate-400 ml-2">
                                    <input
                                        type="checkbox"
                                        checked={meta.flexible_timing || false}
                                        onChange={(e) => updateMetadataField(idx, 'flexible_timing', e.target.checked)}
                                        className="rounded bg-slate-800 border-slate-600"
                                    />
                                    Flexible
                                </label>
                            </div>
                        )}

                        {/* RRULE for advanced patterns */}
                        <div className="py-1.5">
                            <div className="flex items-center gap-2">
                                <Edit3 size={12} className="text-slate-500 shrink-0" />
                                <label className="text-xs text-slate-400 w-20 shrink-0">RRULE</label>
                                <input
                                    type="text"
                                    value={meta.rrule || ''}
                                    onChange={(e) => updateMetadataField(idx, 'rrule', e.target.value || null)}
                                    placeholder="e.g. FREQ=MONTHLY;BYDAY=2SA"
                                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-amber-300 focus:border-indigo-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (type === 'update_entity') {
            return (
                <div className="space-y-0.5 px-3 pb-3 pt-2">
                    <TextField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="title" label="Title" value={p.title} placeholder="New title..." />

                    <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="status" label="Status" value={p.status} options={[
                        { value: 'ACTIVE', label: '⏳ Active' },
                        { value: 'COMPLETED', label: '✅ Completed' },
                        { value: 'ARCHIVED', label: '📦 Archived' }
                    ]} />

                    <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="priority" label="Priority" value={p.priority?.toString()} options={[
                        { value: '1', label: '🔴 High (1)' },
                        { value: '2', label: '🟠 Medium (2)' },
                        { value: '3', label: '🟡 Normal (3)' },
                        { value: '4', label: '🟢 Low (4)' }
                    ]} />

                    <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="deadline" label="Deadline" value={p.deadline} />
                    <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="start_time" label="Start" value={p.start_time} />
                    <DateTimeField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="end_time" label="End" value={p.end_time} />
                    {(p.start_time && p.end_time) && (
                        <EventConflictFeedback
                            startTimeIso={typeof p.start_time === 'string' ? p.start_time : null}
                            endTimeIso={typeof p.end_time === 'string' ? p.end_time : null}
                            candidateId={p.id}
                            isAllDay={Boolean(p.all_day || p.is_all_day || meta.all_day || meta.is_all_day)}
                            entities={entities}
                            onApplyAlternativeSlot={(startIso, endIso) => {
                                updatePayloadField(idx, 'start_time', startIso);
                                updatePayloadField(idx, 'end_time', endIso);
                            }}
                        />
                    )}

                    <SelectField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="scheduling_certainty" label="Certainty" value={p.scheduling_certainty || meta.scheduling_certainty} options={[
                        { value: 'confirmed', label: '✅ Confirmed' },
                        { value: 'tentative', label: '❓ Tentative' },
                        { value: 'cancelled', label: '❌ Cancelled' },
                        { value: 'unknown', label: '❔ Unknown' }
                    ]} />

                    <div className="text-[10px] text-slate-600 mt-2 font-mono border-t border-slate-800 pt-2">
                        Target ID: {p.id?.slice(-16) || 'auto-resolve'}
                    </div>
                </div>
            );
        }

        if (type === 'log_to_entity') {
            return (
                <div className="space-y-0.5 px-3 pb-3 pt-2">
                    <TextField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="title" label="Activity" value={p.title || p.t} placeholder="What did you do?" />
                    <NumberField onPayloadFieldChange={updatePayloadField} opIdx={idx} field="duration_minutes" label="Duration" value={p.dur || p.duration_minutes} placeholder="mins" />
                    <div className="text-[10px] text-slate-600 mt-2 font-mono">
                        Entity: {p.entity_id?.slice(-8) || 'unknown'}
                    </div>
                </div>
            );
        }

        // Default: show raw JSON for other types
        return (
            <div className="px-3 pb-3 pt-2">
                <pre className="text-[10px] text-slate-500 font-mono bg-slate-950 p-2 rounded overflow-auto max-h-24">
                    {JSON.stringify(p, null, 2)}
                </pre>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="operation-review-title" aria-busy={submitting} onKeyDown={handleDialogKeyDown} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
                    <h3 id="operation-review-title" className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        Review & Edit Operations
                    </h3>
                    <button ref={closeRef} aria-label="Close action review" disabled={submitting} onClick={handleCancel} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Greenfield Kernel Fingerprint & Validation Badge */}
                {ops.some(op => op.type === 'delete_entity') && <p role="note" className="mx-4 mt-3 text-xs text-amber-300">
                    Entity deletion cannot currently be undone. Cancel before applying if you want to retain it.
                </p>}
                {planResult?.plan && (
                    <div className="mx-3 mt-3 p-2.5 rounded-xl bg-slate-950/80 border border-indigo-500/30 flex items-center justify-between text-xs shrink-0">
                        <div className="flex items-center gap-2 text-indigo-300">
                            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                            <span className="font-medium text-slate-400">Plan Fingerprint:</span>
                            <span className="font-mono text-[11px] text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-slate-800" title={planResult.plan.plan_fingerprint}>
                                {planResult.plan.plan_fingerprint.slice(0, 16)}...
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                            <CheckCircle2 size={12} />
                            Schema Validated
                        </div>
                    </div>
                )}

                {!planResult?.success && selectedOps.size > 0 && <p role="alert" className="mx-3 mt-3 text-sm text-amber-300">This proposal cannot be applied: {planResult?.error || 'No valid changes were found.'}</p>}
                {executionError && <p role="alert" className="mx-3 mt-3 text-sm text-amber-300">{executionError}</p>}
                {/* Operations List */}
                <fieldset disabled={submitting} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                    {editableOps.map((op, idx) => {
                        const { icon, label, description } = getOpInfo(op);
                        const isExpanded = expandedIdx === idx;
                        const isSelected = selectedOps.has(idx);

                        return (
                            <div
                                key={idx}
                                className={`border rounded-xl overflow-hidden transition-all ${isSelected
                                        ? 'border-indigo-500/50 bg-indigo-950/20'
                                        : 'border-slate-800 bg-slate-950/50 opacity-50'
                                    }`}
                            >
                                <div
                                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-800/30 transition-colors"
                                    role="button" tabIndex={submitting ? -1 : 0} aria-label={"Edit action "+(idx+1)} aria-expanded={isExpanded}
                                    onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && !submitting) { event.preventDefault(); setExpandedIdx(isExpanded ? null : idx); } }}
                                    onClick={() => !submitting && setExpandedIdx(isExpanded ? null : idx)}
                                >
                                    <button
                                        aria-label={"Include action "+(idx+1)+": "+(description || label)} aria-pressed={isSelected} onClick={(e) => { e.stopPropagation(); toggleOpSelection(idx); }}
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${isSelected
                                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                                : 'border-slate-600 hover:border-slate-500'
                                            }`}
                                    >
                                        {isSelected && <CheckCircle2 size={10} />}
                                    </button>

                                    {icon}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-200">{label}</div>
                                        <div className="text-xs text-slate-500 truncate">{description}</div>
                                    </div>

                                    {isExpanded ? (
                                        <ChevronUp size={14} className="text-slate-500 shrink-0" />
                                    ) : (
                                        <ChevronDown size={14} className="text-slate-500 shrink-0" />
                                    )}
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-slate-800 bg-slate-900/50">
                                        {renderOpEditor(op, idx)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </fieldset>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-slate-900">
                    <div className="text-xs text-slate-500">
                        {selectedOps.size} of {editableOps.length} selected
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleCancel}
                            disabled={submitting}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={submitting || !planResult?.success || !planResult.plan || planResult.plan.validated_mutations.length === 0}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <Save size={14} />
                            {submitting ? 'Applying...' : 'Apply ('+selectedOps.size+')'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OpsPreviewForm;
