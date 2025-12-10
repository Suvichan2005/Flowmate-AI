import { Entity, Relationship, EntityKind, EntityStatus, RelationshipType, Subtask } from '../types';

export const calculateProgress = (entity: Entity, allEntities: Entity[], allRelationships: Relationship[]): number => {
    // 1. Manual Progress in Metadata (Priority if set explicitly)
    if (typeof entity.metadata?.progress_percent === 'number') {
        return entity.metadata.progress_percent;
    }

    // 2. Check metadata.manual_progress (set by toggle_subtask)
    if (typeof entity.metadata?.manual_progress === 'number') {
        return entity.metadata.manual_progress;
    }

    // 3. Calculate from metadata.subtasks if present (with optional weighted hours)
    const subtasks: Subtask[] = entity.metadata?.subtasks || [];
    if (subtasks.length > 0) {
        const hasWeights = subtasks.some(s => s.estimated_minutes && s.estimated_minutes > 0);

        if (hasWeights) {
            const totalMinutes = subtasks.reduce((sum, s) => sum + (s.estimated_minutes || 60), 0);
            const completedMinutes = subtasks
                .filter(s => s.completed)
                .reduce((sum, s) => sum + (s.estimated_minutes || 60), 0);
            return Math.round((completedMinutes / totalMinutes) * 100);
        } else {
            const completed = subtasks.filter(s => s.completed).length;
            return Math.round((completed / subtasks.length) * 100);
        }
    }

    // 4. Find children via BOTH parent_id field (new) AND PART_OF relationships (legacy)
    const childrenViaParentId = allEntities.filter(e => e.parent_id === entity.id);
    const childrenLinks = allRelationships.filter(r => r.to === entity.id && r.type === RelationshipType.PART_OF);
    const childrenViaRelationship = allEntities.filter(e => childrenLinks.some(r => r.from === e.id));

    // Combine and deduplicate
    const allChildren = [...new Map([...childrenViaParentId, ...childrenViaRelationship].map(e => [e.id, e])).values()];

    if (allChildren.length === 0) {
        return entity.status === EntityStatus.COMPLETED ? 100 : 0;
    }

    const completed = allChildren.filter(e => e.status === EntityStatus.COMPLETED).length;
    return Math.round((completed / allChildren.length) * 100);
};