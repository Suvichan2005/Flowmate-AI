// Async Storage Adapter for Zustand
// Wraps localStorage in the StateStorage interface for Zustand persist middleware with monotonic multi-tab reconciliation

import { StateStorage } from 'zustand/middleware';

const CROSS_TAB_CHANNEL_NAME = 'flowmate_cross_tab_sync';
const STORAGE_KEY_PREFIX = 'flowmate-storage';
const LEGACY_STORAGE_IDENTITY = 'legacy';
let activeStorageIdentity = LEGACY_STORAGE_IDENTITY;
let blockWritesDuringIdentitySwitch = false;

function storageKeyForIdentity(name: string, identity = activeStorageIdentity): string {
    if (name !== STORAGE_KEY_PREFIX || identity === LEGACY_STORAGE_IDENTITY) return name;
    return `${STORAGE_KEY_PREFIX}:identity:${encodeURIComponent(identity)}`;
}

function snapshotWithIdentity(raw: string, identity: string): string | null {
    try {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown>; [key: string]: unknown };
        if (!parsed.state || typeof parsed.state !== 'object') return null;
        const owner = parsed.state.workspaceStorageIdentity;
        if (typeof owner === 'string' && owner !== identity) return null;
        // Existing snapshots predate the marker. The key itself is their
        // established owner; stamp it in memory so every subsequent write is
        // identity-bound without changing the stored source during read.
        if (owner === undefined) parsed.state.workspaceStorageIdentity = identity;
        return JSON.stringify(parsed);
    } catch {
        return null;
    }
}

export function getActiveWorkspaceStorageIdentity(): string {
    return activeStorageIdentity;
}

export function getWorkspaceStorageKey(identity: string): string {
    return storageKeyForIdentity(STORAGE_KEY_PREFIX, identity);
}

/** Select a workspace snapshot and block persistence until its hydration finishes. */
export function beginWorkspaceStorageIdentitySwitch(identity: string | null): void {
    activeStorageIdentity = identity || LEGACY_STORAGE_IDENTITY;
    blockWritesDuringIdentitySwitch = true;
}

export function finishWorkspaceStorageIdentitySwitch(identity?: string): void {
    if (identity && identity !== activeStorageIdentity) return;
    blockWritesDuringIdentitySwitch = false;
}

export function readWorkspaceStorageSnapshot(identity: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(getWorkspaceStorageKey(identity));
        return raw === null ? null : snapshotWithIdentity(raw, identity);
    } catch { return null; }
}

export function summarizeWorkspaceStorageSnapshot(identity: string, defaultSettings?: unknown): { entities: number; relationships: number; messages: number; chatSessions: number; otherItems: number; preferencesChanged: boolean; hasContent: boolean } {
    const raw = readWorkspaceStorageSnapshot(identity);
    if (!raw) return { entities: 0, relationships: 0, messages: 0, chatSessions: 0, otherItems: 0, preferencesChanged: false, hasContent: false };
    try {
        const state = (JSON.parse(raw) as { state?: Record<string, unknown> }).state || {};
        const entitiesValue = state.entities;
        const entities = Array.isArray(entitiesValue)
            ? entitiesValue.length
            : state.kernelEntities && typeof state.kernelEntities === 'object'
                ? Object.keys(state.kernelEntities as Record<string, unknown>).length
                : 0;
        const relationships = Array.isArray(state.relationships) ? state.relationships.length : 0;
        const messages = Array.isArray(state.messages)
            ? state.messages.filter(message => !(message && typeof message === 'object'
                && (message as { id?: unknown }).id === 'init-1'
                && (message as { role?: unknown }).role === 'assistant'
                && (message as { text?: unknown }).text === 'Welcome to Flowmate. What would you like to talk through or work on?')).length
            : 0;
        const chatSessions = Array.isArray(state.chatSessions)
            ? state.chatSessions.filter(session => !(session && typeof session === 'object'
                && (session as { id?: unknown }).id === 'general'
                && (session as { title?: unknown }).title === 'General Chat'
                && !(session as { deleted?: unknown }).deleted)).length
            : 0;
        const otherArrayKeys = ['foodLogs', 'subjects', 'classSchedule', 'holidays', 'attendanceLogs', 'auditLogs', 'syncQueue'];
        const otherArrayCount = otherArrayKeys.reduce((total, key) => total + (Array.isArray(state[key]) ? (state[key] as unknown[]).length : 0), 0);
        const branchValues = state.branches && typeof state.branches === 'object' ? Object.values(state.branches as Record<string, unknown>) : [];
        const customBranches = branchValues.filter(branch => branch && typeof branch === 'object'
            && (branch as { id?: unknown }).id !== 'b_main_general').length;
        const branchQueues = state.branchQueues && typeof state.branchQueues === 'object'
            ? Object.values(state.branchQueues as Record<string, unknown[]>).reduce((total, queue) => total + (Array.isArray(queue) ? queue.length : 0), 0)
            : 0;
        const unsentDrafts = state.unsentDrafts && typeof state.unsentDrafts === 'object'
            ? Object.values(state.unsentDrafts as Record<string, { text?: unknown; attachment?: unknown }>).filter(draft =>
                !!draft && (typeof draft.text === 'string' && draft.text.length > 0 || typeof draft.attachment === 'string' && draft.attachment.length > 0)).length
            : 0;
        const otherItems = otherArrayCount + customBranches + branchQueues + unsentDrafts + (state.dailyBriefing ? 1 : 0);
        const preferencesChanged = state.settings !== undefined && defaultSettings !== undefined
            && canonicalJson(state.settings) !== canonicalJson(defaultSettings);
        return { entities, relationships, messages, chatSessions, otherItems, preferencesChanged, hasContent: entities + relationships + messages + chatSessions + otherItems > 0 || preferencesChanged };
    } catch {
        return { entities: 0, relationships: 0, messages: 0, chatSessions: 0, otherItems: 0, preferencesChanged: false, hasContent: false };
    }
}

/** Copies an explicitly selected snapshot only when the destination has none. */
export function copyWorkspaceStorageSnapshot(fromIdentity: string, toIdentity: string, allowOverwrite = false): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        const sourceKey = getWorkspaceStorageKey(fromIdentity);
        const targetKey = getWorkspaceStorageKey(toIdentity);
        const source = localStorage.getItem(sourceKey);
        if (!source || (!allowOverwrite && localStorage.getItem(targetKey))) return false;
        const copied = JSON.parse(source) as { state?: Record<string, unknown>; [key: string]: unknown };
        if (!copied.state || typeof copied.state !== 'object') return false;
        // This helper represents the user's explicit choice to adopt the source
        // snapshot into a different account namespace, so bind the copy to its
        // destination while leaving the original snapshot untouched.
        copied.state.workspaceStorageIdentity = toIdentity;
        localStorage.setItem(targetKey, JSON.stringify(copied));
        return true;
    } catch { return false; }
}

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
        const identity = activeStorageIdentity;
        const raw = localStorage.getItem(storageKeyForIdentity(name, identity));
        return raw === null || name !== STORAGE_KEY_PREFIX ? raw : snapshotWithIdentity(raw, identity);
    },
    setItem: async (name: string, value: string): Promise<void> => {
        if (typeof localStorage === 'undefined') return;
        if (blockWritesDuringIdentitySwitch) return;

        const identity = activeStorageIdentity;
        const storageKey = storageKeyForIdentity(name, identity);
        const existing = localStorage.getItem(storageKey);
        let finalValue = value;
        if (name === STORAGE_KEY_PREFIX) {
            const taggedIncoming = snapshotWithIdentity(value, identity);
            // A late persist write can outlive the account transition that
            // produced it. Refuse the stale payload instead of saving another
            // account's state under the newly selected identity.
            if (!taggedIncoming) return;
            const taggedExisting = existing === null ? null : snapshotWithIdentity(existing, identity);
            if (existing !== null && !taggedExisting) return;
            finalValue = reconcileStorageSnapshot(taggedExisting, taggedIncoming);
            finalValue = snapshotWithIdentity(finalValue, identity) || taggedIncoming;
        }

        // Hydration writes the same partialized snapshot. Broadcasting it again
        // makes peer tabs rehydrate and echo forever even without a real edit.
        if (existing === finalValue) return;
        localStorage.setItem(storageKey, finalValue);

        // Post broadcast message to notify peer tabs of committed snapshot revision
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                const channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
                channel.postMessage({ type: 'SNAPSHOT_COMMITTED', key: name, storageKey, timestamp: Date.now() });
                channel.close();
            } catch {
                // Ignore channel broadcast errors
            }
        }
    },
    removeItem: async (name: string): Promise<void> => {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(storageKeyForIdentity(name));
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
        if (event.key === storageKeyForIdentity(STORAGE_KEY_PREFIX) && event.newValue) {
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
                if (msg.data?.type === 'SNAPSHOT_COMMITTED' && msg.data?.storageKey === storageKeyForIdentity(STORAGE_KEY_PREFIX)) {
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
