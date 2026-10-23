import { describe, expect, it } from 'vitest';
import { createSnapshotDeduper } from '../services/sync/snapshotDeduper';

describe('Firestore combined snapshot deduplication', () => {
  it('ignores reconstructed objects and metadata-independent key order', () => {
    const shouldNotify = createSnapshotDeduper<unknown>();
    expect(shouldNotify({ messages: [{ id: 'm1', role: 'user', text: 'hello' }] })).toBe(true);
    expect(shouldNotify({ messages: [{ text: 'hello', role: 'user', id: 'm1' }] })).toBe(false);
  });

  it('passes a real message edit and a tombstone change through', () => {
    const shouldNotify = createSnapshotDeduper<unknown>();
    const initial = { messages: [{ id: 'm1', text: 'before' }], sessions: [{ id: 's1', deleted: false }] };
    expect(shouldNotify(initial)).toBe(true);
    expect(shouldNotify({ ...initial, messages: [{ id: 'm1', text: 'after' }] })).toBe(true);
    expect(shouldNotify({ ...initial, sessions: [{ id: 's1', deleted: true }] })).toBe(true);
  });
});
