/**
 * Graph Analyzer Service
 * Specialized AI-powered graph analysis and fixing utilities
 */

import { Entity, Relationship, EntityKind, EntityStatus, RelationshipType, ToonOperation } from '../types';
import { getAiClient } from './ai/client';
import { useStore } from '../store';

// === Type Definitions ===

export interface GraphAnalysis {
    totalEntities: number;
    totalRelationships: number;
    orphans: Entity[];
    disjointGroups: Entity[][];
    missingTags: Entity[];
    uncategorized: Entity[];
    suggestions: string[];
}

export interface FixProgress {
    phase: 'analyzing' | 'processing' | 'reviewing' | 'applying' | 'complete';
    currentChunk: number;
    totalChunks: number;
    operations: ToonOperation[];
    logs: string[];
}

// === Graph Analysis Functions ===

/**
 * Find all orphan entities (no relationships)
 */
export function findOrphans(entities: Entity[], relationships: Relationship[]): Entity[] {
    const connectedIds = new Set<string>();
    relationships.forEach(r => {
        connectedIds.add(r.from);
        connectedIds.add(r.to);
    });

    return entities.filter(e =>
        !connectedIds.has(e.id) &&
        e.kind !== EntityKind.TAG &&
        e.kind !== EntityKind.NOTE &&
        e.kind !== EntityKind.ACTIVITY &&
        e.kind !== EntityKind.MINI_STREAK &&
        e.status !== EntityStatus.ARCHIVED &&
        e.status !== EntityStatus.CANCELED
    );
}

/**
 * Find disjoint groups using Union-Find algorithm
 */
export function findDisjointGroups(entities: Entity[], relationships: Relationship[]): Entity[][] {
    const parent = new Map<string, string>();
    const entityMap = new Map<string, Entity>();

    // Initialize - each entity is its own parent
    entities.forEach(e => {
        parent.set(e.id, e.id);
        entityMap.set(e.id, e);
    });

    // Find root with path compression
    function find(id: string): string {
        if (!parent.has(id)) return id;
        if (parent.get(id) !== id) {
            parent.set(id, find(parent.get(id)!));
        }
        return parent.get(id)!;
    }

    // Union two sets
    function union(a: string, b: string) {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) {
            parent.set(rootA, rootB);
        }
    }

    // Process relationships
    relationships.forEach(r => {
        if (parent.has(r.from) && parent.has(r.to)) {
            union(r.from, r.to);
        }
    });

    // Group by root
    const groups = new Map<string, Entity[]>();
    entities.forEach(e => {
        const root = find(e.id);
        if (!groups.has(root)) {
            groups.set(root, []);
        }
        groups.get(root)!.push(e);
    });

    // Return groups with more than 1 entity, sorted by size
    return Array.from(groups.values())
        .filter(g => g.length > 1)
        .sort((a, b) => b.length - a.length);
}

/**
 * Find entities that might be missing proper tags/contexts
 */
export function findMissingTags(entities: Entity[], relationships: Relationship[]): Entity[] {
    // Find entities that have no TAGGED_WITH relationships
    const taggedIds = new Set<string>();
    relationships
        .filter(r => r.type === RelationshipType.TAGGED_WITH)
        .forEach(r => taggedIds.add(r.from));

    return entities.filter(e =>
        !taggedIds.has(e.id) &&
        e.kind !== EntityKind.TAG &&
        e.kind !== EntityKind.CONTEXT &&
        e.kind !== EntityKind.NOTE &&
        e.kind !== EntityKind.ACTIVITY &&
        e.kind !== EntityKind.MINI_STREAK &&
        e.status === EntityStatus.ACTIVE
    );
}

/**
 * Full graph analysis
 */
export function analyzeGraphTopology(
    entities: Entity[],
    relationships: Relationship[]
): GraphAnalysis {
    const orphans = findOrphans(entities, relationships);
    const disjointGroups = findDisjointGroups(entities, relationships);
    const missingTags = findMissingTags(entities, relationships);

    // Find entities that might need better categorization
    const uncategorized = entities.filter(e =>
        (!e.canonical_tags || e.canonical_tags.length === 0) &&
        e.kind !== EntityKind.TAG &&
        e.kind !== EntityKind.CONTEXT &&
        e.kind !== EntityKind.ACTIVITY &&
        e.kind !== EntityKind.MINI_STREAK
    );

    // Generate suggestions
    const suggestions: string[] = [];
    if (orphans.length > 0) {
        suggestions.push(`${orphans.length} orphan entities found - they have no connections`);
    }
    if (disjointGroups.length > 1) {
        suggestions.push(`Graph has ${disjointGroups.length} disconnected clusters`);
    }
    if (missingTags.length > 0) {
        suggestions.push(`${missingTags.length} entities lack context/tag associations`);
    }
    if (uncategorized.length > 0) {
        suggestions.push(`${uncategorized.length} entities have no tags assigned`);
    }

    return {
        totalEntities: entities.length,
        totalRelationships: relationships.length,
        orphans,
        disjointGroups,
        missingTags,
        uncategorized,
        suggestions
    };
}

/**
 * Chunk entities for LLM processing (to avoid context limits)
 */
export function chunkEntitiesForLLM(entities: Entity[], chunkSize: number = 15): Entity[][] {
    const chunks: Entity[][] = [];
    for (let i = 0; i < entities.length; i += chunkSize) {
        chunks.push(entities.slice(i, i + chunkSize));
    }
    return chunks;
}

// === LLM Integration ===

const GRAPH_FIXING_PROMPT = `
You are Flowmate Graph Optimizer. Your task is to analyze a chunk of entities and suggest improvements.

**YOUR GOALS:**
1. **Categorize**: Suggest better kinds if entity seems miscategorized
2. **Tag**: Suggest Context or Tag associations (use TAGGED_WITH relationship)
3. **Link**: Suggest connections between related entities (PART_OF, DEPENDS_ON, RELATED_TO)
4. **Clean**: Identify duplicates or items that should be merged/archived

**AVAILABLE OPERATIONS:**
- update_entity: { id, fields: { kind?, title?, canonical_tags?, status? } }
- link_entities: { from: "id1", to: "id2", type: "TAGGED_WITH|PART_OF|DEPENDS_ON|RELATED_TO" }
- delete_entity: { id } (only for clear duplicates)

**CONTEXT ENTITIES (existing contexts/tags to link to):**
{contextList}

**ENTITIES TO ANALYZE:**
{entityChunk}

**ALL RELATIONSHIPS IN GRAPH:**
{relationships}

**INSTRUCTIONS:**
1. Analyze each entity in the chunk
2. For orphans: suggest links to existing contexts or other entities
3. For uncategorized: suggest appropriate tags
4. Return ONLY a JSON array of operations
5. Be conservative - only suggest clear improvements
6. NEVER create new entities, only link/update existing ones

Return format:
{ "ops": [...], "reasoning": "Brief explanation" }
`;

/**
 * Process a chunk of entities with LLM to suggest fixes
 */
export async function fixGraphChunk(
    chunk: Entity[],
    allContexts: Entity[],
    allRelationships: Relationship[],
    onProgress?: (log: string) => void
): Promise<ToonOperation[]> {
    const { settings, addDebugLog } = useStore.getState();
    const modelName = settings?.preferred_model || 'gemini-2.5-flash';

    const ai = getAiClient();

    // Format contexts for prompt
    const contextList = allContexts
        .filter(e => e.kind === EntityKind.CONTEXT || e.kind === EntityKind.TAG)
        .slice(0, 30)
        .map(e => `${e.id.slice(-8)}: ${e.title} (${e.kind})`)
        .join('\n');

    // Format chunk for prompt
    const entityChunk = chunk.map(e => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        status: e.status,
        tags: e.canonical_tags || [],
        desc: e.description?.slice(0, 100) || ''
    }));

    // Format relationships
    const relSummary = allRelationships
        .filter(r => chunk.some(e => e.id === r.from || e.id === r.to))
        .map(r => `${r.from.slice(-6)} -[${r.type}]-> ${r.to.slice(-6)}`)
        .join('\n');

    const prompt = GRAPH_FIXING_PROMPT
        .replace('{contextList}', contextList || 'None')
        .replace('{entityChunk}', JSON.stringify(entityChunk, null, 2))
        .replace('{relationships}', relSummary || 'None');

    try {
        onProgress?.(`Analyzing ${chunk.length} entities...`);

        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                temperature: 0.1,
            }
        });

        const text = response.text || '';

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*"ops"[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            onProgress?.(`Found ${parsed.ops?.length || 0} suggested operations`);
            addDebugLog('system', 'Graph chunk processed', { chunk: chunk.length, ops: parsed.ops?.length });
            return parsed.ops || [];
        }

        return [];
    } catch (error: any) {
        onProgress?.(`Error: ${error.message}`);
        console.error('Graph fix chunk error:', error);
        return [];
    }
}

/**
 * Run full graph fixing process
 */
export async function runGraphFixing(
    entities: Entity[],
    relationships: Relationship[],
    onProgress: (progress: FixProgress) => void
): Promise<ToonOperation[]> {
    const allOps: ToonOperation[] = [];
    const logs: string[] = [];

    // Phase 1: Analysis
    onProgress({ phase: 'analyzing', currentChunk: 0, totalChunks: 0, operations: [], logs: ['Starting analysis...'] });

    const analysis = analyzeGraphTopology(entities, relationships);
    logs.push(`Found ${analysis.orphans.length} orphans, ${analysis.missingTags.length} missing tags`);

    // Get entities that need fixing
    const entitiesToFix = [
        ...analysis.orphans,
        ...analysis.missingTags.filter(e => !analysis.orphans.includes(e))
    ];

    if (entitiesToFix.length === 0) {
        logs.push('No entities need fixing!');
        onProgress({ phase: 'complete', currentChunk: 0, totalChunks: 0, operations: [], logs });
        return [];
    }

    // Get contexts for linking
    const contexts = entities.filter(e =>
        e.kind === EntityKind.CONTEXT || e.kind === EntityKind.TAG
    );

    // Phase 2: Processing
    const chunks = chunkEntitiesForLLM(entitiesToFix, 10);

    for (let i = 0; i < chunks.length; i++) {
        onProgress({
            phase: 'processing',
            currentChunk: i + 1,
            totalChunks: chunks.length,
            operations: allOps,
            logs: [...logs, `Processing chunk ${i + 1}/${chunks.length}...`]
        });

        const ops = await fixGraphChunk(chunks[i], contexts, relationships, (log) => {
            logs.push(log);
        });

        allOps.push(...ops);
    }

    // Phase 3: Complete
    logs.push(`Total: ${allOps.length} operations suggested`);
    onProgress({
        phase: 'reviewing',
        currentChunk: chunks.length,
        totalChunks: chunks.length,
        operations: allOps,
        logs
    });

    return allOps;
}
