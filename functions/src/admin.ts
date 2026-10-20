import { createHash, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { monthKey } from './policy.js';
import { assertLiveSessionEnvelopeIsSafe, LIVE_SESSION_RESERVATION_MICRO_USD } from './liveCost.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizedEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && emailPattern.test(email) ? email : null;
};

export interface AdminIdentity {
  uid: string;
  email?: string;
  emailVerified: boolean;
  anonymous: boolean;
}

function fail(res: Response, status: number, code: string) {
  res.status(status).json({ error: { code } });
}

async function requireAdmin(db: Firestore, identity: AdminIdentity): Promise<boolean> {
  if (identity.anonymous || !identity.emailVerified || !identity.email) return false;
  const control = await db.doc('system/managedAi').get();
  const adminUids = control.get('adminUids');
  return Array.isArray(adminUids) && adminUids.includes(identity.uid);
}

async function readAccessOverview(db: Firestore) {
  const month = monthKey(new Date());
  const [allowlist, pending, ordinaryUsage, control, liveControl, budgetPolicy, budgetUsage] = await Promise.all([
    db.collection('managedAiAllowlist').where('status', '==', 'active').get(),
    db.collection('managedAiPendingInvitations').where('status', '==', 'pending').get(),
    db.doc(`managedAiMonthly/${month}`).get(),
    db.doc('system/managedAi').get(),
    db.doc('system/managedLive').get(),
    db.doc('system/managedAiBudgetPolicy').get(),
    db.doc(`managedAiCostProjectMonthly/${month}`).get(),
  ]);
  const activeEntries = await Promise.all(allowlist.docs.map(async entry => {
    const uid = String(entry.get('uid') || entry.id);
    const usage = await db.doc(`managedAiPrivilegedUsers/${uid}`).get();
    return {
      uid,
      email: entry.get('emailLower') || '',
      status: 'active',
      successfulTurns: Number(usage.get('successfulTurns') || 0),
      lastUsedAt: usage.get('lastUsedAt')?.toDate?.()?.toISOString?.() || null,
    };
  }));
  return {
    enabled: control.get('enabled') === true,
    liveEnabled: liveControl.get('enabled') === true,
    month,
    ordinary: { modelCalls: Number(ordinaryUsage.get('callsReserved') || 0), applicationLimit: null, usageIsTelemetryOnly: true },
    budget: {
      enabled: budgetPolicy.get('enabled') === true,
      currency: 'USD',
      projectMonthlyLimitMicroUsd: Number(budgetPolicy.get('projectMonthlyLimitMicroUsd') || 0),
      userMonthlyLimitMicroUsd: Number(budgetPolicy.get('userMonthlyLimitMicroUsd') || 0),
      maxTurnExposureMicroUsd: Number(budgetPolicy.get('maxTurnExposureMicroUsd') || 0),
      emergencyStop: budgetPolicy.get('emergencyStop') === true,
      month,
      projectReservedMicroUsd: Number(budgetUsage.get('reservedMicroUsd') || 0),
      projectSettledMicroUsd: Number(budgetUsage.get('settledMicroUsd') || 0),
    },
    privileged: { accounts: activeEntries.length, noApplicationUsageCeiling: true },
    allowlist: activeEntries,
    pendingInvitations: pending.docs.map(entry => ({ email: entry.get('emailLower') || '', status: 'pending' })),
  };
}

async function listUncertainCostReservations(db: Firestore, pageAfter?: string, now = Date.now()) {
  // Keep this query on Firestore's automatically maintained single-field
  // index; owner-only operational inspection must not require a new index.
  if (pageAfter !== undefined && !/^[a-f0-9]{64}$/.test(pageAfter)) throw new Error('INVALID_COST_RECONCILIATION');
  let query = db.collection('managedAiCalls').where('costStatus', '==', 'uncertain').orderBy(FieldPath.documentId()).limit(501);
  if (pageAfter) query = query.startAfter(pageAfter);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, 500);
  const cutoff = now - 15 * 60_000;
  const stale = page
    .filter(document => Number(document.get('costUncertainAt')?.toMillis?.() || 0) <= cutoff)
    .sort((a, b) => Number(a.get('costUncertainAt')?.toMillis?.() || 0) - Number(b.get('costUncertainAt')?.toMillis?.() || 0));
  const documents = stale;
  return {
    minimumAgeMinutes: 15,
    hasMore: snapshot.docs.length > 500,
    nextCursor: snapshot.docs.length > 500 ? page.at(-1)?.id || null : null,
    reservations: documents.map(document => {
      const data = document.data();
      const userBudgetPath = String(data.costUserBudgetPath || '');
      const turnPath = String(data.costTurnPath || '');
      return {
        callId: document.id,
        purpose: data.purpose === 'briefing' ? 'briefing' : 'chat',
        model: typeof data.model === 'string' ? data.model : null,
        month: typeof data.costMonth === 'string' ? data.costMonth : null,
        reservedMicroUsd: Number.isSafeInteger(data.costReservedMicroUsd) ? data.costReservedMicroUsd : null,
        inputTokens: Number.isSafeInteger(data.costInputTokens) ? data.costInputTokens : null,
        maximumOutputTokens: Number.isSafeInteger(data.costMaximumOutputTokens) ? data.costMaximumOutputTokens : null,
        uncertainSince: data.costUncertainAt?.toDate?.()?.toISOString?.() || null,
        reconciliationReady: /^managedAiCostUserMonthly\/\d{4}-\d{2}_[a-f0-9]{64}$/.test(userBudgetPath)
          && (!turnPath || /^managedAiTurns\/[a-f0-9]{64}$/.test(turnPath)),
      };
    }),
  };
}

async function reconcileCostReservation(
  db: Firestore,
  identity: AdminIdentity,
  callId: string,
  decision: 'settle' | 'confirmed_not_billed',
  evidenceRef: string,
  actualMicroUsd?: number,
  pricingVersion?: string,
) {
  if (!/^[a-f0-9]{64}$/.test(callId) || evidenceRef.trim().length < 8 || evidenceRef.length > 500) {
    throw new Error('INVALID_COST_RECONCILIATION');
  }
  if (decision === 'settle' && (!Number.isSafeInteger(actualMicroUsd) || Number(actualMicroUsd) < 0
      || typeof pricingVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(pricingVersion))) {
    throw new Error('INVALID_COST_RECONCILIATION');
  }
  const callRef = db.doc(`managedAiCalls/${callId}`);
  const auditRef = db.collection('managedAiAdminAudit').doc(randomUUID());
  return db.runTransaction(async transaction => {
    const call = await transaction.get(callRef);
    if (!call.exists || call.get('costStatus') !== 'uncertain') throw new Error('COST_RESERVATION_NOT_RECONCILABLE');
    const month = String(call.get('costMonth') || '');
    const userBudgetPath = String(call.get('costUserBudgetPath') || '');
    const turnPath = String(call.get('costTurnPath') || '');
    if (!/^\d{4}-\d{2}$/.test(month)
      || !new RegExp(`^managedAiCostUserMonthly/${month}_[a-f0-9]{64}$`).test(userBudgetPath)
      || (turnPath && !/^managedAiTurns\/[a-f0-9]{64}$/.test(turnPath))) {
      throw new Error('COST_RESERVATION_NOT_RECONCILABLE');
    }
    const reserved = call.get('costReservedMicroUsd');
    if (!Number.isSafeInteger(reserved) || reserved < 1) throw new Error('COST_RESERVATION_NOT_RECONCILABLE');
    const projectRef = db.doc(`managedAiCostProjectMonthly/${month}`);
    const userRef = db.doc(userBudgetPath);
    const turnRef = turnPath ? db.doc(turnPath) : null;
    const [project, user, turn] = await Promise.all([
      transaction.get(projectRef), transaction.get(userRef), turnRef ? transaction.get(turnRef) : Promise.resolve(null),
    ]);
    const projectReserved = project.get('reservedMicroUsd');
    const userReserved = user.get('reservedMicroUsd');
    const projectSettled = project.get('settledMicroUsd') ?? 0;
    const userSettled = user.get('settledMicroUsd') ?? 0;
    if (!Number.isSafeInteger(projectReserved) || !Number.isSafeInteger(userReserved)
      || !Number.isSafeInteger(projectSettled) || !Number.isSafeInteger(userSettled)
      || projectReserved < reserved || userReserved < reserved
      || projectSettled < 0 || userSettled < 0
      || (decision === 'settle' && (!Number.isSafeInteger(projectSettled + Number(actualMicroUsd))
        || !Number.isSafeInteger(userSettled + Number(actualMicroUsd))))) throw new Error('COST_LEDGER_COUNTER_INVALID');
    const timestamp = Timestamp.now();
    const actual = decision === 'settle' ? Number(actualMicroUsd) : 0;
    const patch = {
      reservedMicroUsd: projectReserved - reserved,
      ...(decision === 'settle' ? { settledMicroUsd: projectSettled + actual } : {}),
      updatedAt: timestamp,
    };
    const userPatch = {
      reservedMicroUsd: userReserved - reserved,
      ...(decision === 'settle' ? { settledMicroUsd: userSettled + actual } : {}),
      updatedAt: timestamp,
    };
    if (turnRef && turn) {
      const turnReserved = turn.get('costReservedMicroUsd');
      const turnSettled = turn.get('costSettledMicroUsd') ?? 0;
      if (!Number.isSafeInteger(turnReserved) || turnReserved < reserved
        || !Number.isSafeInteger(turnSettled) || turnSettled < 0
        || (decision === 'settle' && !Number.isSafeInteger(turnSettled + actual))) throw new Error('COST_LEDGER_COUNTER_INVALID');
      transaction.set(turnRef, {
        costReservedMicroUsd: turnReserved - reserved,
        ...(decision === 'settle' ? { costSettledMicroUsd: turnSettled + actual } : {}),
        updatedAt: timestamp,
      }, { merge: true });
    }
    transaction.set(projectRef, patch, { merge: true });
    transaction.set(userRef, userPatch, { merge: true });
    transaction.set(callRef, {
      costStatus: decision === 'settle' ? 'settled' : 'released_confirmed_not_billed',
      costReconciledAt: timestamp,
      costReconciledBy: identity.uid,
      costReconciliationEvidenceRef: evidenceRef.trim(),
      ...(decision === 'settle' ? { costSettledMicroUsd: actual, costSettledPricingVersion: pricingVersion, costSettledAt: timestamp } : {}),
    }, { merge: true });
    if (decision === 'settle' && actual > reserved) {
      transaction.set(db.doc('system/managedAiBudgetPolicy'), {
        emergencyStop: true,
        emergencyStopReason: 'provider_usage_exceeded_reservation',
        updatedAt: timestamp,
      }, { merge: true });
    }
    transaction.create(auditRef, {
      actorUid: identity.uid,
      action: 'managed_ai_cost_reservation_reconciled',
      callId,
      month,
      decision,
      reservedMicroUsd: reserved,
      ...(decision === 'settle' ? { actualMicroUsd: actual, pricingVersion } : {}),
      evidenceRef: evidenceRef.trim(),
      createdAt: timestamp,
    });
    return { reconciled: true, decision };
  });
}

function budgetCents(value: unknown): number | null {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100_000_000) return null;
  return Number(value);
}

async function addAllowlistEntry(db: Firestore, identity: AdminIdentity, email: string) {
  let targetUid: string | null = null;
  let verified = false;
  try {
    const user = await getAuth().getUserByEmail(email);
    if ((user.email || '').trim().toLowerCase() === email) {
      targetUid = user.uid;
      verified = user.emailVerified;
    }
  } catch (error) {
    if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
  }

  const emailHash = digest(email);
  const emailIndex = db.doc(`managedAiAllowlistEmails/${emailHash}`);
  const pending = db.doc(`managedAiPendingInvitations/${emailHash}`);
  const target = targetUid ? db.doc(`managedAiAllowlist/${targetUid}`) : null;
  const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
  await db.runTransaction(async transaction => {
    const currentIndex = await transaction.get(emailIndex);
    const existingUid = currentIndex.get('uid');
    if (verified && targetUid && typeof existingUid === 'string' && existingUid !== targetUid && currentIndex.get('status') === 'active') {
      throw new Error('ALLOWLIST_EMAIL_BOUND_TO_DIFFERENT_UID');
    }
    const timestamp = Timestamp.now();
    if (verified && targetUid && target) {
      transaction.set(target, {
        uid: targetUid,
        emailLower: email,
        status: 'active',
        createdAt: targetUid === existingUid ? currentIndex.get('createdAt') || timestamp : timestamp,
        grantedBy: identity.uid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(emailIndex, { uid: targetUid, emailLower: email, status: 'active', updatedAt: timestamp }, { merge: true });
      transaction.delete(pending);
    } else {
      transaction.set(pending, { emailLower: email, status: 'pending', createdBy: identity.uid, updatedAt: timestamp }, { merge: true });
      transaction.set(emailIndex, { emailLower: email, status: 'pending', updatedAt: timestamp }, { merge: true });
    }
    transaction.create(audit, {
      actorUid: identity.uid,
      action: verified && targetUid ? 'allowlist_grant' : 'allowlist_invitation',
      targetUid,
      emailLower: email,
      createdAt: timestamp,
    });
  });
  return { status: verified && targetUid ? 'active' : 'pending', uid: targetUid };
}

async function revokeAllowlistEntry(db: Firestore, identity: AdminIdentity, target: unknown) {
  const uid = typeof target === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(target) ? target : null;
  const email = normalizedEmail(target);
  if (!uid && !email) throw new Error('INVALID_ALLOWLIST_TARGET');
  const emailIndexRef = email ? db.doc(`managedAiAllowlistEmails/${digest(email)}`) : null;
  const pendingRef = email ? db.doc(`managedAiPendingInvitations/${digest(email)}`) : null;
  const requestedTarget = uid ? db.doc(`managedAiAllowlist/${uid}`) : null;
  const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
  let revokedUid: string | null = uid;
  let revokedEmail = email;
  await db.runTransaction(async transaction => {
    const [byEmail, pending, byUid] = await Promise.all([
      emailIndexRef ? transaction.get(emailIndexRef) : Promise.resolve(null),
      pendingRef ? transaction.get(pendingRef) : Promise.resolve(null),
      requestedTarget ? transaction.get(requestedTarget) : Promise.resolve(null),
    ]);
    if (email && byEmail?.exists) {
      revokedUid = typeof byEmail.get('uid') === 'string' ? byEmail.get('uid') : null;
      revokedEmail = byEmail.get('emailLower') || email;
    }
    const targetRef = revokedUid ? db.doc(`managedAiAllowlist/${revokedUid}`) : null;
    const targetSnapshot = targetRef && targetRef.path === requestedTarget?.path ? byUid :
      (targetRef ? await transaction.get(targetRef) : null);
    const timestamp = Timestamp.now();
    if (targetRef && targetSnapshot?.exists) {
      revokedEmail = targetSnapshot.get('emailLower') || revokedEmail;
      transaction.set(targetRef, { status: 'revoked', revokedAt: timestamp, revokedBy: identity.uid, updatedAt: timestamp }, { merge: true });
    }
    if (emailIndexRef && byEmail?.exists) transaction.set(emailIndexRef, { status: 'revoked', updatedAt: timestamp }, { merge: true });
    if (pendingRef && pending?.exists) transaction.set(pendingRef, { status: 'revoked', revokedAt: timestamp, revokedBy: identity.uid, updatedAt: timestamp }, { merge: true });
    if ((!targetSnapshot?.exists) && (!pending?.exists)) throw new Error('ALLOWLIST_ENTRY_NOT_FOUND');
    transaction.create(audit, { actorUid: identity.uid, action: 'allowlist_revoke', targetUid: revokedUid, emailLower: revokedEmail, createdAt: timestamp });
  });
  return { status: 'revoked', uid: revokedUid };
}

export async function handleManagedAiAdmin(
  db: Firestore,
  req: Request,
  res: Response,
  identity: AdminIdentity,
): Promise<boolean> {
  if (req.path !== '/admin/access') return false;
  if (req.method !== 'GET' && req.method !== 'POST') { fail(res, 405, 'METHOD_NOT_ALLOWED'); return true; }
  let admin: boolean;
  try { admin = await requireAdmin(db, identity); }
  catch { fail(res, 503, 'ADMIN_STATUS_UNAVAILABLE'); return true; }
  if (!admin) { fail(res, 403, 'ADMIN_REQUIRED'); return true; }

  try {
    if (req.method === 'GET') {
      res.status(200).json(await readAccessOverview(db));
      return true;
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') {
      fail(res, 400, 'INVALID_ADMIN_REQUEST'); return true;
    }
    if (body.action === 'add' && Object.keys(body).every(key => ['action', 'email'].includes(key))) {
      const email = normalizedEmail(body.email);
      if (!email) { fail(res, 400, 'INVALID_EMAIL'); return true; }
      const result = await addAllowlistEntry(db, identity, email);
      res.status(200).json(result);
      return true;
    }
    if (body.action === 'revoke' && Object.keys(body).every(key => ['action', 'target'].includes(key))) {
      const result = await revokeAllowlistEntry(db, identity, body.target);
      res.status(200).json(result);
      return true;
    }
    if (body.action === 'setEnabled' && Object.keys(body).every(key => ['action', 'enabled'].includes(key)) && typeof body.enabled === 'boolean') {
      if (body.enabled) {
        const budget = await db.doc('system/managedAiBudgetPolicy').get();
        if (budget.get('enabled') !== true || budget.get('emergencyStop') === true ||
          !Number.isSafeInteger(budget.get('projectMonthlyLimitMicroUsd')) || Number(budget.get('projectMonthlyLimitMicroUsd')) <= 0 ||
          !Number.isSafeInteger(budget.get('userMonthlyLimitMicroUsd')) || Number(budget.get('userMonthlyLimitMicroUsd')) <= 0 ||
          !Number.isSafeInteger(budget.get('maxTurnExposureMicroUsd')) || Number(budget.get('maxTurnExposureMicroUsd')) <= 0 ||
          Number(budget.get('userMonthlyLimitMicroUsd')) > Number(budget.get('projectMonthlyLimitMicroUsd')) ||
          Number(budget.get('maxTurnExposureMicroUsd')) > Number(budget.get('userMonthlyLimitMicroUsd'))) {
          fail(res, 409, 'MANAGED_AI_BUDGET_UNAVAILABLE'); return true;
        }
      }
      const controlRef = db.doc('system/managedAi');
      const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
      await db.runTransaction(async transaction => {
        const timestamp = Timestamp.now();
        transaction.set(controlRef, {
          enabled: body.enabled,
          ...(body.enabled ? { mode: 'general' } : {}),
          updatedAt: timestamp,
          updatedBy: identity.uid,
        }, { merge: true });
        transaction.create(audit, {
          actorUid: identity.uid,
          action: body.enabled ? 'managed_ai_enable' : 'managed_ai_disable',
          createdAt: timestamp,
        });
      });
      res.status(200).json({ enabled: body.enabled });
      return true;
    }
    if (body.action === 'setLiveEnabled' && Object.keys(body).every(key => ['action', 'enabled'].includes(key)) && typeof body.enabled === 'boolean') {
      if (body.enabled) {
        const budget = await db.doc('system/managedAiBudgetPolicy').get();
        const projectLimit = Number(budget.get('projectMonthlyLimitMicroUsd'));
        const userLimit = Number(budget.get('userMonthlyLimitMicroUsd'));
        const perOperationLimit = Number(budget.get('maxTurnExposureMicroUsd'));
        let safeEnvelope = false;
        try { assertLiveSessionEnvelopeIsSafe(); safeEnvelope = true; } catch { /* fail closed below */ }
        if (budget.get('enabled') !== true || budget.get('currency') !== 'USD'
          || budget.get('emergencyStop') === true
          || !Number.isSafeInteger(projectLimit) || projectLimit < LIVE_SESSION_RESERVATION_MICRO_USD
          || !Number.isSafeInteger(userLimit) || userLimit < LIVE_SESSION_RESERVATION_MICRO_USD
          || !Number.isSafeInteger(perOperationLimit) || perOperationLimit < LIVE_SESSION_RESERVATION_MICRO_USD
          || !safeEnvelope) {
          fail(res, 409, 'MANAGED_LIVE_BUDGET_POLICY_REQUIRED'); return true;
        }
      }
      const controlRef = db.doc('system/managedLive');
      const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
      await db.runTransaction(async transaction => {
        const timestamp = Timestamp.now();
        transaction.set(controlRef, { enabled: body.enabled, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
        transaction.create(audit, { actorUid: identity.uid, action: body.enabled ? 'managed_live_enable' : 'managed_live_disable', createdAt: timestamp });
      });
      res.status(200).json({ enabled: body.enabled });
      return true;
    }
    if (body.action === 'setBudgetPolicy' && Object.keys(body).every(key => ['action', 'projectMonthlyLimitCents', 'userMonthlyLimitCents', 'maxTurnExposureCents'].includes(key))) {
      const projectCents = budgetCents(body.projectMonthlyLimitCents);
      const userCents = budgetCents(body.userMonthlyLimitCents);
      const turnCents = budgetCents(body.maxTurnExposureCents);
      if (!projectCents || !userCents || !turnCents || turnCents > userCents || userCents > projectCents) {
        fail(res, 400, 'INVALID_BUDGET_POLICY'); return true;
      }
      const policyRef = db.doc('system/managedAiBudgetPolicy');
      const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
      await db.runTransaction(async transaction => {
        const existingPolicy = await transaction.get(policyRef);
        const timestamp = Timestamp.now();
        transaction.set(policyRef, {
          enabled: true,
          currency: 'USD',
          projectMonthlyLimitMicroUsd: projectCents * 10_000,
          userMonthlyLimitMicroUsd: userCents * 10_000,
          maxTurnExposureMicroUsd: turnCents * 10_000,
          // Editing ceilings must never silently clear a provider-cost emergency stop.
          emergencyStop: existingPolicy.get('emergencyStop') === true,
          policyVersion: 'managed-cost-v1',
          updatedAt: timestamp,
          updatedBy: identity.uid,
        }, { merge: true });
        transaction.create(audit, {
          actorUid: identity.uid,
          action: 'managed_ai_budget_policy_set',
          projectMonthlyLimitCents: projectCents,
          userMonthlyLimitCents: userCents,
          maxTurnExposureCents: turnCents,
          createdAt: timestamp,
        });
      });
      res.status(200).json({ enabled: true, currency: 'USD' });
      return true;
    }
    if (body.action === 'listUncertainCostReservations'
      && Object.keys(body).every(key => ['action', 'pageAfter'].includes(key))
      && (body.pageAfter === undefined || typeof body.pageAfter === 'string')) {
      res.status(200).json(await listUncertainCostReservations(db, body.pageAfter as string | undefined));
      return true;
    }
    if (body.action === 'reconcileCostReservation'
      && Object.keys(body).every(key => ['action', 'callId', 'decision', 'evidenceRef', 'actualMicroUsd', 'pricingVersion'].includes(key))
      && typeof body.callId === 'string'
      && (body.decision === 'settle' || body.decision === 'confirmed_not_billed')
      && typeof body.evidenceRef === 'string') {
      const result = await reconcileCostReservation(
        db, identity, body.callId, body.decision, body.evidenceRef,
        typeof body.actualMicroUsd === 'number' ? body.actualMicroUsd : undefined,
        typeof body.pricingVersion === 'string' ? body.pricingVersion : undefined,
      );
      res.status(200).json(result);
      return true;
    }
    if (body.action === 'clearEmergencyStop' && Object.keys(body).every(key => key === 'action')) {
      const policyRef = db.doc('system/managedAiBudgetPolicy');
      const audit = db.collection('managedAiAdminAudit').doc(randomUUID());
      const cleared = await db.runTransaction(async transaction => {
        const policy = await transaction.get(policyRef);
        if (policy.get('enabled') !== true || policy.get('currency') !== 'USD' ||
          !Number.isSafeInteger(policy.get('projectMonthlyLimitMicroUsd')) || Number(policy.get('projectMonthlyLimitMicroUsd')) <= 0 ||
          !Number.isSafeInteger(policy.get('userMonthlyLimitMicroUsd')) || Number(policy.get('userMonthlyLimitMicroUsd')) <= 0 ||
          !Number.isSafeInteger(policy.get('maxTurnExposureMicroUsd')) || Number(policy.get('maxTurnExposureMicroUsd')) <= 0 ||
          Number(policy.get('userMonthlyLimitMicroUsd')) > Number(policy.get('projectMonthlyLimitMicroUsd')) ||
          Number(policy.get('maxTurnExposureMicroUsd')) > Number(policy.get('userMonthlyLimitMicroUsd'))) {
          return false;
        }
        const timestamp = Timestamp.now();
        transaction.set(policyRef, { emergencyStop: false, emergencyStopReason: null, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
        transaction.create(audit, { actorUid: identity.uid, action: 'managed_ai_emergency_stop_cleared', createdAt: timestamp });
        return true;
      });
      if (!cleared) { fail(res, 409, 'MANAGED_AI_BUDGET_UNAVAILABLE'); return true; }
      res.status(200).json({ emergencyStop: false });
      return true;
    }
    fail(res, 400, 'INVALID_ADMIN_REQUEST');
    return true;
  } catch (error) {
    const code = (error as { message?: string })?.message;
    if (code === 'ALLOWLIST_EMAIL_BOUND_TO_DIFFERENT_UID') { fail(res, 409, 'EMAIL_BOUND_TO_DIFFERENT_UID'); return true; }
    if (code === 'INVALID_ALLOWLIST_TARGET') { fail(res, 400, 'INVALID_ALLOWLIST_TARGET'); return true; }
    if (code === 'ALLOWLIST_ENTRY_NOT_FOUND') { fail(res, 404, 'ALLOWLIST_ENTRY_NOT_FOUND'); return true; }
    if (code === 'INVALID_COST_RECONCILIATION') { fail(res, 400, 'INVALID_COST_RECONCILIATION'); return true; }
    if (code === 'COST_RESERVATION_NOT_RECONCILABLE') { fail(res, 409, 'COST_RESERVATION_NOT_RECONCILABLE'); return true; }
    if (code === 'COST_LEDGER_COUNTER_INVALID') { fail(res, 503, 'COST_LEDGER_COUNTER_INVALID'); return true; }
    fail(res, 503, 'ADMIN_OPERATION_FAILED');
    return true;
  }
}
