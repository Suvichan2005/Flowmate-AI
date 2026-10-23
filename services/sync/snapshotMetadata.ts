export type SyncSnapshotSource = 'entities' | 'relationships' | 'config' | 'messages' | 'chatSessions' | 'chatBranches';
export type SyncSnapshotMetadata = { fromCache: boolean; hasPendingWrites: boolean };

const SOURCES: SyncSnapshotSource[] = ['entities', 'relationships', 'config', 'messages', 'chatSessions', 'chatBranches'];

/** Combines per-query Firestore metadata only after every workspace stream has emitted once. */
export function createSyncSnapshotMetadataAggregator(
  onUpdate: (metadata: SyncSnapshotMetadata) => void,
): (source: SyncSnapshotSource, metadata: SyncSnapshotMetadata) => void {
  const latest = new Map<SyncSnapshotSource, SyncSnapshotMetadata>();
  let previous: SyncSnapshotMetadata | null = null;

  return (source, metadata) => {
    latest.set(source, metadata);
    if (SOURCES.some(key => !latest.has(key))) return;

    const snapshots = [...latest.values()];
    const combined = {
      fromCache: snapshots.some(item => item.fromCache),
      hasPendingWrites: snapshots.some(item => item.hasPendingWrites),
    };
    if (previous?.fromCache === combined.fromCache && previous?.hasPendingWrites === combined.hasPendingWrites) return;
    previous = combined;
    onUpdate(combined);
  };
}
