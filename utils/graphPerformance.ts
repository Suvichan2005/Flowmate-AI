/**
 * Graph Performance Utilities
 * 
 * Optimizations for rendering large knowledge graphs with D3.js
 */

/**
 * Configuration for graph performance
 */
export interface GraphPerformanceConfig {
    /** Maximum nodes to render before enabling virtualization */
    virtualizationThreshold: number;
    /** Throttle interval for tick updates (ms) */
    tickThrottleMs: number;
    /** Alpha decay rate - higher = faster settling */
    alphaDecay: number;
    /** Velocity decay rate - higher = more friction */
    velocityDecay: number;
    /** Whether to show labels for all nodes or just focused */
    labelMode: 'all' | 'focused' | 'none';
    /** Maximum links to render */
    maxLinks: number;
}

export const DEFAULT_GRAPH_PERFORMANCE: GraphPerformanceConfig = {
    virtualizationThreshold: 200,
    tickThrottleMs: 16, // ~60fps
    alphaDecay: 0.0228, // D3 default
    velocityDecay: 0.4,
    labelMode: 'all',
    maxLinks: 1000,
};

/**
 * Get optimized config based on node count
 */
export function getOptimizedConfig(nodeCount: number): GraphPerformanceConfig {
    if (nodeCount < 100) {
        return {
            ...DEFAULT_GRAPH_PERFORMANCE,
            labelMode: 'all',
            alphaDecay: 0.0228,
            velocityDecay: 0.4,
        };
    }
    
    if (nodeCount < 300) {
        return {
            ...DEFAULT_GRAPH_PERFORMANCE,
            labelMode: 'focused',
            alphaDecay: 0.05,
            velocityDecay: 0.5,
            tickThrottleMs: 32, // ~30fps
        };
    }
    
    if (nodeCount < 500) {
        return {
            ...DEFAULT_GRAPH_PERFORMANCE,
            labelMode: 'focused',
            alphaDecay: 0.08,
            velocityDecay: 0.6,
            tickThrottleMs: 50, // ~20fps
            maxLinks: 500,
        };
    }
    
    // 500+ nodes - aggressive optimization
    return {
        virtualizationThreshold: 200,
        tickThrottleMs: 100, // ~10fps during simulation
        alphaDecay: 0.1, // Settle faster
        velocityDecay: 0.7, // More friction
        labelMode: 'none',
        maxLinks: 300,
    };
}

/**
 * Creates a throttled tick handler
 */
export function createThrottledTick(
    callback: () => void,
    intervalMs: number
): () => void {
    let lastCall = 0;
    let rafId: number | null = null;

    return () => {
        const now = Date.now();
        if (now - lastCall >= intervalMs) {
            lastCall = now;
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            rafId = requestAnimationFrame(callback);
        }
    };
}

/**
 * Filters visible nodes based on viewport bounds
 * For viewport culling optimization
 */
export function getVisibleNodes<T extends { x?: number; y?: number }>(
    nodes: T[],
    viewport: { x: number; y: number; width: number; height: number },
    padding: number = 100
): T[] {
    const minX = viewport.x - padding;
    const maxX = viewport.x + viewport.width + padding;
    const minY = viewport.y - padding;
    const maxY = viewport.y + viewport.height + padding;

    return nodes.filter(node => {
        if (node.x === undefined || node.y === undefined) return true;
        return node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY;
    });
}

/**
 * Prioritizes which links to render based on importance
 */
export function prioritizeLinks<T extends { source: any; target: any; type?: string }>(
    links: T[],
    maxLinks: number,
    selectedNodeId?: string | null
): T[] {
    if (links.length <= maxLinks) return links;

    // Priority order: connected to selected > dependencies > other
    const priorityTypes = ['DEPENDS_ON', 'FULFILLS', 'PART_OF'];
    
    const scored = links.map(link => {
        let score = 0;
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        // Highest priority: connected to selected node
        if (selectedNodeId && (sourceId === selectedNodeId || targetId === selectedNodeId)) {
            score += 1000;
        }
        
        // Higher priority for dependency-type relationships
        if (link.type && priorityTypes.includes(link.type)) {
            score += 100;
        }
        
        return { link, score };
    });

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, maxLinks)
        .map(s => s.link);
}

/**
 * Clusters nodes by kind for better layout
 */
export function clusterNodesByKind<T extends { kind: string }>(
    nodes: T[]
): Map<string, T[]> {
    const clusters = new Map<string, T[]>();
    
    nodes.forEach(node => {
        const existing = clusters.get(node.kind) || [];
        existing.push(node);
        clusters.set(node.kind, existing);
    });
    
    return clusters;
}

/**
 * Generates WebGL-friendly vertex data for high-performance rendering
 * (For future WebGL implementation)
 */
export function generateVertexData(
    nodes: { x: number; y: number; kind: string }[],
    colorMap: Record<string, [number, number, number]>
): Float32Array {
    // 5 floats per node: x, y, r, g, b
    const data = new Float32Array(nodes.length * 5);
    
    nodes.forEach((node, i) => {
        const offset = i * 5;
        data[offset] = node.x;
        data[offset + 1] = node.y;
        const color = colorMap[node.kind] || [0.5, 0.5, 0.5];
        data[offset + 2] = color[0];
        data[offset + 3] = color[1];
        data[offset + 4] = color[2];
    });
    
    return data;
}

/**
 * Simplifies graph for overview mode (collapse clusters)
 */
export function simplifyGraph<N extends { id: string; kind: string }, L extends { source: string; target: string }>(
    nodes: N[],
    links: L[],
    targetNodeCount: number = 50
): { nodes: (N & { count: number })[]; links: L[] } {
    if (nodes.length <= targetNodeCount) {
        return { 
            nodes: nodes.map(n => ({ ...n, count: 1 })), 
            links 
        };
    }

    // Group nodes by kind
    const clusters = clusterNodesByKind(nodes);
    const simplifiedNodes: (N & { count: number })[] = [];
    const nodeIdMap = new Map<string, string>(); // original -> simplified
    
    clusters.forEach((clusterNodes, kind) => {
        if (clusterNodes.length <= 3) {
            // Keep small clusters as-is
            clusterNodes.forEach(n => {
                simplifiedNodes.push({ ...n, count: 1 });
                nodeIdMap.set(n.id, n.id);
            });
        } else {
            // Collapse large clusters into representative node
            const representative = clusterNodes[0];
            simplifiedNodes.push({ 
                ...representative, 
                count: clusterNodes.length 
            });
            clusterNodes.forEach(n => nodeIdMap.set(n.id, representative.id));
        }
    });

    // Remap links
    const seenLinks = new Set<string>();
    const simplifiedLinks = links
        .map(link => ({
            ...link,
            source: nodeIdMap.get(link.source) || link.source,
            target: nodeIdMap.get(link.target) || link.target,
        }))
        .filter(link => {
            // Remove self-links and duplicates
            if (link.source === link.target) return false;
            const key = `${link.source}-${link.target}`;
            if (seenLinks.has(key)) return false;
            seenLinks.add(key);
            return true;
        });

    return { nodes: simplifiedNodes, links: simplifiedLinks };
}

/**
 * Performance metrics tracking
 */
export class GraphPerformanceMonitor {
    private frameCount = 0;
    private lastFpsUpdate = Date.now();
    private currentFps = 0;
    private tickTimes: number[] = [];

    recordTick(duration: number): void {
        this.frameCount++;
        this.tickTimes.push(duration);
        if (this.tickTimes.length > 60) {
            this.tickTimes.shift();
        }

        const now = Date.now();
        if (now - this.lastFpsUpdate >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    getFps(): number {
        return this.currentFps;
    }

    getAverageTickTime(): number {
        if (this.tickTimes.length === 0) return 0;
        return this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length;
    }

    shouldReduceQuality(): boolean {
        return this.currentFps < 20 || this.getAverageTickTime() > 50;
    }
}
