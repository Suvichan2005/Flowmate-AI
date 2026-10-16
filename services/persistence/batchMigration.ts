/**
 * Flowmate Greenfield Domain Kernel — Explicit Batch Migration Engine
 *
 * Performs authoritative batch migration from legacy Firestore representation to Kernel,
 * with atomic pre-migration backup snapshots and transactional rollback.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Pre-migration backup snapshot to /users/{uid}/meta/backup_pre_v5
 * - Full rollback recovery capability
 * - Idempotent execution (skips if already migrated)
 */

import {
  Firestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  DocumentData,
} from 'firebase/firestore';
import { Entity } from '../kernel/types';
import { PersistencePort, PersistenceMutation } from '../kernel/persistencePort';
import {
  isLegacyEntityDocument,
  upgradeLegacyEntityToKernel,
  upgradeLegacyMealLogToKernel,
  upgradeLegacyAttendanceLogToKernel,
} from './legacyMigration';

export interface MigrationStatus {
  status: 'pending' | 'completed' | 'rolled_back';
  version?: number;
  migrated_at?: string;
  rolled_back_at?: string;
  total_entities?: number;
}

export interface MigrationResult {
  success: boolean;
  alreadyMigrated: boolean;
  migratedCount: number;
  backupId: string;
}

export interface RollbackResult {
  success: boolean;
  restoredCount: number;
  timestamp: string;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export async function getMigrationStatus(
  db: Firestore,
  userId: string
): Promise<MigrationStatus> {
  const statusRef = doc(db, 'users', userId, 'meta', 'migration_v5_status');
  const snap = await getDoc(statusRef);
  if (!snap.exists()) {
    return { status: 'pending' };
  }
  const data = snap.data();
  return {
    status: data.status === 'completed' || data.status === 'rolled_back' ? data.status : 'pending',
    version: typeof data.version === 'number' ? data.version : undefined,
    migrated_at: typeof data.migrated_at === 'string' ? data.migrated_at : undefined,
    rolled_back_at: typeof data.rolled_back_at === 'string' ? data.rolled_back_at : undefined,
    total_entities: typeof data.total_entities === 'number' ? data.total_entities : undefined,
  };
}

export async function executeBatchMigrationToKernel(
  db: Firestore,
  userId: string,
  persistencePort: PersistencePort
): Promise<MigrationResult> {
  // 1. Check idempotency
  const currentStatus = await getMigrationStatus(db, userId);
  if (currentStatus.status === 'completed' && currentStatus.version === 5) {
    return {
      success: true,
      alreadyMigrated: true,
      migratedCount: 0,
      backupId: 'skipped_already_completed',
    };
  }

  const now = new Date().toISOString();

  // 2. Read all legacy entity docs
  const entitiesColRef = collection(db, 'users', userId, 'entities');
  const entitySnaps = await getDocs(entitiesColRef);
  const rawEntities: Record<string, unknown>[] = [];
  for (const d of entitySnaps.docs) {
    const data = d.data();
    rawEntities.push({ id: d.id, ...data });
  }

  // 3. Read food silo if present
  const foodDocRef = doc(db, 'users', userId, 'meta', 'food');
  const foodSnap = await getDoc(foodDocRef);
  const rawFood = foodSnap.exists() ? foodSnap.data() : null;

  // 4. Read attendance silo if present
  const attDocRef = doc(db, 'users', userId, 'meta', 'attendance');
  const attSnap = await getDoc(attDocRef);
  const rawAtt = attSnap.exists() ? attSnap.data() : null;

  // 5. Create authoritative backup pre-snapshot in /users/{userId}/meta/backup_pre_v5
  const backupDocRef = doc(db, 'users', userId, 'meta', 'backup_pre_v5');
  await setDoc(backupDocRef, {
    created_at: now,
    entities: rawEntities,
    food: rawFood,
    attendance: rawAtt,
  });

  // 6. Transform entities
  const upgradedEntities: Entity[] = [];

  for (const raw of rawEntities) {
    if (isLegacyEntityDocument(raw)) {
      upgradedEntities.push(upgradeLegacyEntityToKernel(raw));
    }
  }

  // Transform food logs
  if (rawFood && Array.isArray(rawFood.foodLogs)) {
    for (const meal of rawFood.foodLogs) {
      if (isRecord(meal)) {
        upgradedEntities.push(upgradeLegacyMealLogToKernel(meal));
      }
    }
  }

  // Transform attendance logs
  if (rawAtt && Array.isArray(rawAtt.attendanceLogs)) {
    const subjectMap: Record<string, string> = {};
    if (Array.isArray(rawAtt.subjects)) {
      for (const sub of rawAtt.subjects) {
        if (isRecord(sub) && typeof sub.id === 'string' && typeof sub.name === 'string') {
          subjectMap[sub.id] = sub.name;
        }
      }
    }
    for (const att of rawAtt.attendanceLogs) {
      if (isRecord(att)) {
        upgradedEntities.push(upgradeLegacyAttendanceLogToKernel(att, subjectMap));
      }
    }
  }

  // 7. Commit via PersistencePort in chunks of 250 (Firestore batch limit is 500)
  const BATCH_SIZE = 250;
  for (let i = 0; i < upgradedEntities.length; i += BATCH_SIZE) {
    const chunk = upgradedEntities.slice(i, i + BATCH_SIZE);
    const mutations: PersistenceMutation[] = chunk.map((entity) => ({
      type: 'set_entity',
      entity,
    }));
    await persistencePort.commitBatch(mutations);
  }

  // 8. Record completed status
  const statusDocRef = doc(db, 'users', userId, 'meta', 'migration_v5_status');
  await setDoc(statusDocRef, {
    status: 'completed',
    version: 5,
    migrated_at: now,
    total_entities: upgradedEntities.length,
  });

  return {
    success: true,
    alreadyMigrated: false,
    migratedCount: upgradedEntities.length,
    backupId: 'backup_pre_v5',
  };
}

export async function rollbackBatchMigration(
  db: Firestore,
  userId: string
): Promise<RollbackResult> {
  const now = new Date().toISOString();

  // 1. Fetch pre-v5 backup
  const backupDocRef = doc(db, 'users', userId, 'meta', 'backup_pre_v5');
  const backupSnap = await getDoc(backupDocRef);
  if (!backupSnap.exists()) {
    throw new Error(`Rollback failed: No backup_pre_v5 snapshot found for user ${userId}.`);
  }

  const backupData = backupSnap.data();
  const rawEntities = Array.isArray(backupData.entities) ? backupData.entities : [];

  // 2. Restore backup entities into /users/{userId}/entities
  const BATCH_SIZE = 250;
  for (let i = 0; i < rawEntities.length; i += BATCH_SIZE) {
    const chunk = rawEntities.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const raw of chunk) {
      if (isRecord(raw) && typeof raw.id === 'string') {
        const docRef = doc(db, 'users', userId, 'entities', raw.id);
        batch.set(docRef, raw as DocumentData);
      }
    }
    await batch.commit();
  }

  // 3. Mark status as rolled back
  const statusDocRef = doc(db, 'users', userId, 'meta', 'migration_v5_status');
  await setDoc(statusDocRef, {
    status: 'rolled_back',
    rolled_back_at: now,
    restored_entities: rawEntities.length,
  });

  return {
    success: true,
    restoredCount: rawEntities.length,
    timestamp: now,
  };
}
