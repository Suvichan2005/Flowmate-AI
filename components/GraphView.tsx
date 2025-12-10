import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useStore } from '../store';
import { Entity, Relationship, EntityKind, EntityStatus, RelationshipType } from '../types';
import { Filter, Eye, EyeOff, Maximize, Play, Edit3, Trash2, CheckSquare, Square, Sliders, Info, Magnet, RefreshCw, Archive, Calendar, Unlink } from 'lucide-react';
import { shouldShowInGraph, getGraphStats } from '../utils/graphVisibility';

interface GraphViewProps {
    entities: Entity[];
    relationships: Relationship[];
}

const GraphView: React.FC<GraphViewProps> = ({ entities, relationships }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { selectEntity, applyOperations, startFocusSession, selectedEntityId } = useStore();

    // Initialize with all kinds visible
    const [visibleKinds, setVisibleKinds] = useState<Set<EntityKind>>(
        new Set(Object.values(EntityKind))
    );
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [showPhysicsMenu, setShowPhysicsMenu] = useState(false);

    // Smart Visibility Filters (Flowmate 3.0)
    const [showArchived, setShowArchived] = useState(false);
    const [showOldCompleted, setShowOldCompleted] = useState(false);
    const [showPastEvents, setShowPastEvents] = useState(false);
    const [showOrphans, setShowOrphans] = useState(true);

    // Physics State
    const [groupByKind, setGroupByKind] = useState(false);
    const [forceProps, setForceProps] = useState({
        charge: -200,
        linkDistance: 120,
        collideRadius: 50,
        centerStrength: 0.1
    });

    // Interaction State
    const [dragLink, setDragLink] = useState<{ sourceId: string, x: number, y: number } | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);

    // Transform State for Link Projection
    const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, entityId: string } | null>(null);
    // Link Creation Menu State
    const [pendingLink, setPendingLink] = useState<{ source: string, target: string, x: number, y: number } | null>(null);

    // Simulation Ref to access nodes for auto-center
    const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null);
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<Element, unknown> | null>(null);

    const safeEntities = Array.isArray(entities) ? entities : [];
    const safeRelationships = Array.isArray(relationships) ? relationships : [];

    // Relationship Colors
    const relColors: Record<string, string> = {
        [RelationshipType.DEPENDS_ON]: '#ef4444', // red-500
        [RelationshipType.PART_OF]: '#475569', // slate-600
        [RelationshipType.FULFILLS]: '#10b981', // emerald-500
        [RelationshipType.PRECEDES]: '#3b82f6', // blue-500
        [RelationshipType.SCHEDULED_FOR]: '#a855f7', // purple-500
        [RelationshipType.TAGGED_WITH]: '#6366f1', // indigo-500 (distinct for context)
        'DEFAULT': '#475569'
    };

    const getLinkColor = (type: string) => relColors[type] || relColors['DEFAULT'];

    // Filter Data based on visibility
    const { nodes, links, stats } = useMemo(() => {
        // Defensive Filter: Ensure basic properties exist
        // Apply smart visibility rules AND kind filter
        const activeNodes = safeEntities
            .filter(e => e && e.id && e.kind && visibleKinds.has(e.kind))
            .filter(e => shouldShowInGraph(e, safeRelationships, {
                showArchived,
                showOldCompleted,
                showPastEvents,
                showOrphans
            }))
            .map(e => ({
                ...e,
                id: e.id,
                kind: e.kind || EntityKind.NOTE,
                title: e.title || 'Untitled'
            }));

        const activeNodeIds = new Set(activeNodes.map(n => n.id));

        const activeLinks = safeRelationships
            .filter(r => r && r.from && r.to && activeNodeIds.has(r.from) && activeNodeIds.has(r.to))
            .map(r => ({
                source: r.from,
                target: r.to,
                type: r.type,
                id: r.id
            }));

        // Calculate stats for display
        const stats = getGraphStats(safeEntities, safeRelationships);

        return { nodes: activeNodes, links: activeLinks, stats };
    }, [safeEntities, safeRelationships, visibleKinds, showArchived, showOldCompleted, showPastEvents, showOrphans]);

    // Update Simulation Forces when props change
    useEffect(() => {
        if (!simulationRef.current) return;
        const sim = simulationRef.current;

        // Update forces
        sim.force("charge", d3.forceManyBody().strength(forceProps.charge));
        sim.force("link", d3.forceLink(links).id((d: any) => d.id).distance(forceProps.linkDistance));
        sim.force("collide", d3.forceCollide().radius(forceProps.collideRadius));

        if (groupByKind) {
            // Grouping Logic: Cluster by Kind
            const kinds = Object.values(EntityKind);
            const cols = 4; // Columns for the grid
            const cellW = 300;
            const cellH = 300;
            const width = containerRef.current?.clientWidth || 800;
            const height = containerRef.current?.clientHeight || 600;

            // Calculate grid start to center it
            const gridW = cols * cellW;
            const rows = Math.ceil(kinds.length / cols);
            const gridH = rows * cellH;
            const startX = width / 2 - gridW / 2 + cellW / 2;
            const startY = height / 2 - gridH / 2 + cellH / 2;

            sim.force("center", null); // Disable single center
            sim.force("x", d3.forceX((d: any) => {
                const idx = kinds.indexOf(d.kind);
                const col = idx % cols;
                return startX + col * cellW;
            }).strength(0.5));
            sim.force("y", d3.forceY((d: any) => {
                const idx = kinds.indexOf(d.kind);
                const row = Math.floor(idx / cols);
                return startY + row * cellH;
            }).strength(0.5));

        } else {
            sim.force("x", null);
            sim.force("y", null);
            sim.force("center", d3.forceCenter((containerRef.current?.clientWidth || 0) / 2, (containerRef.current?.clientHeight || 0) / 2));
        }

        // Add special gravity for Context nodes to pull them centerish but not override too much
        sim.force("context-gravity", d3.forceManyBody().strength((d: any) =>
            d.kind === EntityKind.CONTEXT ? 200 : 0
        ));

        // Re-heat simulation
        sim.alpha(0.3).restart();
    }, [forceProps, links, nodes, groupByKind]);

    // Auto-Center Effect
    useEffect(() => {
        if (!selectedEntityId || !simulationRef.current || !svgRef.current || !containerRef.current) return;

        // Find node in simulation (it has current x/y)
        const simNode = simulationRef.current.nodes().find(n => n.id === selectedEntityId);

        if (simNode && simNode.x !== undefined && simNode.y !== undefined) {
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            const svg = d3.select(svgRef.current);

            // Calculate centered transform
            const scale = 1.5; // Zoom in a bit when selecting
            const x = width / 2 - simNode.x * scale;
            const y = height / 2 - simNode.y * scale;
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);

            if (zoomBehaviorRef.current) {
                svg.transition().duration(750).call(zoomBehaviorRef.current.transform as any, newTransform);
            }
        }
    }, [selectedEntityId]);

    useEffect(() => {
        if (!svgRef.current || !containerRef.current) return;

        // Resize handling
        const container = containerRef.current;
        let width = container.clientWidth;
        let height = container.clientHeight;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear previous

        if (nodes.length === 0) return;

        // --- Adjacency Matrix for Highlighting ---
        const linkedByIndex: Record<string, boolean> = {};
        links.forEach((d: any) => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            linkedByIndex[`${s},${t}`] = true;
            linkedByIndex[`${t},${s}`] = true;
        });

        function isConnected(a: any, b: any) {
            return linkedByIndex[`${a.id},${b.id}`] || linkedByIndex[`${b.id},${a.id}`] || a.id === b.id;
        }
        // -----------------------------------------

        // Zoom Group
        const g = svg.append("g");

        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
                setTransform(event.transform); // Sync state
                setContextMenu(null); // Hide menu on zoom
            });

        zoomBehaviorRef.current = zoom;

        svg.call(zoom as any)
            .on("dblclick.zoom", null);

        // Color scale for Entity Kind
        const color = d3.scaleOrdinal<string>()
            .domain(Object.values(EntityKind))
            .range([
                '#ef4444', // GOAL (red)
                '#f97316', // PROJECT (orange)
                '#eab308', // COURSE (yellow)
                '#22c55e', // TOPIC (green)
                '#3b82f6', // TASK (blue)
                '#a855f7', // EVENT (purple)
                '#ec4899', // ACTIVITY (pink)
                '#64748b', // ROLE (slate)
                '#94a3b8', // TAG
                '#cbd5e1', // NOTE
                '#8b5cf6'  // CONTEXT (violet)
            ]);

        const simulation = d3.forceSimulation(nodes as any)
            .force("link", d3.forceLink(links).id((d: any) => d.id).distance(forceProps.linkDistance))
            .force("charge", d3.forceManyBody().strength(forceProps.charge))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(forceProps.collideRadius));

        simulationRef.current = simulation;

        // Arrow markers - Generate one per color
        const defs = g.append("defs");

        Object.entries(relColors).forEach(([type, color]) => {
            const markerId = `arrow-${type.replace(/_/g, '-')}`;
            defs.append("marker")
                .attr("id", markerId)
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 25)
                .attr("refY", 0)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto")
                .append("path")
                .attr("fill", color)
                .attr("d", "M0,-5L10,0L0,5");
        });

        // Fallback marker
        defs.append("marker")
            .attr("id", "arrow-default")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 25)
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("fill", relColors['DEFAULT'])
            .attr("d", "M0,-5L10,0L0,5");

        const link = g.append("g")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke-width", (d: any) => d.type === RelationshipType.TAGGED_WITH ? 1 : 2) // Thinner for TAGGED_WITH
            .attr("stroke", (d: any) => getLinkColor(d.type))
            .attr("stroke-opacity", (d: any) => d.type === RelationshipType.TAGGED_WITH ? 0.4 : 0.6)
            .attr("marker-end", (d: any) => {
                const markerId = `arrow-${d.type.replace(/_/g, '-')}`;
                return `url(#${markerId})`;
            })
            .attr("class", "link");

        const node = g.append("g")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .selectAll("g")
            .data(nodes)
            .join("g")
            .attr("class", "node")
            .call(drag(simulation) as any)
            .on("click", (event, d: any) => {
                selectEntity(d.id);
                setContextMenu(null);
                event.stopPropagation();
            })
            .on("mousedown", (event, d: any) => {
                if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation(); // Prevent drag/zoom
                    setDragLink({ sourceId: d.id, x: d.x, y: d.y });
                }
            })
            .on("contextmenu", (event, d: any) => {
                event.preventDefault();
                selectEntity(d.id);
                setContextMenu({ x: event.pageX, y: event.pageY, entityId: d.id });
            })
            .on("mouseenter", function (event, d: any) {
                node.transition().duration(200).style("opacity", (o: any) =>
                    isConnected(d, o) ? 1 : 0.1
                );
                link.transition().duration(200).style("opacity", (l: any) =>
                    (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.05
                );
            })
            .on("mouseleave", function () {
                node.transition().duration(200).style("opacity", 1);
                link.transition().duration(200).style("opacity", (d: any) => d.type === RelationshipType.TAGGED_WITH ? 0.4 : 0.6);
            });

        node.append("circle")
            .attr("r", (d: any) => d.kind === EntityKind.CONTEXT ? 24 : 15) // Larger size for Context nodes
            .attr("fill", (d: any) => color(d.kind))
            .attr("cursor", "pointer")
            .attr("class", (d: any) => d.id === selectedEntityId ? "stroke-indigo-400 stroke-[3px]" : "");

        node.append("text")
            .text((d: any) => {
                const title = d.title || 'Untitled';
                return title.length > 15 ? title.substring(0, 15) + '...' : title;
            })
            .attr("x", 25)
            .attr("y", 5)
            .attr("fill", "#e2e8f0")
            .attr("stroke", "none")
            .attr("font-size", (d: any) => d.kind === EntityKind.CONTEXT ? "14px" : "12px")
            .attr("font-weight", (d: any) => d.kind === EntityKind.CONTEXT ? "bold" : "normal")
            .style("pointer-events", "none")
            .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

        simulation.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source.x)
                .attr("y1", (d: any) => d.source.y)
                .attr("x2", (d: any) => d.target.x)
                .attr("y2", (d: any) => d.target.y);

            node
                .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
        });

        function drag(simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>) {
            function dragstarted(event: any) {
                if (event.sourceEvent.shiftKey) return; // Don't drag node if shifting
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
                setContextMenu(null);
            }

            function dragged(event: any) {
                if (event.sourceEvent.shiftKey) return;
                event.subject.fx = event.x;
                event.subject.fy = event.y;
            }

            function dragended(event: any) {
                if (event.sourceEvent.shiftKey) return;
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }

            return d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended);
        }

        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width: newWidth, height: newHeight } = entry.contentRect;
                svg.attr("viewBox", [0, 0, newWidth, newHeight]);
                simulation.force("center", d3.forceCenter(newWidth / 2, newHeight / 2));
                simulation.alpha(0.3).restart();
            }
        });

        resizeObserver.observe(container);
        svg.call(zoom.transform as any, d3.zoomIdentity);
        svg.on("click", () => {
            selectEntity(null);
            setContextMenu(null);
        });

        return () => {
            simulation.stop();
            resizeObserver.disconnect();
        };
    }, [nodes, links, selectedEntityId]);

    const handleGlobalMouseUp = (e: React.MouseEvent) => {
        if (dragLink) {
            // Check if we dropped on a node
            const targetDatum = d3.select(e.target as any).datum() as any;

            if (targetDatum && targetDatum.id && targetDatum.id !== dragLink.sourceId) {
                // Open selection menu instead of immediate creation
                setPendingLink({
                    source: dragLink.sourceId,
                    target: targetDatum.id,
                    x: e.clientX,
                    y: e.clientY
                });
            }
            setDragLink(null);
        }
    };

    const confirmLink = (type: RelationshipType) => {
        if (!pendingLink) return;
        applyOperations([{
            type: 'link_entities',
            payload: {
                from: pendingLink.source,
                to: pendingLink.target,
                type
            }
        }]);
        setPendingLink(null);
    };

    const calculateLine = () => {
        if (!dragLink || !mousePos) return null;

        // dragLink coordinates are in Simulation Space (needs transform applied)
        const startX = transform.applyX(dragLink.x);
        const startY = transform.applyY(dragLink.y);

        // mousePos coordinates are in SVG space (raw pointer relative to SVG)
        return { x1: startX, y1: startY, x2: mousePos.x, y2: mousePos.y };
    };

    const lineCoords = calculateLine();

    const toggleKind = (kind: EntityKind) => {
        const next = new Set(visibleKinds);
        if (next.has(kind)) {
            next.delete(kind);
        } else {
            next.add(kind);
        }
        setVisibleKinds(next);
    };

    const toggleAll = () => {
        if (visibleKinds.size === Object.keys(EntityKind).length) {
            setVisibleKinds(new Set());
        } else {
            setVisibleKinds(new Set(Object.values(EntityKind)));
        }
    };

    const resetZoom = () => {
        if (!svgRef.current || !containerRef.current) return;
        const svg = d3.select(svgRef.current);
        if (zoomBehaviorRef.current) {
            svg.transition().duration(750).call(
                zoomBehaviorRef.current.transform as any,
                d3.zoomIdentity
            );
        }
    };

    // Context Menu Handlers
    const handleContextAction = (action: string) => {
        if (!contextMenu) return;
        const id = contextMenu.entityId;
        const entity = entities.find(e => e.id === id);
        if (!entity) return;

        switch (action) {
            case 'focus':
                startFocusSession(id);
                break;
            case 'edit':
                selectEntity(id); // Opens panel
                break;
            case 'delete':
                if (confirm("Are you sure?")) {
                    applyOperations([{ type: 'delete_entity', payload: { id } }]);
                }
                break;
            case 'toggle':
                const newStatus = entity.status === EntityStatus.COMPLETED ? EntityStatus.ACTIVE : EntityStatus.COMPLETED;
                applyOperations([{ type: 'update_entity', payload: { id, fields: { status: newStatus } } }]);
                break;
        }
        setContextMenu(null);
    };

    return (
        <div
            ref={containerRef}
            className="w-full h-full bg-slate-900 rounded-lg shadow-inner overflow-hidden border border-slate-800 relative group select-none"
            onMouseUp={handleGlobalMouseUp}
            onMouseMove={(e) => {
                // Track mouse for visual linking using React event
                if (svgRef.current) {
                    const rect = svgRef.current.getBoundingClientRect();
                    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }
            }}
        >
            <svg ref={svgRef} className="w-full h-full cursor-move"></svg>

            {/* Visual Link Line */}
            {lineCoords && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-10">
                    <line
                        x1={lineCoords.x1} y1={lineCoords.y1}
                        x2={lineCoords.x2} y2={lineCoords.y2}
                        stroke="white"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                    />
                    <circle cx={lineCoords.x2} cy={lineCoords.y2} r={4} fill="white" />
                    <text
                        x={lineCoords.x2 + 10}
                        y={lineCoords.y2}
                        fill="white"
                        fontSize="10"
                        className="bg-black drop-shadow-md"
                        style={{ textShadow: '0 1px 2px black' }}
                    >
                        Release to Link
                    </text>
                </svg>
            )}

            {/* Legend Overlay */}
            <div className="absolute bottom-4 right-4 bg-slate-950/80 p-3 rounded-lg border border-slate-800/50 backdrop-blur pointer-events-none flex flex-col gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Relations</span>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-3 h-0.5 bg-red-500"></div> Blocked By
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-3 h-0.5 bg-blue-500"></div> Sequence
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-3 h-0.5 bg-emerald-500"></div> Fulfills
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-3 h-0.5 bg-indigo-500"></div> Tagged With
                </div>
            </div>

            {/* Floating Hint */}
            <div className="absolute bottom-4 left-4 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity flex items-center gap-2 text-[10px] text-slate-400">
                <span className="bg-slate-800 px-1.5 rounded border border-slate-700">Shift</span> + Drag to Link
            </div>

            <div className="absolute top-4 left-4 bg-slate-950/80 p-2 rounded text-xs text-slate-400 pointer-events-none backdrop-blur-sm border border-slate-800/50">
                {nodes.length} Nodes &bull; {links.length} Links
            </div>

            <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                <button
                    onClick={resetZoom}
                    className="p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white transition-colors"
                    title="Reset Zoom"
                >
                    <Maximize size={18} />
                </button>
                <button
                    onClick={() => { setShowPhysicsMenu(!showPhysicsMenu); setShowFilterMenu(false); }}
                    className={`p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white transition-colors ${showPhysicsMenu ? 'text-indigo-400 border-indigo-500/50' : ''}`}
                    title="Graph Physics"
                >
                    <Sliders size={18} />
                </button>
                <button
                    onClick={() => {
                        if (simulationRef.current && containerRef.current) {
                            const cx = containerRef.current.clientWidth / 2;
                            const cy = containerRef.current.clientHeight / 2;

                            // Boost alpha to heat up simulation
                            simulationRef.current.alpha(1).restart();

                            // Apply a temporary centripetal force using forceX/forceY (safest compatibility)
                            // This physically pulls nodes towards the center
                            simulationRef.current.force("temp-x", d3.forceX(cx).strength(0.4));
                            simulationRef.current.force("temp-y", d3.forceY(cy).strength(0.4));

                            // Remove the temp force after a delay
                            setTimeout(() => {
                                if (simulationRef.current) {
                                    simulationRef.current.force("temp-x", null);
                                    simulationRef.current.force("temp-y", null);
                                    simulationRef.current.alpha(0.3).restart();
                                }
                            }, 500);

                            // Reset Zoom to default 1.0 view centered
                            if (zoomBehaviorRef.current && svgRef.current) {
                                d3.select(svgRef.current).transition().duration(750).call(zoomBehaviorRef.current.transform as any, d3.zoomIdentity);
                            }
                        }
                    }}
                    className="p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white transition-colors"
                    title="Refresh & Recenter"
                >
                    <RefreshCw size={18} />
                </button>
                <button
                    onClick={() => { setShowFilterMenu(!showFilterMenu); setShowPhysicsMenu(false); }}
                    className={`p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white transition-colors ${showFilterMenu ? 'text-indigo-400 border-indigo-500/50' : ''}`}
                    title="Filter Graph"
                >
                    <Filter size={18} />
                </button>

                {showPhysicsMenu && (
                    <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800 p-3 rounded-lg shadow-xl w-48 flex flex-col gap-3 animate-in fade-in zoom-in duration-100">
                        <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-2">Physics</div>

                        <button
                            onClick={() => setGroupByKind(!groupByKind)}
                            className={`flex items-center gap-2 text-[10px] p-2 rounded border transition-colors ${groupByKind ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-300'}`}
                        >
                            <Magnet size={14} />
                            {groupByKind ? 'Ungroup Nodes' : 'Group by Kind'}
                        </button>

                        <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span>Repulsion</span>
                                <span>{forceProps.charge}</span>
                            </div>
                            <input
                                type="range" min="-1000" max="-100" step="50"
                                value={forceProps.charge}
                                onChange={(e) => setForceProps({ ...forceProps, charge: Number(e.target.value) })}
                                className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span>Link Distance</span>
                                <span>{forceProps.linkDistance}</span>
                            </div>
                            <input
                                type="range" min="50" max="300" step="10"
                                value={forceProps.linkDistance}
                                onChange={(e) => setForceProps({ ...forceProps, linkDistance: Number(e.target.value) })}
                                className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span>Collision</span>
                                <span>{forceProps.collideRadius}</span>
                            </div>
                            <input
                                type="range" min="10" max="100" step="5"
                                value={forceProps.collideRadius}
                                onChange={(e) => setForceProps({ ...forceProps, collideRadius: Number(e.target.value) })}
                                className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    </div>
                )}

                {showFilterMenu && (
                    <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800 p-3 rounded-lg shadow-xl w-56 flex flex-col gap-1 max-h-[80vh] overflow-y-auto animate-in fade-in zoom-in duration-100">
                        {/* Stats Header */}
                        <div className="text-[10px] text-slate-500 mb-2 p-2 bg-slate-800/50 rounded">
                            <div className="flex justify-between"><span>Total:</span><span>{stats.total}</span></div>
                            <div className="flex justify-between"><span>Hidden:</span><span>{stats.hidden + stats.archived}</span></div>
                            {stats.stale > 0 && <div className="flex justify-between text-amber-400"><span>Stale:</span><span>{stats.stale}</span></div>}
                            {stats.duplicates > 0 && <div className="flex justify-between text-orange-400"><span>Duplicates:</span><span>{stats.duplicates}</span></div>}
                        </div>

                        {/* Smart Visibility Section */}
                        <div className="border-b border-slate-800 pb-2 mb-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Smart Filters</span>

                            <button
                                onClick={() => setShowArchived(!showArchived)}
                                className={`w-full flex items-center justify-between text-xs p-1.5 rounded transition-colors ${showArchived ? 'bg-amber-900/20' : 'hover:bg-slate-800'}`}
                            >
                                <span className={`flex items-center gap-1.5 ${showArchived ? 'text-amber-400' : 'text-slate-400'}`}>
                                    <Archive size={12} /> Archived
                                </span>
                                {showArchived ? <Eye size={12} className="text-emerald-500" /> : <EyeOff size={12} className="text-slate-600" />}
                            </button>

                            <button
                                onClick={() => setShowOldCompleted(!showOldCompleted)}
                                className={`w-full flex items-center justify-between text-xs p-1.5 rounded transition-colors ${showOldCompleted ? 'bg-green-900/20' : 'hover:bg-slate-800'}`}
                            >
                                <span className={`flex items-center gap-1.5 ${showOldCompleted ? 'text-green-400' : 'text-slate-400'}`}>
                                    <CheckSquare size={12} /> Old Completed
                                </span>
                                {showOldCompleted ? <Eye size={12} className="text-emerald-500" /> : <EyeOff size={12} className="text-slate-600" />}
                            </button>

                            <button
                                onClick={() => setShowPastEvents(!showPastEvents)}
                                className={`w-full flex items-center justify-between text-xs p-1.5 rounded transition-colors ${showPastEvents ? 'bg-purple-900/20' : 'hover:bg-slate-800'}`}
                            >
                                <span className={`flex items-center gap-1.5 ${showPastEvents ? 'text-purple-400' : 'text-slate-400'}`}>
                                    <Calendar size={12} /> Past Events (60d+)
                                </span>
                                {showPastEvents ? <Eye size={12} className="text-emerald-500" /> : <EyeOff size={12} className="text-slate-600" />}
                            </button>

                            <button
                                onClick={() => setShowOrphans(!showOrphans)}
                                className={`w-full flex items-center justify-between text-xs p-1.5 rounded transition-colors ${!showOrphans ? 'bg-slate-700/50' : 'hover:bg-slate-800'}`}
                            >
                                <span className={`flex items-center gap-1.5 ${showOrphans ? 'text-slate-300' : 'text-slate-500'}`}>
                                    <Unlink size={12} /> Old Orphans
                                </span>
                                {showOrphans ? <Eye size={12} className="text-emerald-500" /> : <EyeOff size={12} className="text-slate-600" />}
                            </button>
                        </div>

                        {/* Entity Kind Toggles */}
                        <div className="flex justify-between items-center pb-2 mb-2 border-b border-slate-800">
                            <span className="text-xs font-bold text-slate-400 uppercase">By Type</span>
                            <button onClick={toggleAll} className="text-[10px] text-indigo-400 hover:text-indigo-300">
                                {visibleKinds.size === Object.keys(EntityKind).length ? 'Hide All' : 'Show All'}
                            </button>
                        </div>
                        {Object.values(EntityKind).map(kind => (
                            <button
                                key={kind}
                                onClick={() => toggleKind(kind)}
                                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800 transition-colors"
                            >
                                <span className={`font-mono ${visibleKinds.has(kind) ? 'text-slate-200' : 'text-slate-600'}`}>
                                    {kind}
                                </span>
                                {visibleKinds.has(kind) ? <Eye size={12} className="text-emerald-500" /> : <EyeOff size={12} className="text-slate-600" />}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="absolute bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 w-48 z-50 animate-in fade-in zoom-in duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-bold text-slate-500 uppercase">
                        Actions
                    </div>
                    <button onClick={() => handleContextAction('focus')} className="w-full text-left px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-900/30 flex items-center gap-2">
                        <Play size={14} /> Focus Session
                    </button>
                    <button onClick={() => handleContextAction('toggle')} className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2">
                        {entities.find(e => e.id === contextMenu.entityId)?.status === EntityStatus.COMPLETED ? (
                            <><CheckSquare size={14} className="text-emerald-500" /> Mark Active</>
                        ) : (
                            <><Square size={14} /> Mark Complete</>
                        )}
                    </button>
                    <button onClick={() => handleContextAction('edit')} className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2">
                        <Edit3 size={14} /> Edit Details
                    </button>
                    <div className="border-t border-slate-800 my-1"></div>
                    <button onClick={() => handleContextAction('delete')} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 flex items-center gap-2">
                        <Trash2 size={14} /> Delete
                    </button>
                </div>
            )}

            {/* Click-away listener for context menu */}
            {contextMenu && (
                <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}></div>
            )}

            {/* Link Type Selection Menu */}
            {pendingLink && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setPendingLink(null)}></div>
                    <div
                        className="fixed bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 w-48 z-50 animate-in fade-in zoom-in duration-100 flex flex-col"
                        style={{ top: pendingLink.y, left: pendingLink.x }}
                    >
                        <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-bold text-slate-500 uppercase">
                            Select Relationship
                        </div>
                        {[
                            { id: RelationshipType.DEPENDS_ON, label: 'Blocks / Depends On', color: 'text-red-400' },
                            { id: RelationshipType.PRECEDES, label: 'Precedes (Sequence)', color: 'text-blue-400' },
                            { id: RelationshipType.PART_OF, label: 'Part Of', color: 'text-slate-400' },
                            { id: RelationshipType.FULFILLS, label: 'Fulfills / Contributes', color: 'text-emerald-400' },
                            { id: RelationshipType.RELATED_TO, label: 'Related To', color: 'text-slate-300' }
                        ].map(type => (
                            <button
                                key={type.id}
                                onClick={() => confirmLink(type.id)}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-800 flex items-center gap-2 ${type.color}`}
                            >
                                <div className={`w-2 h-2 rounded-full bg-current opacity-50`} />
                                {type.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default GraphView;