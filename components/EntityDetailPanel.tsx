import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { v4 as uuidv4 } from 'uuid';
import { X, Calendar, Clock, Tag, Link2, AlertCircle, Trash2, Edit3, Save, RotateCcw, Plus, CheckSquare, Square, ChevronRight, ArrowUpRight, Sparkles, Timer, Repeat, Wand2, Shield, ShieldAlert, CornerRightDown, CornerRightUp, Lightbulb, TrendingUp, Eye, EyeOff } from 'lucide-react';
import { EntityKind, EntityStatus, RelationshipType, RecurrenceType, ToonOperation, Subtask, ActivityLogEntry } from '../types';
import SmartEditor from './SmartEditor';
import MarkdownText from './MarkdownText';
import { improveText } from '../services/ai';
import { calculateProgress } from '../utils/progressCalculation';
import { SkeletonEntityDetail } from './Skeleton';

const EntityDetailPanel: React.FC = () => {
    const { selectedEntityId, selectEntity, entities, relationships, universalTags, setPendingOps, applyOperations, addMessage, startFocusSession } = useStore();

    // Local Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<{
        title: string;
        description: string;
        status: EntityStatus;
        priority: number;
        recurrence: RecurrenceType;
        tags: string[]; // These are just strings for UI, we diff them on save
        tagInput: string;
        startTime: string; // ISO String
        endTime: string; // ISO String
        deadline: string; // ISO String
    } | null>(null);

    // Subtask & Linking State
    const [showAddSubtask, setShowAddSubtask] = useState(false);
    const [subtaskTitle, setSubtaskTitle] = useState('');

    const [showLinker, setShowLinker] = useState(false);
    const [linkSearch, setLinkSearch] = useState('');
    const [linkType, setLinkType] = useState<RelationshipType>(RelationshipType.FULFILLS);

    const [aiGenerating, setAiGenerating] = useState(false);

    // Activity Log Editor State
    const [showAddLog, setShowAddLog] = useState(false);
    const [logForm, setLogForm] = useState({ title: '', duration: 30, productivity: 'PRODUCTIVE', notes: '' });
    const [editingLogId, setEditingLogId] = useState<string | null>(null);

    const entity = entities.find(e => e.id === selectedEntityId);

    // Reset editing state when selection changes
    useEffect(() => {
        setIsEditing(false);
        setShowAddSubtask(false);
        setShowLinker(false);
        setSubtaskTitle('');
        setLinkSearch('');
        if (entity) {
            setEditForm({
                title: entity.title,
                description: entity.description || '',
                status: entity.status,
                priority: entity.priority,
                recurrence: entity.recurrence,
                tags: entity.canonical_tags || [],
                tagInput: '',
                startTime: entity.start_time || '',
                endTime: entity.end_time || '',
                deadline: entity.deadline || ''
            });
        }
    }, [entity?.id]);

    if (!selectedEntityId || !entity) return null;

    // Find relationships
    const relatedLinks = relationships.filter(r => r.from === entity.id || r.to === entity.id);

    // Distinguish children (Reverse PART_OF)
    const childrenLinks = relationships.filter(r => r.to === entity.id && r.type === RelationshipType.PART_OF);
    const childrenIds = new Set(childrenLinks.map(r => r.from));
    const childEntities = entities.filter(e => childrenIds.has(e.id));

    // Generic Links (excluding children to avoid duplication)
    const otherLinks = relatedLinks.filter(r => !(r.to === entity.id && r.type === RelationshipType.PART_OF));

    // Progress Calculation
    const progress = calculateProgress(entity, entities, relationships);

    // Helper to map technical types to human readable labels
    const getRelationshipLabel = (type: RelationshipType, isOutbound: boolean) => {
        switch (type) {
            case RelationshipType.DEPENDS_ON:
                return isOutbound ? "Blocked By" : "Blocks";
            case RelationshipType.PART_OF:
                return isOutbound ? "Part Of" : "Includes";
            case RelationshipType.PRECEDES:
                return isOutbound ? "Precedes" : "Follows";
            case RelationshipType.FULFILLS:
                return isOutbound ? "Fulfills" : "Fulfilled By";
            default:
                return isOutbound ? type : `Inbound ${type}`;
        }
    };

    const getRelationshipIcon = (label: string) => {
        if (label === "Blocked By") return <ShieldAlert size={12} className="text-orange-400" />;
        if (label === "Blocks") return <Shield size={12} className="text-red-400" />;
        if (label === "Part Of") return <CornerRightUp size={12} className="text-slate-400" />;
        if (label === "Includes") return <CornerRightDown size={12} className="text-slate-400" />;
        return <Link2 size={12} className="text-slate-500" />;
    };

    // Group links by Human Label
    const linksByType: Record<string, typeof otherLinks> = {};
    otherLinks.forEach(link => {
        const isOutbound = link.from === entity.id;
        const label = getRelationshipLabel(link.type, isOutbound);

        if (!linksByType[label]) linksByType[label] = [];
        linksByType[label].push(link);
    });

    const getRelatedEntity = (linkId: string, fromId: string, toId: string) => {
        const targetId = fromId === entity.id ? toId : fromId;
        return entities.find(e => e.id === targetId);
    };

    // Calculate Suggested Links based on shared tags
    const suggestedLinks = entities.filter(e =>
        e.id !== entity.id &&
        !relatedLinks.some(r => r.from === e.id || r.to === e.id) && // Not already linked
        e.canonical_tags && entity.canonical_tags &&
        e.canonical_tags.some(t => entity.canonical_tags.includes(t)) // Shares a tag
    ).slice(0, 3); // Top 3

    const handleDelete = () => {
        setPendingOps([
            {
                type: 'delete_entity',
                payload: { id: entity.id, title: entity.title }
            }
        ], 'manual-delete');
        selectEntity(null);
    };

    const handleSave = () => {
        if (!editForm) return;

        const updates: Record<string, any> = {};
        if (editForm.title !== entity.title) updates.title = editForm.title;
        if (editForm.description !== (entity.description || '')) updates.description = editForm.description;
        if (editForm.status !== entity.status) updates.status = editForm.status;
        if (editForm.priority !== entity.priority) updates.priority = editForm.priority;
        if (editForm.recurrence !== entity.recurrence) updates.recurrence = editForm.recurrence;

        // Dates
        if (editForm.startTime !== (entity.start_time || '')) updates.start_time = editForm.startTime || null;
        if (editForm.endTime !== (entity.end_time || '')) updates.end_time = editForm.endTime || null;
        if (editForm.deadline !== (entity.deadline || '')) updates.deadline = editForm.deadline || null;

        const ops: ToonOperation[] = [];

        // 1. Basic Updates
        if (Object.keys(updates).length > 0) {
            ops.push({
                type: 'update_entity',
                payload: {
                    id: entity.id,
                    fields: updates
                }
            });
        }

        // 2. Tag Synchronization (Diffing logic)
        const currentTags = entity.canonical_tags || [];
        const newTags = editForm.tags;

        // Find tags to ADD
        const tagsToAdd = newTags.filter(t => !currentTags.includes(t));
        tagsToAdd.forEach(tagTitle => {
            // Check if universal tag exists
            const existingTag = universalTags.find(t => t.title.toLowerCase() === tagTitle.toLowerCase());

            if (existingTag) {
                // Link to existing
                ops.push({
                    type: 'link_entities',
                    payload: { from: entity.id, to: existingTag.id, type: RelationshipType.TAGGED_WITH }
                });
            } else {
                // Create new TAG entity + Link
                const newTagId = uuidv4();
                ops.push({
                    type: 'create_entity',
                    payload: { id: newTagId, title: tagTitle, kind: EntityKind.TAG, status: EntityStatus.ACTIVE }
                });
                ops.push({
                    type: 'link_entities',
                    payload: { from: entity.id, to: newTagId, type: RelationshipType.TAGGED_WITH }
                });
            }
        });

        // Find tags to REMOVE
        const tagsToRemove = currentTags.filter(t => !newTags.includes(t));
        tagsToRemove.forEach(tagTitle => {
            // Find entity ID for this tag
            // Note: canonical_tags are strings, so we look up in universalTags (fast) or entities (slow)
            const tagEntity = universalTags.find(t => t.title === tagTitle) || entities.find(e => e.title === tagTitle && (e.kind === EntityKind.TAG || e.kind === EntityKind.CONTEXT));

            if (tagEntity) {
                ops.push({
                    type: 'unlink_entities',
                    payload: { from: entity.id, to: tagEntity.id, type: RelationshipType.TAGGED_WITH }
                });
            }
        });

        if (ops.length > 0) {
            applyOperations(ops);
        }

        setIsEditing(false);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setEditForm({
            title: entity.title,
            description: entity.description || '',
            status: entity.status,
            priority: entity.priority,
            recurrence: entity.recurrence,
            tags: entity.canonical_tags || [],
            tagInput: '',
            startTime: entity.start_time || '',
            endTime: entity.end_time || '',
            deadline: entity.deadline || ''
        });
    };

    const handleAddTag = () => {
        if (!editForm || !editForm.tagInput.trim()) return;
        const newTag = editForm.tagInput.trim();
        // Case insensitive check for duplicates in current list
        if (!editForm.tags.some(t => t.toLowerCase() === newTag.toLowerCase())) {
            setEditForm({
                ...editForm,
                tags: [...editForm.tags, newTag], // Keep original casing for display until saved
                tagInput: ''
            });
        }
    };

    const handleRemoveTag = (tag: string) => {
        if (!editForm) return;
        setEditForm({
            ...editForm,
            tags: editForm.tags.filter(t => t !== tag)
        });
    };

    const handleCreateSubtask = (e: React.FormEvent) => {
        e.preventDefault();
        if (!subtaskTitle.trim()) return;

        // NEW: Use nested subtask via add_subtask operation
        applyOperations([{
            type: 'add_subtask',
            payload: {
                entity_id: entity.id,
                title: subtaskTitle.trim()
            }
        }]);
        setSubtaskTitle('');
        setShowAddSubtask(false);
    };

    const handleCreateLink = (targetId: string, type: RelationshipType) => {
        applyOperations([{
            type: 'link_entities',
            payload: {
                from: entity.id,
                to: targetId,
                type
            }
        }]);
        setShowLinker(false);
        setLinkSearch('');
    };

    const toggleTaskStatus = (task: typeof entity) => {
        const newStatus = task.status === EntityStatus.COMPLETED ? EntityStatus.ACTIVE : EntityStatus.COMPLETED;
        applyOperations([{
            type: 'update_entity',
            payload: {
                id: task.id,
                fields: { status: newStatus }
            }
        }]);
    };

    const handleAiBreakdown = () => {
        if (confirm(`Ask AI to break down "${entity.title}" into subtasks?`)) {
            addMessage('user', `Please break down the ${entity.kind.toLowerCase()} "${entity.title}" into actionable subtasks. Create them and link them to it.`);
        }
    };

    const handleAiGenerateDescription = async () => {
        if (!editForm) return;
        setAiGenerating(true);
        try {
            const prompt = `Generate a concise, professional description for a ${entity.kind.toLowerCase()} titled "${entity.title}". Focus on actionable details.`;
            const desc = await improveText(prompt, 'expand');
            setEditForm(prev => prev ? ({ ...prev, description: desc }) : null);
        } catch (err) {
            console.error("AI Gen Failed", err);
        } finally {
            setAiGenerating(false);
        }
    };

    const handleStartFocus = () => {
        startFocusSession(entity.id);
    };

    const toDateTimeLocal = (isoStr: string) => {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    };

    const fromDateTimeLocal = (val: string) => {
        if (!val) return '';
        return new Date(val).toISOString();
    };

    const linkCandidates = showLinker ? entities.filter(e =>
        e.id !== entity.id &&
        e.title.toLowerCase().includes(linkSearch.toLowerCase()) &&
        !relatedLinks.some(r => r.from === e.id || r.to === e.id)
    ).slice(0, 5) : [];

    // Autocomplete candidates for tags
    const tagCandidates = isEditing && editForm?.tagInput
        ? universalTags.filter(t => t.title.toLowerCase().includes(editForm.tagInput.toLowerCase()) && !editForm.tags.includes(t.title)).slice(0, 5)
        : [];

    return (
        <>
            {/* Backdrop for mobile */}
            <div
                className="fixed inset-0 bg-black/50 z-30 md:hidden"
                onClick={() => selectEntity(null)}
            />
            <div className="fixed md:absolute bottom-0 md:top-0 right-0 md:right-0 h-[85vh] md:h-full w-full md:w-[420px] bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 shadow-2xl rounded-t-2xl md:rounded-none z-40 overflow-hidden flex flex-col animate-in slide-in-from-bottom md:slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/95 backdrop-blur">
                    <div className="flex-1 mr-4">
                        <span className="text-xs font-mono uppercase bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded mb-2 inline-block">
                            {entity.kind}
                        </span>
                        {isEditing ? (
                            <input
                                type="text"
                                value={editForm?.title}
                                onChange={e => setEditForm(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded px-2 py-1 mt-1 font-bold text-lg focus:ring-2 focus:ring-indigo-500/50 outline-none"
                            />
                        ) : (
                            <h2 className="text-xl font-bold text-slate-100 leading-tight break-words">{entity.title}</h2>
                        )}
                    </div>

                    <div className="flex gap-2">
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-colors"
                                title="Edit Entity"
                            >
                                <Edit3 size={18} />
                            </button>
                        )}
                        <button
                            onClick={() => selectEntity(null)}
                            className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {!isEditing && entity.status !== EntityStatus.COMPLETED && (
                        <button
                            onClick={handleStartFocus}
                            className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 rounded-lg flex items-center justify-center gap-2 transition-colors font-medium"
                        >
                            <Timer size={18} /> Start Focus Session
                        </button>
                    )}

                    {/* Status & Priority - Quick Toggle */}
                    <div className="flex gap-4">
                        <div className="flex-1 bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <span className="text-xs text-slate-500 uppercase tracking-wider block mb-2">Status</span>
                            {isEditing ? (
                                <select
                                    value={editForm?.status}
                                    onChange={e => setEditForm(prev => prev ? ({ ...prev, status: e.target.value as EntityStatus }) : null)}
                                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                >
                                    {Object.values(EntityStatus).map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => {
                                            if (entity.status !== EntityStatus.ACTIVE) {
                                                applyOperations([{ type: 'update_entity', payload: { id: entity.id, status: EntityStatus.ACTIVE } }]);
                                            }
                                        }}
                                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${entity.status === EntityStatus.ACTIVE
                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50'
                                            : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-700'
                                            }`}
                                    >
                                        ⏳ Active
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (entity.status !== EntityStatus.COMPLETED) {
                                                applyOperations([{ type: 'update_entity', payload: { id: entity.id, status: EntityStatus.COMPLETED } }]);
                                            }
                                        }}
                                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${entity.status === EntityStatus.COMPLETED
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                                            : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-700'
                                            }`}
                                    >
                                        ✅ Done
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (entity.status !== EntityStatus.ARCHIVED) {
                                                applyOperations([{ type: 'update_entity', payload: { id: entity.id, status: EntityStatus.ARCHIVED } }]);
                                            }
                                        }}
                                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${entity.status === EntityStatus.ARCHIVED
                                            ? 'bg-slate-600/20 text-slate-400 border border-slate-500/50'
                                            : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-700'
                                            }`}
                                    >
                                        📦 Archived
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="w-28 bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <span className="text-xs text-slate-500 uppercase tracking-wider block mb-2">Priority</span>
                            {isEditing ? (
                                <input
                                    type="number"
                                    min="1"
                                    max="5"
                                    value={editForm?.priority}
                                    onChange={e => setEditForm(prev => prev ? ({ ...prev, priority: parseInt(e.target.value) || 1 }) : null)}
                                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                />
                            ) : (
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(p => (
                                        <button
                                            key={p}
                                            onClick={() => {
                                                if (entity.priority !== p) {
                                                    applyOperations([{ type: 'update_entity', payload: { id: entity.id, priority: p } }]);
                                                }
                                            }}
                                            className={`w-6 h-6 rounded text-xs font-bold transition-colors ${entity.priority === p
                                                ? p === 1 ? 'bg-red-500/30 text-red-300 border border-red-500/50'
                                                    : p === 2 ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                                                        : p === 3 ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/50'
                                                            : p === 4 ? 'bg-green-500/30 text-green-300 border border-green-500/50'
                                                                : 'bg-slate-500/30 text-slate-300 border border-slate-500/50'
                                                : 'bg-slate-900 text-slate-600 hover:bg-slate-800 border border-slate-700'
                                                }`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Hide from AI Toggle */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-xs text-slate-500 uppercase tracking-wider block mb-0.5">AI Context</span>
                                <span className="text-sm text-slate-300">
                                    {entity.metadata?.hidden ? 'Hidden from AI' : 'Visible to AI'}
                                </span>
                            </div>
                            <button
                                onClick={() => {
                                    applyOperations([{
                                        type: 'update_entity',
                                        payload: {
                                            id: entity.id,
                                            fields: {
                                                metadata: {
                                                    ...entity.metadata,
                                                    hidden: !entity.metadata?.hidden
                                                }
                                            }
                                        }
                                    }]);
                                }}
                                className={`px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium transition-colors ${entity.metadata?.hidden
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                    }`}
                                title={entity.metadata?.hidden ? 'Show to AI (include in context)' : 'Hide from AI (exclude from context)'}
                            >
                                {entity.metadata?.hidden ? (
                                    <><EyeOff size={14} /> Hidden</>
                                ) : (
                                    <><Eye size={14} /> Visible</>
                                )}
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                            Hidden entities still appear in calendar but won't be sent to the AI
                        </p>
                    </div>

                    {/* Recurrence */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                        <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                            <Repeat size={12} /> Recurrence
                        </span>
                        {isEditing ? (
                            <select
                                value={editForm?.recurrence || ''}
                                onChange={e => setEditForm(prev => prev ? ({ ...prev, recurrence: (e.target.value || null) as RecurrenceType }) : null)}
                                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                            >
                                <option value="">None</option>
                                <option value="DAILY">Daily</option>
                                <option value="WEEKLY">Weekly</option>
                                <option value="MONTHLY">Monthly</option>
                                <option value="YEARLY">Yearly</option>
                            </select>
                        ) : (
                            <div className="flex flex-col gap-1">
                                <span className="text-sm font-medium text-slate-200">{entity.recurrence || 'None'}</span>
                                {entity.metadata?.rrule && (
                                    <span className="text-xs text-amber-400 font-mono">{entity.metadata.rrule}</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Progress Bar with Slider */}
                    {progress !== null && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                    <TrendingUp size={12} /> Progress
                                </span>
                                <div className="flex items-center gap-1">
                                    {isEditing ? (
                                        <>
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={progress || 0}
                                                onChange={(e) => {
                                                    const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                                    applyOperations([{
                                                        type: 'update_entity',
                                                        payload: {
                                                            id: entity.id,
                                                            fields: { metadata: { ...entity.metadata, manual_progress: val } }
                                                        }
                                                    }]);
                                                }}
                                                className="w-12 bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-1 text-right outline-none focus:border-indigo-500 transition-colors"
                                            />
                                            <span className="text-xs text-slate-500 font-mono">%</span>
                                        </>
                                    ) : (
                                        <span className="text-xs font-mono text-slate-300 font-medium">{progress}%</span>
                                    )}
                                </div>
                                {entity.duration_minutes && (
                                    <span className="text-[10px] text-slate-500 ml-2 font-mono">
                                        ({Math.round((progress || 0) / 100 * entity.duration_minutes)}m / {entity.duration_minutes}m)
                                    </span>
                                )}
                            </div>
                            <div className="w-full bg-slate-700 rounded-full h-2 mb-3">
                                <div
                                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Dates */}
                    <div className="space-y-3">
                        {(entity.start_time || isEditing) && (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                    <Calendar size={12} /> Start
                                </span>
                                {isEditing ? (
                                    <input
                                        type="datetime-local"
                                        value={toDateTimeLocal(editForm?.startTime || '')}
                                        onChange={e => setEditForm(prev => prev ? ({ ...prev, startTime: fromDateTimeLocal(e.target.value) }) : null)}
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                    />
                                ) : (
                                    <span className="text-sm font-medium text-slate-200">
                                        {new Date(entity.start_time!).toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                        {(entity.end_time || isEditing) && (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                    <Clock size={12} /> End Time
                                </span>
                                {isEditing ? (
                                    <input
                                        type="datetime-local"
                                        value={toDateTimeLocal(editForm?.endTime || '')}
                                        onChange={e => setEditForm(prev => prev ? ({ ...prev, endTime: fromDateTimeLocal(e.target.value) }) : null)}
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                    />
                                ) : (
                                    <span className="text-sm font-medium text-slate-200">
                                        {new Date(entity.end_time!).toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                        {(entity.deadline || isEditing) && (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                    <AlertCircle size={12} /> Deadline
                                </span>
                                {isEditing ? (
                                    <input
                                        type="datetime-local"
                                        value={toDateTimeLocal(editForm?.deadline || '')}
                                        onChange={e => setEditForm(prev => prev ? ({ ...prev, deadline: fromDateTimeLocal(e.target.value) }) : null)}
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                    />
                                ) : (
                                    <span className="text-sm font-medium text-slate-200">
                                        {new Date(entity.deadline!).toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Description */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-slate-500 uppercase tracking-wider">Description</span>
                            {isEditing && (
                                <button
                                    onClick={handleAiGenerateDescription}
                                    disabled={aiGenerating}
                                    className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                                >
                                    <Wand2 size={12} /> {aiGenerating ? 'Generating...' : 'AI Generate'}
                                </button>
                            )}
                        </div>
                        {isEditing ? (
                            <textarea
                                value={editForm?.description || ''}
                                onChange={e => setEditForm(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
                                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-2 outline-none min-h-[80px] resize-none"
                                placeholder="Add a description..."
                            />
                        ) : (
                            <div className="text-sm text-slate-300">
                                {entity.description ? (
                                    <MarkdownText content={entity.description} />
                                ) : (
                                    <span className="text-slate-500 italic">No description</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Tags */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                        <span className="text-xs text-slate-500 uppercase tracking-wider block mb-2 flex items-center gap-1">
                            <Tag size={12} /> Tags
                        </span>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {(isEditing ? editForm?.tags : entity.canonical_tags)?.map(tag => (
                                <span
                                    key={tag}
                                    className="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-xs flex items-center gap-1"
                                >
                                    {tag}
                                    {isEditing && (
                                        <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-400">
                                            <X size={12} />
                                        </button>
                                    )}
                                </span>
                            ))}
                            {(!isEditing && (!entity.canonical_tags || entity.canonical_tags.length === 0)) && (
                                <span className="text-slate-500 text-xs italic">No tags</span>
                            )}
                        </div>
                        {isEditing && (
                            <div className="relative">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={editForm?.tagInput || ''}
                                        onChange={e => setEditForm(prev => prev ? ({ ...prev, tagInput: e.target.value }) : null)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                                        placeholder="Add tag..."
                                        className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none"
                                    />
                                    <button
                                        onClick={handleAddTag}
                                        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                                {tagCandidates.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded shadow-lg z-10">
                                        {tagCandidates.map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => setEditForm(prev => prev ? ({ ...prev, tags: [...prev.tags, t.title], tagInput: '' }) : null)}
                                                className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                                            >
                                                {t.title}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Nested Subtasks (NEW: from metadata.subtasks) */}
                    {(() => {
                        const nestedSubtasks: Subtask[] = entity.metadata?.subtasks || [];
                        const totalSubtasks = nestedSubtasks.length + childEntities.length;

                        const toggleNestedSubtask = (subtaskId: string) => {
                            applyOperations([{
                                type: 'toggle_subtask',
                                payload: { entity_id: entity.id, subtask_id: subtaskId }
                            }]);
                        };

                        const deleteNestedSubtask = (subtaskId: string) => {
                            applyOperations([{
                                type: 'delete_subtask',
                                payload: { entity_id: entity.id, subtask_id: subtaskId }
                            }]);
                        };

                        return (totalSubtasks > 0 || !isEditing) && (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <CheckSquare size={12} /> Subtasks ({totalSubtasks})
                                    </span>
                                    {!isEditing && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowAddSubtask(!showAddSubtask)}
                                                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                            >
                                                <Plus size={12} /> Add
                                            </button>
                                            <button
                                                onClick={handleAiBreakdown}
                                                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                            >
                                                <Sparkles size={12} /> Auto-Break
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {showAddSubtask && (
                                    <form onSubmit={handleCreateSubtask} className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={subtaskTitle}
                                            onChange={e => setSubtaskTitle(e.target.value)}
                                            placeholder="Subtask title..."
                                            className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none"
                                            autoFocus
                                        />
                                        <button type="submit" className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded">
                                            Add
                                        </button>
                                    </form>
                                )}

                                <div className="space-y-1">
                                    {/* NEW: Render nested subtasks from metadata */}
                                    {nestedSubtasks.map(subtask => (
                                        <div
                                            key={subtask.id}
                                            className="flex items-center gap-2 p-2 rounded hover:bg-slate-700/50 group"
                                        >
                                            <button
                                                onClick={() => toggleNestedSubtask(subtask.id)}
                                                className="text-slate-400 hover:text-indigo-400"
                                            >
                                                {subtask.completed ? (
                                                    <CheckSquare size={16} className="text-green-400" />
                                                ) : (
                                                    <Square size={16} />
                                                )}
                                            </button>
                                            <span className={`text-sm flex-1 ${subtask.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                                                {subtask.title}
                                            </span>
                                            <button
                                                onClick={() => deleteNestedSubtask(subtask.id)}
                                                className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Delete subtask"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}

                                    {/* Legacy: Render PART_OF child entities for backwards compatibility */}
                                    {childEntities.map(child => (
                                        <div
                                            key={child.id}
                                            className="flex items-center gap-2 p-2 rounded hover:bg-slate-700/50 cursor-pointer group"
                                        >
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleTaskStatus(child); }}
                                                className="text-slate-400 hover:text-indigo-400"
                                            >
                                                {child.status === EntityStatus.COMPLETED ? (
                                                    <CheckSquare size={16} className="text-green-400" />
                                                ) : (
                                                    <Square size={16} />
                                                )}
                                            </button>
                                            <span
                                                onClick={() => selectEntity(child.id)}
                                                className={`text-sm flex-1 ${child.status === EntityStatus.COMPLETED ? 'line-through text-slate-500' : 'text-slate-200'}`}
                                            >
                                                {child.title}
                                            </span>
                                            <ChevronRight size={14} className="text-slate-500 opacity-0 group-hover:opacity-100" />
                                        </div>
                                    ))}

                                    {totalSubtasks === 0 && !showAddSubtask && (
                                        <span className="text-slate-500 text-xs italic">No subtasks</span>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Activity Log (NEW: from metadata.activity_log) */}
                    {/* Activity Log Section with Editor */}
                    {(entity.metadata?.activity_log?.length > 0 || entity.kind === EntityKind.HABIT || entity.kind === EntityKind.GOAL || entity.kind === EntityKind.PROJECT) && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                    <Clock size={12} /> Activity Log ({entity.metadata?.activity_log?.length || 0})
                                </span>
                                <button
                                    onClick={() => setShowAddLog(!showAddLog)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Add Log
                                </button>
                            </div>

                            {/* Add Log Form */}
                            {showAddLog && (
                                <div className="bg-slate-900/50 p-3 rounded-lg mb-3 space-y-2">
                                    <input
                                        type="text"
                                        placeholder="Activity title..."
                                        value={logForm.title}
                                        onChange={e => setLogForm({ ...logForm, title: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
                                    />
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            placeholder="Minutes"
                                            value={logForm.duration}
                                            onChange={e => setLogForm({ ...logForm, duration: parseInt(e.target.value) || 0 })}
                                            className="w-24 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
                                        />
                                        <select
                                            value={logForm.productivity}
                                            onChange={e => setLogForm({ ...logForm, productivity: e.target.value })}
                                            className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
                                        >
                                            <option value="PRODUCTIVE">🟢 Productive</option>
                                            <option value="NEUTRAL">⚪ Neutral</option>
                                            <option value="UNPRODUCTIVE">🔴 Unproductive</option>
                                            <option value="SLEEP">🔵 Sleep</option>
                                        </select>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (!logForm.title) return;

                                                if (editingLogId) {
                                                    // EDIT: Update existing log
                                                    const updated = (entity.metadata?.activity_log || []).map((l: any) =>
                                                        l.id === editingLogId
                                                            ? { ...l, title: logForm.title, duration_minutes: logForm.duration, productivity: logForm.productivity, notes: logForm.notes }
                                                            : l
                                                    );
                                                    applyOperations([{
                                                        type: 'update_entity',
                                                        payload: { id: entity.id, fields: { metadata: { ...entity.metadata, activity_log: updated } } }
                                                    }]);
                                                } else {
                                                    // ADD: Create new log
                                                    applyOperations([{
                                                        type: 'log_to_entity',
                                                        payload: {
                                                            entity_id: entity.id,
                                                            title: logForm.title,
                                                            duration_minutes: logForm.duration,
                                                            productivity: logForm.productivity,
                                                            notes: logForm.notes
                                                        }
                                                    }]);
                                                }

                                                setLogForm({ title: '', duration: 30, productivity: 'PRODUCTIVE', notes: '' });
                                                setEditingLogId(null);
                                                setShowAddLog(false);
                                            }}
                                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded"
                                        >
                                            {editingLogId ? 'Save' : 'Add'}
                                        </button>
                                        <button
                                            onClick={() => { setShowAddLog(false); setEditingLogId(null); setLogForm({ title: '', duration: 30, productivity: 'PRODUCTIVE', notes: '' }); }}
                                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Log List */}
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                                {(entity.metadata?.activity_log as ActivityLogEntry[] || []).slice().reverse().map((log: ActivityLogEntry) => (
                                    <div key={log.id} className="flex items-center justify-between text-sm p-2 rounded hover:bg-slate-700/30 group">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${log.productivity === 'PRODUCTIVE' ? 'bg-teal-500' :
                                                log.productivity === 'UNPRODUCTIVE' ? 'bg-rose-500' :
                                                    log.productivity === 'SLEEP' ? 'bg-indigo-500' : 'bg-slate-500'
                                                }`} />
                                            <span className="text-slate-300 truncate">{log.title}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400 text-xs font-mono">{log.duration_minutes}m</span>
                                            <span className="text-[9px] text-slate-600">{new Date(log.timestamp).toLocaleDateString()}</span>
                                            <button
                                                onClick={() => {
                                                    setEditingLogId(log.id);
                                                    setLogForm({
                                                        title: log.title,
                                                        duration: log.duration_minutes,
                                                        productivity: log.productivity || 'NEUTRAL',
                                                        notes: log.notes || ''
                                                    });
                                                    setShowAddLog(true);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:bg-slate-600 rounded transition-opacity"
                                            >
                                                <Edit3 size={12} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const updated = (entity.metadata?.activity_log || []).filter((l: any) => l.id !== log.id);
                                                    applyOperations([{
                                                        type: 'update_entity',
                                                        payload: { id: entity.id, fields: { metadata: { ...entity.metadata, activity_log: updated } } }
                                                    }]);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:bg-red-500/20 rounded transition-opacity"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {(!entity.metadata?.activity_log || entity.metadata.activity_log.length === 0) && (
                                    <span className="text-slate-500 text-xs italic">No activity logged yet</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Relationships / Links */}
                    {!isEditing && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                    <Link2 size={12} /> Links
                                </span>
                                <button
                                    onClick={() => setShowLinker(!showLinker)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Link
                                </button>
                            </div>

                            {showLinker && (
                                <div className="mb-3 space-y-2">
                                    <select
                                        value={linkType}
                                        onChange={e => setLinkType(e.target.value as RelationshipType)}
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded p-1 outline-none"
                                    >
                                        <option value={RelationshipType.RELATED_TO}>Related To</option>
                                        <option value={RelationshipType.PART_OF}>Part Of</option>
                                        <option value={RelationshipType.DEPENDS_ON}>Depends On</option>
                                        <option value={RelationshipType.PRECEDES}>Precedes</option>
                                        <option value={RelationshipType.FULFILLS}>Fulfills</option>
                                    </select>
                                    <input
                                        type="text"
                                        value={linkSearch}
                                        onChange={e => setLinkSearch(e.target.value)}
                                        placeholder="Search entities..."
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none"
                                    />
                                    {linkCandidates.length > 0 && (
                                        <div className="bg-slate-800 border border-slate-700 rounded">
                                            {linkCandidates.map(c => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => handleCreateLink(c.id, linkType)}
                                                    className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                                >
                                                    <span className="text-xs text-slate-500">{c.kind}</span>
                                                    {c.title}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Grouped Links */}
                            {Object.entries(linksByType).map(([label, links]) => (
                                <div key={label} className="mb-2">
                                    <span className="text-xs text-slate-400 flex items-center gap-1 mb-1">
                                        {getRelationshipIcon(label)} {label}
                                    </span>
                                    {links.map(link => {
                                        const related = getRelatedEntity(link.id, link.from, link.to);
                                        if (!related) return null;
                                        return (
                                            <div
                                                key={link.id}
                                                className="flex items-center gap-2 p-2 rounded hover:bg-slate-700/50 cursor-pointer text-sm text-slate-200 group"
                                            >
                                                <span onClick={() => selectEntity(related.id)} className="flex-1 flex items-center gap-2">
                                                    <span className="text-xs text-slate-500">{related.kind}</span>
                                                    {related.title}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`Remove link to "${related.title}"?`)) {
                                                            applyOperations([{
                                                                type: 'unlink_entities',
                                                                payload: { id: link.id }
                                                            }]);
                                                        }
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-all"
                                                    title="Remove link"
                                                >
                                                    <X size={12} />
                                                </button>
                                                <ArrowUpRight size={12} className="text-slate-500" onClick={() => selectEntity(related.id)} />
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}

                            {Object.keys(linksByType).length === 0 && !showLinker && (
                                <span className="text-slate-500 text-xs italic">No links</span>
                            )}
                        </div>
                    )}

                    {/* Suggested Links */}
                    {!isEditing && suggestedLinks.length > 0 && (
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-dashed border-slate-700">
                            <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-2">
                                <Lightbulb size={12} /> Suggested Links
                            </span>
                            {suggestedLinks.map(s => (
                                <div
                                    key={s.id}
                                    className="flex items-center justify-between p-2 rounded hover:bg-slate-700/50"
                                >
                                    <span className="text-sm text-slate-300">{s.title}</span>
                                    <button
                                        onClick={() => handleCreateLink(s.id, RelationshipType.RELATED_TO)}
                                        className="text-xs text-indigo-400 hover:text-indigo-300"
                                    >
                                        Link
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/95 backdrop-blur">
                    {isEditing ? (
                        <div className="flex gap-2">
                            <button
                                onClick={handleSave}
                                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center justify-center gap-2 font-medium"
                            >
                                <Save size={16} /> Save
                            </button>
                            <button
                                onClick={handleCancel}
                                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg flex items-center justify-center gap-2 font-medium"
                            >
                                <RotateCcw size={16} /> Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleDelete}
                            className="w-full py-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 rounded-lg flex items-center justify-center gap-2 font-medium"
                        >
                            <Trash2 size={16} /> Delete
                        </button>
                    )}
                </div>
            </div>
        </>
    );
};

export default EntityDetailPanel;