/**
 * Flowmate Unified Synchronization Protocol (P1-10)
 *
 * Defines platform-agnostic contracts for:
 * 1. Pluggable Storage Providers (Firebase Firestore vs Google Drive BYOS vs Local Vault)
 * 2. Real-Time Transport (WebSocket Relay + BroadcastChannel)
 * 3. Durable Outbox & Reconciliation Envelopes
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  Entity as LegacyEntity,
  Relationship as LegacyRelationship,
  Message,
  ChatSession,
  ConversationBranch,
  FoodLogEntry,
  Subject,
  ClassSchedule,
  Holiday,
  AttendanceLog,
  TagDefinition,
  UserSettings,
} from '../../types';

export type SyncStorageBackend = 'firestore' | 'googledrive' | 'local_vault';

export type SyncRelayConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unavailable';

export type SyncOverallStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'blocked_by_client';

export type SyncEntityKind =
  | 'entity'
  | 'relationship'
  | 'message'
  | 'chat_session'
  | 'chat_branch'
  | 'chat_draft'
  | 'chat_streaming'
  | 'settings'
  | 'attendance'
  | 'food_logs'
  | 'workspace_plugin';

export type SyncOperationType = 'upsert' | 'delete';

export interface SyncMutationPayload {
  readonly id: string;
  readonly entityKind: SyncEntityKind;
  readonly op: SyncOperationType;
  readonly entityId: string;
  readonly clientTimestamp: string;
  readonly deviceId: string;
  readonly data?: Record<string, unknown>;
}

export interface SyncEnvelope {
  readonly version: 2;
  readonly envelopeId: string;
  readonly senderDeviceId: string;
  readonly senderTabId?: string;
  readonly userId: string;
  readonly timestamp: string;
  readonly mutations: SyncMutationPayload[];
}

export interface FullWorkspaceSnapshot {
  readonly schemaVersion: 2;
  readonly exportedAt: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly entities: LegacyEntity[];
  readonly relationships: LegacyRelationship[];
  readonly messages: Message[];
  readonly chatSessions: ChatSession[];
  readonly conversationBranches: ConversationBranch[];
  readonly universalTags: TagDefinition[];
  readonly settings?: Partial<UserSettings>;
  readonly foodLogs: FoodLogEntry[];
  readonly attendance: {
    readonly subjects: Subject[];
    readonly classSchedule: ClassSchedule[];
    readonly holidays: Holiday[];
    readonly attendanceLogs: AttendanceLog[];
  };
}

export interface SyncStatusReport {
  readonly storageBackend: SyncStorageBackend;
  readonly relayState: SyncRelayConnectionState;
  readonly overallStatus: SyncOverallStatus;
  readonly pendingOutboxCount: number;
  readonly lastSyncedAt: string | null;
  readonly activePeersCount: number;
  readonly deviceId: string;
  readonly errorMessage: string | null;
  readonly isAdBlockerActive: boolean;
}

export interface SyncStorageProvider {
  readonly id: SyncStorageBackend;
  readonly name: string;
  readonly isAvailable: () => boolean;
  readonly initialize: (userId: string) => Promise<boolean>;
  readonly loadWorkspace: () => Promise<FullWorkspaceSnapshot | null>;
  readonly saveWorkspace: (snapshot: FullWorkspaceSnapshot) => Promise<boolean>;
  readonly saveMutation: (mutation: SyncMutationPayload) => Promise<boolean>;
  readonly disconnect: () => Promise<void>;
}

export interface SyncRelayProvider {
  readonly isAvailable: () => boolean;
  readonly connect: (userId: string, tokenGetter: () => Promise<string | null>) => void;
  readonly disconnect: () => void;
  readonly broadcast: (envelope: SyncEnvelope) => boolean;
  readonly onRemoteEnvelope: (listener: (envelope: SyncEnvelope) => void) => () => void;
  readonly onStateChange: (listener: (state: SyncRelayConnectionState, peerCount: number) => void) => () => void;
  readonly getConnectionState: () => SyncRelayConnectionState;
  readonly getActivePeerCount: () => number;
}
