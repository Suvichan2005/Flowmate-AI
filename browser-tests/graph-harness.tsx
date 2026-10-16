import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import GraphView from '../components/GraphView';
import { Entity, EntityKind, EntityStatus, Relationship, RelationshipType } from '../types';
import { useStore } from '../store';

const params = new URLSearchParams(location.search);
const shape = params.get('shape') || 'disconnected';
const sizes: Record<string, number> = { empty: 0, single: 1, disconnected: 8, dense: 16, large: 240 };
const count = sizes[shape] ?? 8;
const now = new Date().toISOString();
const entities: Entity[] = Array.from({ length: count }, (_, index) => ({
  id: `synthetic-graph-${shape}-${index}`,
  kind: index % 3 === 0 ? EntityKind.PROJECT : EntityKind.TASK,
  title: `Synthetic node ${index + 1}`,
  description: null,
  status: EntityStatus.ACTIVE,
  priority: 3,
  start_time: null,
  end_time: null,
  deadline: null,
  duration_minutes: null,
  recurrence: null,
  metadata: {},
  created_at: now,
  updated_at: now,
  canonical_tags: [],
}));

const pairs: Array<[number, number]> = [];
if (shape === 'dense') {
  for (let from = 0; from < count; from++) {
    for (let to = from + 1; to < count; to++) pairs.push([from, to]);
  }
} else if (shape === 'large') {
  for (let from = 0; from < count; from++) pairs.push([from, (from + 1) % count], [from, (from + 7) % count]);
}
const relationships: Relationship[] = pairs.map(([from, to], index) => ({
  id: `synthetic-graph-link-${index}`,
  from: entities[from].id,
  to: entities[to].id,
  type: index === 0 ? RelationshipType.ASSIGNED_TO : RelationshipType.RELATED_TO,
  meta: {},
  created_at: now,
}));

useStore.setState({ selectedEntityId: null });
const target = document.getElementById('graph-fixture');
if (!target) throw new Error('Graph fixture mount is missing');

function GraphHarness() {
  const [extraNodes, setExtraNodes] = useState(0);
  useEffect(() => {
    const addNode = () => setExtraNodes(value => value + 1);
    window.addEventListener('graphfixture:add-node', addNode);
    return () => window.removeEventListener('graphfixture:add-node', addNode);
  }, []);
  const nextEntities = [...entities, ...Array.from({ length: extraNodes }, (_, index) => ({
    ...entities[0], id: `synthetic-graph-added-${index}`, title: `Added node ${index + 1}`,
  }))];
  const nextRelationships = extraNodes && nextEntities.length > 1
    ? [...relationships, { id: `synthetic-graph-added-edge`, from: nextEntities[0].id, to: nextEntities[nextEntities.length - 1].id, type: RelationshipType.RELATED_TO, meta: {}, created_at: now }]
    : relationships;
  return <GraphView entities={nextEntities} relationships={nextRelationships} />;
}

createRoot(target).render(<GraphHarness />);

