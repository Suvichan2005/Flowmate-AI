import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, Timestamp, type Firestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { RequestFailure, GUEST_CHAT_TURN_LIMIT, ACCOUNT_CHAT_TURN_LIMIT, GUEST_DAILY_BRIEFING_LIMIT, ACCOUNT_DAILY_BRIEFING_LIMIT, RATE_LIMIT_PER_MINUTE, RESERVATION_TTL_MS, ACTIVE_MODEL_CALL_LEASE_MS, dayKey, monthKey } from './policy.js';

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
  userMonth: DocumentReference;
  privilegedMonth: DocumentReference;
  privilegedUserMonth: DocumentReference;
  isPrivileged: boolean;
}

export interface BriefingLedgerRefs {
  uid: string;
  email?: string;
  allowance: 'guest' | 'account';
  dailyLimit: number;
  user: DocumentReference;
  privilegedUser: DocumentReference;
  allowlist: DocumentReference;
  emailIndex: DocumentReference;
  pendingInvitation: DocumentReference;
  daily: DocumentReference;
  call: DocumentReference;
  control: DocumentReference;
  month: DocumentReference;
  userMonth: DocumentReference;
  privilegedMonth: DocumentReference;
  privilegedUserMonth: DocumentReference;
  isPrivileged: boolean;
}

export function turnLedgerRefs(db: Firestore, uid: string, turnId: string, callId: string, date = new Date(), email?: string, allowance: 'guest' | 'account' = 'account'): TurnLedgerRefs {
  const normalizedEmail = email?.trim().toLowerCase();
  const emailHash = hash(normalizedEmail || `uid:${uid}`);
  const month = monthKey(date);
  return {
    uid,
    email: normalizedEmail,
    allowance,
    turnLimit: allowance === 'guest' ? GUEST_CHAT_TURN_LIMIT : ACCOUNT_CHAT_TURN_LIMIT,
    user: db.doc(`${allowance === 'guest' ? 'managedAiGuests' : 'managedAiUsers'}/${uid}`),
    privilegedUser: db.doc(`managedAiPrivilegedUsers/${uid}`),
    allowlist: db.doc(`managedAiAllowlist/${uid}`),
    emailIndex: db.doc(`managedAiAllowlistEmails/${emailHash}`),
    pendingInvitation: db.doc(`managedAiPendingInvitations/${emailHash}`),
    turn: db.doc(`managedAiTurns/${hash(`${uid}:${turnId}`)}`),
    call: db.doc(`managedAiCalls/${hash(`${uid}:${turnId}:${callId}`)}`),
    control: db.doc('system/managedAi'),
    month: db.doc(`managedAiMonthly/${month}`),
    userMonth: db.doc(`managedAiUserMonthly/${month}_${hash(uid)}`),
    privilegedMonth: db.doc(`managedAiPrivilegedMonthly/${month}`),
    privilegedUserMonth: db.doc(`managedAiPrivilegedUserMonthly/${month}_${hash(uid)}`),
    isPrivileged: false,
  };
}

export function briefingLedgerRefs(db: Firestore, uid: string, callId: string, date = new Date(), email?: string, allowance: 'guest' | 'account' = 'account'): BriefingLedgerRefs {
  const normalizedEmail = email?.trim().toLowerCase();
  const emailHash = hash(normalizedEmail || `uid:${uid}`);
  const month = monthKey(date);
  const day = dayKey(date);
  return {
    uid,
    email: normalizedEmail,
    allowance,
    dailyLimit: allowance === 'guest' ? GUEST_DAILY_BRIEFING_LIMIT : ACCOUNT_DAILY_BRIEFING_LIMIT,
    user: db.doc(`${allowance === 'guest' ? 'managedAiGuests' : 'managedAiUsers'}/${uid}`),
    privilegedUser: db.doc(`managedAiPrivilegedUsers/${uid}`),
    allowlist: db.doc(`managedAiAllowlist/${uid}`),
    emailIndex: db.doc(`managedAiAllowlistEmails/${emailHash}`),
    pendingInvitation: db.doc(`managedAiPendingInvitations/${emailHash}`),
    daily: db.doc(`managedAiBriefings/${day}_${hash(uid)}`),
    call: db.doc(`managedAiCalls/${hash(`${uid}:briefing:${day}:${callId}`)}`),
    control: db.doc('system/managedAi'),
    month: db.doc(`managedAiMonthly/${month}`),
    userMonth: db.doc(`managedAiUserMonthly/${month}_${hash(uid)}`),
    privilegedMonth: db.doc(`managedAiPrivilegedMonthly/${month}`),
    privilegedUserMonth: db.doc(`managedAiPrivilegedUserMonthly/${month}_${hash(uid)}`),
    isPrivileged: false,
  };
}

export function isManagedAiEnabledForIdentity(control: DocumentData | undefined, uid: string, privileged: boolean): boolean {
  if (control?.enabled !== true) return false;
  if (control.mode === 'general') return true;
  // Test mode is an exact UID allowlist, including for privileged accounts.
  // This lets preview acceptance use one synthetic identity without silently
  // opening the managed endpoint to every owner/admin allowlist member.
  return control.mode === 'test'
    && Array.isArray(control.allowedTestUids)
    && control.allowedTestUids.includes(uid);
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
    const turnExpired = turn.exists && turnData.status === 'pending' && Number(turnData.expiresAtMs || 0) <= now;
    const isNewTurn = !turn.exists || turnData.status === 'failed' || turnData.status === 'expired' || turnExpired;
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    // A conversation turn may use multiple model/tool rounds. Rate-limit human
    // submissions, not each internal continuation of that same turn.
    if (!privileged && isNewTurn && rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);
    const reservationsExpired = Number(userData.reservationsExpireAtMs || 0) <= now;
    let reservedTurns = reservationsExpired ? 0 : Number(userData.reservedTurns || 0);
    if (turnExpired && !reservationsExpired) reservedTurns = Math.max(0, reservedTurns - 1);
    if (!privileged && isNewTurn && Number(userData.successfulTurns || 0) + reservedTurns >= refs.turnLimit) {
      throw new RequestFailure(refs.allowance === 'guest' ? 'GUEST_TURN_ALLOWANCE_EXHAUSTED' : 'TURN_ALLOWANCE_EXHAUSTED', 402);
    }
    if (turn.exists && turnData.status === 'complete') throw new RequestFailure('TURN_ALREADY_COMPLETE', 409);
    if (Number(userData.activeCallUntilMs || 0) > now) throw new RequestFailure('USER_CALL_IN_PROGRESS', 429);

    transaction.set(userRef, {
      ...(!privileged && isNewTurn ? {
        rateWindowStartMs: windowStart > now - 60_000 ? windowStart : now,
        rateWindowCount: rateCount + 1,
      } : {}),
      reservedTurns: isNewTurn ? reservedTurns + 1 : reservedTurns,
      reservationsExpireAtMs: now + RESERVATION_TTL_MS,
      activeCallUntilMs: now + ACTIVE_MODEL_CALL_LEASE_MS,
    }, { merge: true });
    transaction.set(refs.turn, {
      status: 'pending', callsReserved: isNewTurn ? 1 : Number(turnData.callsReserved || 0) + 1,
      expiresAtMs: now + RESERVATION_TTL_MS, updatedAt: Timestamp.now(),
    }, { merge: true });
    refs.isPrivileged = privileged;
  });
}

/** Atomically reserve one separate daily briefing allowance and one actual model call. */
export async function reserveBriefing(db: Firestore, refs: BriefingLedgerRefs, now = Date.now()): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, user, privilegedUser, daily, call, allowlist, pendingInvitation, emailIndex] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.user), transaction.get(refs.privilegedUser),
      transaction.get(refs.daily), transaction.get(refs.call), transaction.get(refs.allowlist),
      transaction.get(refs.pendingInvitation), transaction.get(refs.emailIndex),
    ]);
    const allowlistData = allowlist.data() || {};
    let privileged = refs.allowance === 'account' && Boolean(refs.email)
      && allowlistData.status === 'active' && allowlistData.uid === refs.uid && allowlistData.emailLower === refs.email;
    const pendingData = pendingInvitation.data() || {};
    const emailIndexData = emailIndex.data() || {};
    if (!privileged && refs.allowance === 'account' && refs.email
      && pendingData.status === 'pending' && pendingData.emailLower === refs.email
      && (!emailIndexData.uid || emailIndexData.uid === refs.uid)) {
      privileged = true;
      const activationAudit = db.collection('managedAiAdminAudit').doc(randomUUID());
      transaction.set(refs.allowlist, { uid: refs.uid, emailLower: refs.email, status: 'active', activatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.emailIndex, { uid: refs.uid, emailLower: refs.email, status: 'active', updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.pendingInvitation, { status: 'activated', uid: refs.uid, updatedAt: Timestamp.now() }, { merge: true });
      transaction.create(activationAudit, { actorUid: pendingData.createdBy || 'system', action: 'allowlist_invitation_activated', targetUid: refs.uid, createdAt: Timestamp.now() });
    }
    if (!isManagedAiEnabledForIdentity(control.data(), refs.uid, privileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    const userRef = privileged ? refs.privilegedUser : refs.user;
    const userData = (privileged ? privilegedUser.data() : user.data()) || {};
    const dailyData = daily.data() || {};
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    if (!privileged && rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);
    if (Number(userData.activeCallUntilMs || 0) > now) throw new RequestFailure('USER_CALL_IN_PROGRESS', 429);
    const successes = Number(dailyData.successful || 0);
    const reserved = Number(dailyData.reserved || 0);
    if (!privileged && successes + reserved >= refs.dailyLimit) throw new RequestFailure('BRIEFING_ALLOWANCE_EXHAUSTED', 402);
    transaction.set(userRef, {
      ...(!privileged ? {
        rateWindowStartMs: windowStart > now - 60_000 ? windowStart : now,
        rateWindowCount: rateCount + 1,
      } : {}),
      activeCallUntilMs: now + ACTIVE_MODEL_CALL_LEASE_MS,
    }, { merge: true });
    transaction.set(refs.daily, { reserved: reserved + (privileged ? 0 : 1), updatedAt: Timestamp.now() }, { merge: true });
    transaction.create(refs.call, { status: 'pending', purpose: 'briefing', reservedAt: Timestamp.now(), privileged });
    refs.isPrivileged = privileged;
  });
}

export async function reserveBriefingGenerationCall(db: Firestore, refs: BriefingLedgerRefs): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, monthly, userMonthly, privilegedMonthly, privilegedUserMonthly, call, allowlist] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.month), transaction.get(refs.userMonth), transaction.get(refs.privilegedMonth),
      transaction.get(refs.privilegedUserMonth), transaction.get(refs.call), transaction.get(refs.allowlist),
    ]);
    const access = allowlist.data() || {};
    if (refs.isPrivileged && (access.status !== 'active' || access.uid !== refs.uid || access.emailLower !== refs.email)) {
      throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    }
    if (!isManagedAiEnabledForIdentity(control.data(), refs.uid, refs.isPrivileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (!call.exists || call.get('status') !== 'pending') throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    if (!refs.isPrivileged) {
      transaction.set(refs.month, { callsReserved: Number(monthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.userMonth, { callsReserved: Number(userMonthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
    }
    else {
      transaction.set(refs.privilegedMonth, { callsReserved: Number(privilegedMonthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.privilegedUserMonth, {
        uid: refs.uid,
        callsReserved: Number(privilegedUserMonthly.get('callsReserved') || 0) + 1,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    transaction.set(refs.call, { status: 'reserved', providerCallReservedAt: Timestamp.now() }, { merge: true });
  });
}

export async function finishBriefing(db: Firestore, refs: BriefingLedgerRefs, successful: boolean): Promise<void> {
  await db.runTransaction(async transaction => {
    const userRef = refs.isPrivileged ? refs.privilegedUser : refs.user;
    const daily = await transaction.get(refs.daily);
    const dailyData = daily.data() || {};
    const remaining = refs.isPrivileged ? 0 : Math.max(0, Number(dailyData.reserved || 0) - 1);
    transaction.set(refs.daily, {
      reserved: remaining,
      successful: Number(dailyData.successful || 0) + (successful ? 1 : 0),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(userRef, { activeCallUntilMs: 0 }, { merge: true });
    transaction.set(refs.call, {
      status: successful ? 'complete' : 'failed',
      ...(successful ? { completedAt: Timestamp.now() } : { failedAt: Timestamp.now() }),
    }, { merge: true });
  });
}

export async function reserveGenerationCall(db: Firestore, refs: TurnLedgerRefs): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, monthly, userMonthly, privilegedMonthly, privilegedUserMonthly, call, allowlist] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.month), transaction.get(refs.userMonth), transaction.get(refs.privilegedMonth),
      transaction.get(refs.privilegedUserMonth), transaction.get(refs.call), transaction.get(refs.allowlist),
    ]);
    const access = allowlist.data() || {};
    if (refs.isPrivileged && (access.status !== 'active' || access.uid !== refs.uid || access.emailLower !== refs.email)) {
      throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    }
    if (!isManagedAiEnabledForIdentity(control.data(), refs.uid, refs.isPrivileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    if (!refs.isPrivileged) {
      transaction.set(refs.month, { callsReserved: Number(monthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.userMonth, { callsReserved: Number(userMonthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
    } else {
      transaction.set(refs.privilegedMonth, { callsReserved: Number(privilegedMonthly.get('callsReserved') || 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
      transaction.set(refs.privilegedUserMonth, {
        uid: refs.uid,
        callsReserved: Number(privilegedUserMonthly.get('callsReserved') || 0) + 1,
        updatedAt: Timestamp.now(),
      }, { merge: true });
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
      expiresAtMs: complete ? 0 : Date.now() + RESERVATION_TTL_MS,
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

/** Persist only non-content model metadata; never store prompts, responses, or credentials. */
export function sanitizeUsageMetadata(usageMetadata: Record<string, unknown> | null | undefined): Record<string, number> {
  const numericFields = ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount'];
  return Object.fromEntries(numericFields.flatMap(field => {
    const value = Number(usageMetadata?.[field]);
    return Number.isSafeInteger(value) && value >= 0 ? [[field, value]] : [];
  }));
}

export async function recordGenerationUsage(
  refs: TurnLedgerRefs | BriefingLedgerRefs,
  model: string,
  reasoningLevel: string,
  usageMetadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  const usage = sanitizeUsageMetadata(usageMetadata);
  await refs.call.set({ model, reasoningLevel, usage, usageRecordedAt: Timestamp.now() }, { merge: true });
}
