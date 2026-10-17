import { createHash, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { MONTHLY_GENERATION_LIMIT, monthKey } from './policy.js';

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

async function readAccessOverview(db: Firestore, privilegedMonthlyLimit: number) {
  const month = monthKey(new Date());
  const [allowlist, pending, ordinaryUsage, privilegedUsage, control] = await Promise.all([
    db.collection('managedAiAllowlist').where('status', '==', 'active').get(),
    db.collection('managedAiPendingInvitations').where('status', '==', 'pending').get(),
    db.doc(`managedAiMonthly/${month}`).get(),
    db.doc(`managedAiPrivilegedMonthly/${month}`).get(),
    db.doc('system/managedAi').get(),
  ]);
  const activeEntries = await Promise.all(allowlist.docs.map(async entry => {
    const uid = String(entry.get('uid') || entry.id);
    const usage = await db.doc(`managedAiPrivilegedUsers/${uid}`).get();
    const accountMonth = await db.doc(`managedAiPrivilegedUserMonthly/${month}_${digest(uid)}`).get();
    return {
      uid,
      email: entry.get('emailLower') || '',
      status: 'active',
      successfulTurns: Number(usage.get('successfulTurns') || 0),
      modelCallsThisMonth: Number(accountMonth.get('callsReserved') || 0),
      lastUsedAt: usage.get('lastUsedAt')?.toDate?.()?.toISOString?.() || null,
    };
  }));
  return {
    enabled: control.get('enabled') === true,
    month,
    ordinary: { modelCalls: Number(ordinaryUsage.get('callsReserved') || 0), monthlyLimit: MONTHLY_GENERATION_LIMIT },
    privileged: { modelCalls: Number(privilegedUsage.get('callsReserved') || 0), monthlyLimit: privilegedMonthlyLimit },
    allowlist: activeEntries,
    pendingInvitations: pending.docs.map(entry => ({ email: entry.get('emailLower') || '', status: 'pending' })),
  };
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
  privilegedMonthlyLimit: number,
): Promise<boolean> {
  if (req.path !== '/admin/access') return false;
  if (req.method !== 'GET' && req.method !== 'POST') { fail(res, 405, 'METHOD_NOT_ALLOWED'); return true; }
  let admin: boolean;
  try { admin = await requireAdmin(db, identity); }
  catch { fail(res, 503, 'ADMIN_STATUS_UNAVAILABLE'); return true; }
  if (!admin) { fail(res, 403, 'ADMIN_REQUIRED'); return true; }

  try {
    if (req.method === 'GET') {
      res.status(200).json(await readAccessOverview(db, privilegedMonthlyLimit));
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
    fail(res, 400, 'INVALID_ADMIN_REQUEST');
    return true;
  } catch (error) {
    const code = (error as { message?: string })?.message;
    if (code === 'ALLOWLIST_EMAIL_BOUND_TO_DIFFERENT_UID') { fail(res, 409, 'EMAIL_BOUND_TO_DIFFERENT_UID'); return true; }
    if (code === 'INVALID_ALLOWLIST_TARGET') { fail(res, 400, 'INVALID_ALLOWLIST_TARGET'); return true; }
    if (code === 'ALLOWLIST_ENTRY_NOT_FOUND') { fail(res, 404, 'ALLOWLIST_ENTRY_NOT_FOUND'); return true; }
    fail(res, 503, 'ADMIN_OPERATION_FAILED');
    return true;
  }
}
