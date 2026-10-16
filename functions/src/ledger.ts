import { createHash } from 'node:crypto';
import { getFirestore, Timestamp, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import { RequestFailure, MAX_CALLS_PER_TURN, MONTHLY_GENERATION_LIMIT, RATE_LIMIT_PER_MINUTE, TURN_RESERVATION_TTL_MS, USER_TURN_LIMIT, monthKey } from './policy.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface TurnLedgerRefs {
  user: DocumentReference;
  turn: DocumentReference;
  call: DocumentReference;
  control: DocumentReference;
  month: DocumentReference;
}

export function turnLedgerRefs(db: Firestore, uid: string, turnId: string, callId: string, date = new Date()): TurnLedgerRefs {
  return {
    user: db.doc(`managedAiUsers/${uid}`),
    turn: db.doc(`managedAiTurns/${hash(`${uid}:${turnId}`)}`),
    call: db.doc(`managedAiCalls/${hash(`${uid}:${turnId}:${callId}`)}`),
    control: db.doc('system/managedAi'),
    month: db.doc(`managedAiMonthly/${monthKey(date)}`),
  };
}

export async function reserveTurn(db: Firestore, refs: TurnLedgerRefs, now = Date.now()): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, user, turn, call] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.user), transaction.get(refs.turn), transaction.get(refs.call),
    ]);
    if (control.get('enabled') !== true) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const windowStart = Number(userData.rateWindowStartMs || 0);
    const rateCount = windowStart > now - 60_000 ? Number(userData.rateWindowCount || 0) : 0;
    if (rateCount >= RATE_LIMIT_PER_MINUTE) throw new RequestFailure('RATE_LIMITED', 429);

    const turnExpired = turn.exists && turnData.status === 'pending' && Number(turnData.expiresAtMs || 0) <= now;
    const isNewTurn = !turn.exists || turnData.status === 'failed' || turnData.status === 'expired' || turnExpired;
    const reservationsExpired = Number(userData.reservationsExpireAtMs || 0) <= now;
    let reservedTurns = reservationsExpired ? 0 : Number(userData.reservedTurns || 0);
    if (turnExpired && !reservationsExpired) reservedTurns = Math.max(0, reservedTurns - 1);
    if (isNewTurn && Number(userData.successfulTurns || 0) + reservedTurns >= USER_TURN_LIMIT) {
      throw new RequestFailure('TURN_ALLOWANCE_EXHAUSTED', 402);
    }
    if (turn.exists && turnData.status === 'complete') throw new RequestFailure('TURN_ALREADY_COMPLETE', 409);
    if (turn.exists && turnData.status === 'pending' && !turnExpired && Number(turnData.callsReserved || 0) >= MAX_CALLS_PER_TURN) {
      throw new RequestFailure('TURN_CALL_LIMIT', 429);
    }
    if (Number(userData.activeCallUntilMs || 0) > now) throw new RequestFailure('USER_CALL_IN_PROGRESS', 429);

    transaction.set(refs.user, {
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
  });
}

export async function reserveGenerationCall(db: Firestore, refs: TurnLedgerRefs): Promise<void> {
  await db.runTransaction(async transaction => {
    const [control, monthly, call] = await Promise.all([
      transaction.get(refs.control), transaction.get(refs.month), transaction.get(refs.call),
    ]);
    if (control.get('enabled') !== true) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    if (call.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    const callsReserved = Number(monthly.get('callsReserved') || 0);
    if (callsReserved >= MONTHLY_GENERATION_LIMIT) throw new RequestFailure('GLOBAL_LIMIT_REACHED', 429);
    transaction.set(refs.month, { callsReserved: callsReserved + 1, updatedAt: Timestamp.now() }, { merge: true });
    transaction.create(refs.call, { status: 'reserved', reservedAt: Timestamp.now() });
  });
}

export async function finishTurn(db: Firestore, refs: TurnLedgerRefs, complete: boolean): Promise<void> {
  await db.runTransaction(async transaction => {
    const [user, turn] = await Promise.all([transaction.get(refs.user), transaction.get(refs.turn)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const remaining = complete ? Math.max(0, Number(userData.reservedTurns || 0) - 1) : Number(userData.reservedTurns || 0);
    transaction.set(refs.user, {
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
    const [user, turn] = await Promise.all([transaction.get(refs.user), transaction.get(refs.turn)]);
    const userData = user.data() || {};
    const turnData = turn.data() || {};
    const remaining = Math.max(0, Number(userData.reservedTurns || 0) - (turnData.status === 'pending' ? 1 : 0));
    transaction.set(refs.user, {
      reservedTurns: remaining,
      reservationsExpireAtMs: remaining === 0 ? 0 : Number(userData.reservationsExpireAtMs || 0),
      activeCallUntilMs: 0,
    }, { merge: true });
    transaction.set(refs.turn, { status: 'failed', failedAt: Timestamp.now() }, { merge: true });
    if (callReserved) transaction.set(refs.call, { status: 'failed', failedAt: Timestamp.now() }, { merge: true });
  });
}
