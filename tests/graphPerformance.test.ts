/**
 * Graph Performance Utilities Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getOptimizedConfig,
    createThrottledTick,
    getVisibleNodes,
    prioritizeLinks,
    clusterNodesByKind,
    simplifyGraph,
    GraphPerformanceMonitor,
    DEFAULT_GRAPH_PERFORMANCE,
} from '../utils/graphPerformance';

describe('Graph Performance Utilities', () => {
    describe('getOptimizedConfig', () => {
        it('returns default config for small graphs', () => {
            const config = getOptimizedConfig(50);
            expect(config.labelMode).toBe('all');
            expect(config.alphaDecay).toBe(0.0228);
        });

        it('optimizes for medium graphs (100-300 nodes)', () => {
            const config = getOptimizedConfig(200);
            expect(config.labelMode).toBe('focused');
            expect(config.tickThrottleMs).toBe(32);
        });

        it('optimizes for large graphs (300-500 nodes)', () => {
            const config = getOptimizedConfig(400);
            expect(config.labelMode).toBe('focused');
            expect(config.maxLinks).toBe(500);
        });

        it('aggressive optimization for very large graphs (500+)', () => {
            const config = getOptimizedConfig(600);
            expect(config.labelMode).toBe('none');
            expect(config.maxLinks).toBe(300);
            expect(config.alphaDecay).toBe(0.1);
        });
    });

    describe('createThrottledTick', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('throttles calls to the callback', () => {
            const callback = vi.fn();
            const throttledTick = createThrottledTick(callback, 100);

            // Mock requestAnimationFrame
            vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
                cb(0);
                return 0;
            });

            // First call should execute
            throttledTick();
            expect(callback).toHaveBeenCalledTimes(1);

            // Immediate second call should be throttled
            throttledTick();
            expect(callback).toHaveBeenCalledTimes(1);

            // After interval, should execute again
            vi.advanceTimersByTime(100);
            throttledTick();
            expect(callback).toHaveBeenCalledTimes(2);
        });
    });

    describe('getVisibleNodes', () => {
        it('filters nodes within viewport', () => {
            const nodes = [
                { x: 50, y: 50 },
                { x: 150, y: 150 },
                { x: 500, y: 500 }, // Outside viewport
                { x: 250, y: 250 },
            ];

            const viewport = { x: 0, y: 0, width: 300, height: 300 };
            const visible = getVisibleNodes(nodes, viewport, 50);

            expect(visible).toHaveLength(3);
            expect(visible).not.toContainEqual({ x: 500, y: 500 });
        });

        it('includes nodes without positions', () => {
            const nodes = [
                { x: 50, y: 50 },
                { id: 'no-position' }, // No x/y
            ];

            const viewport = { x: 0, y: 0, width: 100, height: 100 };
            const visible = getVisibleNodes(nodes, viewport);

            expect(visible).toHaveLength(2);
        });
    });

    describe('prioritizeLinks', () => {
        const links = [
            { source: 'a', target: 'b', type: 'OTHER' },
            { source: 'b', target: 'c', type: 'DEPENDS_ON' },
            { source: 'c', target: 'd', type: 'TAGGED_WITH' },
            { source: 'selected', target: 'e', type: 'OTHER' },
        ];

        it('returns all links if under max', () => {
            const result = prioritizeLinks(links, 10);
            expect(result).toHaveLength(4);
        });

        it('prioritizes links connected to selected node', () => {
            const result = prioritizeLinks(links, 2, 'selected');
            expect(result).toHaveLength(2);
            expect(result.some(l => l.source === 'selected' || l.target === 'selected')).toBe(true);
        });

        it('prioritizes dependency links', () => {
            const result = prioritizeLinks(links, 2);
            expect(result).toHaveLength(2);
            expect(result.some(l => l.type === 'DEPENDS_ON')).toBe(true);
        });
    });

    describe('clusterNodesByKind', () => {
        it('groups nodes by kind', () => {
            const nodes = [
                { id: '1', kind: 'TASK' },
                { id: '2', kind: 'GOAL' },
                { id: '3', kind: 'TASK' },
                { id: '4', kind: 'GOAL' },
            ];

            const clusters = clusterNodesByKind(nodes);

            expect(clusters.get('TASK')).toHaveLength(2);
            expect(clusters.get('GOAL')).toHaveLength(2);
        });

        it('handles empty array', () => {
            const clusters = clusterNodesByKind([]);
            expect(clusters.size).toBe(0);
        });
    });

    describe('simplifyGraph', () => {
        it('returns original graph if small enough', () => {
            const nodes = [
                { id: '1', kind: 'TASK' },
                { id: '2', kind: 'GOAL' },
            ];
            const links = [{ source: '1', target: '2' }];

            const result = simplifyGraph(nodes, links, 50);

            expect(result.nodes).toHaveLength(2);
            expect(result.links).toHaveLength(1);
        });

        it('collapses large clusters', () => {
            const nodes = Array.from({ length: 10 }, (_, i) => ({
                id: `task-${i}`,
                kind: 'TASK',
            }));
            const links = [{ source: 'task-0', target: 'task-1' }];

            const result = simplifyGraph(nodes, links, 5);

            // Should collapse tasks into one representative
            expect(result.nodes.length).toBeLessThan(10);
            expect(result.nodes[0].count).toBeGreaterThan(1);
        });

        it('removes self-links after simplification', () => {
            const nodes = [
                { id: '1', kind: 'TASK' },
                { id: '2', kind: 'TASK' },
                { id: '3', kind: 'TASK' },
                { id: '4', kind: 'TASK' },
            ];
            // Links within same cluster become self-links after collapse
            const links = [
                { source: '1', target: '2' },
                { source: '2', target: '3' },
            ];

            const result = simplifyGraph(nodes, links, 1);

            // Self-links should be filtered out
            result.links.forEach(link => {
                expect(link.source).not.toBe(link.target);
            });
        });
    });

    describe('GraphPerformanceMonitor', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('tracks FPS', () => {
            const monitor = new GraphPerformanceMonitor();

            // Record 60 ticks over 1 second
            for (let i = 0; i < 60; i++) {
                monitor.recordTick(5);
                vi.advanceTimersByTime(16);
            }

            // After 1 second, FPS should be calculated
            vi.advanceTimersByTime(1000);
            monitor.recordTick(5);

            expect(monitor.getFps()).toBeGreaterThan(0);
        });

        it('calculates average tick time', () => {
            const monitor = new GraphPerformanceMonitor();

            monitor.recordTick(10);
            monitor.recordTick(20);
            monitor.recordTick(30);

            expect(monitor.getAverageTickTime()).toBe(20);
        });

        it('detects when quality should be reduced', () => {
            const monitor = new GraphPerformanceMonitor();

            // Record slow ticks
            for (let i = 0; i < 10; i++) {
                monitor.recordTick(100); // 100ms per tick is very slow
            }

            expect(monitor.shouldReduceQuality()).toBe(true);
        });
    });
});
