import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, Timestamp, type Firestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { RequestFailure, GUEST_CHAT_TURN_LIMIT, ACCOUNT_CHAT_TURN_LIMIT, GUEST_DAILY_BRIEFING_LIMIT, ACCOUNT_DAILY_BRIEFING_LIMIT, RATE_LIMIT_PER_MINUTE, MAX_GENERATIONS_PER_TURN, RESERVATION_TTL_MS, ACTIVE_MODEL_CALL_LEASE_MS, dayKey, monthKey } from './policy.js';
import type { CostEstimate } from './cost.js';

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
  call: DocumentReference;
  control: DocumentReference;
  month: DocumentReference;
  userMonth: DocumentReference;
  userDay: DocumentReference;
  privilegedMonth: DocumentReference;
  privilegedUserMonth: DocumentReference;
  privilegedUserDay: DocumentReference;
  day: string;
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
    call: db.doc(`managedAiCalls/${hash(`${uid}:briefing:${day}:${callId}`)}`),
    control: db.doc('system/managedAi'),
    month: db.doc(`managedAiMonthly/${month}`),
    userMonth: db.doc(`managedAiUserMonthly/${month}_${hash(uid)}`),
    userDay: db.doc(`managedAiUserDaily/${day}_${hash(uid)}`),
    privilegedMonth: db.doc(`managedAiPrivilegedMonthly/${month}`),
    privilegedUserMonth: db.doc(`managedAiPrivilegedUserMonthly/${month}_${hash(uid)}`),
    privilegedUserDay: db.doc(`managedAiPrivilegedUserDaily/${day}_${hash(uid)}`),
    day,
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
    const [control, user, privilegedUser, turn, call, allowlist, pendingInvitation, emailIndex, userMonth, privilegedUserMonth] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.user), transaction.get(refs.privilegedUser),
      transaction.get(refs.turn), transaction.get(refs.call), transaction.get(refs.allowlist),
      transaction.get(refs.pendingInvitation), transaction.get(refs.emailIndex), transaction.get(refs.userMonth), transaction.get(refs.privilegedUserMonth),
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
    const usageRef = privileged ? refs.privilegedUserMonth : refs.userMonth;
    const usageData = (privileged ? privilegedUserMonth.data() : userMonth.data()) || {};
    const userData = (privileged ? privilegedUser.data() : user.data()) || {};
    const turnData = turn.data() || {};
    const turnExpired = turn.exists && turnData.status === 'pending' && Number(turnData.expiresAtMs || 0) <= now;
    const isNewTurn = !turn.exists || turnData.status === 'failed' || turnData.status === 'expired' || turnExpired;
    if (!isNewTurn && Number(turnData.callsReserved || 0) >= MAX_GENERATIONS_PER_TURN) {
      throw new RequestFailure('TURN_GENERATION_LIMIT', 429);
    }
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    // A conversation turn may use multiple model/tool rounds. Rate-limit human
    // submissions, not each internal continuation of that same turn.
    if (!privileged && isNewTurn && rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);
    const reservationsExpired = Number(userData.reservationsExpireAtMs || 0) <= now;
    let reservedTurns = reservationsExpired ? 0 : Number(userData.reservedTurns || 0);
    if (turnExpired && !reservationsExpired) reservedTurns = Math.max(0, reservedTurns - 1);
    const thisMonth = refs.userMonth.id.slice(0, 7);
    let monthlyReservedTurns = Number(usageData.reservedTurns || 0);
    if (turnExpired && turnData.quotaMonth === thisMonth) monthlyReservedTurns = Math.max(0, monthlyReservedTurns - 1);
    if (!privileged && isNewTurn && Number(usageData.successfulTurns || 0) + monthlyReservedTurns >= refs.turnLimit) {
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
      ...(isNewTurn ? { quotaMonth: thisMonth } : {}),
      expiresAtMs: now + RESERVATION_TTL_MS, updatedAt: Timestamp.now(),
    }, { merge: true });
    if (isNewTurn) transaction.set(usageRef, { reservedTurns: monthlyReservedTurns + 1, updatedAt: Timestamp.now() }, { merge: true });
    refs.isPrivileged = privileged;
  });
}

/** Atomically reserve one daily briefing allowance and one actual model call. */
export async function reserveBriefing(db: Firestore, refs: BriefingLedgerRefs, now = Date.now()): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, user, privilegedUser, userDay, privilegedUserDay, call, allowlist, pendingInvitation, emailIndex] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.user), transaction.get(refs.privilegedUser),
      transaction.get(refs.userDay), transaction.get(refs.privilegedUserDay), transaction.get(refs.call), transaction.get(refs.allowlist),
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
    const dailyData = (privileged ? privilegedUserDay.data() : userDay.data()) || {};
    const userData = (privileged ? privilegedUser.data() : user.data()) || {};
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    if (!privileged && rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);
    if (Number(userData.activeCallUntilMs || 0) > now) throw new RequestFailure('USER_CALL_IN_PROGRESS', 429);
    const successes = Number(dailyData.successfulBriefings || 0);
    // Reserve against the Asia/Kolkata daily bucket. Expired in-flight calls
    // stop counting, while successful generations remain charged for the day.
    const reserved = Number(userData.activeCallUntilMs || 0) > now ? Number(dailyData.reservedBriefings || 0) : 0;
    if (!privileged && successes + reserved >= refs.dailyLimit) throw new RequestFailure('BRIEFING_ALLOWANCE_EXHAUSTED', 402);
    transaction.set(userRef, {
      ...(!privileged ? {
        rateWindowStartMs: windowStart > now - 60_000 ? windowStart : now,
        rateWindowCount: rateCount + 1,
      } : {}),
      activeCallUntilMs: now + ACTIVE_MODEL_CALL_LEASE_MS,
    }, { merge: true });
    transaction.set(privileged ? refs.privilegedUserDay : refs.userDay, { reservedBriefings: reserved + 1, updatedAt: Timestamp.now() }, { merge: true });
    transaction.create(refs.call, {
      status: 'pending', purpose: 'briefing', reservedAt: Timestamp.now(), privileged,
      expiresAt: Timestamp.fromMillis(now + 90 * 24 * 60 * 60 * 1000),
    });
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
    const usageRef = refs.isPrivileged ? refs.privilegedUserMonth : refs.userMonth;
    const dailyRef = refs.isPrivileged ? refs.privilegedUserDay : refs.userDay;
    const [call, usage, daily] = await Promise.all([transaction.get(refs.call), transaction.get(usageRef), transaction.get(dailyRef)]);
    if (call.get('status') === 'complete' || call.get('status') === 'failed') return;
    const usageData = usage.data() || {};
    transaction.set(usageRef, {
      successfulBriefings: Number(usageData.successfulBriefings || 0) + (successful ? 1 : 0),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    const dailyData = daily.data() || {};
    transaction.set(dailyRef, {
      reservedBriefings: Math.max(0, Number(dailyData.reservedBriefings || 0) - 1),
      successfulBriefings: Number(dailyData.successfulBriefings || 0) + (successful ? 1 : 0),
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
    transaction.create(refs.call, {
      status: 'reserved', reservedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  });
}

function trustedCounter(value: unknown): number {
  const number = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
  return number;
}

/** Reserve estimated provider exposure before sending the generation request. */
export async function reserveCostExposure(
  db: Firestore,
  refs: TurnLedgerRefs | BriefingLedgerRefs,
  estimate: CostEstimate,
  now = new Date(),
): Promise<void> {
  const month = monthKey(now);
  const uidHash = hash(refs.uid);
  const policyRef = db.doc('system/managedAiBudgetPolicy');
  const projectBudgetRef = db.doc(`managedAiCostProjectMonthly/${month}`);
  const userBudgetRef = db.doc(`managedAiCostUserMonthly/${month}_${uidHash}`);
  const callRef = refs.call;
  const turnRef = 'turn' in refs ? refs.turn : null;

  await db.runTransaction(async transaction => {
    const [policy, projectBudget, userBudget, call, turn] = await Promise.all([
      transaction.get(policyRef), transaction.get(projectBudgetRef), transaction.get(userBudgetRef),
      transaction.get(callRef), turnRef ? transaction.get(turnRef) : Promise.resolve(null),
    ]);
    const policyData = policy.data() || {};
    const projectLimit = trustedCounter(policyData.projectMonthlyLimitMicroUsd);
    const userLimit = trustedCounter(policyData.userMonthlyLimitMicroUsd);
    const turnLimit = trustedCounter(policyData.maxTurnExposureMicroUsd);
    if (policy.get('enabled') !== true || policy.get('currency') !== 'USD' || !projectLimit || !userLimit || !turnLimit ||
        userLimit > projectLimit || turnLimit > userLimit || policy.get('emergencyStop') === true) {
      throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
    }
    if (!Number.isSafeInteger(estimate.estimatedMicroUsd) || estimate.estimatedMicroUsd <= 0 ||
        !estimate.pricingVersion || !Number.isSafeInteger(estimate.inputTokens) || estimate.inputTokens < 0 ||
        !Number.isSafeInteger(estimate.maximumOutputTokens) || estimate.maximumOutputTokens < 1) {
      throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);
    }
    if (!call.exists || ['reserved', 'complete', 'failed'].includes(String(call.get('costStatus') || ''))) {
      throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    }

    const projectData = projectBudget.data() || {};
    const userData = userBudget.data() || {};
    const projectReserved = trustedCounter(projectData.reservedMicroUsd);
    const projectSettled = trustedCounter(projectData.settledMicroUsd);
    const userReserved = trustedCounter(userData.reservedMicroUsd);
    const userSettled = trustedCounter(userData.settledMicroUsd);
    const projectExposure = projectSettled + projectReserved + estimate.estimatedMicroUsd;
    const userExposure = userSettled + userReserved + estimate.estimatedMicroUsd;
    if (!Number.isSafeInteger(projectExposure) || projectExposure > projectLimit) {
      throw new RequestFailure('MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE', 503);
    }
    if (!Number.isSafeInteger(userExposure) || userExposure > userLimit) {
      throw new RequestFailure('USER_MANAGED_BUDGET_EXHAUSTED', 429);
    }

    let turnReserved = 0;
    let turnSettled = 0;
    if (turn) {
      if (!turn.exists || turn.get('status') !== 'pending') throw new RequestFailure('TURN_ALREADY_COMPLETE', 409);
      turnReserved = trustedCounter(turn.get('costReservedMicroUsd'));
      turnSettled = trustedCounter(turn.get('costSettledMicroUsd'));
      const turnExposure = turnReserved + turnSettled + estimate.estimatedMicroUsd;
      if (!Number.isSafeInteger(turnExposure) || turnExposure > turnLimit) {
        throw new RequestFailure('TURN_COST_ENVELOPE_EXHAUSTED', 413);
      }
      transaction.set(turnRef!, { costReservedMicroUsd: turnReserved + estimate.estimatedMicroUsd, updatedAt: Timestamp.now() }, { merge: true });
    }
    transaction.set(projectBudgetRef, {
      reservedMicroUsd: projectReserved + estimate.estimatedMicroUsd,
      ...(!projectBudget.exists ? { expiresAt: Timestamp.fromMillis(Date.now() + 400 * 24 * 60 * 60 * 1000) } : {}),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(userBudgetRef, {
      reservedMicroUsd: userReserved + estimate.estimatedMicroUsd,
      ...(!userBudget.exists ? { expiresAt: Timestamp.fromMillis(Date.now() + 400 * 24 * 60 * 60 * 1000) } : {}),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(callRef, {
      costStatus: 'reserved', costMonth: month, costReservedMicroUsd: estimate.estimatedMicroUsd,
      costPricingVersion: estimate.pricingVersion, costInputTokens: estimate.inputTokens,
      costMaximumOutputTokens: estimate.maximumOutputTokens, costReservedAt: Timestamp.now(),
    }, { merge: true });
  });
}

/** Mark post-submission failures as uncertain and retain their exposure reservation. */
export async function markCostExposureUncertain(refs: TurnLedgerRefs | BriefingLedgerRefs): Promise<void> {
  await refs.call.firestore.runTransaction(async transaction => {
    const call = await transaction.get(refs.call);
    if (call.get('costStatus') === 'reserved') {
      transaction.set(refs.call, { costStatus: 'uncertain', costUncertainAt: Timestamp.now() }, { merge: true });
    }
  });
}

/** Settle only when authoritative provider usage is present; otherwise hold the reserve. */
export async function settleCostExposure(
  refs: TurnLedgerRefs | BriefingLedgerRefs,
  actualMicroUsd: number,
  pricingVersion: string,
): Promise<void> {
  if (!Number.isSafeInteger(actualMicroUsd) || actualMicroUsd < 0 || !pricingVersion) {
    throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);
  }
  const db = refs.call.firestore;
  const turnRef = 'turn' in refs ? refs.turn : null;
  await db.runTransaction(async transaction => {
    const callSnapshot = await transaction.get(refs.call);
    const status = callSnapshot.get('costStatus');
    if (status === 'settled') return;
    if (status !== 'reserved' && status !== 'uncertain') throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
    const month = String(callSnapshot.get('costMonth') || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
    const uidHash = hash(refs.uid);
    const projectBudgetRef = db.doc(`managedAiCostProjectMonthly/${month}`);
    const userBudgetRef = db.doc(`managedAiCostUserMonthly/${month}_${uidHash}`);
    const [projectBudget, userBudget, turn] = await Promise.all([
      transaction.get(projectBudgetRef), transaction.get(userBudgetRef), turnRef ? transaction.get(turnRef) : Promise.resolve(null),
    ]);
    const reserved = trustedCounter(callSnapshot.get('costReservedMicroUsd'));
    const projectReserved = trustedCounter(projectBudget.get('reservedMicroUsd'));
    const userReserved = trustedCounter(userBudget.get('reservedMicroUsd'));
    if (projectReserved < reserved || userReserved < reserved) throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
    const estimateExceeded = actualMicroUsd > reserved;
    transaction.set(projectBudgetRef, {
      reservedMicroUsd: projectReserved - reserved,
      settledMicroUsd: trustedCounter(projectBudget.get('settledMicroUsd')) + actualMicroUsd,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(userBudgetRef, {
      reservedMicroUsd: userReserved - reserved,
      settledMicroUsd: trustedCounter(userBudget.get('settledMicroUsd')) + actualMicroUsd,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    if (turn) {
      const turnReserved = trustedCounter(turn.get('costReservedMicroUsd'));
      if (turnReserved < reserved) throw new RequestFailure('MANAGED_AI_BUDGET_UNAVAILABLE', 503);
      transaction.set(turnRef!, {
        costReservedMicroUsd: turnReserved - reserved,
        costSettledMicroUsd: trustedCounter(turn.get('costSettledMicroUsd')) + actualMicroUsd,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    transaction.set(refs.call, {
      costStatus: 'settled', costSettledMicroUsd: actualMicroUsd, costSettledPricingVersion: pricingVersion,
      costSettledAt: Timestamp.now(), ...(estimateExceeded ? { costEstimateExceeded: true } : {}),
    }, { merge: true });
    if (estimateExceeded) transaction.set(db.doc('system/managedAiBudgetPolicy'), { emergencyStop: true, emergencyStopReason: 'provider_usage_exceeded_reservation', updatedAt: Timestamp.now() }, { merge: true });
  });
}

export async function finishTurn(db: Firestore, refs: TurnLedgerRefs, complete: boolean): Promise<void> {
  await db.runTransaction(async transaction => {
    const userRef = refs.isPrivileged ? refs.privilegedUser : refs.user;
    const usageRef = refs.isPrivileged ? refs.privilegedUserMonth : refs.userMonth;
    const [user, turn, usage] = await Promise.all([transaction.get(userRef), transaction.get(refs.turn), transaction.get(usageRef)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    if (turnData.status === 'complete') return;
    const remaining = complete ? Math.max(0, Number(userData.reservedTurns || 0) - 1) : Number(userData.reservedTurns || 0);
    transaction.set(userRef, {
      activeCallUntilMs: 0,
      reservedTurns: remaining,
      reservationsExpireAtMs: remaining === 0 ? 0 : Number(userData.reservationsExpireAtMs || 0),
      ...(complete ? { successfulTurns: Number(userData.successfulTurns || 0) + 1 } : {}),
    }, { merge: true });
    if (complete) {
      const usageData = usage.data() || {};
      transaction.set(usageRef, {
        reservedTurns: Math.max(0, Number(usageData.reservedTurns || 0) - (turnData.status === 'pending' && turnData.quotaMonth === refs.userMonth.id.slice(0, 7) ? 1 : 0)),
        successfulTurns: Number(usageData.successfulTurns || 0) + 1,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
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
    const usageRef = refs.isPrivileged ? refs.privilegedUserMonth : refs.userMonth;
    const [user, turn, usage] = await Promise.all([transaction.get(userRef), transaction.get(refs.turn), transaction.get(usageRef)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const remaining = Math.max(0, Number(userData.reservedTurns || 0) - (turnData.status === 'pending' ? 1 : 0));
    transaction.set(userRef, {
      reservedTurns: remaining,
      reservationsExpireAtMs: remaining === 0 ? 0 : Number(userData.reservationsExpireAtMs || 0),
      activeCallUntilMs: 0,
    }, { merge: true });
    if (turnData.status === 'pending' && turnData.quotaMonth === refs.userMonth.id.slice(0, 7)) {
      transaction.set(usageRef, { reservedTurns: Math.max(0, Number(usage.get('reservedTurns') || 0) - 1), updatedAt: Timestamp.now() }, { merge: true });
    }
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
  const usageRef = refs.isPrivileged ? refs.privilegedUserMonth : refs.userMonth;
  await refs.call.firestore.runTransaction(async transaction => {
    const [call, monthly] = await Promise.all([transaction.get(refs.call), transaction.get(usageRef)]);
    if (call.get('usageRecordedAt')) return;
    transaction.set(refs.call, { model, reasoningLevel, usage, ...(Object.keys(usage).length ? { usageRecordedAt: Timestamp.now() } : {}) }, { merge: true });
    if (Object.keys(usage).length) {
      const data = monthly.data() || {};
      transaction.set(usageRef, {
        inputTokens: Number(data.inputTokens || 0) + Number(usage.promptTokenCount || 0),
        outputTokens: Number(data.outputTokens || 0) + Number(usage.candidatesTokenCount || 0),
        thinkingTokens: Number(data.thinkingTokens || 0) + Number(usage.thoughtsTokenCount || 0),
        totalTokens: Number(data.totalTokens || 0) + Number(usage.totalTokenCount || 0),
        usageCallsReported: Number(data.usageCallsReported || 0) + 1,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  });
}
