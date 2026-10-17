import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, Timestamp, type Firestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { RequestFailure, MAX_CALLS_PER_TURN, MONTHLY_GENERATION_LIMIT, RATE_LIMIT_PER_MINUTE, TURN_RESERVATION_TTL_MS, monthKey } from './policy.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface TurnLedgerRefs {
  uid: string;
  email?: string;
  allowance: 'guest' | 'account';
  turnLimit: number;
  user: DocumentReference;
  privilegedUser: DocumentReference;
  allowlist: DocumentReference;
  emailIndex: DocumentReference;
  pendingInvitation: DocumentReference;
  turn: DocumentReference;
  call: DocumentReference;
  control: DocumentReference;
  month: DocumentReference;
  privilegedMonth: DocumentReference;
  privilegedUserMonth: DocumentReference;
  privilegedMonthlyLimit: number;
  isPrivileged: boolean;
}

export function turnLedgerRefs(db: Firestore, uid: string, turnId: string, callId: string, date = new Date(), email?: string, allowance: 'guest' | 'account' = 'account', privilegedMonthlyLimit = 50): TurnLedgerRefs {
  const normalizedEmail = email?.trim().toLowerCase();
  const emailHash = hash(normalizedEmail || `uid:${uid}`);
  const month = monthKey(date);
  return {
    uid,
    email: normalizedEmail,
    allowance,
    turnLimit: allowance === 'guest' ? 3 : 10,
    user: db.doc(`${allowance === 'guest' ? 'managedAiGuests' : 'managedAiUsers'}/${uid}`),
    privilegedUser: db.doc(`managedAiPrivilegedUsers/${uid}`),
    allowlist: db.doc(`managedAiAllowlist/${uid}`),
    emailIndex: db.doc(`managedAiAllowlistEmails/${emailHash}`),
    pendingInvitation: db.doc(`managedAiPendingInvitations/${emailHash}`),
    turn: db.doc(`managedAiTurns/${hash(`${uid}:${turnId}`)}`),
    call: db.doc(`managedAiCalls/${hash(`${uid}:${turnId}:${callId}`)}`),
    control: db.doc('system/managedAi'),
    month: db.doc(`managedAiMonthly/${month}`),
    privilegedMonth: db.doc(`managedAiPrivilegedMonthly/${month}`),
    privilegedUserMonth: db.doc(`managedAiPrivilegedUserMonthly/${month}_${hash(uid)}`),
    privilegedMonthlyLimit,
    isPrivileged: false,
  };
}

function isManagedAiEnabledForIdentity(control: DocumentData | undefined, uid: string, privileged: boolean): boolean {
  if (control?.enabled !== true) return false;
  if (control.mode === 'general') return true;
  return control.mode === 'test'
    && (privileged || (Array.isArray(control.allowedTestUids) && control.allowedTestUids.includes(uid)));
}

export async function reserveTurn(db: Firestore, refs: TurnLedgerRefs, now = Date.now()): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, user, privilegedUser, turn, call, allowlist, pendingInvitation, emailIndex] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.user), transaction.get(refs.privilegedUser),
      transaction.get(refs.turn), transaction.get(refs.call), transaction.get(refs.allowlist),
      transaction.get(refs.pendingInvitation), transaction.get(refs.emailIndex),
    ]);
    const allowlistData = allowlist.data() || {};
    let privileged = refs.allowance === 'account' && Boolean(refs.email)
      && allowlistData.status === 'active'
      && allowlistData.uid === refs.uid
      && allowlistData.emailLower === refs.email;
    const pendingData = pendingInvitation.data() || {};
    const emailIndexData = emailIndex.data() || {};
    if (!privileged && refs.allowance === 'account' && refs.email
      && pendingData.status === 'pending' && pendingData.emailLower === refs.email
      && (!emailIndexData.uid || emailIndexData.uid === refs.uid)) {
      privileged = true;
      const activationAudit = db.collection('managedAiAdminAudit').doc(randomUUID());
      transaction.set(refs.allowlist, {
        uid: refs.uid, emailLower: refs.email, status: 'active', activatedAt: Timestamp.now(),
      }, { merge: true });
      transaction.set(refs.emailIndex, {
        uid: refs.uid, emailLower: refs.email, status: 'active', updatedAt: Timestamp.now(),
      }, { merge: true });
      transaction.set(refs.pendingInvitation, { status: 'activated', uid: refs.uid, updatedAt: Timestamp.now() }, { merge: true });
      transaction.create(activationAudit, {
        actorUid: pendingData.createdBy || 'system', action: 'allowlist_invitation_activated',
        targetUid: refs.uid, emailLower: refs.email, createdAt: Timestamp.now(),
      });
    }
    if (!isManagedAiEnabledForIdentity(control.data(), refs.uid, privileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    const userRef = privileged ? refs.privilegedUser : refs.user;
    const userData = (privileged ? privilegedUser.data() : user.data()) || {};
    const turnData = turn.data() || {};
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    if (rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);

    const turnExpired = turn.exists && turnData.status === 'pending' && Number(turnData.expiresAtMs || 0) <= now;
    const isNewTurn = !turn.exists || turnData.status === 'failed' || turnData.status === 'expired' || turnExpired;
    const reservationsExpired = Number(userData.reservationsExpireAtMs || 0) <= now;
    let reservedTurns = reservationsExpired ? 0 : Number(userData.reservedTurns || 0);
    if (turnExpired && !reservationsExpired) reservedTurns = Math.max(0, reservedTurns - 1);
    if (!privileged && isNewTurn && Number(userData.successfulTurns || 0) + reservedTurns >= refs.turnLimit) {
      throw new RequestFailure(refs.allowance === 'guest' ? 'GUEST_TURN_ALLOWANCE_EXHAUSTED' : 'TURN_ALLOWANCE_EXHAUSTED', 402);
    }
    if (turn.exists && turnData.status === 'complete') throw new RequestFailure('TURN_ALREADY_COMPLETE', 409);
    if (turn.exists && turnData.status === 'pending' && !turnExpired && Number(turnData.callsReserved || 0) >= MAX_CALLS_PER_TURN) {
      throw new RequestFailure('TURN_CALL_LIMIT', 429);
    }
    if (Number(userData.activeCallUntilMs || 0) > now) throw new RequestFailure('USER_CALL_IN_PROGRESS', 429);

    transaction.set(userRef, {
      rateWindowStartMs: windowStart > now - 60_000 ? windowStart : now,
      rateWindowCount: rateCount + 1,
      reservedTurns: isNewTurn ? reservedTurns + 1 : reservedTurns,
      reservationsExpireAtMs: now + TURN_RESERVATION_TTL_MS,
      activeCallUntilMs: now + 65_000,
    }, { merge: true });
    transaction.set(refs.turn, {
      status: 'pending', callsReserved: isNewTurn ? 1 : Number(turnData.callsReserved || 0) + 1,
      expiresAtMs: now + TURN_RESERVATION_TTL_MS, updatedAt: Timestamp.now(),
    }, { merge: true });
    refs.isPrivileged = privileged;
  });
}

export async function reserveGenerationCall(db: Firestore, refs: TurnLedgerRefs): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, monthly, privilegedMonthly, privilegedUserMonthly, call, allowlist] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.month), transaction.get(refs.privilegedMonth),
      transaction.get(refs.privilegedUserMonth), transaction.get(refs.call), transaction.get(refs.allowlist),
    ]);
    const access = allowlist.data() || {};
    if (refs.isPrivileged && (access.status !== 'active' || access.uid !== refs.uid || access.emailLower !== refs.email)) {
      throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    }
    if (!isManagedAiEnabledForIdentity(control.data(), refs.uid, refs.isPrivileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    if (refs.isPrivileged) {
      const privilegedCalls = Number(privilegedMonthly.get('callsReserved') || 0);
      if (refs.privilegedMonthlyLimit <= 0 || privilegedCalls >= refs.privilegedMonthlyLimit) throw new RequestFailure('GLOBAL_LIMIT_REACHED', 429);
      transaction.set(refs.privilegedMonth, { callsReserved: privilegedCalls + 1, updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.privilegedUserMonth, {
        uid: refs.uid, callsReserved: Number(privilegedUserMonthly.get('callsReserved') || 0) + 1,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    } else {
      const callsReserved = Number(monthly.get('callsReserved') || 0);
      if (callsReserved >= MONTHLY_GENERATION_LIMIT) throw new RequestFailure('GLOBAL_LIMIT_REACHED', 429);
      transaction.set(refs.month, { callsReserved: callsReserved + 1, updatedAt: Timestamp.now() }, { merge: true });
    }
    transaction.create(refs.call, { status: 'reserved', reservedAt: Timestamp.now() });
  });
}

export async function finishTurn(db: Firestore, refs: TurnLedgerRefs, complete: boolean): Promise<void> {
  await db.runTransaction(async transaction => {
    const userRef = refs.isPrivileged ? refs.privilegedUser : refs.user;
    const [user, turn] = await Promise.all([transaction.get(userRef), transaction.get(refs.turn)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const remaining = complete ? Math.max(0, Number(userData.reservedTurns || 0) - 1) : Number(userData.reservedTurns || 0);
    transaction.set(userRef, {
      activeCallUntilMs: 0,
      reservedTurns: remaining,
      reservationsExpireAtMs: remaining === 0 ? 0 : Number(userData.reservationsExpireAtMs || 0),
      ...(complete ? { successfulTurns: Number(userData.successfulTurns || 0) + 1 } : {}),
    }, { merge: true });
    transaction.set(refs.turn, {
      status: complete ? 'complete' : 'pending',
      callsReserved: Number(turnData.callsReserved || 0),
      expiresAtMs: complete ? 0 : Date.now() + TURN_RESERVATION_TTL_MS,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(refs.call, { status: 'complete', completedAt: Timestamp.now() }, { merge: true });
  });
}

export async function failTurn(db: Firestore, refs: TurnLedgerRefs, callReserved: boolean): Promise<void> {
  await db.runTransaction(async transaction => {
    const userRef = refs.isPrivileged ? refs.privilegedUser : refs.user;
    const [user, turn] = await Promise.all([transaction.get(userRef), transaction.get(refs.turn)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const remaining = Math.max(0, Number(userData.reservedTurns || 0) - (turnData.status === 'pending' ? 1 : 0));
    transaction.set(userRef, {
      reservedTurns: remaining,
      reservationsExpireAtMs: remaining === 0 ? 0 : Number(userData.reservationsExpireAtMs || 0),
      activeCallUntilMs: 0,
    }, { merge: true });
    transaction.set(refs.turn, { status: 'failed', failedAt: Timestamp.now() }, { merge: true });
    if (callReserved) transaction.set(refs.call, { status: 'failed', failedAt: Timestamp.now() }, { merge: true });
  });
}
