import { Entity, Relationship, EntityKind, EntityStatus, RelationshipType } from '../types';

export const calculateProgress = (entity: Entity, allEntities: Entity[], allRelationships: Relationship[]): number => {
    // 1. Manual Progress in Metadata (Priority for Goals if set explicitly)
    if (typeof entity.metadata?.progress_percent === 'number') {
        return entity.metadata.progress_percent;
    }

    // 2. Derived Progress from Children (Projects, or Goals with sub-goals/tasks)
    // Find entities that are PART_OF this entity
    const childrenLinks = allRelationships.filter(r => r.to === entity.id && r.type === RelationshipType.PART_OF);
    
    if (childrenLinks.length === 0) {
        // If it's a Goal/Project with no children and no manual progress:
        // If COMPLETED -> 100%, else 0%
        return entity.status === EntityStatus.COMPLETED ? 100 : 0;
    }

    const childrenIds = new Set(childrenLinks.map(r => r.from));
    const children = allEntities.filter(e => childrenIds.has(e.id));
    
    if (children.length === 0) return entity.status === EntityStatus.COMPLETED ? 100 : 0;

    const completed = children.filter(e => e.status === EntityStatus.COMPLETED).length;
    
    return Math.round((completed / children.length) * 100);
};