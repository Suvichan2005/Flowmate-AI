import { Entity, EntityKind, EntityStatus, Relationship } from '../types';

/**
 * Determines if an entity should be visible in the graph based on smart visibility rules.
 * This reduces visual clutter by hiding stale, completed, or orphan entities.
 */
export function shouldShowInGraph(
    entity: Entity,
    relationships: Relationship[],
    options: {
        showArchived?: boolean;
        showOldCompleted?: boolean;
        showPastEvents?: boolean;
        showOrphans?: boolean;
        completedDaysThreshold?: number;
        pastEventDaysThreshold?: number;
    } = {}
): boolean {
    const {
        showArchived = false,
        showOldCompleted = false,
        showPastEvents = false,
        showOrphans = true,
        completedDaysThreshold = 30,
        pastEventDaysThreshold = 60
    } = options;

    // Always hide if manually hidden
    if (entity.metadata?.hidden) return false;

    // Check archived status
    if (entity.metadata?.archived && !showArchived) return false;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Check old completed tasks
    if (!showOldCompleted && entity.status === EntityStatus.COMPLETED) {
        const updatedAt = new Date(entity.updated_at).getTime();
        const daysSinceUpdate = (now - updatedAt) / dayMs;
        if (daysSinceUpdate > completedDaysThreshold) return false;
    }

    // Check past events
    if (!showPastEvents && entity.kind === EntityKind.EVENT && entity.start_time) {
        const eventTime = new Date(entity.start_time).getTime();
        const daysSinceEvent = (now - eventTime) / dayMs;
        if (daysSinceEvent > pastEventDaysThreshold) return false;
    }

    // Check orphans (entities with no relationships)
    if (!showOrphans) {
        const hasRelationship = relationships.some(
            r => r.from === entity.id || r.to === entity.id
        );
        // Only hide orphans that are low priority and not recent
        if (!hasRelationship && entity.priority <= 1) {
            const createdAt = new Date(entity.created_at).getTime();
            const daysSinceCreated = (now - createdAt) / dayMs;
            if (daysSinceCreated > 7) return false;
        }
    }

    return true;
}

/**
 * Finds potentially duplicate entities based on title similarity.
 */
export function findDuplicateEntities(entities: Entity[]): Map<string, Entity[]> {
    const duplicates = new Map<string, Entity[]>();

    // Normalize title for comparison
    const normalize = (title: string) =>
        title.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

    // Group by normalized title
    const groups = new Map<string, Entity[]>();
    entities.forEach(e => {
        const key = normalize(e.title);
        if (key.length < 3) return; // Skip very short titles

        const existing = groups.get(key) || [];
        existing.push(e);
        groups.set(key, existing);
    });

    // Filter to only groups with duplicates
    groups.forEach((group, key) => {
        if (group.length > 1) {
            duplicates.set(key, group);
        }
    });

    return duplicates;
}

/**
 * Finds entities that should be auto-archived based on age and status.
 */
export function findStaleEntities(
    entities: Entity[],
    options: {
        completedTaskDays?: number;
        pastEventDays?: number;
        canceledDays?: number;
    } = {}
): Entity[] {
    const {
        completedTaskDays = 30,
        pastEventDays = 60,
        canceledDays = 14
    } = options;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return entities.filter(e => {
        // Skip already archived
        if (e.metadata?.archived) return false;

        // Completed tasks older than threshold
        if (e.status === EntityStatus.COMPLETED && e.kind === EntityKind.TASK) {
            const updatedAt = new Date(e.updated_at).getTime();
            if ((now - updatedAt) / dayMs > completedTaskDays) return true;
        }

        // Past events older than threshold
        if (e.kind === EntityKind.EVENT && e.start_time) {
            const eventTime = new Date(e.start_time).getTime();
            if ((now - eventTime) / dayMs > pastEventDays) return true;
        }

        // Canceled entities older than threshold
        if (e.status === EntityStatus.CANCELED) {
            const updatedAt = new Date(e.updated_at).getTime();
            if ((now - updatedAt) / dayMs > canceledDays) return true;
        }

        return false;
    });
}

/**
 * Calculates graph declutter statistics for display.
 */
export function getGraphStats(
    entities: Entity[],
    relationships: Relationship[]
): {
    total: number;
    archived: number;
    hidden: number;
    orphans: number;
    duplicates: number;
    stale: number;
} {
    const archived = entities.filter(e => e.metadata?.archived).length;
    const hidden = entities.filter(e => e.metadata?.hidden).length;

    // Count orphans
    const connectedIds = new Set<string>();
    relationships.forEach(r => {
        connectedIds.add(r.from);
        connectedIds.add(r.to);
    });
    const orphans = entities.filter(e => !connectedIds.has(e.id)).length;

    // Count duplicates
    const duplicateGroups = findDuplicateEntities(entities);
    let duplicates = 0;
    duplicateGroups.forEach(group => {
        duplicates += group.length - 1; // Count extras, not the first one
    });

    // Count stale
    const stale = findStaleEntities(entities).length;

    return {
        total: entities.length,
        archived,
        hidden,
        orphans,
        duplicates,
        stale
    };
}
