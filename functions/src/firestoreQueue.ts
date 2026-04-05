import * as functions from 'firebase-functions';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { createHash, randomBytes } from 'crypto';
import {
  type AdmissionRoundConfig,
  checkRateLimit as sharedCheckRateLimit,
  getRateLimitIdentifier as sharedGetRateLimitIdentifier,
  normalizeAdmissionRounds as sharedNormalizeAdmissionRounds,
  normalizeCallableRequest as sharedNormalizeCallableRequest
} from './shared/queueShared';
import {
  buildQueueStateDoc as buildQueueStateRecord,
  getAdvanceLimitFromCounts,
  getAvailableWriterSlots,
  getQueueAdvanceAmount,
  type QueueLiveMetrics,
  type QueueStateDoc
} from './queueState';

// Runtime configurations for hot-path functions to handle stampede load
const hotPathRuntime = functionsV1.runWith({
  timeoutSeconds: 120,
  memory: '512MB',
  minInstances: 5,
  maxInstances: 200
});
const heartbeatRuntime = functionsV1.runWith({
  timeoutSeconds: 30,
  memory: '256MB',
  maxInstances: 100
});
const schedulerRuntime = functionsV1.runWith({
  timeoutSeconds: 300,
  memory: '1GB',
  minInstances: 1,
  maxInstances: 20
});
const standardRuntime = functionsV1.runWith({
  timeoutSeconds: 120,
  memory: '512MB',
  minInstances: 2,
  maxInstances: 80
});

if (admin.apps.length === 0) {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
}

type QueueEntryStatus = 'waiting' | 'eligible' | 'consumed' | 'expired';
type ReservationStatus = 'reserved' | 'processing' | 'confirmed' | 'expired' | 'cancelled';

interface QueueEntryDoc {
  roundId: string;
  roundLabel?: string;
  userId: string;
  queueIdentityHash?: string;
  applicantName?: string;
  applicantPhoneLast4?: string;
  number: number | null;
  status: QueueEntryStatus;
  joinedAt: number;
  eligibleAt?: number | null;
  lastSeenAt: number;
  activeReservationId?: string | null;
  updatedAt: number;
}

interface ReservationDoc {
  roundId: string;
  roundLabel?: string;
  userId: string;
  queueIdentityHash?: string;
  applicantName?: string;
  applicantPhoneLast4?: string;
  queueNumber: number | null;
  status: ReservationStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  processingAt?: number | null;
  confirmedAt?: number | null;
  expiredAt?: number | null;
  requestId: string;
  registrationId?: string | null;
  finalStatus?: 'confirmed' | 'waitlisted' | null;
}

interface RequestLockDoc {
  type: 'joinQueue' | 'startRegistration' | 'confirmReservation' | 'forceExpireSession';
  userId: string;
  createdAt: number;
  updatedAt: number;
  result: Record<string, any>;
}

interface QueueIdentityLockDoc {
  roundId: string;
  userId: string;
  studentName: string;
  phoneLast4: string;
  status: 'waiting' | 'eligible' | 'reserved' | 'confirmed' | 'waitlisted';
  queueNumber?: number | null;
  sessionId?: string | null;
  registrationId?: string | null;
  updatedAt: number;
}

type JoinQueueErrorReason = 'QUEUE_CLOSED' | 'CAPACITY_FULL';

interface NormalizedCallableRequest {
  data: any;
  auth: any;
  rawRequest: any;
}

const DEFAULT_SESSION_MS = 3 * 60 * 1000;
const SESSION_SUBMIT_GRACE_MS = 90 * 1000;
const WAITING_PRESENCE_TIMEOUT_MS = 90 * 1000;
const ELIGIBLE_PRESENCE_TIMEOUT_MS = 60 * 1000;
const ACTIVE_QUEUE_ENTRY_STATUSES: QueueEntryStatus[] = ['waiting', 'eligible'];
const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ['reserved', 'processing'];

function normalizeCallableRequest(requestOrData: any, legacyContext?: any): NormalizedCallableRequest {
  return sharedNormalizeCallableRequest(requestOrData, legacyContext);
}

// Best-effort rate limiting without Firestore transactions.
// Eliminates write contention when many users share the same IP (e.g. school Wi-Fi).
// Trade-off: under extreme concurrency the limit may be exceeded by a few requests,
// which is acceptable for a rate limiter whose purpose is abuse prevention, not
// precise metering.
async function checkRateLimit(
  db: admin.firestore.Firestore,
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  return sharedCheckRateLimit(db, identifier, maxRequests, windowMs);
}

function getRateLimitIdentifier(rawRequest: any, fallback: string) {
  return sharedGetRateLimitIdentifier(rawRequest, fallback);
}

function normalizeAdmissionRounds(schoolData: admin.firestore.DocumentData): AdmissionRoundConfig[] {
  return sharedNormalizeAdmissionRounds(schoolData);
}

function getResolvedAdmissionRound(schoolData: admin.firestore.DocumentData, now = Date.now()) {
  const rounds = normalizeAdmissionRounds(schoolData);
  if (rounds.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', '모집 차수가 설정되지 않았습니다.');
  }

  const round2 = rounds.find((r) => r.id === 'round2');
  if (round2 && round2.openDateTime) {
    const round2Open = new Date(round2.openDateTime).getTime();
    if (!Number.isNaN(round2Open) && round2Open <= now) {
      return round2;
    }
  }

  const openedRounds = rounds.filter((round) => {
    const openTime = new Date(round.openDateTime || 0).getTime();
    return openTime && !Number.isNaN(openTime) && now >= openTime;
  });

  return openedRounds.length > 0 ? openedRounds[openedRounds.length - 1] : rounds[0];
}

function getRoundById(schoolData: admin.firestore.DocumentData, roundId?: string | null) {
  const rounds = normalizeAdmissionRounds(schoolData);
  if (!roundId) {
    return null;
  }

  return rounds.find((round) => round.id === roundId) || null;
}

function getRoundCapacity(round: AdmissionRoundConfig) {
  const maxCapacity = Number(round.maxCapacity || 0);
  const waitlistCapacity = Number(round.waitlistCapacity || 0);
  return {
    maxCapacity,
    waitlistCapacity,
    totalCapacity: maxCapacity + waitlistCapacity
  };
}

function getMaxActiveSessions(schoolData: admin.firestore.DocumentData) {
  return Math.max(1, Number(schoolData.queueSettings?.maxActiveSessions || 60));
}

function getQueueJoinLimit(round: AdmissionRoundConfig) {
  const { totalCapacity } = getRoundCapacity(round);
  return Math.max(1, Math.ceil(totalCapacity * 1.0));
}

function isQueueEnabled(schoolData: admin.firestore.DocumentData) {
  return schoolData.queueSettings?.enabled !== false;
}

function assertSchoolOpen(schoolData: admin.firestore.DocumentData, round: AdmissionRoundConfig, now = Date.now()) {
  if (schoolData.isActive === false) {
    throw new functions.https.HttpsError('failed-precondition', '현재 접수를 진행하고 있지 않습니다.');
  }

  const openTime = new Date(round.openDateTime || 0).getTime();
  if (!openTime || Number.isNaN(openTime)) {
    throw new functions.https.HttpsError('failed-precondition', '접수 시작 시간이 설정되어 있지 않습니다.');
  }
  if (now < openTime) {
    throw new functions.https.HttpsError('failed-precondition', '아직 접수 시작 시간이 아닙니다.');
  }
}

function queueStateRef(db: admin.firestore.Firestore, schoolId: string, roundId: string) {
  return db.doc(`schools/${schoolId}/queueState/${roundId}`);
}

function queueEntriesRef(db: admin.firestore.Firestore, schoolId: string) {
  return db.collection(`schools/${schoolId}/queueEntries`);
}

function reservationsRef(db: admin.firestore.Firestore, schoolId: string) {
  return db.collection(`schools/${schoolId}/reservations`);
}

function registrationsRef(db: admin.firestore.Firestore, schoolId: string) {
  return db.collection(`schools/${schoolId}/registrations`);
}

function requestLockRef(db: admin.firestore.Firestore, schoolId: string, requestId: string) {
  return db.doc(`schools/${schoolId}/requestLocks/${requestId}`);
}

function queueIdentityLockRef(db: admin.firestore.Firestore, schoolId: string, roundId: string, identityHash: string) {
  // roundId is intentionally ignored here to make the lock global for the school.
  // This explicitly blocks a user who succeeded in round 1 from applying in round 2.
  return db.doc(`schools/${schoolId}/queueIdentityLocks/${identityHash}`);
}

function makeJoinQueueError(
  message: string,
  reason: JoinQueueErrorReason,
  metadata?: Record<string, unknown>
) {
  return new functions.https.HttpsError('resource-exhausted', message, {
    reason,
    isFull: true,
    message,
    ...(metadata || {})
  });
}

async function setQueueStateBestEffort(
  stateRef: admin.firestore.DocumentReference,
  nextState: Partial<QueueStateDoc>,
  context: string
) {
  try {
    await stateRef.set(nextState, { merge: true });
  } catch (error) {
    functions.logger.error(`[${context}] queueState sync failed`, {
      path: stateRef.path,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function sanitizeRequestId(requestId?: string) {
  return typeof requestId === 'string' && requestId.trim()
    ? requestId.trim().slice(0, 120)
    : `req_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

interface QueueIdentity {
  studentName: string;
  phone: string;
  phoneLast4: string;
  identityHash: string;
}

function buildQueueIdentityHash(studentName: string, phone: string) {
  const normalizedName = String(studentName || '').trim().replace(/\s+/g, '').toLowerCase();
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  return createHash('sha256').update(`${normalizedName}:${normalizedPhone}`).digest('hex');
}

function sanitizeQueueIdentity(queueIdentity: any): QueueIdentity {
  if (typeof queueIdentity !== 'object' || queueIdentity === null) {
    throw new functions.https.HttpsError('invalid-argument', '이름과 휴대폰 번호를 먼저 입력해 주세요.');
  }

  const studentName = String(queueIdentity.studentName || '').trim().slice(0, 50);
  const phone = String(queueIdentity.phone || '').replace(/\D/g, '');

  if (!studentName) {
    throw new functions.https.HttpsError('invalid-argument', '이름을 입력해 주세요.');
  }

  if (!/^010\d{8}$/.test(phone)) {
    throw new functions.https.HttpsError('invalid-argument', '휴대폰 번호는 010으로 시작하는 11자리 숫자로 입력해 주세요.');
  }

  return {
    studentName,
    phone,
    phoneLast4: phone.slice(-4),
    identityHash: buildQueueIdentityHash(studentName, phone)
  };
}

function buildQueueIdentityInUseMessage(studentName: string, phoneLast4: string) {
  return `${studentName} (${phoneLast4}) 정보로 이미 진행 중인 대기열 또는 신청서가 있습니다. 기존 기기에서 이어서 진행해 주세요.`;
}

function buildQueueStateDoc(
  schoolData: admin.firestore.DocumentData,
  round: AdmissionRoundConfig,
  existing?: Partial<QueueStateDoc> | null
): QueueStateDoc {
  return buildQueueStateRecord(
    round,
    {
      totalCapacity: getRoundCapacity(round).totalCapacity,
      maxActiveSessions: getMaxActiveSessions(schoolData),
      queueEnabled: isQueueEnabled(schoolData)
    },
    existing
  );
}

async function loadQueueLiveMetrics(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  schoolId: string,
  round: AdmissionRoundConfig,
  schoolData: admin.firestore.DocumentData
): Promise<QueueLiveMetrics> {
  const { totalCapacity } = getRoundCapacity(round);
  const [activeReservationsSnapshot, eligibleEntriesSnapshot, registrationsSnapshot] = await Promise.all([
    transaction.get(
      reservationsRef(db, schoolId)
        .where('roundId', '==', round.id)
        .where('status', 'in', ACTIVE_RESERVATION_STATUSES)
    ),
    transaction.get(
      queueEntriesRef(db, schoolId)
        .where('roundId', '==', round.id)
        .where('status', '==', 'eligible')
    ),
    transaction.get(
      registrationsRef(db, schoolId)
        .where('admissionRoundId', '==', round.id)
        .where('status', 'in', ['confirmed', 'waitlisted'])
    )
  ]);

  const activeReservationCount = activeReservationsSnapshot.size;
  const pendingAdmissionCount = eligibleEntriesSnapshot.size;
  let confirmedCount = 0;
  let waitlistedCount = 0;
  registrationsSnapshot.forEach((doc) => {
    const status = doc.get('status');
    if (status === 'confirmed') {
      confirmedCount += 1;
      return;
    }
    if (status === 'waitlisted') {
      waitlistedCount += 1;
    }
  });

  return {
    activeReservationCount,
    pendingAdmissionCount,
    confirmedCount,
    waitlistedCount,
    availableCapacity: Math.max(0, totalCapacity - confirmedCount - waitlistedCount - activeReservationCount)
  };
}

function getAuditLogCollection(db: admin.firestore.Firestore, schoolId: string) {
  return db.collection(`schools/${schoolId}/adminAuditLogs`);
}

async function loadEntriesForPromotion(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  schoolId: string,
  roundId: string,
  fromNumber: number,
  targetCount: number
) {
  if (targetCount <= 0) {
    return [] as admin.firestore.QueryDocumentSnapshot[];
  }

  const snapshot = await transaction.get(
    queueEntriesRef(db, schoolId)
      .where('roundId', '==', roundId)
      .where('status', '==', 'waiting')
      .where('number', '>', fromNumber)
      .orderBy('number', 'asc')
      .limit(targetCount)
  );

  return snapshot.docs;
}

function promoteEligibleEntries(
  transaction: admin.firestore.Transaction,
  docs: admin.firestore.QueryDocumentSnapshot[],
  now: number
) {
  docs.forEach((doc) => {
    transaction.set(
      doc.ref,
      {
        status: 'eligible',
        eligibleAt: now,
        updatedAt: now
      },
      { merge: true }
    );
  });

  return docs.length;
}

function makeRequestLock(
  type: RequestLockDoc['type'],
  userId: string,
  result: Record<string, any>
): RequestLockDoc {
  const now = Date.now();
  return {
    type,
    userId,
    createdAt: now,
    updatedAt: now,
    result
  };
}

async function getExistingRequestResult(
  db: admin.firestore.Firestore,
  schoolId: string,
  requestId: string
) {
  const snapshot = await requestLockRef(db, schoolId, requestId).get();
  if (!snapshot.exists) return null;
  return (snapshot.data() as RequestLockDoc).result;
}

function queueIssuerRef(schoolId: string, roundId: string) {
  return admin.database().ref(`queueIssuer/${schoolId}/${roundId}`);
}

async function issueQueueNumberFromRtdb(
  schoolId: string,
  roundId: string,
  userId: string,
  now: number,
  queueJoinLimit: number
) {
  const issuerRef = queueIssuerRef(schoolId, roundId);
  const assignmentRef = issuerRef.child(`assignments/${userId}`);

  // 1. Fast path: check if user already has an assignment (simple read, no tx)
  const existingSnapshot = await assignmentRef.get();
  if (existingSnapshot.exists() && existingSnapshot.val()?.number) {
    return { number: Number(existingSnapshot.val().number), reused: true };
  }

   // 2. Acquire a per-user issuing lock before touching the global counter.
   //    This keeps duplicate in-flight requests from burning extra numbers
   //    for the same uid while preserving the low-contention counter path.
  const assignmentLock = await assignmentRef.transaction((currentValue) => {
    if (currentValue?.number) {
      return; // already assigned
    }
    if (currentValue?.status === 'issuing') {
      // Override stale locks left by crashed/timed-out function instances.
      // The startedAt field lets us distinguish a genuinely in-flight request
      // from one that will never complete.
      const lockAgeMs = now - (currentValue.startedAt || 0);
      if (lockAgeMs > 30_000) {
        return { status: 'issuing', startedAt: now };
      }
      return; // another request is currently issuing
    }
    return {
      status: 'issuing',
      startedAt: now
    };
  });

  if (!assignmentLock.committed) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const retrySnapshot = await assignmentRef.get();
      if (retrySnapshot.exists() && retrySnapshot.val()?.number) {
        return {
          number: Number(retrySnapshot.val().number),
          reused: true
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new functions.https.HttpsError(
      'aborted',
      '같은 사용자에 대한 대기번호 발급이 진행 중입니다. 잠시 후 다시 시도해 주세요.'
    );
  }

  // 3. Lightweight transaction on just the counter (not the entire object).
  //    Previously the transaction read/wrote the full assignments map, causing
  //    O(N²) bandwidth under concurrency as the object grew.
  let issuedNumber: number | null = null;
  let limitReached = false;

  try {
    const counterRef = issuerRef.child('nextNumber');
    const result = await counterRef.transaction((currentNumber) => {
      // Reset closure variables on each retry to prevent stale values
      // from a previous invocation leaking into the final result.
      limitReached = false;
      issuedNumber = null;

      const nextNumber = Number(currentNumber || 0) + 1;
      if (nextNumber > queueJoinLimit) {
        limitReached = true;
        return; // abort transaction
      }
      issuedNumber = nextNumber;
      return nextNumber;
    });

    if (limitReached) {
      await assignmentRef.remove();
      throw makeJoinQueueError(
        '대기열이 운영 상한에 도달하여 마감되었습니다.',
        'QUEUE_CLOSED',
        { roundId, queueJoinLimit }
      );
    }

    if (result.committed && issuedNumber != null) {
      // 4. Replace the issuing lock with the final assignment.
      await assignmentRef.set({ number: issuedNumber, assignedAt: now });
      return { number: issuedNumber, reused: false };
    }

    // Fallback: another request for this user may have raced and written an assignment
    const retrySnapshot = await assignmentRef.get();
    if (retrySnapshot.exists() && retrySnapshot.val()?.number) {
      return {
        number: Number(retrySnapshot.val().number),
        reused: true
      };
    }

    await assignmentRef.remove();
    throw new functions.https.HttpsError('aborted', '대기번호 발급 중 충돌이 발생했습니다. 다시 시도해 주세요.');
  } catch (error) {
    const latestSnapshot = await assignmentRef.get();
    if (latestSnapshot.exists() && latestSnapshot.val()?.status === 'issuing') {
      await assignmentRef.remove().catch(() => undefined);
    }
    throw error;
  }
}

async function clearQueueNumberFromRtdb(schoolId: string, roundId: string, userId: string) {
  await queueIssuerRef(schoolId, roundId).child(`assignments/${userId}`).remove();
}

async function issueQueueNumber(
  schoolId: string,
  roundId: string,
  userId: string,
  now: number,
  queueJoinLimit: number
) {
  return issueQueueNumberFromRtdb(schoolId, roundId, userId, now, queueJoinLimit);
}

async function clearQueueNumber(schoolId: string, roundId: string, userId: string) {
  await clearQueueNumberFromRtdb(schoolId, roundId, userId);
}

async function resetQueueIssuerState(schoolId: string, roundId: string) {
  await queueIssuerRef(schoolId, roundId).remove();
}

async function advanceQueueForSchool(
  db: admin.firestore.Firestore,
  schoolId: string,
  round: AdmissionRoundConfig,
  options?: { now?: number }
) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const stateRef = queueStateRef(db, schoolId, round.id);
  const now = options?.now ?? Date.now();

  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, stateSnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(stateRef)
    ]);

    if (!schoolSnapshot.exists) {
      return 0;
    }

    const schoolData = schoolSnapshot.data()!;
    if (!isQueueEnabled(schoolData)) {
      return 0;
    }

    const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);

    if (queueState.availableCapacity <= 0 || getAvailableWriterSlots(queueState) <= 0) {
      return 0;
    }

    // Compute headroom from capacity and session limits only — do NOT rely on
    // lastAssignedNumber for the waiting count. Since joinQueue no longer
    // updates queueState, lastAssignedNumber can be stale. Instead, we query
    // queueEntries directly and let the actual docs determine the advance count.
    const headroom = Math.min(
      queueState.availableCapacity,
      Math.max(0, queueState.maxActiveSessions - queueState.activeReservationCount - queueState.pendingAdmissionCount)
    );
    if (headroom <= 0) {
      return 0;
    }

    const promotionDocs = await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, headroom);
    const promotedCount = promoteEligibleEntries(transaction, promotionDocs, now);
    if (promotedCount <= 0) {
      return 0;
    }

    // Reconcile lastAssignedNumber from the highest promoted entry number
    const maxPromotedNumber = Math.max(
      queueState.lastAssignedNumber,
      ...promotionDocs.map(doc => Number((doc.data() as QueueEntryDoc).number || 0))
    );

    transaction.set(stateRef, {
      ...queueState,
      pendingAdmissionCount: queueState.pendingAdmissionCount + promotedCount,
      currentNumber: queueState.currentNumber + promotedCount,
      lastAssignedNumber: maxPromotedNumber,
      lastAdvancedAt: now,
      updatedAt: now
    }, { merge: true });

    return promotedCount;
  });
}

async function ensureEligibleEntryVisibleInQueueState(
  db: admin.firestore.Firestore,
  schoolId: string,
  round: AdmissionRoundConfig,
  entry: Pick<QueueEntryDoc, 'status' | 'number'>
) {
  if (entry.status !== 'eligible' || entry.number == null) {
    return false;
  }

  const stateRef = queueStateRef(db, schoolId, round.id);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, stateSnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(stateRef)
    ]);

    if (!schoolSnapshot.exists) {
      return false;
    }

    const schoolData = schoolSnapshot.data()!;
    const queueState = buildQueueStateDoc(
      schoolData,
      round,
      stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null
    );

    if (queueState.currentNumber >= entry.number) {
      return false;
    }

    transaction.set(stateRef, {
      ...queueState,
      currentNumber: entry.number,
      lastAdvancedAt: now,
      updatedAt: now
    }, { merge: true });

    return true;
  });
}

async function assertAdminAccessToSchool(db: admin.firestore.Firestore, uid: string, schoolId: string) {
  const adminSnapshot = await db.doc(`admins/${uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData) {
    throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다.');
  }
  if (adminData.role === 'MASTER') {
    return adminData;
  }
  if (adminData.role === 'SCHOOL' && adminData.assignedSchoolId === schoolId) {
    return adminData;
  }
  throw new functions.https.HttpsError('permission-denied', '해당 학교에 대한 접근 권한이 없습니다.');
}

async function recalculateQueueState(db: admin.firestore.Firestore, schoolId: string) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const schoolSnapshot = await schoolRef.get();
  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
  }

  const schoolData = schoolSnapshot.data()!;
  const round = getResolvedAdmissionRound(schoolData);
  const stateRef = queueStateRef(db, schoolId, round.id);
  const existingState = (await stateRef.get()).data() as Partial<QueueStateDoc> | undefined;
  const [activeReservationsSnapshot, queueEntriesSnapshot, registrationsSnapshot] = await Promise.all([
    reservationsRef(db, schoolId)
      .where('roundId', '==', round.id)
      .where('status', 'in', ['reserved', 'processing'])
      .get(),
    queueEntriesRef(db, schoolId).where('roundId', '==', round.id).get(),
    registrationsRef(db, schoolId)
      .where('admissionRoundId', '==', round.id)
      .where('status', 'in', ['confirmed', 'waitlisted'])
      .get()
  ]);

  const activeReservationCount = activeReservationsSnapshot.size;
  let lastAssignedNumber = 0;
  let currentNumber = Math.max(0, Number(existingState?.currentNumber ?? 0));
  let pendingAdmissionCount = 0;

  queueEntriesSnapshot.forEach((doc) => {
    const data = doc.data() as QueueEntryDoc;
    lastAssignedNumber = Math.max(lastAssignedNumber, Number(data.number || 0));
    if (
      Number(data.number || 0) <= currentNumber &&
      !data.activeReservationId &&
      data.status !== 'consumed' &&
      data.status !== 'expired'
    ) {
      pendingAdmissionCount += 1;
    }
  });
  currentNumber = Math.min(currentNumber, lastAssignedNumber);

  let confirmedCount = 0;
  let waitlistedCount = 0;
  registrationsSnapshot.forEach((doc) => {
    const status = doc.get('status');
    if (status === 'confirmed') {
      confirmedCount += 1;
      return;
    }
    if (status === 'waitlisted') {
      waitlistedCount += 1;
    }
  });

  const nextState = buildQueueStateDoc(schoolData, round, {
    ...(existingState || {}),
    currentNumber,
    lastAssignedNumber,
    activeReservationCount,
    pendingAdmissionCount,
    confirmedCount,
    waitlistedCount,
    updatedAt: Date.now()
  });

  await setQueueStateBestEffort(stateRef, nextState, 'recalculateQueueState');
  return nextState;
}

async function cleanupStaleQueueEntriesForSchool(
  db: admin.firestore.Firestore,
  schoolId: string,
  round: AdmissionRoundConfig,
  options?: { now?: number; limitPerStatus?: number }
) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const stateRef = queueStateRef(db, schoolId, round.id);
  const now = options?.now ?? Date.now();
  const limitPerStatus = options?.limitPerStatus ?? 25;
  const waitingCutoff = now - WAITING_PRESENCE_TIMEOUT_MS;
  const eligibleCutoff = now - ELIGIBLE_PRESENCE_TIMEOUT_MS;

  const [schoolSnapshot, waitingSnapshot, eligibleSnapshot] = await Promise.all([
    schoolRef.get(),
    queueEntriesRef(db, schoolId)
      .where('roundId', '==', round.id)
      .where('status', '==', 'waiting')
      .where('lastSeenAt', '<=', waitingCutoff)
      .limit(limitPerStatus)
      .get(),
    queueEntriesRef(db, schoolId)
      .where('roundId', '==', round.id)
      .where('status', '==', 'eligible')
      .where('lastSeenAt', '<=', eligibleCutoff)
      .limit(limitPerStatus)
      .get()
  ]);

  if (!schoolSnapshot.exists || (waitingSnapshot.empty && eligibleSnapshot.empty)) {
    return { expiredWaiting: 0, expiredEligible: 0, advancedCount: 0, clearedUserIds: [] as string[] };
  }

  const schoolData = schoolSnapshot.data()!;

  return db.runTransaction(async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? (stateSnapshot.data() as QueueStateDoc) : null);
    let pendingAdmissionCount = queueState.pendingAdmissionCount;
    let expiredWaiting = 0;
    let expiredEligible = 0;
    const staleWaitingEntries: Array<{
      ref: admin.firestore.DocumentReference;
      queueIdentityHash: string | null;
    }> = [];
    const staleEligibleEntries: Array<{
      ref: admin.firestore.DocumentReference;
      queueIdentityHash: string | null;
    }> = [];
    const clearedUserIds = new Set<string>();

    for (const doc of waitingSnapshot.docs) {
      const freshSnapshot = await transaction.get(doc.ref);
      if (!freshSnapshot.exists) {
        continue;
      }

      const freshEntry = freshSnapshot.data() as QueueEntryDoc;
      if (
        freshEntry.roundId !== round.id ||
        freshEntry.status !== 'waiting' ||
        Number(freshEntry.lastSeenAt || 0) > waitingCutoff
      ) {
        continue;
      }

      staleWaitingEntries.push({
        ref: doc.ref,
        queueIdentityHash: freshEntry.queueIdentityHash || null
      });
      clearedUserIds.add(freshEntry.userId);
      expiredWaiting += 1;
      if (staleWaitingEntries.length >= limitPerStatus) {
        break;
      }
    }

    for (const doc of eligibleSnapshot.docs) {
      const freshSnapshot = await transaction.get(doc.ref);
      if (!freshSnapshot.exists) {
        continue;
      }

      const freshEntry = freshSnapshot.data() as QueueEntryDoc;
      if (
        freshEntry.roundId !== round.id ||
        freshEntry.status !== 'eligible' ||
        Number(freshEntry.lastSeenAt || 0) > eligibleCutoff
      ) {
        continue;
      }

      staleEligibleEntries.push({
        ref: doc.ref,
        queueIdentityHash: freshEntry.queueIdentityHash || null
      });
      clearedUserIds.add(freshEntry.userId);
      pendingAdmissionCount = Math.max(0, pendingAdmissionCount - 1);
      expiredEligible += 1;
      if (staleEligibleEntries.length >= limitPerStatus) {
        break;
      }
    }

    const nextState = {
      ...queueState,
      pendingAdmissionCount,
      updatedAt: now
    };
    const nextAdvance = getQueueAdvanceAmount(nextState, expiredEligible);
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, nextState.currentNumber, nextAdvance)
      : [];

    staleWaitingEntries.forEach(({ ref }) => {
      transaction.set(ref, {
        status: 'expired',
        eligibleAt: null,
        activeReservationId: null,
        updatedAt: now
      }, { merge: true });
    });

    for (const { queueIdentityHash } of staleWaitingEntries) {
      if (queueIdentityHash) {
        transaction.delete(queueIdentityLockRef(db, schoolId, round.id, queueIdentityHash));
      }
    }

    staleEligibleEntries.forEach(({ ref }) => {
      transaction.set(ref, {
        status: 'expired',
        eligibleAt: null,
        activeReservationId: null,
        updatedAt: now
      }, { merge: true });
    });

    for (const { queueIdentityHash } of staleEligibleEntries) {
      if (queueIdentityHash) {
        transaction.delete(queueIdentityLockRef(db, schoolId, round.id, queueIdentityHash));
      }
    }

    transaction.set(
      stateRef,
      {
        ...nextState,
        pendingAdmissionCount: pendingAdmissionCount + nextAdvance,
        currentNumber: nextState.currentNumber + nextAdvance,
        lastAdvancedAt: nextAdvance > 0 ? now : nextState.lastAdvancedAt,
        updatedAt: now
      },
      { merge: true }
    );

    if (nextAdvance > 0) {
      const actualAdvance = promoteEligibleEntries(transaction, promotionDocs, now);

      transaction.set(
        stateRef,
        {
          ...nextState,
          pendingAdmissionCount: pendingAdmissionCount + actualAdvance,
          currentNumber: nextState.currentNumber + actualAdvance,
          lastAdvancedAt: actualAdvance > 0 ? now : nextState.lastAdvancedAt,
          updatedAt: now
        },
        { merge: true }
      );

      return {
        expiredWaiting,
        expiredEligible,
        advancedCount: actualAdvance,
        clearedUserIds: Array.from(clearedUserIds)
      };
    }

    return {
      expiredWaiting,
      expiredEligible,
      advancedCount: 0,
      clearedUserIds: Array.from(clearedUserIds)
    };
  });
}

async function expireReservationDocument(
  db: admin.firestore.Firestore,
  schoolId: string,
  reservationId: string,
  userId: string | null
) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const reservationRef = reservationsRef(db, schoolId).doc(reservationId);
  const now = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const [schoolSnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(reservationRef)
    ]);

    if (!schoolSnapshot.exists || !reservationSnapshot.exists) {
      return { expired: false, clearedUserId: null as string | null };
    }

    const reservation = reservationSnapshot.data() as ReservationDoc;
    const round = getRoundById(schoolSnapshot.data()!, reservation.roundId) || getResolvedAdmissionRound(schoolSnapshot.data()!);
    const stateRef = queueStateRef(db, schoolId, round.id);
    const queueEntryRef = queueEntriesRef(db, schoolId).doc(reservation.userId);
    const [stateSnapshot, queueEntrySnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(queueEntryRef)
    ]);
    if (userId && reservation.userId !== userId) {
      throw new functions.https.HttpsError('permission-denied', '해당 세션에 대한 접근 권한이 없습니다.');
    }
    if (reservation.status === 'expired' || reservation.status === 'cancelled' || reservation.status === 'confirmed') {
      return { expired: false, clearedUserId: null as string | null };
    }

    const schoolData = schoolSnapshot.data()!;
    const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);
    const activeReservationCount = Math.max(0, queueState.activeReservationCount - 1);
    const nextState = {
      ...queueState,
      activeReservationCount,
      availableCapacity: Math.max(0, queueState.totalCapacity - queueState.confirmedCount - queueState.waitlistedCount - activeReservationCount),
      updatedAt: now
    };
    const nextAdvance = getQueueAdvanceAmount(nextState, 1);
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, nextState.currentNumber, nextAdvance)
      : [];

    const actualAdvance = promoteEligibleEntries(transaction, promotionDocs, now);
    transaction.set(stateRef, {
      ...nextState,
      pendingAdmissionCount: nextState.pendingAdmissionCount + actualAdvance,
      currentNumber: nextState.currentNumber + actualAdvance,
      lastAdvancedAt: actualAdvance > 0 ? now : nextState.lastAdvancedAt
    }, { merge: true });
    transaction.update(reservationRef, {
      status: 'expired',
      expiredAt: now,
      updatedAt: now,
      processingAt: null
    });
    if (reservation.queueIdentityHash) {
      transaction.delete(queueIdentityLockRef(db, schoolId, round.id, reservation.queueIdentityHash));
    }

    if (queueEntryRef && queueEntrySnapshot?.exists) {
      const currentEntry = queueEntrySnapshot.data() as QueueEntryDoc;
      transaction.set(queueEntryRef, {
        ...(currentEntry.roundId === round.id
          ? {
              status: 'expired',
              eligibleAt: null,
              activeReservationId: null,
              updatedAt: now,
              lastSeenAt: now
            }
          : {})
      }, { merge: true });
    }

    return { expired: true, clearedUserId: reservation.userId, clearedRoundId: round.id };
  });

  if (result.expired && result.clearedUserId && (result as any).clearedRoundId) {
    await clearQueueNumber(schoolId, (result as any).clearedRoundId, result.clearedUserId);
  }

  return result;
}

export const joinQueue = hotPathRuntime.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, roundId, queueIdentity } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }
  const sanitizedIdentity = sanitizeQueueIdentity(queueIdentity);

  // Parallelize all pre-checks: idempotency, rate limits, and data reads.
  // This eliminates ~300-600ms of sequential await overhead on the hot path.
  const ipIdentifier = getRateLimitIdentifier(rawRequest, `joinQueue_ip_${auth.uid}`);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);

  const [existingResult, userRateLimit, ipRateLimit, schoolSnapshot, entrySnapshot] = await Promise.all([
    getExistingRequestResult(db, schoolId, requestId),
    checkRateLimit(db, `joinQueue_${auth.uid}`, 5, 60000),
    checkRateLimit(db, `joinQueue_${schoolId}_${ipIdentifier}`, 120, 60000),
    schoolRef.get(),
    entryRef.get()
  ]);

  if (existingResult) {
    return existingResult;
  }
  if (!userRateLimit.allowed) {
    throw new functions.https.HttpsError("resource-exhausted", `요청이 너무 빈번합니다. ${userRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }
  if (!ipRateLimit.allowed) {
    throw new functions.https.HttpsError("resource-exhausted", `요청이 너무 빈번합니다. ${ipRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }
  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "학교 정보를 찾을 수 없습니다.");
  }

  const schoolData = schoolSnapshot.data()!;
  const round = roundId ? (getRoundById(schoolData, roundId) || getResolvedAdmissionRound(schoolData)) : getResolvedAdmissionRound(schoolData);
  const identityLockRef = queueIdentityLockRef(db, schoolId, round.id, sanitizedIdentity.identityHash);
  const stateRef = queueStateRef(db, schoolId, round.id);
  const lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
  const stateSnapshot = await stateRef.get();
  assertSchoolOpen(schoolData, round);
  if (!isQueueEnabled(schoolData)) {
    const directResult = {
      success: true,
      number: null,
      currentNumber: 0,
      lastAssignedNumber: 0,
      status: 'direct'
    };
    await lockRef.set(makeRequestLock('joinQueue', auth.uid, directResult));
    return directResult;
  }

  const now = Date.now();
  const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? (stateSnapshot.data() as QueueStateDoc) : null);
  const existingEntry = entrySnapshot.exists ? (entrySnapshot.data() as QueueEntryDoc) : null;
  const queueJoinLimit = getQueueJoinLimit(round);
  const totalCapacity = Number(queueState.totalCapacity || 0);

  if (existingEntry && existingEntry.roundId === round.id && existingEntry.status !== 'expired') {
    const existingJoinResult = {
      success: true,
      accepted: true,
      number: existingEntry.number,
      currentNumber: queueState.currentNumber,
      lastAssignedNumber: Math.max(queueState.lastAssignedNumber, Number(existingEntry.number || 0)),
      status: existingEntry.status
    };

    await Promise.all([
      entryRef.set(
        {
          lastSeenAt: now,
          updatedAt: now
        },
        { merge: true }
      ),
      identityLockRef.set({
        roundId: round.id,
        userId: auth.uid,
        studentName: existingEntry.applicantName || sanitizedIdentity.studentName,
        phoneLast4: existingEntry.applicantPhoneLast4 || sanitizedIdentity.phoneLast4,
        status: existingEntry.status === 'eligible' ? 'eligible' : 'waiting',
        queueNumber: existingEntry.number,
        sessionId: null,
        registrationId: null,
        updatedAt: now
      } as QueueIdentityLockDoc, { merge: true }),
      lockRef.set(makeRequestLock('joinQueue', auth.uid, existingJoinResult))
    ]);

    return existingJoinResult;
  }

  if (existingEntry?.status === 'expired' && existingEntry.roundId === round.id) {
    await clearQueueNumber(schoolId, round.id, auth.uid);
  }

  if (existingEntry && existingEntry.roundId && existingEntry.roundId !== round.id) {
    await clearQueueNumber(schoolId, existingEntry.roundId, auth.uid).catch(() => undefined);
  }

  if (totalCapacity <= 0 || queueState.availableCapacity <= 0) {
    throw makeJoinQueueError(
      '현재 신청 가능한 정원이 없습니다.',
      'CAPACITY_FULL',
      { roundId: round.id, queueJoinLimit }
    );
  }

  const issued = await issueQueueNumber(schoolId, round.id, auth.uid, now, queueJoinLimit);

  try {
    // NOTE: stateRef is intentionally excluded from this transaction to avoid
    // single-document write contention when hundreds of users join simultaneously.
    // queueState is reconciled by the scheduled autoAdvanceQueue job instead of
    // being updated on every join.
    const joinResult = await db.runTransaction(async (transaction) => {
      const [freshEntrySnapshot, freshLockSnapshot, freshIdentityLockSnapshot] = await Promise.all([
        transaction.get(entryRef),
        transaction.get(lockRef),
        transaction.get(identityLockRef)
      ]);

      if (freshLockSnapshot.exists) {
        return (freshLockSnapshot.data() as RequestLockDoc).result;
      }

      if (freshEntrySnapshot.exists) {
        const freshEntry = freshEntrySnapshot.data() as QueueEntryDoc;
        if (freshEntry.roundId === round.id && freshEntry.status !== 'expired' && freshEntry.number != null) {
          const alreadyJoinedResult = {
            success: true,
            accepted: true,
            number: freshEntry.number,
            currentNumber: queueState.currentNumber,
            lastAssignedNumber: Math.max(queueState.lastAssignedNumber, Number(freshEntry.number || 0)),
            status: freshEntry.status
          };
          transaction.set(lockRef, makeRequestLock('joinQueue', auth.uid, alreadyJoinedResult));
          return alreadyJoinedResult;
        }
      }

      if (freshIdentityLockSnapshot.exists) {
        const identityLock = freshIdentityLockSnapshot.data() as QueueIdentityLockDoc;
        if (
          identityLock.status === 'confirmed' ||
          identityLock.status === 'waitlisted' ||
          (identityLock.userId !== auth.uid && ACTIVE_QUEUE_ENTRY_STATUSES.includes(identityLock.status as QueueEntryStatus)) ||
          (identityLock.userId !== auth.uid && identityLock.status === 'reserved')
        ) {
          const statusMessage =
            identityLock.status === 'reserved'
              ? `${buildQueueIdentityInUseMessage(sanitizedIdentity.studentName, sanitizedIdentity.phoneLast4)} 신청서 작성 시간이 아직 남아 있습니다.`
              : identityLock.status === 'confirmed' || identityLock.status === 'waitlisted'
                ? `${sanitizedIdentity.studentName} (${sanitizedIdentity.phoneLast4}) 정보로 이미 이전 차수에서 신청이 완료되어 다른 차수에 지원할 수 없습니다. 조회 페이지에서 결과를 확인해 주세요.`
                : buildQueueIdentityInUseMessage(sanitizedIdentity.studentName, sanitizedIdentity.phoneLast4);
          throw new functions.https.HttpsError('already-exists', statusMessage);
        }
      }

      const nextLastAssignedNumber = Math.max(queueState.lastAssignedNumber, issued.number);
      transaction.set(
        entryRef,
        {
          roundId: round.id,
          roundLabel: round.label,
          userId: auth.uid,
          queueIdentityHash: sanitizedIdentity.identityHash,
          applicantName: sanitizedIdentity.studentName,
          applicantPhoneLast4: sanitizedIdentity.phoneLast4,
          number: issued.number,
          status: 'waiting',
          eligibleAt: null,
          joinedAt: now,
          lastSeenAt: now,
          activeReservationId: null,
          updatedAt: now
        } as QueueEntryDoc,
        { merge: true }
      );
      transaction.set(identityLockRef, {
        roundId: round.id,
        userId: auth.uid,
        studentName: sanitizedIdentity.studentName,
        phoneLast4: sanitizedIdentity.phoneLast4,
        status: 'waiting',
        queueNumber: issued.number,
        sessionId: null,
        registrationId: null,
        updatedAt: now
      } as QueueIdentityLockDoc, { merge: true });

      const createdJoinResult = {
        success: true,
        accepted: true,
        number: issued.number,
        currentNumber: queueState.currentNumber,
        lastAssignedNumber: nextLastAssignedNumber,
        status: 'waiting'
      };
      transaction.set(lockRef, makeRequestLock('joinQueue', auth.uid, createdJoinResult));
      return createdJoinResult;
    });

    // Best-effort immediate advancement so users do not wait for the 1-minute
    // scheduler tick when there is already available admission headroom.
    void advanceQueueForSchool(db, schoolId, round, { now }).catch((error) => {
      functions.logger.warn('[joinQueue] best-effort advance failed', {
        schoolId,
        roundId: round.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    // queueState is still reconciled by the scheduled autoAdvanceQueue job.
    return joinResult;
  } catch (error) {
    if (!issued.reused) {
      await clearQueueNumber(schoolId, round.id, auth.uid).catch(() => undefined);
    }
    throw error;
  }
});

export const startRegistrationSession = standardRuntime.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, roundId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }

  const existingResult = await getExistingRequestResult(db, schoolId, requestId);
  if (existingResult) {
    return existingResult;
  }

  const rateLimit = await checkRateLimit(
    db,
    getRateLimitIdentifier(rawRequest, `startRegistration_${auth.uid}`),
    5,
    60000
  );
  if (!rateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${rateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }

  const schoolRef = db.doc(`schools/${schoolId}`);
  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const reservationCollectionRef = reservationsRef(db, schoolId);
  const reservationId = `reservation_${Date.now()}_${randomBytes(8).toString('hex')}`;
  const reservationRef = reservationCollectionRef.doc(reservationId);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [schoolSnapshot, entrySnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(entryRef)
    ]);
    if (!schoolSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
    }

    const schoolData = schoolSnapshot.data()!;
    let round = roundId ? (getRoundById(schoolData, roundId) || getResolvedAdmissionRound(schoolData)) : getResolvedAdmissionRound(schoolData);
    let stateRef = queueStateRef(db, schoolId, round.id);
    let lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
    let existingState = (await stateRef.get()).data() as QueueStateDoc | undefined;
    let lockSnapshot = await transaction.get(lockRef);
    if (lockSnapshot.exists) {
      return {
        response: (lockSnapshot.data() as RequestLockDoc).result
      };
    }
    assertSchoolOpen(schoolData, round);

    const activeReservationQuery = reservationCollectionRef
      .where('userId', '==', auth.uid)
      .where('status', 'in', ['reserved', 'processing'])
      .limit(1);
    const activeReservationSnapshot = await transaction.get(activeReservationQuery);
    if (!activeReservationSnapshot.empty) {
      const existingReservationDoc = activeReservationSnapshot.docs[0];
      const existingReservation = existingReservationDoc.data() as ReservationDoc;
      const result = {
        success: true,
        sessionId: existingReservationDoc.id,
        expiresAt: existingReservation.expiresAt,
        queueNumber: existingReservation.queueNumber ?? null
      };
      transaction.set(lockRef, makeRequestLock('startRegistration', auth.uid, result));
      return { response: result };
    }

    let queueState = buildQueueStateDoc(schoolData, round, existingState ?? null);

    const now = Date.now();
    let queueNumber: number | null = null;
    let queueIdentityHash: string | null = null;
    let applicantName: string | null = null;
    let applicantPhoneLast4: string | null = null;

    if (isQueueEnabled(schoolData)) {
      if (!entrySnapshot.exists) {
        throw new functions.https.HttpsError('failed-precondition', '먼저 대기열에 입장해 주세요.');
      }

      const queueEntry = entrySnapshot.data() as QueueEntryDoc;
      queueIdentityHash = queueEntry.queueIdentityHash || null;
      applicantName = queueEntry.applicantName || null;
      applicantPhoneLast4 = queueEntry.applicantPhoneLast4 || null;
      if (queueEntry.roundId !== round.id) {
        round = getRoundById(schoolData, queueEntry.roundId) || round;
        stateRef = queueStateRef(db, schoolId, round.id);
        lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
        existingState = (await stateRef.get()).data() as QueueStateDoc | undefined;
        lockSnapshot = await transaction.get(lockRef);
        if (lockSnapshot.exists) {
          return {
            response: (lockSnapshot.data() as RequestLockDoc).result
          };
        }
        queueState = buildQueueStateDoc(schoolData, round, existingState ?? null);
      }
      queueNumber = queueEntry.number;
      if (queueEntry.status !== 'eligible' || queueEntry.number == null) {
        throw new functions.https.HttpsError('failed-precondition', '대기열 입장 자격이 아닙니다.');
      }

    }

    const liveMetrics = await loadQueueLiveMetrics(transaction, db, schoolId, round, schoolData);
    queueState = buildQueueStateDoc(
      schoolData,
      round,
      existingState
        ? {
            ...existingState,
            ...liveMetrics
          }
        : liveMetrics
    );
    if (liveMetrics.availableCapacity <= 0) {
      throw new functions.https.HttpsError('resource-exhausted', '현재 이용 가능한 접수 인원이 없습니다.');
    }
    if (liveMetrics.activeReservationCount >= queueState.maxActiveSessions) {
      throw new functions.https.HttpsError('resource-exhausted', '현재 동시 접수 가능한 인원이 가득 찼습니다. 잠시 후 다시 시도해 주세요.');
    }

    const nextAdvance = getAdvanceLimitFromCounts(
      queueState,
      {
        ...liveMetrics,
        activeReservationCount: liveMetrics.activeReservationCount + 1,
        pendingAdmissionCount: Math.max(0, liveMetrics.pendingAdmissionCount - (isQueueEnabled(schoolData) ? 1 : 0)),
        availableCapacity: Math.max(0, liveMetrics.availableCapacity - 1)
      },
      1
    );
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, nextAdvance)
      : [];
    const promotedCount = promoteEligibleEntries(transaction, promotionDocs, now);
    const maxPromotedNumber = Math.max(
      queueState.lastAssignedNumber,
      ...promotionDocs.map((doc) => Number((doc.data() as QueueEntryDoc).number || 0))
    );

    if (isQueueEnabled(schoolData)) {
      transaction.set(entryRef, {
        status: 'eligible',
        eligibleAt: now,
        activeReservationId: reservationId,
        lastSeenAt: now,
        updatedAt: now
      }, { merge: true });
    }

    const activeSessionTimeoutMs = Number(schoolData.sessionTimeoutSettings?.activeSessionTimeoutMs || DEFAULT_SESSION_MS);
    const expiresAt = now + (activeSessionTimeoutMs > 0 ? activeSessionTimeoutMs : DEFAULT_SESSION_MS);
    transaction.set(reservationRef, {
      roundId: round.id,
      roundLabel: round.label,
      userId: auth.uid,
      queueIdentityHash,
      applicantName,
      applicantPhoneLast4,
      queueNumber,
      status: 'reserved',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      requestId,
      registrationId: null,
      finalStatus: null
    } as ReservationDoc);
    if (queueIdentityHash) {
      transaction.set(queueIdentityLockRef(db, schoolId, round.id, queueIdentityHash), {
        roundId: round.id,
        userId: auth.uid,
        studentName: applicantName || '',
        phoneLast4: applicantPhoneLast4 || '',
        status: 'reserved',
        queueNumber,
        sessionId: reservationId,
        registrationId: null,
        updatedAt: now
      } as QueueIdentityLockDoc, { merge: true });
    }
    const nextQueueState: QueueStateDoc = {
      ...queueState,
      activeReservationCount: liveMetrics.activeReservationCount + 1,
      pendingAdmissionCount: Math.max(0, liveMetrics.pendingAdmissionCount - (isQueueEnabled(schoolData) ? 1 : 0)) + promotedCount,
      confirmedCount: liveMetrics.confirmedCount,
      waitlistedCount: liveMetrics.waitlistedCount,
      availableCapacity: Math.max(0, liveMetrics.availableCapacity - 1),
      currentNumber: queueState.currentNumber + promotedCount,
      lastAssignedNumber: maxPromotedNumber,
      lastAdvancedAt: promotedCount > 0 ? now : queueState.lastAdvancedAt,
      updatedAt: now
    };

    const result = {
      success: true,
      sessionId: reservationId,
      expiresAt,
      queueNumber,
      roundId: round.id,
      roundLabel: round.label
    };
    transaction.set(lockRef, makeRequestLock('startRegistration', auth.uid, result));
    return {
      response: result,
      stateRefPath: stateRef.path,
      nextQueueState
    };
  });

  if (transactionResult.stateRefPath && transactionResult.nextQueueState) {
    await setQueueStateBestEffort(
      db.doc(transactionResult.stateRefPath),
      transactionResult.nextQueueState,
      'startRegistrationSession'
    );
  }

  return transactionResult.response;
});

export const getReservationSession = standardRuntime.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, sessionId } = data?.data || data;
  if (!schoolId || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId와 sessionId가 필요합니다.');
  }

  const [userRateLimit, ipRateLimit] = await Promise.all([
    checkRateLimit(db, `getReservationSession_${auth.uid}_${sessionId}`, 20, 60000),
    checkRateLimit(db, `getReservationSession_${schoolId}_${getRateLimitIdentifier(rawRequest, auth.uid)}`, 120, 60000)
  ]);
  if (!userRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${userRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }
  if (!ipRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${ipRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }

  const [reservationSnapshot, schoolSnapshot] = await Promise.all([
    reservationsRef(db, schoolId).doc(sessionId).get(),
    db.doc(`schools/${schoolId}`).get()
  ]);
  if (!reservationSnapshot.exists) {
    throw new functions.https.HttpsError('failed-precondition', '유효한 등록 세션이 아닙니다.');
  }

  const reservation = reservationSnapshot.data() as ReservationDoc;
  if (reservation.userId !== auth.uid) {
    throw new functions.https.HttpsError('permission-denied', '해당 세션에 대한 접근 권한이 없습니다.');
  }

  if (reservation.status === 'confirmed') {
    return {
      success: true,
      expiresAt: reservation.expiresAt,
      queueNumber: reservation.queueNumber ?? null,
      status: 'confirmed',
      registrationId: reservation.registrationId ?? null,
      roundId: reservation.roundId,
      roundLabel: reservation.roundLabel ?? null
    };
  }

  if (reservation.status !== 'reserved' && reservation.status !== 'processing') {
    throw new functions.https.HttpsError('failed-precondition', '유효한 등록 세션이 아닙니다.');
  }

  const schoolData = schoolSnapshot.data() || {};
  const gracePeriodMs = Number(schoolData.sessionTimeoutSettings?.gracePeriodMs || SESSION_SUBMIT_GRACE_MS);
  if (Date.now() > reservation.expiresAt + gracePeriodMs) {
    await expireReservationDocument(db, schoolId, sessionId, auth.uid);
    throw new functions.https.HttpsError('deadline-exceeded', '등록 세션이 만료되었습니다.');
  }

  return {
    success: true,
    expiresAt: reservation.expiresAt,
    queueNumber: reservation.queueNumber ?? null,
    status: reservation.status,
    roundId: reservation.roundId,
    roundLabel: reservation.roundLabel ?? null
  };
});

export const forceExpireSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, sessionId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId와 sessionId가 필요합니다.');
  }

  const existingResult = await getExistingRequestResult(db, schoolId, requestId);
  if (existingResult) {
    return existingResult;
  }

  const result = await expireReservationDocument(db, schoolId, sessionId, auth.uid);
  await requestLockRef(db, schoolId, requestId).set(makeRequestLock('forceExpireSession', auth.uid, { success: true, ...result }));
  return { success: true, ...result };
});

export const heartbeatQueuePresence = heartbeatRuntime.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId } = data?.data || data;
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }

  const [userRateLimit, ipRateLimit] = await Promise.all([
    checkRateLimit(db, `heartbeatQueuePresence_${auth.uid}_${schoolId}`, 30, 60000),
    checkRateLimit(db, `heartbeatQueuePresence_${schoolId}_${getRateLimitIdentifier(rawRequest, auth.uid)}`, 240, 60000)
  ]);
  if (!userRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${userRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }
  if (!ipRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${ipRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }

  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const now = Date.now();
  const entrySnapshot = await entryRef.get();

  if (entrySnapshot.exists) {
    const entry = entrySnapshot.data() as QueueEntryDoc;
    if (entry.status === 'waiting' || entry.status === 'eligible') {
      // Only update presence timestamp. Queue advancement and cleanup are
      // handled by scheduled autoAdvanceQueue / cleanupExpiredReservations
      // (every 1 minute). Removing them from heartbeat eliminates queueState
      // write contention (~3 transactions per heartbeat × N concurrent users).
      await entryRef.set(
        {
          lastSeenAt: now,
          updatedAt: now
        },
        { merge: true }
      );
    }
  }

  return { success: true };
});

const ALLOWED_FORM_FIELDS = [
  'studentName',
  'phone',
  'phoneLast4',
  'email',
  'studentId',
  'schoolName',
  'grade',
  'address',
  'agreedSms'
];

function sanitizeFormData(formData: any) {
  if (typeof formData !== 'object' || formData === null) {
    throw new functions.https.HttpsError('invalid-argument', '입력 데이터가 올바르지 않습니다.');
  }

  const sanitized: Record<string, any> = {};
  for (const key of ALLOWED_FORM_FIELDS) {
    if (formData[key] !== undefined) {
      sanitized[key] = formData[key];
    }
  }

  if (!sanitized.studentName || typeof sanitized.studentName !== 'string' || sanitized.studentName.trim().length === 0) {
    throw new functions.https.HttpsError('invalid-argument', '이름은 필수 입력 항목입니다.');
  }
  if (!sanitized.phone || !/^010\d{8}$/.test(String(sanitized.phone))) {
    throw new functions.https.HttpsError('invalid-argument', '휴대폰번호 형식이 올바르지 않습니다. (01000000000)');
  }

  sanitized.studentName = String(sanitized.studentName).trim().slice(0, 50);
  sanitized.phone = String(sanitized.phone).trim();
  sanitized.phoneLast4 = sanitized.phone.slice(-4);
  if (sanitized.schoolName) sanitized.schoolName = String(sanitized.schoolName).trim().slice(0, 100);
  if (sanitized.address) sanitized.address = String(sanitized.address).trim().slice(0, 200);
  if (sanitized.studentId) sanitized.studentId = String(sanitized.studentId).trim().slice(0, 20);
  if (sanitized.grade) sanitized.grade = String(sanitized.grade).trim().slice(0, 20);
  if (sanitized.email) sanitized.email = String(sanitized.email).trim().slice(0, 200);

  return sanitized;
}

function sanitizedFormDataQueueIdentityHash(formData: { studentName?: string; phone?: string } | Record<string, any>) {
  return buildQueueIdentityHash(formData.studentName, formData.phone);
}

export const confirmReservation = standardRuntime.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, sessionId, formData } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId || !sessionId || !formData) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId, sessionId, formData가 필요합니다.');
  }

  const existingResult = await getExistingRequestResult(db, schoolId, requestId);
  if (existingResult) {
    return existingResult;
  }

  const rateLimit = await checkRateLimit(
    db,
    getRateLimitIdentifier(rawRequest, `confirmReservation_${auth.uid}_${sessionId}`),
    5,
    60000
  );
  if (!rateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${rateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }

  const sanitizedFormData = sanitizeFormData(formData);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const reservationRef = reservationsRef(db, schoolId).doc(sessionId);
  const queueEntryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const registrationRef = db.doc(`schools/${schoolId}/registrations/${sessionId}`);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [schoolSnapshot, reservationSnapshot, queueEntrySnapshot, registrationSnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(reservationRef),
      transaction.get(queueEntryRef),
      transaction.get(registrationRef)
    ]);
    if (!schoolSnapshot.exists || !reservationSnapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', '유효한 등록 세션이 아닙니다.');
    }

    const reservation = reservationSnapshot.data() as ReservationDoc;
    const schoolData = schoolSnapshot.data()!;
    const round = getRoundById(schoolData, reservation.roundId) || getResolvedAdmissionRound(schoolData);
    const stateRef = queueStateRef(db, schoolId, round.id);
    const lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
    const [existingState, lockSnapshot] = await Promise.all([
      stateRef.get(),
      transaction.get(lockRef)
    ]);
    if (lockSnapshot.exists) {
      return {
        response: (lockSnapshot.data() as RequestLockDoc).result
      };
    }
    if (reservation.userId !== auth.uid) {
      throw new functions.https.HttpsError('permission-denied', '해당 세션에 대한 접근 권한이 없습니다.');
    }

    if (registrationSnapshot.exists || reservation.status === 'confirmed') {
      const existingRegistration = registrationSnapshot.data() as any;
      const result = {
        success: true,
        registrationId: registrationRef.id,
        status: existingRegistration?.status || reservation.finalStatus || 'confirmed',
        rank: existingRegistration?.rank ?? null
      };
      transaction.set(lockRef, makeRequestLock('confirmReservation', auth.uid, result));
      return { response: result };
    }

    const now = Date.now();
    if (reservation.status !== 'reserved' && reservation.status !== 'processing') {
      throw new functions.https.HttpsError('failed-precondition', '유효한 등록 세션이 아닙니다.');
    }
    const gracePeriodMs = Number(schoolData.sessionTimeoutSettings?.gracePeriodMs || SESSION_SUBMIT_GRACE_MS);
    if (now > reservation.expiresAt + gracePeriodMs) {
      throw new functions.https.HttpsError('deadline-exceeded', '등록 세션이 만료되었습니다.');
    }

    const queueIdentityHash = sanitizedFormDataQueueIdentityHash(sanitizedFormData);
    if (reservation.queueIdentityHash && reservation.queueIdentityHash !== queueIdentityHash) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        '대기열 입장에 사용한 이름과 휴대폰 번호로만 신청서를 제출할 수 있습니다.'
      );
    }

    const identityLockRef = queueIdentityLockRef(db, schoolId, round.id, queueIdentityHash);
    const identityLockSnapshot = await transaction.get(identityLockRef);
    if (identityLockSnapshot.exists) {
      const identityLock = identityLockSnapshot.data() as QueueIdentityLockDoc;
      if (
        identityLock.userId !== auth.uid &&
        (identityLock.status === 'confirmed' || identityLock.status === 'waitlisted' || identityLock.status === 'reserved')
      ) {
        throw new functions.https.HttpsError('already-exists', '이미 같은 휴대폰 번호로 진행 중인 신청이 있습니다.');
      }
    }

    const { maxCapacity, waitlistCapacity } = getRoundCapacity(round);
    const liveMetrics = await loadQueueLiveMetrics(transaction, db, schoolId, round, schoolData);
    const queueState = buildQueueStateDoc(
      schoolData,
      round,
      existingState.exists
        ? {
            ...(existingState.data() as QueueStateDoc),
            ...liveMetrics
          }
        : liveMetrics
    );

    let status: 'confirmed' | 'waitlisted' = 'confirmed';
    let rank: number | null = null;
    let nextConfirmedCount = liveMetrics.confirmedCount;
    let nextWaitlistedCount = liveMetrics.waitlistedCount;

    if (liveMetrics.confirmedCount < maxCapacity) {
      nextConfirmedCount += 1;
    } else if (liveMetrics.waitlistedCount < waitlistCapacity) {
      status = 'waitlisted';
      nextWaitlistedCount += 1;
      rank = nextWaitlistedCount;
    } else {
      throw new functions.https.HttpsError('resource-exhausted', 'FULL_CAPACITY');
    }

    const currentEntry = queueEntrySnapshot.exists ? queueEntrySnapshot.data() as QueueEntryDoc : null;
    const nextAdvance = getAdvanceLimitFromCounts(
      queueState,
      {
        ...liveMetrics,
        confirmedCount: nextConfirmedCount,
        waitlistedCount: nextWaitlistedCount,
        activeReservationCount: Math.max(0, liveMetrics.activeReservationCount - 1),
        pendingAdmissionCount: Math.max(
          0,
          liveMetrics.pendingAdmissionCount - (currentEntry?.roundId === round.id && currentEntry.status === 'eligible' ? 1 : 0)
        ),
        availableCapacity: Math.max(
          0,
          queueState.totalCapacity - nextConfirmedCount - nextWaitlistedCount - Math.max(0, liveMetrics.activeReservationCount - 1)
        )
      },
      1
    );
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, nextAdvance)
      : [];
    const promotedCount = promoteEligibleEntries(transaction, promotionDocs, now);
    const maxPromotedNumber = Math.max(
      queueState.lastAssignedNumber,
      ...promotionDocs.map((doc) => Number((doc.data() as QueueEntryDoc).number || 0))
    );

    transaction.set(registrationRef, {
      ...sanitizedFormData,
      queueIdentityHash,
      id: registrationRef.id,
      schoolId,
      admissionRoundId: round.id,
      admissionRoundLabel: round.label,
      sessionId,
      status,
      rank,
      submittedAt: now,
      updatedAt: now
    });

    transaction.update(reservationRef, {
      status: 'confirmed',
      confirmedAt: now,
      updatedAt: now,
      processingAt: null,
      registrationId: registrationRef.id,
      finalStatus: status
    });
    transaction.set(identityLockRef, {
      roundId: round.id,
      userId: auth.uid,
      studentName: sanitizedFormData.studentName,
      phoneLast4: sanitizedFormData.phoneLast4,
      status,
      queueNumber: reservation.queueNumber ?? null,
      sessionId,
      registrationId: registrationRef.id,
      updatedAt: now
    } as QueueIdentityLockDoc, { merge: true });
    const nextQueueState: QueueStateDoc = {
      ...queueState,
      activeReservationCount: Math.max(0, liveMetrics.activeReservationCount - 1),
      pendingAdmissionCount: Math.max(
        0,
        liveMetrics.pendingAdmissionCount - (currentEntry?.roundId === round.id && currentEntry.status === 'eligible' ? 1 : 0)
      ) + promotedCount,
      confirmedCount: nextConfirmedCount,
      waitlistedCount: nextWaitlistedCount,
      availableCapacity: Math.max(
        0,
        queueState.totalCapacity - nextConfirmedCount - nextWaitlistedCount - Math.max(0, liveMetrics.activeReservationCount - 1)
      ),
      currentNumber: queueState.currentNumber + promotedCount,
      lastAssignedNumber: maxPromotedNumber,
      lastAdvancedAt: promotedCount > 0 ? now : queueState.lastAdvancedAt,
      updatedAt: now
    };

    if (currentEntry) {
      if (currentEntry.roundId === round.id) {
        transaction.set(queueEntryRef, {
          status: 'consumed',
          eligibleAt: null,
          activeReservationId: null,
          updatedAt: now,
          lastSeenAt: now
        }, { merge: true });
      }
    }

    const result = {
      success: true,
      registrationId: registrationRef.id,
      status,
      rank
    };
    transaction.set(lockRef, makeRequestLock('confirmReservation', auth.uid, result));
    return {
      response: result,
      stateRefPath: stateRef.path,
      nextQueueState
    };
  });

  if (transactionResult.stateRefPath && transactionResult.nextQueueState) {
    await setQueueStateBestEffort(
      db.doc(transactionResult.stateRefPath),
      transactionResult.nextQueueState,
      'confirmReservation'
    );
  }

  const reservationSnapshot = await reservationRef.get();
  const reservation = reservationSnapshot.exists ? (reservationSnapshot.data() as ReservationDoc) : null;
  if (reservation?.roundId) {
    await clearQueueNumber(schoolId, reservation.roundId, auth.uid).catch(() => undefined);
  }
  return transactionResult.response;
});

export const cleanupExpiredReservations = schedulerRuntime.pubsub
  .schedule('* * * * *')
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    const schoolsSnapshot = await db.collection('schools').get();
    let expiredCount = 0;
    let expiredQueueCount = 0;

    for (const schoolSnapshot of schoolsSnapshot.docs) {
      const schoolId = schoolSnapshot.id;
      const reservationSnapshot = await reservationsRef(db, schoolId)
        .where('status', 'in', ['reserved', 'processing'])
        .where('expiresAt', '<=', now)
        .limit(100)
        .get();

    for (const reservationDoc of reservationSnapshot.docs) {
      const result = await expireReservationDocument(db, schoolId, reservationDoc.id, null);
      if (result.expired) {
        expiredCount += 1;
      }
    }

      for (const round of normalizeAdmissionRounds(schoolSnapshot.data())) {
        const queueCleanupResult = await cleanupStaleQueueEntriesForSchool(db, schoolId, round, { now, limitPerStatus: 50 });
        await Promise.all(queueCleanupResult.clearedUserIds.map((userId) => clearQueueNumber(schoolId, round.id, userId)));
        expiredQueueCount += queueCleanupResult.expiredWaiting + queueCleanupResult.expiredEligible;
      }
    }

    functions.logger.info('[cleanupExpiredReservations] completed', { expiredCount, expiredQueueCount });
    return { expiredCount, expiredQueueCount };
  });

export const autoAdvanceQueue = schedulerRuntime.pubsub
  .schedule('* * * * *')
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    const db = admin.firestore();
    const schoolsSnapshot = await db.collection('schools').get();
    let totalAdvanced = 0;

    for (const schoolSnapshot of schoolsSnapshot.docs) {
      const schoolId = schoolSnapshot.id;
      const schoolData = schoolSnapshot.data();
      if (!isQueueEnabled(schoolData) || schoolData.isActive === false) {
        continue;
      }

      const round = getResolvedAdmissionRound(schoolData);
      const stateRef = queueStateRef(db, schoolId, round.id);

      const advanced = await db.runTransaction(async (transaction) => {
        const stateSnapshot = await transaction.get(stateRef);
        const liveMetrics = await loadQueueLiveMetrics(transaction, db, schoolId, round, schoolData);
        const queueState = buildQueueStateDoc(
          schoolData,
          round,
          stateSnapshot.exists
            ? {
                ...(stateSnapshot.data() as QueueStateDoc),
                ...liveMetrics
              }
            : liveMetrics
        );
        const nowMs = Date.now();

        if (liveMetrics.availableCapacity <= 0 || liveMetrics.activeReservationCount >= queueState.maxActiveSessions) {
          return 0;
        }

        const headroom = getAdvanceLimitFromCounts(queueState, liveMetrics);
        if (headroom <= 0) {
          return 0;
        }

        const promotionDocs = await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, headroom);
        const promotedCount = promoteEligibleEntries(transaction, promotionDocs, nowMs);
        if (promotedCount <= 0) {
          return 0;
        }

        const maxPromotedNumber = Math.max(
          queueState.lastAssignedNumber,
          ...promotionDocs.map(doc => Number((doc.data() as QueueEntryDoc).number || 0))
        );

        transaction.set(stateRef, {
          ...queueState,
          activeReservationCount: liveMetrics.activeReservationCount,
          confirmedCount: liveMetrics.confirmedCount,
          waitlistedCount: liveMetrics.waitlistedCount,
          availableCapacity: liveMetrics.availableCapacity,
          pendingAdmissionCount: liveMetrics.pendingAdmissionCount + promotedCount,
          currentNumber: queueState.currentNumber + promotedCount,
          lastAssignedNumber: maxPromotedNumber,
          lastAdvancedAt: nowMs,
          updatedAt: nowMs
        }, { merge: true });

        return promotedCount;
      });

      if (advanced > 0) {
        totalAdvanced += advanced;
      }
    }

    functions.logger.info('[autoAdvanceQueue] completed', { totalAdvanced });
    return { totalAdvanced };
  });

export const getAdminReservations = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId } = data?.data || data;
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }

  const adminSnapshot = await db.doc(`admins/${auth.uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData || (adminData.role !== 'MASTER' && adminData.assignedSchoolId !== schoolId)) {
    throw new functions.https.HttpsError('permission-denied', '해당 학교 정보를 조회할 권한이 없습니다.');
  }

  const snapshot = await reservationsRef(db, schoolId).orderBy('createdAt', 'desc').limit(200).get();
  return {
    reservations: snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }))
  };
});

export const runAdminQueueAction = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, action } = data?.data || data;
  if (!schoolId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId와 action이 필요합니다.');
  }

  await assertAdminAccessToSchool(db, auth.uid, schoolId);

  if (action === 'recalculateState') {
    const queueState = await recalculateQueueState(db, schoolId);
    return {
      success: true,
      action,
      queueState
    };
  }

  if (action === 'expireStaleReservations') {
    const now = Date.now();
    const snapshot = await reservationsRef(db, schoolId)
      .where('status', 'in', ['reserved', 'processing'])
      .where('expiresAt', '<=', now)
      .limit(100)
      .get();

    let expiredCount = 0;
    for (const reservationDoc of snapshot.docs) {
      const result = await expireReservationDocument(db, schoolId, reservationDoc.id, null);
      if (result.expired) {
        expiredCount += 1;
      }
    }

    const round = getResolvedAdmissionRound((await db.doc(`schools/${schoolId}`).get()).data() || {});
    const queueCleanupResult = await cleanupStaleQueueEntriesForSchool(db, schoolId, round, { now, limitPerStatus: 100 });
    await Promise.all(queueCleanupResult.clearedUserIds.map((userId) => clearQueueNumber(schoolId, round.id, userId)));

    const queueState = await recalculateQueueState(db, schoolId);
    return {
      success: true,
      action,
      expiredCount,
      expiredQueueCount: queueCleanupResult.expiredWaiting + queueCleanupResult.expiredEligible,
      queueState
    };
  }

  throw new functions.https.HttpsError('invalid-argument', '지원하지 않는 action입니다.');
});

async function deleteCollectionInBatches(
  collection: admin.firestore.CollectionReference,
  batchSize = 200,
  maxBatches = 250
) {
  let deletedCount = 0;
  let batchCount = 0;

  while (batchCount < maxBatches) {
    const snapshot = await collection.limit(batchSize).get();
    if (snapshot.empty) {
      return { deletedCount, batchCount };
    }

    const batch = admin.firestore().batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deletedCount += snapshot.size;
    batchCount += 1;
  }

  throw new functions.https.HttpsError(
    'resource-exhausted',
    `삭제 배치 한도(${maxBatches})를 초과했습니다: ${collection.path}`
  );
}

export const resetSchoolState = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }

  const adminSnapshot = await db.doc(`admins/${auth.uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData || adminData.role !== 'MASTER') {
    throw new functions.https.HttpsError('permission-denied', 'MASTER 권한이 필요합니다.');
  }

  const schoolRef = db.doc(`schools/${schoolId}`);
  const schoolSnapshot = await schoolRef.get();
  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
  }

  const schoolData = schoolSnapshot.data()!;
  const now = Date.now();
  const auditRef = getAuditLogCollection(db, schoolId).doc();
  await auditRef.set({
    action: 'resetSchoolState',
    actorUid: auth.uid,
    requestId,
    status: 'started',
    startedAt: now,
    updatedAt: now
  });

  try {
    const deletionResults = await Promise.all([
      deleteCollectionInBatches(queueEntriesRef(db, schoolId)),
      deleteCollectionInBatches(reservationsRef(db, schoolId)),
      deleteCollectionInBatches(db.collection(`schools/${schoolId}/registrations`)),
      deleteCollectionInBatches(db.collection(`schools/${schoolId}/requestLocks`)),
      deleteCollectionInBatches(db.collection(`schools/${schoolId}/queueIdentityLocks`))
    ]);
    await Promise.all([
      resetQueueIssuerState(schoolId, 'round1'),
      resetQueueIssuerState(schoolId, 'round2')
    ]);

    await schoolRef.set({
      stats: {
        confirmedCount: 0,
        waitlistedCount: 0
      },
      updatedAt: now
    }, { merge: true });

    for (const round of normalizeAdmissionRounds(schoolData)) {
      await queueStateRef(db, schoolId, round.id).set(buildQueueStateDoc(schoolData, round, {
        currentNumber: 0,
        lastAssignedNumber: 0,
        lastAdvancedAt: 0,
        activeReservationCount: 0,
        confirmedCount: 0,
        waitlistedCount: 0,
        updatedAt: now
      }), { merge: true });
    }

    await auditRef.set({
      status: 'completed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      deletionSummary: {
        queueEntries: deletionResults[0],
        reservations: deletionResults[1],
        registrations: deletionResults[2],
        requestLocks: deletionResults[3],
        queueIdentityLocks: deletionResults[4]
      }
    }, { merge: true });

    return { success: true };
  } catch (error) {
    await auditRef.set({
      status: 'failed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      errorMessage: error instanceof Error ? error.message : String(error)
    }, { merge: true });
    throw error;
  }
});

export const cleanupAnonymousAuthUsers = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const adminSnapshot = await db.doc(`admins/${auth.uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData || adminData.role !== 'MASTER') {
    throw new functions.https.HttpsError('permission-denied', 'MASTER 권한이 필요합니다.');
  }

  let deletedCount = 0;
  let pageToken: string | undefined;

  do {
    const listResult = await admin.auth().listUsers(1000, pageToken);
    const anonymousUids = listResult.users
      .filter(user => user.providerData.length === 0)
      .map(user => user.uid);

    if (anonymousUids.length > 0) {
      const deleteResult = await admin.auth().deleteUsers(anonymousUids);
      deletedCount += deleteResult.successCount;
    }

    pageToken = listResult.pageToken;
  } while (pageToken);

  return { success: true, deletedCount };
});
