/**
 * Filters repeated Firestore listener emissions that contain the same
 * application data. Key ordering is normalized so object reconstruction or
 * metadata-only SDK events do not look like user edits.
 */
const normalizeSnapshotValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
  if (value && typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === 'function') {
      try { return maybeTimestamp.toDate().toISOString(); } catch { /* Fall through to fields. */ }
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map(key => [key, normalizeSnapshotValue(record[key])]),
    );
  }
  return value;
};

export function createSnapshotDeduper<T>(): (snapshot: T) => boolean {
  let previous = '';
  let hasPrevious = false;
  return (snapshot: T): boolean => {
    const signature = JSON.stringify(normalizeSnapshotValue(snapshot)) ?? 'undefined';
    if (hasPrevious && signature === previous) return false;
    previous = signature;
    hasPrevious = true;
    return true;
  };
}
