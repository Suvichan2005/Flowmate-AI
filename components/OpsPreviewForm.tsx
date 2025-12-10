import React, { useState } from 'react';
import { ToonOperation } from '../types';
import {
    Plus, RefreshCw, Link, Activity, X, ChevronDown, ChevronUp,
    Calendar, Clock, CheckCircle2, Edit3, Save, Repeat, Star, FileText,
    MapPin, Timer
} from 'lucide-react';

interface OpsPreviewFormProps {
    ops: ToonOperation[];
    onConfirm: (ops: ToonOperation[]) => void;
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

const OpsPreviewForm: React.FC<OpsPreviewFormProps> = ({ ops, onConfirm, onCancel }) => {
    const [editableOps, setEditableOps] = useState<ToonOperation[]>(() =>
        ops.map(op => JSON.parse(JSON.stringify(op)))
    );
    const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
    const [selectedOps, setSelectedOps] = useState<Set<number>>(() => new Set(ops.map((_, i) => i)));

    const updatePayloadField = (opIdx: number, field: string, value: any) => {
        setEditableOps(prev => prev.map((op, i) => {
            if (i !== opIdx) return op;
            return {
                ...op,
                payload: { ...op.payload, [field]: value }
            };
        }));
    };

    const updateMetadataField = (opIdx: number, field: string, value: any) => {
        setEditableOps(prev => prev.map((op, i) => {
            if (i !== opIdx) return op;
            const currentMeta = op.payload?.metadata || {};
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

    const handleConfirm = () => {
        const selected = editableOps.filter((_, i) => selectedOps.has(i));
        onConfirm(selected);
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
                icon = <Plus size={14} className="text-emerald-400" />;
                label = `Create ${kind}`;
                description = title;
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

    // Reusable field components
    const DateTimeField = ({ opIdx, field, label, value }: { opIdx: number; field: string; label: string; value: any }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Calendar size={12} className="text-slate-500 shrink-0" />
            <label className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input
                type="datetime-local"
                value={toLocalDatetimeInput(value)}
                onChange={(e) => updatePayloadField(opIdx, field, fromLocalDatetimeInput(e.target.value))}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const TextField = ({ opIdx, field, label, value, placeholder }: { opIdx: number; field: string; label: string; value: any; placeholder?: string }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Edit3 size={12} className="text-slate-500 shrink-0" />
            <label className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input
                type="text"
                value={value || ''}
                placeholder={placeholder}
                onChange={(e) => updatePayloadField(opIdx, field, e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const NumberField = ({ opIdx, field, label, value, placeholder }: { opIdx: number; field: string; label: string; value: any; placeholder?: string }) => (
        <div className="flex items-center gap-2 py-1.5">
            <Timer size={12} className="text-slate-500 shrink-0" />
            <label className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <input
                type="number"
                value={value || ''}
                placeholder={placeholder}
                onChange={(e) => updatePayloadField(opIdx, field, e.target.value ? parseInt(e.target.value) : null)}
                className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            />
        </div>
    );

    const SelectField = ({ opIdx, field, label, value, options }: { opIdx: number; field: string; label: string; value: any; options: { value: string; label: string }[] }) => (
        <div className="flex items-center gap-2 py-1.5">
            <ChevronDown size={12} className="text-slate-500 shrink-0" />
            <label className="text-xs text-slate-400 w-20 shrink-0">{label}</label>
            <select
                value={value || ''}
                onChange={(e) => updatePayloadField(opIdx, field, e.target.value || null)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
                <option value="">None</option>
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );

    const renderOpEditor = (op: ToonOperation, idx: number) => {
        const { type, kind } = getOpInfo(op);
        const p = op.payload || {};
        const meta = p.metadata || {};
        const currentKind = expandKind(p.kind || p.k);

        if (type === 'create_entity') {
            return (
                <div className="space-y-0.5 px-3 pb-3 pt-2">
                    {/* Core Fields */}
                    <TextField opIdx={idx} field="title" label="Title" value={p.title || p.t} placeholder="Enter title..." />

                    <SelectField opIdx={idx} field="kind" label="Type" value={currentKind} options={[
                        { value: 'TASK', label: '📋 Task' },
                        { value: 'EVENT', label: '📅 Event' },
                        { value: 'PROJECT', label: '📁 Project' },
                        { value: 'GOAL', label: '🎯 Goal' },
                        { value: 'HABIT', label: '🔄 Habit' },
                        { value: 'NOTE', label: '📝 Note' }
                    ]} />

                    <SelectField opIdx={idx} field="priority" label="Priority" value={p.priority?.toString()} options={[
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

                    {/* Event-specific: Start/End Time */}
                    {currentKind === 'EVENT' && (
                        <>
                            <DateTimeField opIdx={idx} field="start_time" label="Start" value={p.start_time || p.start} />
                            <DateTimeField opIdx={idx} field="end_time" label="End" value={p.end_time || p.end} />
                            <TextField opIdx={idx} field="location" label="Location" value={meta.location} placeholder="Add location..." />
                        </>
                    )}

                    {/* Task-specific: Deadline and Duration */}
                    {(currentKind === 'TASK' || currentKind === 'PROJECT' || currentKind === 'GOAL') && (
                        <>
                            <DateTimeField opIdx={idx} field="deadline" label="Deadline" value={p.deadline || p.due} />
                            <NumberField opIdx={idx} field="duration_minutes" label="Duration" value={p.duration_minutes || p.dur} placeholder="mins" />
                        </>
                    )}

                    {/* Recurrence for all types */}
                    <div className="border-t border-slate-800 mt-2 pt-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Repeat size={12} className="text-indigo-400" />
                            <span className="text-xs text-slate-300 font-medium">Recurrence</span>
                        </div>

                        <SelectField opIdx={idx} field="recurrence" label="Repeat" value={p.recurrence} options={[
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
                    <TextField opIdx={idx} field="title" label="Title" value={p.title} placeholder="New title..." />

                    <SelectField opIdx={idx} field="status" label="Status" value={p.status} options={[
                        { value: 'ACTIVE', label: '⏳ Active' },
                        { value: 'COMPLETED', label: '✅ Completed' },
                        { value: 'ARCHIVED', label: '📦 Archived' }
                    ]} />

                    <SelectField opIdx={idx} field="priority" label="Priority" value={p.priority?.toString()} options={[
                        { value: '1', label: '🔴 High (1)' },
                        { value: '2', label: '🟠 Medium (2)' },
                        { value: '3', label: '🟡 Normal (3)' },
                        { value: '4', label: '🟢 Low (4)' }
                    ]} />

                    <DateTimeField opIdx={idx} field="deadline" label="Deadline" value={p.deadline} />
                    <DateTimeField opIdx={idx} field="start_time" label="Start" value={p.start_time} />
                    <DateTimeField opIdx={idx} field="end_time" label="End" value={p.end_time} />

                    <div className="text-[10px] text-slate-600 mt-2 font-mono border-t border-slate-800 pt-2">
                        Target ID: {p.id?.slice(-16) || 'auto-resolve'}
                    </div>
                </div>
            );
        }

        if (type === 'log_to_entity') {
            return (
                <div className="space-y-0.5 px-3 pb-3 pt-2">
                    <TextField opIdx={idx} field="title" label="Activity" value={p.title || p.t} placeholder="What did you do?" />
                    <NumberField opIdx={idx} field="duration_minutes" label="Duration" value={p.dur || p.duration_minutes} placeholder="mins" />
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
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
                    <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        Review & Edit Operations
                    </h3>
                    <button onClick={onCancel} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Operations List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
                                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                >
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleOpSelection(idx); }}
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
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-slate-900">
                    <div className="text-xs text-slate-500">
                        {selectedOps.size} of {editableOps.length} selected
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={selectedOps.size === 0}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <Save size={14} />
                            Apply ({selectedOps.size})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OpsPreviewForm;
