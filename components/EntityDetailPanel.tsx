import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { v4 as uuidv4 } from 'uuid';
import { X, Calendar, Clock, Tag, Link2, AlertCircle, AlertTriangle, Trash2, Edit3, Save, RotateCcw, Plus, CheckSquare, Square, ChevronRight, ChevronLeft, ArrowUpRight, Sparkles, Timer, Repeat, Wand2, Shield, ShieldAlert, CornerRightDown, CornerRightUp, Lightbulb, TrendingUp, Eye, EyeOff, Target, CheckCircle2, UserCheck, Bot, Brain, Sliders } from 'lucide-react';
import { EntityKind, EntityStatus, RelationshipType, RecurrenceType, ToonOperation, Subtask, ActivityLogEntry, Entity } from '../types';
import type { Provenance } from '../services/kernel';
import SmartEditor from './SmartEditor';
import MarkdownText from './MarkdownText';
import { improveText } from '../services/ai';
import { calculateProgress } from '../utils/progressCalculation';
import { SkeletonEntityDetail } from './Skeleton';
import { MemoryDetailView } from './MemoryDetailView';
import { extractMemoryItem } from '../services/context/resolver';
import {
  parseCommitmentTarget,
  parseEvidenceItems,
  evaluateCommitmentProgress,
  calculateStreakProjection,
  EvidenceItem,
  CommitmentTarget,
  CommitmentPeriod,
} from '../services/kernel/commitment';
import { findCalendarConflicts, findEarliestFreeSlot, CalendarConflict, EarliestFreeSlotResult, checkFocusSessionConflicts, FocusSessionConflictWarning } from '../utils/calendarConflicts';

const EntityDetailPanel: React.FC = () => {
    const { selectedEntityId, selectEntity, entities, relationships, universalTags, setPendingOps, applyOperations, addMessage, startFocusSession, kernelEntities, addToast } = useStore();

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

    // Navigation History State (Workflow 3 round-trip navigation)
    const [prevEntityId, setPrevEntityId] = useState<string | null>(null);
    const [currentId, setCurrentId] = useState<string | null>(selectedEntityId);

    // Inline Task & Note Creation State
    const [showAddDependentTask, setShowAddDependentTask] = useState(false);
    const [newDependentTaskTitle, setNewDependentTaskTitle] = useState('');
    const [showAddContextualNote, setShowAddContextualNote] = useState(false);
    const [newContextualNoteText, setNewContextualNoteText] = useState('');

    // Commitment Amendment State (Reference Workflow 1)
    const [isAmendingCommitment, setIsAmendingCommitment] = useState(false);
    const [amendedTargetCount, setAmendedTargetCount] = useState<number>(1);
    const [amendedPeriod, setAmendedPeriod] = useState<CommitmentPeriod>('week');
    const [amendedTargetUnit, setAmendedTargetUnit] = useState<string>('times');

    const entity = entities.find(e => e.id === selectedEntityId);

    // Track navigation history for back navigation
    useEffect(() => {
        if (selectedEntityId !== currentId) {
            if (currentId && currentId !== selectedEntityId) {
                setPrevEntityId(currentId);
            }
            setCurrentId(selectedEntityId);
        }
    }, [selectedEntityId, currentId]);

    // Reset editing state when selection changes
    useEffect(() => {
        setIsEditing(false);
        setShowAddSubtask(false);
        setShowLinker(false);
        setShowAddDependentTask(false);
        setShowAddContextualNote(false);
        setSubtaskTitle('');
        setLinkSearch('');
        setNewDependentTaskTitle('');
        setNewContextualNoteText('');
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

    const kernelEntity = selectedEntityId ? kernelEntities[selectedEntityId] : null;

    // Find relationships
    const relatedLinks = entity ? relationships.filter(r => r.from === entity.id || r.to === entity.id) : [];

    // Distinguish children (Reverse PART_OF)
    const childrenLinks = entity ? relationships.filter(r => r.to === entity.id && r.type === RelationshipType.PART_OF) : [];
    const childrenIds = new Set(childrenLinks.map(r => r.from));
    const childEntities = entities.filter(e => !e.metadata?.deleted && childrenIds.has(e.id));

    // Generic Links (excluding children and dedicated goal/dependency links to avoid duplication)
    const otherLinks = relatedLinks.filter(r => {
        if (entity && r.to === entity.id && r.type === RelationshipType.PART_OF) return false;
        if (r.type === RelationshipType.FULFILLS) return false;
        if (r.type === RelationshipType.DEPENDS_ON) return false;
        return true;
    });

    // Greenfield Kernel Metadata & Provenance (Workflow 4)
    const provenance = kernelEntity?.provenance || (entity?.metadata?._provenance as Provenance | undefined);
    const validity = kernelEntity?.validity;
    const version = kernelEntity?.version;

    // Goal-to-Task Linkage & Causal Hierarchy (Workflow 3)
    const fulfilledGoals = entity
        ? relationships
            .filter(r => r.from === entity.id && r.type === RelationshipType.FULFILLS)
            .map(r => entities.find(e => e.id === r.to))
            .filter((e): e is Entity => Boolean(e) && !e.metadata?.deleted)
        : [];

    const directFulfilling = entity
        ? relationships
            .filter(r => r.to === entity.id && r.type === RelationshipType.FULFILLS)
            .map(r => entities.find(e => e.id === r.from))
            .filter((e): e is Entity => Boolean(e) && !e.metadata?.deleted)
        : [];

    const childFulfilling = entity
        ? entities.filter(e =>
            !e.metadata?.deleted &&
            e.id !== entity.id &&
            (e.parent_id === entity.id || relationships.some(r => r.to === entity.id && r.from === e.id && r.type === RelationshipType.PART_OF))
        )
        : [];

    const fulfillingEntities = [...new Map([...directFulfilling, ...childFulfilling].map(e => [e.id, e])).values()];

    const blockedByEntities = entity
        ? relationships
            .filter(r => r.from === entity.id && r.type === RelationshipType.DEPENDS_ON)
            .map(r => entities.find(e => e.id === r.to))
            .filter((e): e is Entity => Boolean(e) && !e.metadata?.deleted)
        : [];

    const blockingEntities = entity
        ? relationships
            .filter(r => r.to === entity.id && r.type === RelationshipType.DEPENDS_ON)
            .map(r => entities.find(e => e.id === r.from))
            .filter((e): e is Entity => Boolean(e) && !e.metadata?.deleted)
        : [];

    // Calendar Consequences Projection (Workflow 3)
    const calendarConsequences = useMemo(() => {
        if (!entity) return { sessions: [], totalScheduledMinutes: 0, sessionCount: 0, hasOverdue: false };
        const dependentEntityIds = new Set<string>([entity.id, ...fulfillingEntities.map(f => f.id)]);

        // 1. Linked Calendar Events
        const linkedEvents = entities.filter(e => {
            if (e.metadata?.deleted || e.status === EntityStatus.ARCHIVED) return false;
            if (e.kind !== EntityKind.EVENT) return false;
            if (e.metadata?.goal_id === entity.id) return true;
            if (e.parent_id === entity.id) return true;
            const isRelLinked = relationships.some(r =>
                (dependentEntityIds.has(r.from) && r.to === e.id) ||
                (r.from === e.id && dependentEntityIds.has(r.to))
            );
            return isRelLinked;
        });

        // 2. Fulfilling tasks or goal with scheduled start/end or deadline
        const scheduledTasks = fulfillingEntities.filter(f => f.start_time || f.deadline);

        type CalendarSession = {
            id: string;
            title: string;
            kind: EntityKind;
            start_time?: string | null;
            end_time?: string | null;
            deadline?: string | null;
            durationMinutes: number;
            isOverdue?: boolean;
        };

        const sessions: CalendarSession[] = [];

        if (entity.deadline || entity.start_time) {
            sessions.push({
                id: entity.id,
                title: `${entity.title} (Target)`,
                kind: entity.kind,
                start_time: entity.start_time,
                end_time: entity.end_time,
                deadline: entity.deadline,
                durationMinutes: entity.duration_minutes || 0,
                isOverdue: Boolean(entity.deadline && new Date(entity.deadline) < new Date() && entity.status !== EntityStatus.COMPLETED)
            });
        }

        linkedEvents.forEach(evt => {
            const start = evt.start_time ? new Date(evt.start_time).getTime() : 0;
            const end = evt.end_time ? new Date(evt.end_time).getTime() : 0;
            const duration = end > start ? Math.round((end - start) / 60000) : (evt.duration_minutes || 60);
            sessions.push({
                id: evt.id,
                title: evt.title,
                kind: EntityKind.EVENT,
                start_time: evt.start_time,
                end_time: evt.end_time,
                durationMinutes: duration,
            });
        });

        scheduledTasks.forEach(tsk => {
            const isOverdue = Boolean(tsk.deadline && new Date(tsk.deadline) < new Date() && tsk.status !== EntityStatus.COMPLETED);
            sessions.push({
                id: tsk.id,
                title: tsk.title,
                kind: EntityKind.TASK,
                start_time: tsk.start_time,
                end_time: tsk.end_time,
                deadline: tsk.deadline,
                durationMinutes: tsk.duration_minutes || 30,
                isOverdue
            });
        });

        const uniqueSessions = [...new Map(sessions.map(s => [s.id, s])).values()]
            .sort((a, b) => {
                const timeA = new Date(a.start_time || a.deadline || 0).getTime();
                const timeB = new Date(b.start_time || b.deadline || 0).getTime();
                return timeA - timeB;
            });

        const totalScheduledMinutes = uniqueSessions.reduce((acc, s) => acc + s.durationMinutes, 0);

        return {
            sessions: uniqueSessions,
            totalScheduledMinutes,
            sessionCount: uniqueSessions.length,
            hasOverdue: uniqueSessions.some(s => s.isOverdue)
        };
    }, [entity, fulfillingEntities, entities, relationships]);

    // Contextual Notes & Beliefs Projection (Workflow 3)
    const contextualNotes = useMemo(() => {
        if (!entity) return [];
        type ContextualNoteItem = {
            id: string;
            title: string;
            content: string;
            type: 'kernel_memory' | 'domain_note';
            epistemicStatus?: 'user_decision' | 'assistant_proposal' | 'observed_code' | 'inferred_preference';
            speaker?: 'user' | 'assistant';
            sourceType?: string;
            confidence?: number;
            updatedAt: string;
        };

        const notes: ContextualNoteItem[] = [];

        Object.values(kernelEntities || {}).forEach(k => {
            if (k.schema_id !== 'system/memory_item' || k.lifecycle?.deleted_at || k.lifecycle?.status === 'deleted') return;
            const mem = extractMemoryItem(k);

            const isDirectlyAssociated = mem.associated_entity_ids?.includes(entity.id);
            const hasSharedTag = Boolean(entity.canonical_tags && mem.tags?.some(t => entity.canonical_tags?.includes(t)));
            const mentionsEntity = mem.content.toLowerCase().includes(entity.title.toLowerCase());

            if (isDirectlyAssociated || hasSharedTag || mentionsEntity) {
                notes.push({
                    id: k.id,
                    title: mem.title || 'Contextual Belief',
                    content: mem.content,
                    type: 'kernel_memory',
                    epistemicStatus: mem.epistemic_status as any,
                    speaker: mem.speaker,
                    sourceType: mem.source_type,
                    confidence: mem.confidence,
                    updatedAt: mem.updated_at
                });
            }
        });

        entities.forEach(e => {
            if (e.metadata?.deleted || e.kind !== EntityKind.NOTE) return;
            const isRelLinked = relationships.some(r =>
                (r.from === entity.id && r.to === e.id) ||
                (r.to === entity.id && r.from === e.id)
            );
            const isParentLinked = e.parent_id === entity.id;
            if (isRelLinked || isParentLinked) {
                notes.push({
                    id: e.id,
                    title: e.title,
                    content: e.description || '',
                    type: 'domain_note',
                    updatedAt: e.metadata?.updated_at || e.metadata?.created_at || ''
                });
            }
        });

        return notes;
    }, [entity, kernelEntities, entities, relationships]);

    // Progress Calculation
    const progress = entity ? calculateProgress(entity, entities, relationships) : null;

    // Commitment Capability Resolution (Reference Workflow 1)
    const commitmentTarget: CommitmentTarget | null = useMemo(() => {
        if (!entity && !kernelEntity) return null;
        const raw = kernelEntity?.attributes?.commitment ||
                    (entity ? (entity as any).attributes?.commitment : undefined) ||
                    entity?.metadata?.commitment;
        return parseCommitmentTarget(raw);
    }, [entity, kernelEntity]);

    const commitmentProgress = useMemo(() => {
        if (!commitmentTarget || !entity) return null;
        const rawEvidence = kernelEntity?.attributes?.evidence || entity.metadata?.evidence;
        const evidence = parseEvidenceItems(rawEvidence);
        const evalProgress = evaluateCommitmentProgress(commitmentTarget, evidence);
        const streak = calculateStreakProjection(commitmentTarget, evidence, undefined, 6);
        return { progress: evalProgress, streak, evidence };
    }, [commitmentTarget, entity, kernelEntity]);

    useEffect(() => {
        if (commitmentTarget) {
            setAmendedTargetCount(commitmentTarget.min_count);
            setAmendedPeriod(commitmentTarget.period);
            setAmendedTargetUnit(commitmentTarget.target_unit || 'times');
            setIsAmendingCommitment(false);
        }
    }, [commitmentTarget, selectedEntityId]);

    // Calendar Conflict & Grounding Analysis (Priority A)
    const eventConflicts = useMemo<CalendarConflict[]>(() => {
        if (!entity || entity.kind !== EntityKind.EVENT || isEditing) return [];
        const start = entity.start_time || entity.metadata?.start_time;
        const end = entity.end_time || entity.metadata?.end_time;
        if (!start) return [];
        const effectiveEnd = (end && new Date(end).getTime() > new Date(start).getTime())
            ? end
            : new Date(new Date(start).getTime() + (entity.duration_minutes || 60) * 60000).toISOString();
        return findCalendarConflicts(
            {
                candidateId: entity.id,
                startTimeIso: start,
                endTimeIso: effectiveEnd,
                isAllDay: entity.metadata?.all_day
            },
            entities
        );
    }, [entity, entities, isEditing]);

    const alternativeSlot = useMemo<EarliestFreeSlotResult | null>(() => {
        if (!entity || entity.kind !== EntityKind.EVENT || eventConflicts.length === 0) return null;
        const start = entity.start_time || entity.metadata?.start_time;
        const end = entity.end_time || entity.metadata?.end_time;
        if (!start) return null;
        const effectiveEnd = (end && new Date(end).getTime() > new Date(start).getTime())
            ? end
            : new Date(new Date(start).getTime() + (entity.duration_minutes || 60) * 60000).toISOString();
        return findEarliestFreeSlot(
            {
                candidateId: entity.id,
                startTimeIso: start,
                endTimeIso: effectiveEnd,
                isAllDay: entity.metadata?.all_day
            },
            entities
        );
    }, [entity, eventConflicts, entities]);

    const focusConflict = useMemo<FocusSessionConflictWarning>(() => {
        return checkFocusSessionConflicts(25, entities);
    }, [entities]);

    const [showFocusConflictModal, setShowFocusConflictModal] = useState<FocusSessionConflictWarning | null>(null);

    const handleStageReschedule = (newStartIso: string, newEndIso: string) => {
        if (!entity) return;
        const rescheduleOp: ToonOperation = {
            type: 'update_entity',
            payload: {
                id: entity.id,
                start_time: newStartIso,
                end_time: newEndIso
            },
            op: 'update_entity',
            id: entity.id
        } as unknown as ToonOperation;
        setPendingOps([rescheduleOp], `reschedule-${entity.id}`);
        if (addToast) {
            addToast('Reschedule Staged: Review and confirm in operations preview', 'info');
        }
    };

    // Render Memory, Preference & Decision Provenance Inspector (Reference Workflow 4)
    if (kernelEntity && kernelEntity.schema_id === 'system/memory_item' && !kernelEntity.lifecycle.deleted_at) {
        const memoryItem = extractMemoryItem(kernelEntity);
        return (
            <div className="w-80 md:w-96 border-l border-slate-800 bg-slate-900 flex flex-col h-full z-20 shrink-0 shadow-2xl animate-fade-in">
                <MemoryDetailView
                    memory={memoryItem}
                    kernelEntity={kernelEntity}
                    onClose={() => selectEntity(null)}
                    onNavigateToEntity={(id) => selectEntity(id)}
                    onBack={prevEntityId ? () => selectEntity(prevEntityId) : undefined}
                />
            </div>
        );
    }

    if (!selectedEntityId || !entity || entity.metadata?.deleted) return null;

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
        !e.metadata?.deleted &&
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

    const handleStartFocus = (customDuration?: number) => {
        if (!entity) return;
        if (customDuration) {
            startFocusSession(entity.id, customDuration);
            setShowFocusConflictModal(null);
            return;
        }

        const conflict = checkFocusSessionConflicts(25, entities);
        if (conflict.hasConflict) {
            setShowFocusConflictModal(conflict);
        } else {
            startFocusSession(entity.id, 25);
        }
    };

    const handleCreateDependentTask = () => {
        if (!newDependentTaskTitle.trim()) return;
        const newTaskId = uuidv4();
        const ops: ToonOperation[] = [
            {
                type: 'create_entity',
                payload: {
                    id: newTaskId,
                    title: newDependentTaskTitle.trim(),
                    kind: EntityKind.TASK,
                    status: EntityStatus.ACTIVE,
                    priority: entity.priority || 2,
                }
            },
            {
                type: 'link_entities',
                payload: {
                    from: newTaskId,
                    to: entity.id,
                    type: RelationshipType.FULFILLS
                }
            }
        ];
        applyOperations(ops);
        if (addToast) addToast(`Added task: ${newDependentTaskTitle.trim()}`, 'success');
        setNewDependentTaskTitle('');
        setShowAddDependentTask(false);
    };

    const handleScheduleWorkSession = () => {
        const newEventId = uuidv4();
        const sessionDate = new Date();
        sessionDate.setDate(sessionDate.getDate() + 1);
        sessionDate.setHours(10, 0, 0, 0);
        const sessionEnd = new Date(sessionDate.getTime() + 60 * 60 * 1000);

        const ops: ToonOperation[] = [
            {
                type: 'create_entity',
                payload: {
                    id: newEventId,
                    title: `Work Session: ${entity.title}`,
                    kind: EntityKind.EVENT,
                    status: EntityStatus.ACTIVE,
                    start_time: sessionDate.toISOString(),
                    end_time: sessionEnd.toISOString(),
                    duration_minutes: 60
                }
            },
            {
                type: 'link_entities',
                payload: {
                    from: newEventId,
                    to: entity.id,
                    type: RelationshipType.FULFILLS
                }
            }
        ];
        applyOperations(ops);
        if (addToast) addToast(`Scheduled 60m session for ${entity.title}`, 'success');
    };

    const handleCreateContextualNote = () => {
        if (!newContextualNoteText.trim()) return;
        const newNoteId = uuidv4();
        const ops: ToonOperation[] = [
            {
                type: 'create_entity',
                payload: {
                    id: newNoteId,
                    title: `Note: ${entity.title}`,
                    description: newContextualNoteText.trim(),
                    kind: EntityKind.NOTE,
                    status: EntityStatus.ACTIVE
                }
            },
            {
                type: 'link_entities',
                payload: {
                    from: newNoteId,
                    to: entity.id,
                    type: RelationshipType.RELATED_TO
                }
            }
        ];
        applyOperations(ops);
        if (addToast) addToast(`Added contextual note`, 'success');
        setNewContextualNoteText('');
        setShowAddContextualNote(false);
    };

    const handleSaveCommitmentAmendments = () => {
        if (!entity) return;
        const updatedCommitment = {
            min_count: Math.max(1, amendedTargetCount || 1),
            period: amendedPeriod,
            target_unit: amendedTargetUnit.trim() || 'times'
        };

        const ops: ToonOperation[] = [{
            type: 'update_entity',
            payload: {
                id: entity.id,
                fields: {
                    metadata: {
                        ...(entity.metadata || {}),
                        commitment: updatedCommitment
                    },
                    attributes: {
                        ...((entity as unknown as Record<string, unknown>).attributes as Record<string, unknown> || {}),
                        commitment: updatedCommitment
                    }
                }
            }
        }];

        applyOperations(ops);
        setIsAmendingCommitment(false);
        if (addToast) addToast(`Amended commitment target to ${updatedCommitment.min_count} ${updatedCommitment.target_unit} per ${updatedCommitment.period}`, 'success');
    };

    const handleRecordCommitmentProgress = () => {
        if (!entity || !commitmentProgress) return;
        const nowIso = new Date().toISOString();
        const newEvidenceItem: EvidenceItem = {
            id: `evidence-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: nowIso,
            quantity: 1,
            note: 'Logged via Entity Inspector',
            provenance: {
                source_type: 'user',
                observed_at: nowIso,
                confidence: 1.0,
                is_inferred: false,
                user_confirmed: true,
            },
        };

        const nextEvidence = [...commitmentProgress.evidence, newEvidenceItem];
        applyOperations([{
            type: 'update_entity',
            payload: {
                id: entity.id,
                fields: {
                    metadata: {
                        ...(entity.metadata || {}),
                        evidence: nextEvidence
                    },
                    attributes: {
                        ...((entity as unknown as Record<string, unknown>).attributes as Record<string, unknown> || {}),
                        evidence: nextEvidence
                    }
                }
            }
        }]);
        if (addToast) addToast(`Recorded progress for "${entity.title}"!`, 'success');
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
        !e.metadata?.deleted &&
        e.id !== entity.id &&
        e.title.toLowerCase().includes(linkSearch.toLowerCase()) &&
        !relatedLinks.some(r => r.from === e.id || r.to === e.id)
    ).slice(0, 5) : [];

    // Autocomplete candidates for tags
    const tagCandidates = isEditing && editForm?.tagInput
        ? universalTags.filter(t => t.title.toLowerCase().includes(editForm.tagInput.toLowerCase()) && !editForm.tags.includes(t.title)).slice(0, 5)
        : [];

    const prevEntity = prevEntityId && prevEntityId !== entity.id ? (entities.find(e => e.id === prevEntityId) || kernelEntities[prevEntityId]) : null;

    return (
        <>
            {/* Backdrop for mobile */}
            <div
                className="fixed inset-0 bg-black/50 z-30 md:hidden"
                onClick={() => selectEntity(null)}
            />
            <div role="complementary" aria-label="Entity details" className="fixed md:absolute bottom-0 md:top-0 right-0 md:right-0 h-[85vh] md:h-full w-full md:w-[420px] bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 shadow-2xl rounded-t-2xl md:rounded-none z-40 overflow-hidden flex flex-col animate-in slide-in-from-bottom md:slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/95 backdrop-blur">
                    <div className="flex-1 mr-4">
                        {prevEntity && (
                            <button
                                onClick={() => selectEntity(prevEntityId)}
                                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-300 transition-colors mb-2 cursor-pointer group"
                                title={`Back to ${('title' in prevEntity && prevEntity.title) ? prevEntity.title : prevEntity.id}`}
                                aria-label="Back to previous entity"
                            >
                                <ChevronLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
                                <span className="truncate max-w-[220px]">Back to {('title' in prevEntity && prevEntity.title) ? prevEntity.title : prevEntity.id}</span>
                            </button>
                        )}
                        <span className="text-xs font-mono uppercase bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded mb-2 inline-block">
                            {entity.kind}
                        </span>
                        {isEditing ? (
                            <input
                                type="text"
                                value={editForm?.title}
                                aria-label="Entity title"
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
                            aria-label="Close entity details"
                            className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {!isEditing && entity.status !== EntityStatus.COMPLETED && (
                        <div className="flex flex-col gap-1.5">
                            <button
                                onClick={() => handleStartFocus()}
                                className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 rounded-lg flex items-center justify-center gap-2 transition-colors font-medium cursor-pointer"
                                data-testid="start-focus-session-btn"
                            >
                                <Timer size={18} /> Start Focus Session
                            </button>
                            {focusConflict.hasConflict && focusConflict.collidingEvent && (
                                <div
                                    className="px-2.5 py-1 rounded-md bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-300 flex items-center justify-between"
                                    data-testid="focus-conflict-warning-pill"
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                                        {focusConflict.isEventOngoing ? 'Clashes with ongoing event' : `Clashes with event in ${focusConflict.minutesUntilNextEvent ?? 0}m`}: {focusConflict.collidingEvent.collidingEventTitle}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Status & Priority - Quick Toggle */}
                    <div className="flex gap-4">
                        <div className="flex-1 bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                            <span className="text-xs text-slate-500 uppercase tracking-wider block mb-2">Status</span>
                            {isEditing ? (
                                <select
                                    value={editForm?.status}
                                    aria-label="Entity status"
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

                    {/* Commitment Target & Policy (Reference Workflow 1) */}
                    {!isEditing && commitmentTarget && (
                        <div className="bg-violet-950/30 border border-violet-500/30 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm" data-testid="commitment-policy-card">
                            <div className="flex items-center justify-between text-xs text-violet-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5">
                                    <Target size={13} /> Commitment Target &amp; Cadence
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-violet-300 bg-violet-900/40 px-2 py-0.5 rounded border border-violet-500/20 capitalize" data-testid="commitment-cadence-badge">
                                        {commitmentTarget.min_count} {commitmentTarget.target_unit || 'times'} / {commitmentTarget.period}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setIsAmendingCommitment(prev => !prev)}
                                        className="text-[10px] font-mono text-violet-400 hover:text-violet-200 flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-900/40 hover:bg-violet-900/70 transition-colors cursor-pointer"
                                        aria-label="Amend commitment target"
                                        data-testid="amend-commitment-toggle-btn"
                                    >
                                        <Sliders size={11} /> {isAmendingCommitment ? 'Close' : 'Amend'}
                                    </button>
                                </div>
                            </div>

                            {/* Inline Amendment Form */}
                            {isAmendingCommitment ? (
                                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-violet-500/30 flex flex-col gap-2.5" data-testid="amend-commitment-form">
                                    <div className="text-[11px] font-medium text-slate-300">Amend Target Cadence</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <label className="text-[10px] text-slate-400 block mb-1">Target Count</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={amendedTargetCount}
                                                onChange={e => setAmendedTargetCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded px-2 py-1 outline-none focus:border-violet-400 font-mono"
                                                data-testid="amend-commitment-count-input"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-400 block mb-1">Unit</label>
                                            <input
                                                type="text"
                                                value={amendedTargetUnit}
                                                onChange={e => setAmendedTargetUnit(e.target.value)}
                                                placeholder="times, sessions..."
                                                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded px-2 py-1 outline-none focus:border-violet-400"
                                                data-testid="amend-commitment-unit-input"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-400 block mb-1">Period</label>
                                            <select
                                                value={amendedPeriod}
                                                onChange={e => setAmendedPeriod(e.target.value as CommitmentPeriod)}
                                                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded px-1.5 py-1 outline-none focus:border-violet-400"
                                                data-testid="amend-commitment-period-select"
                                            >
                                                <option value="day">Day</option>
                                                <option value="week">Week</option>
                                                <option value="month">Month</option>
                                                <option value="year">Year</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex justify-end gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setIsAmendingCommitment(false)}
                                            className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                                            data-testid="amend-commitment-cancel-btn"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSaveCommitmentAmendments}
                                            className="px-3 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 text-white rounded font-medium flex items-center gap-1 cursor-pointer"
                                            data-testid="amend-commitment-save-btn"
                                        >
                                            <Save size={11} /> Save Changes
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {commitmentProgress && (
                                        <>
                                            {/* Period Progress Bar */}
                                            <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800">
                                                <div className="flex justify-between items-center text-[11px] text-slate-300 mb-1">
                                                    <span className="font-medium text-slate-400">{commitmentProgress.progress.period_window.label}</span>
                                                    <span className="font-semibold text-violet-300 font-mono">
                                                        {commitmentProgress.progress.current_count} / {commitmentProgress.progress.target_count} {commitmentProgress.progress.unit}
                                                    </span>
                                                </div>
                                                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-300 ${
                                                            commitmentProgress.progress.is_completed
                                                                ? 'bg-emerald-500'
                                                                : 'bg-violet-500'
                                                        }`}
                                                        style={{ width: `${commitmentProgress.progress.percentage}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Streak & Quick Action */}
                                            <div className="flex items-center justify-between pt-0.5">
                                                <span className="text-[11px] text-amber-400 font-medium flex items-center gap-1">
                                                    {commitmentProgress.streak.current_streak} {commitmentTarget.period} streak 🔥
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={handleRecordCommitmentProgress}
                                                    className="px-2 py-1 text-[10px] font-medium rounded bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 text-violet-200 flex items-center gap-1 transition-colors cursor-pointer"
                                                    data-testid="commitment-log-progress-btn"
                                                >
                                                    <CheckCircle2 size={11} /> + Log Progress
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Goal-to-Task Linkage & Causal Hierarchy (Workflow 3) */}
                    {!isEditing && fulfilledGoals.length > 0 && (
                        <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-sm" data-testid="fulfilled-goals-card">
                            <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5"><Target size={13} /> Fulfills Goal</span>
                                <span className="text-[10px] font-mono text-emerald-500/80">Workflow Linkage</span>
                            </div>
                            {fulfilledGoals.map(g => (
                                <div
                                    key={g.id}
                                    onClick={() => selectEntity(g.id)}
                                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-emerald-500/20 cursor-pointer transition-all hover:border-emerald-400/40 group"
                                >
                                    <span className="text-xs font-medium text-slate-200 group-hover:text-emerald-300 truncate mr-2">
                                        {g.title}
                                    </span>
                                    <ArrowUpRight size={13} className="text-emerald-400/70 group-hover:text-emerald-300 shrink-0" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Dependent Workstream (Workflow 3) */}
                    {!isEditing && (entity.kind === EntityKind.GOAL || entity.kind === EntityKind.PROJECT || fulfillingEntities.length > 0) && (
                        <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm" data-testid="dependent-workstream-card">
                            <div className="flex items-center justify-between text-xs text-indigo-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5"><Target size={13} /> Dependent Workstream ({fulfillingEntities.length})</span>
                                <button
                                    onClick={() => setShowAddDependentTask(prev => !prev)}
                                    className="text-[10px] font-mono text-indigo-400 hover:text-indigo-200 flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-900/40 hover:bg-indigo-900/70 transition-colors cursor-pointer"
                                    aria-label="Add fulfilling task"
                                >
                                    <Plus size={11} /> Add Task
                                </button>
                            </div>

                            {/* Inline Add Task Form */}
                            {showAddDependentTask && (
                                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-indigo-500/30 flex flex-col gap-2">
                                    <input
                                        type="text"
                                        value={newDependentTaskTitle}
                                        onChange={e => setNewDependentTaskTitle(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleCreateDependentTask(); }}
                                        placeholder="New fulfilling task title..."
                                        className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded px-2.5 py-1.5 outline-none focus:border-indigo-400"
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => { setShowAddDependentTask(false); setNewDependentTaskTitle(''); }}
                                            className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleCreateDependentTask}
                                            className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium flex items-center gap-1 cursor-pointer"
                                        >
                                            <Plus size={11} /> Create & Link
                                        </button>
                                    </div>
                                </div>
                            )}

                            {fulfillingEntities.length > 0 ? (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {fulfillingEntities.map(f => {
                                        const isCompleted = f.status === EntityStatus.COMPLETED;
                                        return (
                                            <div
                                                key={f.id}
                                                data-testid={`dependent-workstream-item-${f.id}`}
                                                onClick={() => selectEntity(f.id)}
                                                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-indigo-500/20 cursor-pointer transition-all hover:border-indigo-400/40 group"
                                            >
                                                <div className="flex items-center gap-2 min-w-0 mr-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleTaskStatus(f);
                                                        }}
                                                        className={`p-0.5 rounded transition-colors ${isCompleted ? 'text-emerald-400 hover:text-slate-400' : 'text-slate-500 hover:text-indigo-400'}`}
                                                        title={isCompleted ? "Mark active" : "Mark complete"}
                                                    >
                                                        {isCompleted ? <CheckSquare size={13} /> : <Square size={13} />}
                                                    </button>
                                                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">{f.kind}</span>
                                                    <span className={`text-xs truncate ${isCompleted ? 'line-through text-slate-500' : 'text-slate-200 group-hover:text-indigo-300'}`}>
                                                        {f.title}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {f.deadline && (
                                                        <span className="text-[10px] text-slate-500 font-mono hidden group-hover:inline">
                                                            {new Date(f.deadline).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                    <ArrowUpRight size={13} className="text-indigo-400/70 group-hover:text-indigo-300" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-[11px] text-slate-400 italic p-2 rounded bg-slate-900/50 border border-slate-800/80">
                                    No fulfilling workstream linked yet. Click &quot;Add Task&quot; to define milestones.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Upstream Blockers (Dependency Gate) */}
                    {!isEditing && blockedByEntities.length > 0 && (
                        <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-sm" data-testid="blocked-by-card">
                            <div className="flex items-center justify-between text-xs text-amber-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5"><ShieldAlert size={13} /> Blocked By ({blockedByEntities.length})</span>
                                <span className="text-[10px] font-mono text-amber-500/80">Dependency Gate</span>
                            </div>
                            {blockedByEntities.map(b => (
                                <div
                                    key={b.id}
                                    onClick={() => selectEntity(b.id)}
                                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-amber-500/20 cursor-pointer transition-all hover:border-amber-400/40 group"
                                >
                                    <span className="text-xs font-medium text-slate-200 group-hover:text-amber-300 truncate mr-2">{b.title}</span>
                                    <ArrowUpRight size={13} className="text-amber-400/70 group-hover:text-amber-300 shrink-0" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Downstream Dependents (Blocks) */}
                    {!isEditing && blockingEntities.length > 0 && (
                        <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-sm" data-testid="blocks-downstream-card">
                            <div className="flex items-center justify-between text-xs text-red-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5"><Shield size={13} /> Blocks ({blockingEntities.length})</span>
                                <span className="text-[10px] font-mono text-red-500/80">Downstream Dependent</span>
                            </div>
                            {blockingEntities.map(b => (
                                <div
                                    key={b.id}
                                    onClick={() => selectEntity(b.id)}
                                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-red-500/20 cursor-pointer transition-all hover:border-red-400/40 group"
                                >
                                    <span className="text-xs font-medium text-slate-200 group-hover:text-red-300 truncate mr-2">{b.title}</span>
                                    <ArrowUpRight size={13} className="text-red-400/70 group-hover:text-red-300 shrink-0" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Calendar Consequences (Workflow 3) */}
                    {!isEditing && (entity.kind === EntityKind.GOAL || entity.kind === EntityKind.PROJECT || calendarConsequences.sessionCount > 0 || entity.deadline || entity.start_time) && (
                        <div className="bg-sky-950/30 border border-sky-500/30 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm" data-testid="calendar-consequences-card">
                            <div className="flex items-center justify-between text-xs text-sky-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5">
                                    <Calendar size={13} /> Calendar Consequences ({calendarConsequences.sessionCount})
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {calendarConsequences.totalScheduledMinutes > 0 && (
                                        <span className="text-[10px] font-mono text-sky-400 bg-sky-900/40 px-1.5 py-0.5 rounded">
                                            {calendarConsequences.totalScheduledMinutes}m scheduled
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Quick Action: Schedule Work Session */}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleScheduleWorkSession}
                                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                    aria-label="Schedule work session"
                                >
                                    <Calendar size={12} /> Schedule Work Session
                                </button>
                                <button
                                    onClick={() => handleStartFocus()}
                                    className="py-1.5 px-2.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                    aria-label="Start focus session"
                                >
                                    <Timer size={12} /> Focus 25m
                                </button>
                            </div>

                            {/* Sessions list */}
                            {calendarConsequences.sessions.length > 0 ? (
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {calendarConsequences.sessions.map(s => (
                                        <div
                                            key={s.id}
                                            data-testid={`calendar-consequence-item-${s.id}`}
                                            onClick={() => selectEntity(s.id)}
                                            className={`flex items-center justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border cursor-pointer transition-all group ${s.isOverdue ? 'border-rose-500/40 hover:border-rose-400' : 'border-sky-500/20 hover:border-sky-400/40'}`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 mr-2">
                                                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 border border-slate-700 shrink-0">
                                                    {s.kind}
                                                </span>
                                                <span className="text-xs font-medium text-slate-200 group-hover:text-sky-300 truncate">
                                                    {s.title}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {s.isOverdue && (
                                                    <span className="text-[9px] font-mono text-rose-400 uppercase bg-rose-950/40 px-1 py-0.5 rounded border border-rose-500/30">
                                                        Overdue
                                                    </span>
                                                )}
                                                <span className="text-[10px] font-mono text-slate-400">
                                                    {s.start_time ? new Date(s.start_time).toLocaleDateString() : s.deadline ? new Date(s.deadline).toLocaleDateString() : ''}
                                                </span>
                                                <ArrowUpRight size={12} className="text-sky-400/70 group-hover:text-sky-300" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-[11px] text-slate-400 italic p-2 rounded bg-slate-900/50 border border-slate-800/80">
                                    No calendar commitments scheduled yet. Click &quot;Schedule Work Session&quot; to reserve dedicated time.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Contextual Notes & Decisions (Workflow 3) */}
                    {!isEditing && (entity.kind === EntityKind.GOAL || entity.kind === EntityKind.PROJECT || contextualNotes.length > 0) && (
                        <div className="bg-purple-950/30 border border-purple-500/30 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm" data-testid="contextual-notes-card">
                            <div className="flex items-center justify-between text-xs text-purple-400 font-semibold uppercase tracking-wider">
                                <span className="flex items-center gap-1.5">
                                    <Brain size={13} /> Contextual Notes &amp; Decisions ({contextualNotes.length})
                                </span>
                                <button
                                    onClick={() => setShowAddContextualNote(prev => !prev)}
                                    className="text-[10px] font-mono text-purple-400 hover:text-purple-200 flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-900/40 hover:bg-purple-900/70 transition-colors cursor-pointer"
                                    aria-label="Add contextual note"
                                >
                                    <Plus size={11} /> Add Note
                                </button>
                            </div>

                            {/* Add Contextual Note Form */}
                            {showAddContextualNote && (
                                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-purple-500/30 flex flex-col gap-2">
                                    <textarea
                                        value={newContextualNoteText}
                                        onChange={e => setNewContextualNoteText(e.target.value)}
                                        placeholder="Capture decision, constraint, or contextual note..."
                                        className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded p-2 outline-none focus:border-purple-400 min-h-[60px] resize-none"
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => { setShowAddContextualNote(false); setNewContextualNoteText(''); }}
                                            className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleCreateContextualNote}
                                            className="px-2.5 py-1 text-[11px] bg-purple-600 hover:bg-purple-500 text-white rounded font-medium flex items-center gap-1 cursor-pointer"
                                        >
                                            <Plus size={11} /> Save Note
                                        </button>
                                    </div>
                                </div>
                            )}

                            {contextualNotes.length > 0 ? (
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {contextualNotes.map(n => {
                                        const isDecision = n.epistemicStatus === 'user_decision' || n.sourceType === 'user_explicit';
                                        const isProposal = n.epistemicStatus === 'assistant_proposal' || n.sourceType === 'inferred';
                                        return (
                                            <div
                                                key={n.id}
                                                data-testid={`contextual-note-item-${n.id}`}
                                                onClick={() => selectEntity(n.id)}
                                                className="flex items-start justify-between p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-purple-500/20 cursor-pointer transition-all hover:border-purple-400/40 group"
                                            >
                                                <div className="flex-1 min-w-0 mr-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        {isDecision ? (
                                                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                                                <UserCheck size={9} /> User Decision
                                                            </span>
                                                        ) : isProposal ? (
                                                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-400 border border-indigo-500/30 flex items-center gap-1">
                                                                <Bot size={9} /> Proposal
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-purple-400 border border-slate-700 flex items-center gap-1">
                                                                <Lightbulb size={9} /> Note
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-slate-400 truncate font-medium">
                                                            {n.title}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed group-hover:text-purple-200">
                                                        {n.content}
                                                    </p>
                                                </div>
                                                <ArrowUpRight size={12} className="text-purple-400/70 group-hover:text-purple-300 shrink-0 mt-1" />
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-[11px] text-slate-400 italic p-2 rounded bg-slate-900/50 border border-slate-800/80">
                                    No contextual notes or decisions linked. Click &quot;Add Note&quot; to capture context.
                                </div>
                            )}
                        </div>
                    )}

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

                    {/* Calendar Collision & Alternative Slot Grounding (Priority A) */}
                    {entity.kind === EntityKind.EVENT && !isEditing && (
                        eventConflicts.length > 0 ? (
                            <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm" data-testid="schedule-conflict-card">
                                <div className="flex items-center justify-between text-xs text-amber-400 font-semibold uppercase tracking-wider">
                                    <span className="flex items-center gap-1.5">
                                        <AlertTriangle size={13} className="text-amber-400" /> Schedule Collision Detected ({eventConflicts.length})
                                    </span>
                                </div>

                                <div className="flex flex-col gap-2">
                                    {eventConflicts.map((c) => (
                                        <div
                                            key={c.collidingEventId}
                                            onClick={() => selectEntity(c.collidingEventId)}
                                            className="p-2.5 rounded-lg bg-slate-900/80 border border-amber-500/20 hover:border-amber-400/40 transition-colors cursor-pointer group flex flex-col gap-1"
                                            title={`Click to inspect ${c.collidingEventTitle}`}
                                            data-testid={`colliding-event-${c.collidingEventId}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-200 group-hover:text-amber-300 truncate">
                                                    {c.collidingEventTitle}
                                                </span>
                                                <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30 shrink-0">
                                                    {c.overlapMinutes}m overlap
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                                                <span>{c.formattedTimeSpan}</span>
                                                <span className="text-[10px] text-slate-500">
                                                    {c.sourceAttribution} · {c.syncFreshness === 'recent' ? 'Recent Sync' : c.syncFreshness === 'stale' ? 'Stale Sync' : 'Local'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {alternativeSlot && (
                                    <div className="mt-1 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex flex-col gap-2" data-testid="alternative-slot-card">
                                        <div className="text-xs font-medium text-emerald-300 flex items-center justify-between">
                                            <span>Earliest Conflict-Free Window:</span>
                                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-900/40 px-1.5 py-0.5 rounded">
                                                +{alternativeSlot.displacementMinutes}m
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-300 font-mono">
                                            {new Date(alternativeSlot.startTimeIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(alternativeSlot.endTimeIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        <button
                                            onClick={() => handleStageReschedule(alternativeSlot.startTimeIso, alternativeSlot.endTimeIso)}
                                            className="w-full py-1.5 px-3 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                            data-testid="stage-reschedule-btn"
                                            aria-label="Stage Reschedule to Earliest Conflict-Free Window"
                                        >
                                            <Calendar size={12} /> Stage Reschedule (2-Phase Confirmation)
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-2.5 flex items-center justify-between text-xs text-emerald-400" data-testid="schedule-conflict-free">
                                <span className="flex items-center gap-1.5 font-medium">
                                    <CheckCircle2 size={13} className="text-emerald-400" /> Conflict-Free Schedule
                                </span>
                                <span className="text-[10px] text-emerald-400/70">No overlapping events</span>
                            </div>
                        )
                    )}

                    {/* Greenfield Provenance & Bi-Temporal Trust (Workflow 4) */}
                    {(provenance || validity || version) && !isEditing && (
                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5 font-medium">
                                    <Shield size={12} className="text-indigo-400" /> Provenance & Trust
                                </span>
                                {version && (
                                    <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                        Rev v{version}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                                    <span className="text-[10px] text-slate-500 block">Origin Source</span>
                                    <span className="font-medium text-slate-200 capitalize flex items-center gap-1.5 mt-0.5">
                                        {provenance?.source_type === 'user' ? (
                                            <><UserCheck size={12} className="text-emerald-400 shrink-0" /> User</>
                                        ) : (
                                            <><Bot size={12} className="text-indigo-400 shrink-0" /> {provenance?.source_type || 'Agent'}</>
                                        )}
                                    </span>
                                </div>
                                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                                    <span className="text-[10px] text-slate-500 block">Validation State</span>
                                    <span className="font-medium text-slate-200 flex items-center gap-1.5 mt-0.5">
                                        {provenance?.user_confirmed ? (
                                            <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Confirmed</span>
                                        ) : provenance?.is_inferred ? (
                                            <span className="text-amber-400 flex items-center gap-1"><Sparkles size={12} /> Inferred ({Math.round((provenance?.confidence || 0.9) * 100)}%)</span>
                                        ) : (
                                            <span className="text-slate-300">Direct Entry</span>
                                        )}
                                    </span>
                                </div>
                            </div>
                            {validity && (validity.valid_from || validity.valid_until) && (
                                <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-slate-500"><Clock size={11} /> Temporal Validity</span>
                                    <span className="text-slate-300 font-mono text-[10px]">
                                        {validity.valid_from ? new Date(validity.valid_from).toLocaleDateString() : 'Always'} → {validity.valid_until ? new Date(validity.valid_until).toLocaleDateString() : 'Indefinite'}
                                    </span>
                                </div>
                            )}
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
                                    aria-label="Add relationship"
                                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Link
                                </button>
                            </div>

                            {showLinker && (
                                <div className="mb-3 space-y-2">
                                    <select
                                        value={linkType}
                                        aria-label="Relationship type"
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

            {/* Focus Session Calendar Collision Confirmation Modal */}
            {showFocusConflictModal && showFocusConflictModal.collidingEvent && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                    data-testid="focus-conflict-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="focus-conflict-title"
                >
                    <div className="bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-5 w-full max-w-md flex flex-col gap-4">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                                <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                                <span id="focus-conflict-title">Calendar Collision with Focus Session</span>
                            </div>
                            <button
                                onClick={() => setShowFocusConflictModal(null)}
                                className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
                                aria-label="Close dialog"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="text-xs text-slate-300 space-y-2">
                            <p>
                                Starting a 25m focus session overlaps with{' '}
                                <strong className="text-white">{showFocusConflictModal.collidingEvent.collidingEventTitle}</strong>:
                            </p>
                            <div className="p-2.5 rounded-lg bg-slate-950 border border-amber-500/20 text-slate-400 text-[11px] space-y-1">
                                <div><span className="text-slate-500">Time:</span> {showFocusConflictModal.collidingEvent.formattedTimeSpan}</div>
                                <div><span className="text-slate-500">Source:</span> {showFocusConflictModal.collidingEvent.sourceAttribution}</div>
                                {!showFocusConflictModal.isEventOngoing && showFocusConflictModal.minutesUntilNextEvent !== undefined && (
                                    <div className="text-amber-300 font-medium pt-0.5">Starts in: {showFocusConflictModal.minutesUntilNextEvent} minute(s)</div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                            {showFocusConflictModal.suggestedDurationMinutes && showFocusConflictModal.suggestedDurationMinutes > 0 ? (
                                <button
                                    onClick={() => handleStartFocus(showFocusConflictModal.suggestedDurationMinutes)}
                                    className="w-full py-2 px-3 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                                    data-testid="fit-before-event-btn"
                                >
                                    <Timer size={14} /> Fit Before Event ({showFocusConflictModal.suggestedDurationMinutes}m Focus)
                                </button>
                            ) : null}
                            <button
                                onClick={() => {
                                    startFocusSession(entity.id, 25);
                                    setShowFocusConflictModal(null);
                                }}
                                className="w-full py-2 px-3 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                                data-testid="start-focus-anyway-btn"
                            >
                                Start 25m Anyway
                            </button>
                            <button
                                onClick={() => setShowFocusConflictModal(null)}
                                className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                                data-testid="cancel-focus-conflict-btn"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default EntityDetailPanel;
