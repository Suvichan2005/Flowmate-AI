// Async Storage Adapter for Zustand
// Wraps localStorage in the StateStorage interface for Zustand persist middleware with monotonic multi-tab reconciliation

import { StateStorage } from 'zustand/middleware';

const CROSS_TAB_CHANNEL_NAME = 'flowmate_cross_tab_sync';
const STORAGE_KEY_PREFIX = 'flowmate-storage';

interface StoredKernelEntity {
    id: string;
    version: number;
    lifecycle?: {
        status?: string;
        deleted_at?: string | null;
        restored_at?: string | null;
        restored?: boolean;
        updated_at?: string;
        created_at?: string;
    };
    metadata?: {
        deleted?: boolean;
        deleted_at?: string | null;
        restored?: boolean;
        restored_at?: string | null;
        [key: string]: unknown;
    };
    attributes?: Record<string, unknown>;
    deleted?: boolean;
    restored?: boolean;
    restored_at?: string | null;
    [key: string]: unknown;
}

export function isStoredEntityTombstone(ent: StoredKernelEntity | undefined | null): boolean {
    if (!ent || typeof ent !== 'object') return false;
    if (ent.lifecycle && typeof ent.lifecycle === 'object') {
        if (ent.lifecycle.deleted_at !== null && ent.lifecycle.deleted_at !== undefined) return true;
        if (ent.lifecycle.status === 'deleted') return true;
    }
    if (ent.deleted === true) return true;
    if (ent.metadata && typeof ent.metadata === 'object') {
        const meta = ent.metadata as Record<string, unknown>;
        if (meta.deleted === true) return true;
        if (meta.deleted_at !== null && meta.deleted_at !== undefined) return true;
    }
    if (ent.attributes && typeof ent.attributes === 'object') {
        const attrs = ent.attributes as Record<string, unknown>;
        if (attrs.deleted === true || attrs.status === 'deleted') return true;
        if (attrs.deleted_at !== null && attrs.deleted_at !== undefined) return true;
    }
    return false;
}

export function getStoredEntityDeletedAt(ent: StoredKernelEntity): string | null {
    if (ent.lifecycle?.deleted_at) return ent.lifecycle.deleted_at;
    if (typeof ent.metadata?.deleted_at === 'string') return ent.metadata.deleted_at;
    if (ent.attributes && typeof (ent.attributes as Record<string, unknown>).deleted_at === 'string') {
        return (ent.attributes as Record<string, unknown>).deleted_at as string;
    }
    return null;
}

function parseTimestampMs(ts: unknown): number {
    if (typeof ts === 'string' && ts.trim() !== '') {
        const ms = new Date(ts).getTime();
        if (!isNaN(ms)) return ms;
    }
    if (typeof ts === 'number' && !isNaN(ts)) {
        return ts;
    }
    return 0;
}

export function canonicalJson(val: unknown): string {
    if (val === null || typeof val !== 'object') {
        return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
        return '[' + val.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
    }
    const rec = val as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const pairs: string[] = [];
    for (const k of keys) {
        const v = rec[k];
        if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') {
            pairs.push(JSON.stringify(k) + ':' + canonicalJson(v));
        }
    }
    return '{' + pairs.join(',') + '}';
}

function getStoredEntityUpdatedAt(ent: StoredKernelEntity): string {
    if (ent.lifecycle?.updated_at) return ent.lifecycle.updated_at;
    if (typeof ent.metadata?.updated_at === 'string') return ent.metadata.updated_at;
    if (ent.attributes && typeof (ent.attributes as Record<string, unknown>).updated_at === 'string') {
        return (ent.attributes as Record<string, unknown>).updated_at as string;
    }
    return '';
}

/**
 * Checks whether an entity has explicit verified authentication for restoration.
 * In the fail-closed model, unauthenticated writable flags (restored: true, future/invalid restored_at)
 * are rejected to prevent unauthenticated revival of tombstones.
 */
export function isStoredEntityExplicitlyRestored(ent: StoredKernelEntity, deletedAt: string | null): boolean {
    // Fail-closed invariant: plain mutable JSON attributes cannot authenticate restoration
    return false;
}

interface StoredSnapshot {
    state?: {
        kernelEntities?: Record<string, StoredKernelEntity>;
        [key: string]: unknown;
    };
    version?: number;
    [key: string]: unknown;
}

/**
 * Reconciles incoming serialized storage snapshot with existing on-disk snapshot.
 * Guarantees monotonic revisions, tombstone supremacy, and prevents concurrent tab overwrite data-loss.
 */
export function reconcileStorageSnapshot(existingRaw: string | null, incomingRaw: string): string {
    if (!existingRaw) return incomingRaw;

    try {
        const existingParsed = JSON.parse(existingRaw) as StoredSnapshot;
        const incomingParsed = JSON.parse(incomingRaw) as StoredSnapshot;

        const existingKernel = existingParsed?.state?.kernelEntities;
        const incomingKernel = incomingParsed?.state?.kernelEntities;

        if (!existingKernel || !incomingKernel || typeof existingKernel !== 'object' || typeof incomingKernel !== 'object') {
            return incomingRaw;
        }

        let needsMerge = false;
        const mergedKernel: Record<string, StoredKernelEntity> = { ...incomingKernel };

        for (const [id, existingEnt] of Object.entries(existingKernel)) {
            if (!existingEnt || typeof existingEnt !== 'object' || typeof existingEnt.version !== 'number') {
                continue;
            }

            const incomingEnt = incomingKernel[id];

            if (!incomingEnt) {
                // Entity exists on disk (committed by peer tab or prior write) but absent in incoming snapshot.
                // Preserve it so concurrent writes never drop peer tab entities!
                mergedKernel[id] = existingEnt;
                needsMerge = true;
                continue;
            }

            const isExistingDeleted = isStoredEntityTombstone(existingEnt);
            const isIncomingDeleted = isStoredEntityTombstone(incomingEnt);

            if (isExistingDeleted && !isIncomingDeleted) {
                // Disk is deleted tombstone, incoming is non-deleted edit.
                // Fail-closed tombstone supremacy: unauthenticated incoming edits cannot revive a tombstone.
                const finalVersion = incomingEnt.version > existingEnt.version
                    ? incomingEnt.version + 1
                    : existingEnt.version;
                mergedKernel[id] = {
                    ...existingEnt,
                    version: finalVersion,
                };
                needsMerge = true;
            } else if (!isExistingDeleted && isIncomingDeleted) {
                // Disk is non-deleted edit, incoming is deleted tombstone.
                // Fail-closed tombstone supremacy: deletion prevails over non-deleted edits.
                const finalVersion = existingEnt.version > incomingEnt.version
                    ? existingEnt.version + 1
                    : incomingEnt.version;
                mergedKernel[id] = {
                    ...incomingEnt,
                    version: finalVersion,
                };
                if (finalVersion !== incomingEnt.version) {
                    needsMerge = true;
                }
            } else if (isExistingDeleted && isIncomingDeleted) {
                // Both are deleted tombstones.
                if (incomingEnt.version > existingEnt.version) {
                    mergedKernel[id] = incomingEnt;
                } else if (existingEnt.version > incomingEnt.version) {
                    mergedKernel[id] = existingEnt;
                    needsMerge = true;
                } else {
                    // Equal version: deterministic tie-break
                    const exUpdatedMs = parseTimestampMs(getStoredEntityUpdatedAt(existingEnt) || getStoredEntityDeletedAt(existingEnt));
                    const inUpdatedMs = parseTimestampMs(getStoredEntityUpdatedAt(incomingEnt) || getStoredEntityDeletedAt(incomingEnt));
                    if (inUpdatedMs > exUpdatedMs) {
                        mergedKernel[id] = incomingEnt;
                    } else if (exUpdatedMs > inUpdatedMs) {
                        mergedKernel[id] = existingEnt;
                        needsMerge = true;
                    } else {
                        const jsonEx = canonicalJson(existingEnt);
                        const jsonIn = canonicalJson(incomingEnt);
                        if (jsonIn > jsonEx) {
                            mergedKernel[id] = incomingEnt;
                        } else {
                            mergedKernel[id] = existingEnt;
                            needsMerge = true;
                        }
                    }
                }
            } else {
                // Neither is deleted.
                if (incomingEnt.version > existingEnt.version) {
                    mergedKernel[id] = incomingEnt;
                } else if (existingEnt.version > incomingEnt.version) {
                    mergedKernel[id] = existingEnt;
                    needsMerge = true;
                } else {
                    // Equal version: deterministic commutative tie-breaker
                    const exUpdatedMs = parseTimestampMs(getStoredEntityUpdatedAt(existingEnt));
                    const inUpdatedMs = parseTimestampMs(getStoredEntityUpdatedAt(incomingEnt));
                    if (inUpdatedMs > exUpdatedMs) {
                        mergedKernel[id] = incomingEnt;
                    } else if (exUpdatedMs > inUpdatedMs) {
                        mergedKernel[id] = existingEnt;
                        needsMerge = true;
                    } else {
                        const jsonEx = canonicalJson(existingEnt);
                        const jsonIn = canonicalJson(incomingEnt);
                        if (jsonIn > jsonEx) {
                            mergedKernel[id] = incomingEnt;
                        } else {
                            mergedKernel[id] = existingEnt;
                            needsMerge = true;
                        }
                    }
                }
            }
        }

        if (needsMerge && incomingParsed.state) {
            incomingParsed.state.kernelEntities = mergedKernel;
            return JSON.stringify(incomingParsed);
        }
    } catch {
        // Fall back to incoming value on parse error
    }

    return incomingRaw;
}


export const asyncStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(name);
    },
    setItem: async (name: string, value: string): Promise<void> => {
        if (typeof localStorage === 'undefined') return;

        const existing = localStorage.getItem(name);
        let finalValue = value;
        if (name === STORAGE_KEY_PREFIX) {
            finalValue = reconcileStorageSnapshot(existing, value);
        }

        // Hydration writes the same partialized snapshot. Broadcasting it again
        // makes peer tabs rehydrate and echo forever even without a real edit.
        if (existing === finalValue) return;
        localStorage.setItem(name, finalValue);

        // Post broadcast message to notify peer tabs of committed snapshot revision
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                const channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
                channel.postMessage({ type: 'SNAPSHOT_COMMITTED', key: name, timestamp: Date.now() });
                channel.close();
            } catch {
                // Ignore channel broadcast errors
            }
        }
    },
    removeItem: async (name: string): Promise<void> => {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(name);
    },
};

/**
 * Registers cross-tab synchronization listeners via BroadcastChannel and window 'storage' events.
 * Invokes onExternalChange whenever peer tabs commit updated state.
 */
export function setupCrossTabSync(onExternalChange: () => void): () => void {
    if (typeof window === 'undefined') return () => {};

    // 1. Native window storage event (triggers in peer tabs when localStorage changes)
    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY_PREFIX && event.newValue) {
            onExternalChange();
        }
    };
    window.addEventListener('storage', handleStorage);

    // 2. High-performance BroadcastChannel for immediate cross-tab delivery (<5ms)
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
            channel.onmessage = (msg: MessageEvent) => {
                if (msg.data?.type === 'SNAPSHOT_COMMITTED') {
                    onExternalChange();
                }
            };
        } catch {
            channel = null;
        }
    }

    return () => {
        window.removeEventListener('storage', handleStorage);
        if (channel) {
            channel.close();
        }
    };
}
