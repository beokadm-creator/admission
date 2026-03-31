import * as functions from 'firebase-functions';
import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';

if (admin.apps.length === 0) {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
}

type QueueEntryStatus = 'waiting' | 'eligible' | 'consumed' | 'expired';
type ReservationStatus = 'reserved' | 'processing' | 'confirmed' | 'expired' | 'cancelled';

interface AdmissionRoundConfig {
  id: string;
  label: string;
  openDateTime: string;
  maxCapacity: number;
  waitlistCapacity: number;
  enabled: boolean;
}

interface QueueStateDoc {
  roundId: string;
  roundLabel: string;
  currentNumber: number;
  lastAssignedNumber: number;
  lastAdvancedAt: number;
  activeReservationCount: number;
  pendingAdmissionCount: number;
  maxActiveSessions: number;
  confirmedCount: number;
  waitlistedCount: number;
  totalCapacity: number;
  availableCapacity: number;
  updatedAt: number;
  queueEnabled: boolean;
}

interface QueueEntryDoc {
  roundId: string;
  roundLabel?: string;
  userId: string;
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

interface NormalizedCallableRequest {
  data: any;
  auth: any;
  rawRequest: any;
}

const DEFAULT_SESSION_MS = 3 * 60 * 1000;
const WAITING_PRESENCE_TIMEOUT_MS = 90 * 1000;
const ELIGIBLE_PRESENCE_TIMEOUT_MS = 60 * 1000;

function normalizeCallableRequest(requestOrData: any, legacyContext?: any): NormalizedCallableRequest {
  if (
    requestOrData &&
    typeof requestOrData === 'object' &&
    ('data' in requestOrData || 'auth' in requestOrData || 'rawRequest' in requestOrData)
  ) {
    return {
      data: requestOrData.data ?? {},
      auth: requestOrData.auth ?? null,
      rawRequest: requestOrData.rawRequest
    };
  }

  if (
    legacyContext &&
    typeof legacyContext === 'object' &&
    ('auth' in legacyContext || 'rawRequest' in legacyContext)
  ) {
    return {
      data: requestOrData?.data ?? requestOrData ?? {},
      auth: legacyContext.auth ?? null,
      rawRequest: legacyContext.rawRequest
    };
  }

  return {
    data: requestOrData ?? {},
    auth: null,
    rawRequest: undefined
  };
}

async function checkRateLimit(
  db: admin.firestore.Firestore,
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const rateLimitRef = db.collection('rateLimits').doc(identifier);
  let result: { allowed: boolean; retryAfter?: number } = { allowed: true };

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);

    if (!snapshot.exists) {
      transaction.set(rateLimitRef, {
        count: 1,
        firstRequest: now,
        lastRequest: now
      });
      result = { allowed: true };
      return;
    }

    const data = snapshot.data()!;
    const elapsed = now - (data.firstRequest || 0);

    if (elapsed > windowMs) {
      transaction.update(rateLimitRef, {
        count: 1,
        firstRequest: now,
        lastRequest: now
      });
      result = { allowed: true };
      return;
    }

    if ((data.count || 0) >= maxRequests) {
      result = {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((windowMs - elapsed) / 1000))
      };
      return;
    }

    transaction.update(rateLimitRef, {
      count: admin.firestore.FieldValue.increment(1),
      lastRequest: now
    });
  });

  return result;
}

function getRateLimitIdentifier(rawRequest: any, fallback: string) {
  const ipAddress =
    rawRequest?.ip ||
    rawRequest?.headers?.['x-forwarded-for'] ||
    rawRequest?.headers?.['fastly-client-ip'];

  if (typeof ipAddress === 'string' && ipAddress.trim()) {
    return `ip_${ipAddress.split(',')[0].trim()}`;
  }

  return fallback;
}

function normalizeAdmissionRounds(schoolData: admin.firestore.DocumentData): AdmissionRoundConfig[] {
  const rounds = Array.isArray(schoolData.admissionRounds) && schoolData.admissionRounds.length > 0
    ? schoolData.admissionRounds
    : [
        {
          id: 'round1',
          label: '1차',
          openDateTime: schoolData.openDateTime || '',
          maxCapacity: Number(schoolData.maxCapacity || 0),
          waitlistCapacity: Number(schoolData.waitlistCapacity || 0),
          enabled: true
        }
      ];

  const fallbackRounds: AdmissionRoundConfig[] = [
    { id: 'round1', label: '1차', openDateTime: '', maxCapacity: 0, waitlistCapacity: 0, enabled: true },
    { id: 'round2', label: '2차', openDateTime: '', maxCapacity: 0, waitlistCapacity: 0, enabled: false }
  ];

  return fallbackRounds.map((fallback, index) => {
    const source = rounds[index] || {};
    return {
      id: String(source.id || fallback.id),
      label: String(source.label || fallback.label),
      openDateTime: String(source.openDateTime || fallback.openDateTime || ''),
      maxCapacity: Math.max(0, Number(source.maxCapacity ?? fallback.maxCapacity)),
      waitlistCapacity: Math.max(0, Number(source.waitlistCapacity ?? fallback.waitlistCapacity)),
      enabled: index === 0 ? true : source.enabled !== false
    };
  }).filter((round) => round.enabled);
}

function getResolvedAdmissionRound(schoolData: admin.firestore.DocumentData, now = Date.now()) {
  const rounds = normalizeAdmissionRounds(schoolData);
  if (rounds.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', '모집 차수가 설정되지 않았습니다.');
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
  return Math.max(1, Math.ceil(totalCapacity * 1.5));
}

function isQueueEnabled(schoolData: admin.firestore.DocumentData) {
  return schoolData.queueSettings?.enabled !== false;
}

function assertSchoolOpen(schoolData: admin.firestore.DocumentData, round: AdmissionRoundConfig, now = Date.now()) {
  if (schoolData.isActive === false) {
    throw new functions.https.HttpsError('failed-precondition', '?꾩옱 ?묒닔瑜?吏꾪뻾?섍퀬 ?덉? ?딆뒿?덈떎.');
  }

  const openTime = new Date(round.openDateTime || 0).getTime();
  if (!openTime || Number.isNaN(openTime)) {
    throw new functions.https.HttpsError('failed-precondition', '?묒닔 ?쒖옉 ?쒓컙???ㅼ젙?섏뼱 ?덉? ?딆뒿?덈떎.');
  }
  if (now < openTime) {
    throw new functions.https.HttpsError('failed-precondition', '?꾩쭅 ?묒닔 ?쒖옉 ?쒓컙???꾨떃?덈떎.');
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

function requestLockRef(db: admin.firestore.Firestore, schoolId: string, requestId: string) {
  return db.doc(`schools/${schoolId}/requestLocks/${requestId}`);
}

function sanitizeRequestId(requestId?: string) {
  return typeof requestId === 'string' && requestId.trim()
    ? requestId.trim().slice(0, 120)
    : `req_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

function buildQueueStateDoc(
  schoolData: admin.firestore.DocumentData,
  round: AdmissionRoundConfig,
  existing?: Partial<QueueStateDoc> | null
): QueueStateDoc {
  const { totalCapacity } = getRoundCapacity(round);
  const maxActiveSessions = getMaxActiveSessions(schoolData);
  const pendingAdmissionCount = Number(existing?.pendingAdmissionCount ?? 0);
  const confirmedCount = Number(existing?.confirmedCount ?? 0);
  const waitlistedCount = Number(existing?.waitlistedCount ?? 0);
  const activeReservationCount = Number(existing?.activeReservationCount ?? 0);
  const currentNumber = Number(existing?.currentNumber ?? 0);
  const lastAssignedNumber = Number(existing?.lastAssignedNumber ?? 0);
  const lastAdvancedAt = Number(existing?.lastAdvancedAt ?? 0);
  const updatedAt = Number(existing?.updatedAt ?? Date.now());

  return {
    roundId: round.id,
    roundLabel: round.label,
    currentNumber,
    lastAssignedNumber,
    lastAdvancedAt,
    activeReservationCount,
    pendingAdmissionCount,
    maxActiveSessions,
    confirmedCount,
    waitlistedCount,
    totalCapacity,
    availableCapacity: Math.max(0, totalCapacity - confirmedCount - waitlistedCount - activeReservationCount),
    updatedAt,
    queueEnabled: isQueueEnabled(schoolData)
  };
}

function getAvailableWriterSlots(queueState: QueueStateDoc) {
  return Math.max(0, queueState.maxActiveSessions - queueState.activeReservationCount);
}

function getQueueAdvanceAmount(queueState: QueueStateDoc, limit = Number.MAX_SAFE_INTEGER) {
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const admissionHeadroom = Math.max(
    0,
    queueState.maxActiveSessions - queueState.activeReservationCount - queueState.pendingAdmissionCount
  );
  return Math.max(
    0,
    Math.min(waitingCount, queueState.availableCapacity, admissionHeadroom, limit)
  );
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
  let issuedNumber: number | null = null;
  let existingNumber: number | null = null;
  let limitReached = false;

  const result = await issuerRef.transaction((current) => {
    const state = current || {};
    const assignments = state.assignments || {};
    const existing = assignments[userId];
    if (existing?.number) {
      existingNumber = Number(existing.number);
      return;
    }

    const nextNumber = Number(state.nextNumber || 0) + 1;
    if (nextNumber > queueJoinLimit) {
      limitReached = true;
      return;
    }
    issuedNumber = nextNumber;
    return {
      nextNumber,
      updatedAt: now,
      assignments: {
        ...assignments,
        [userId]: {
          number: nextNumber,
          assignedAt: now
        }
      }
    };
  });

  if (result.committed && issuedNumber != null) {
    return { number: issuedNumber, reused: false };
  }

  if (existingNumber != null) {
    return { number: existingNumber, reused: true };
  }

  if (limitReached) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      '대기열이 운영 상한에 도달하여 마감되었습니다.'
    );
  }

  const snapshot = await issuerRef.child(`assignments/${userId}`).get();
  if (snapshot.exists()) {
    return {
      number: Number(snapshot.val().number),
      reused: true
    };
  }

  throw new functions.https.HttpsError('aborted', '?湲곕쾲??諛쒓툒 以?異⑸룎??諛쒖깮?덉뒿?덈떎. ?ㅼ떆 ?쒕룄??二쇱꽭??');
}

async function clearQueueNumberFromRtdb(schoolId: string, roundId: string, userId: string) {
  await queueIssuerRef(schoolId, roundId).child(`assignments/${userId}`).remove();
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
    const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);

    if (waitingCount <= 0 || queueState.availableCapacity <= 0 || getAvailableWriterSlots(queueState) <= 0) {
      return 0;
    }

    const advanceAmount = getQueueAdvanceAmount(queueState);
    if (advanceAmount <= 0) {
      return 0;
    }

    const promotionDocs = await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, advanceAmount);
    const promotedCount = promoteEligibleEntries(transaction, promotionDocs, now);
    if (promotedCount <= 0) {
      return 0;
    }

    transaction.set(stateRef, {
      ...queueState,
      pendingAdmissionCount: queueState.pendingAdmissionCount + promotedCount,
      currentNumber: queueState.currentNumber + promotedCount,
      lastAdvancedAt: now,
      updatedAt: now
    }, { merge: true });

    return promotedCount;
  });
}

async function assertAdminAccessToSchool(db: admin.firestore.Firestore, uid: string, schoolId: string) {
  const adminSnapshot = await db.doc(`admins/${uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData) {
    throw new functions.https.HttpsError('permission-denied', '愿由ъ옄 沅뚰븳???꾩슂?⑸땲??');
  }
  if (adminData.role === 'MASTER') {
    return adminData;
  }
  if (adminData.role === 'SCHOOL' && adminData.assignedSchoolId === schoolId) {
    return adminData;
  }
  throw new functions.https.HttpsError('permission-denied', '?대떦 ?숆탳???묎렐??沅뚰븳???놁뒿?덈떎.');
}

async function recalculateQueueState(db: admin.firestore.Firestore, schoolId: string) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const schoolSnapshot = await schoolRef.get();
  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', '?숆탳 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
  }

  const schoolData = schoolSnapshot.data()!;
  const round = getResolvedAdmissionRound(schoolData);
  const stateRef = queueStateRef(db, schoolId, round.id);
  const existingState = (await stateRef.get()).data() as Partial<QueueStateDoc> | undefined;
  const [activeReservationsSnapshot, queueEntriesSnapshot] = await Promise.all([
    reservationsRef(db, schoolId)
      .where('roundId', '==', round.id)
      .where('status', 'in', ['reserved', 'processing'])
      .get(),
    queueEntriesRef(db, schoolId).where('roundId', '==', round.id).get()
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

  const nextState = buildQueueStateDoc(schoolData, round, {
    ...(existingState || {}),
    currentNumber,
    lastAssignedNumber,
    activeReservationCount,
    pendingAdmissionCount,
    confirmedCount: Number(existingState?.confirmedCount || 0),
    waitlistedCount: Number(existingState?.waitlistedCount || 0),
    updatedAt: Date.now()
  });

  await stateRef.set(nextState, { merge: true });
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
    const staleWaitingRefs: admin.firestore.DocumentReference[] = [];
    const staleEligibleRefs: admin.firestore.DocumentReference[] = [];
    const clearedUserIds = new Set<string>();

    for (const doc of waitingSnapshot.docs) {
      const freshSnapshot = await transaction.get(doc.ref);
      if (!freshSnapshot.exists) {
        continue;
      }

      const freshEntry = freshSnapshot.data() as QueueEntryDoc;
      if (freshEntry.status !== 'waiting' || Number(freshEntry.lastSeenAt || 0) > waitingCutoff) {
        continue;
      }

      staleWaitingRefs.push(doc.ref);
      clearedUserIds.add(freshEntry.userId);
      expiredWaiting += 1;
    }

    for (const doc of eligibleSnapshot.docs) {
      const freshSnapshot = await transaction.get(doc.ref);
      if (!freshSnapshot.exists) {
        continue;
      }

      const freshEntry = freshSnapshot.data() as QueueEntryDoc;
      if (freshEntry.status !== 'eligible' || Number(freshEntry.lastSeenAt || 0) > eligibleCutoff) {
        continue;
      }

      staleEligibleRefs.push(doc.ref);
      clearedUserIds.add(freshEntry.userId);
      pendingAdmissionCount = Math.max(0, pendingAdmissionCount - 1);
      expiredEligible += 1;
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

    staleWaitingRefs.forEach((ref) => {
      transaction.set(ref, {
        status: 'expired',
        eligibleAt: null,
        activeReservationId: null,
        updatedAt: now
      }, { merge: true });
    });

    staleEligibleRefs.forEach((ref) => {
      transaction.set(ref, {
        status: 'expired',
        eligibleAt: null,
        activeReservationId: null,
        updatedAt: now
      }, { merge: true });
    });

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
      throw new functions.https.HttpsError('permission-denied', '?대떦 ?몄뀡???묎렐?????놁뒿?덈떎.');
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
    await clearQueueNumberFromRtdb(schoolId, (result as any).clearedRoundId, result.clearedUserId);
  }

  return result;
}

export const joinQueue = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, roundId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId媛 ?꾩슂?⑸땲??');
  }

  const existingResult = await getExistingRequestResult(db, schoolId, requestId);
  if (existingResult) {
    return existingResult;
  }

  const rateLimit = await checkRateLimit(
    db,
    `joinQueue_${auth.uid}`,
    5,
    60000
  );
  if (!rateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `?붿껌???덈Т 鍮좊쫭?덈떎. ${rateLimit.retryAfter}珥????ㅼ떆 ?쒕룄??二쇱꽭??`);
  }

  const ipRateLimit = await checkRateLimit(
    db,
    getRateLimitIdentifier(rawRequest, `joinQueue_ip_${auth.uid}`),
    20,
    60000
  );
  if (!ipRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `?붿껌???덈Т 鍮좊쫭?덈떎. ${ipRateLimit.retryAfter}珥????ㅼ떆 ?쒕룄??二쇱꽭??`);
  }

  const schoolRef = db.doc(`schools/${schoolId}`);
  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const [schoolSnapshot, entrySnapshot] = await Promise.all([schoolRef.get(), entryRef.get()]);

  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', '?숆탳 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
  }

  const schoolData = schoolSnapshot.data()!;
  const round = roundId ? (getRoundById(schoolData, roundId) || getResolvedAdmissionRound(schoolData)) : getResolvedAdmissionRound(schoolData);
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
      lockRef.set(makeRequestLock('joinQueue', auth.uid, existingJoinResult))
    ]);

    return existingJoinResult;
  }

  if (existingEntry?.status === 'expired' && existingEntry.roundId === round.id) {
    await clearQueueNumberFromRtdb(schoolId, round.id, auth.uid);
  }

  if (existingEntry && existingEntry.roundId && existingEntry.roundId !== round.id) {
    await clearQueueNumberFromRtdb(schoolId, existingEntry.roundId, auth.uid).catch(() => undefined);
  }

  if (totalCapacity <= 0 || queueState.availableCapacity <= 0) {
    throw new functions.https.HttpsError('resource-exhausted', '현재 신청 가능한 정원이 없습니다.');
  }

  const issued = await issueQueueNumberFromRtdb(schoolId, round.id, auth.uid, now, queueJoinLimit);

  try {
    const joinResult = await db.runTransaction(async (transaction) => {
      const [freshStateSnapshot, freshEntrySnapshot, freshLockSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(entryRef),
        transaction.get(lockRef)
      ]);

      if (freshLockSnapshot.exists) {
        return (freshLockSnapshot.data() as RequestLockDoc).result;
      }

      const freshQueueState = buildQueueStateDoc(
        schoolData,
        round,
        freshStateSnapshot.exists ? (freshStateSnapshot.data() as QueueStateDoc) : null
      );

      if (freshEntrySnapshot.exists) {
        const freshEntry = freshEntrySnapshot.data() as QueueEntryDoc;
        if (freshEntry.roundId === round.id && freshEntry.status !== 'expired' && freshEntry.number != null) {
          const alreadyJoinedResult = {
            success: true,
            accepted: true,
            number: freshEntry.number,
            currentNumber: freshQueueState.currentNumber,
            lastAssignedNumber: Math.max(freshQueueState.lastAssignedNumber, Number(freshEntry.number || 0)),
            status: freshEntry.status
          };
          transaction.set(lockRef, makeRequestLock('joinQueue', auth.uid, alreadyJoinedResult));
          return alreadyJoinedResult;
        }
      }

      const nextLastAssignedNumber = Math.max(freshQueueState.lastAssignedNumber, issued.number);
      transaction.set(
        entryRef,
        {
          roundId: round.id,
          roundLabel: round.label,
          userId: auth.uid,
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
      transaction.set(
        stateRef,
        {
          ...freshQueueState,
          lastAssignedNumber: nextLastAssignedNumber,
          updatedAt: now
        },
        { merge: true }
      );

      const createdJoinResult = {
        success: true,
        accepted: true,
        number: issued.number,
        currentNumber: freshQueueState.currentNumber,
        lastAssignedNumber: nextLastAssignedNumber,
        status: 'waiting'
      };
      transaction.set(lockRef, makeRequestLock('joinQueue', auth.uid, createdJoinResult));
      return createdJoinResult;
    });

    await advanceQueueForSchool(db, schoolId, round, { now: Date.now() });
    const [finalStateSnapshot, finalEntrySnapshot] = await Promise.all([stateRef.get(), entryRef.get()]);
    const finalState = buildQueueStateDoc(
      schoolData,
      round,
      finalStateSnapshot.exists ? (finalStateSnapshot.data() as QueueStateDoc) : null
    );
    const finalEntry = finalEntrySnapshot.exists ? (finalEntrySnapshot.data() as QueueEntryDoc) : null;

    return {
      ...joinResult,
      number: finalEntry?.number ?? joinResult.number ?? issued.number,
      status: finalEntry?.status ?? joinResult.status,
      currentNumber: finalState.currentNumber,
      lastAssignedNumber: finalState.lastAssignedNumber
    };
  } catch (error) {
    if (!issued.reused) {
      await clearQueueNumberFromRtdb(schoolId, round.id, auth.uid).catch(() => undefined);
    }
    throw error;
  }
});

export const startRegistrationSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, roundId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId媛 ?꾩슂?⑸땲??');
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
    throw new functions.https.HttpsError('resource-exhausted', `?붿껌???덈Т 鍮좊쫭?덈떎. ${rateLimit.retryAfter}珥????ㅼ떆 ?쒕룄??二쇱꽭??`);
  }

  const schoolRef = db.doc(`schools/${schoolId}`);
  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const reservationCollectionRef = reservationsRef(db, schoolId);
  const reservationId = `reservation_${Date.now()}_${randomBytes(8).toString('hex')}`;
  const reservationRef = reservationCollectionRef.doc(reservationId);

  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, entrySnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(entryRef)
    ]);
    if (!schoolSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', '?숆탳 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
    }

    const schoolData = schoolSnapshot.data()!;
    let round = roundId ? (getRoundById(schoolData, roundId) || getResolvedAdmissionRound(schoolData)) : getResolvedAdmissionRound(schoolData);
    let stateRef = queueStateRef(db, schoolId, round.id);
    let lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
    let [stateSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(lockRef)
    ]);
    if (lockSnapshot.exists) {
      return (lockSnapshot.data() as RequestLockDoc).result;
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
      return result;
    }

    let queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);
    if (queueState.availableCapacity <= 0) {
      throw new functions.https.HttpsError('resource-exhausted', '?꾩옱 ?댁슜 媛?ν븳 ?좎껌 ?몄썝???놁뒿?덈떎.');
    }
    if (getAvailableWriterSlots(queueState) <= 0) {
      throw new functions.https.HttpsError('resource-exhausted', '?꾩옱 ?묒꽦 媛?ν븳 ?몄썝??媛??李쇱뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??');
    }

    const now = Date.now();
    let queueNumber: number | null = null;

    if (isQueueEnabled(schoolData)) {
      if (!entrySnapshot.exists) {
        throw new functions.https.HttpsError('failed-precondition', '癒쇱? ?湲곗뿴???낆옣??二쇱꽭??');
      }

      const queueEntry = entrySnapshot.data() as QueueEntryDoc;
      if (queueEntry.roundId !== round.id) {
        round = getRoundById(schoolData, queueEntry.roundId) || round;
        stateRef = queueStateRef(db, schoolId, round.id);
        lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
        [stateSnapshot, lockSnapshot] = await Promise.all([
          transaction.get(stateRef),
          transaction.get(lockRef)
        ]);
        if (lockSnapshot.exists) {
          return (lockSnapshot.data() as RequestLockDoc).result;
        }
        queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);
      }
      queueNumber = queueEntry.number;
      if (queueEntry.status !== 'eligible' || queueEntry.number == null) {
        throw new functions.https.HttpsError('failed-precondition', '?袁⑹춦 ?醫롪퍕 揶쎛?館釉???뽮퐣揶쎛 ?袁⑤뻸??덈뼄.');
      }
      if (queueEntry.number > queueState.currentNumber) {
        throw new functions.https.HttpsError('failed-precondition', '?꾩쭅 ?좎껌 媛?ν븳 ?쒖꽌媛 ?꾨떃?덈떎.');
      }

    }

    const nextState = {
      ...queueState,
      activeReservationCount: queueState.activeReservationCount + 1,
      pendingAdmissionCount: Math.max(0, queueState.pendingAdmissionCount - (isQueueEnabled(schoolData) ? 1 : 0)),
      availableCapacity: Math.max(0, queueState.availableCapacity - 1),
      updatedAt: now
    };
    const nextAdvance = getQueueAdvanceAmount(nextState, 1);
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, nextState.currentNumber, nextAdvance)
      : [];

    if (isQueueEnabled(schoolData)) {
      transaction.set(entryRef, {
        status: 'eligible',
        eligibleAt: now,
        activeReservationId: reservationId,
        lastSeenAt: now,
        updatedAt: now
      }, { merge: true });
    }

    const expiresAt = now + DEFAULT_SESSION_MS;
    transaction.set(reservationRef, {
      roundId: round.id,
      roundLabel: round.label,
      userId: auth.uid,
      queueNumber,
      status: 'reserved',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      requestId,
      registrationId: null,
      finalStatus: null
    } as ReservationDoc);
    transaction.set(stateRef, {
      ...nextState,
      pendingAdmissionCount: nextState.pendingAdmissionCount + promotionDocs.length,
      currentNumber: nextState.currentNumber + promotionDocs.length,
      lastAdvancedAt: promotionDocs.length > 0 ? now : nextState.lastAdvancedAt
    }, { merge: true });
    promoteEligibleEntries(transaction, promotionDocs, now);

    const result = {
      success: true,
      sessionId: reservationId,
      expiresAt,
      queueNumber,
      roundId: round.id,
      roundLabel: round.label
    };
    transaction.set(lockRef, makeRequestLock('startRegistration', auth.uid, result));
    return result;
  });
});

export const getReservationSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, sessionId } = data?.data || data;
  if (!schoolId || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId? sessionId媛 ?꾩슂?⑸땲??');
  }

  const reservationSnapshot = await reservationsRef(db, schoolId).doc(sessionId).get();
  if (!reservationSnapshot.exists) {
    throw new functions.https.HttpsError('failed-precondition', '?좏슚???깅줉 ?몄뀡???꾨떃?덈떎.');
  }

  const reservation = reservationSnapshot.data() as ReservationDoc;
  if (reservation.userId !== auth.uid) {
    throw new functions.https.HttpsError('permission-denied', '?대떦 ?몄뀡???묎렐?????놁뒿?덈떎.');
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
    throw new functions.https.HttpsError('failed-precondition', '?좏슚???깅줉 ?몄뀡???꾨떃?덈떎.');
  }

  if (Date.now() > reservation.expiresAt) {
    await expireReservationDocument(db, schoolId, sessionId, auth.uid);
    throw new functions.https.HttpsError('deadline-exceeded', '?깅줉 ?몄뀡??留뚮즺?섏뿀?듬땲??');
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
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, sessionId } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId? sessionId媛 ?꾩슂?⑸땲??');
  }

  const existingResult = await getExistingRequestResult(db, schoolId, requestId);
  if (existingResult) {
    return existingResult;
  }

  const result = await expireReservationDocument(db, schoolId, sessionId, auth.uid);
  await requestLockRef(db, schoolId, requestId).set(makeRequestLock('forceExpireSession', auth.uid, { success: true, ...result }));
  return { success: true, ...result };
});

export const heartbeatQueuePresence = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId } = data?.data || data;
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId媛 ?꾩슂?⑸땲??');
  }

  const entryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const now = Date.now();
  const entrySnapshot = await entryRef.get();
  let cleanupResult = null;

  if (entrySnapshot.exists) {
    const entry = entrySnapshot.data() as QueueEntryDoc;
    if (entry.status === 'waiting' || entry.status === 'eligible') {
      await entryRef.set(
        {
          lastSeenAt: now,
          updatedAt: now
        },
        { merge: true }
      );

      cleanupResult = await cleanupStaleQueueEntriesForSchool(
        db,
        schoolId,
        {
          id: entry.roundId,
          label: entry.roundLabel || (entry.roundId === 'round2' ? '2차' : '1차'),
          openDateTime: '',
          maxCapacity: 0,
          waitlistCapacity: 0,
          enabled: true
        },
        {
          now,
          limitPerStatus: 20
        }
      );
    }
  }

  return {
    success: true,
    cleanupResult
  };
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
    throw new functions.https.HttpsError('invalid-argument', '?낅젰 ?곗씠?곌? ?щ컮瑜댁? ?딆뒿?덈떎.');
  }

  const sanitized: Record<string, any> = {};
  for (const key of ALLOWED_FORM_FIELDS) {
    if (formData[key] !== undefined) {
      sanitized[key] = formData[key];
    }
  }

  if (!sanitized.studentName || typeof sanitized.studentName !== 'string' || sanitized.studentName.trim().length === 0) {
    throw new functions.https.HttpsError('invalid-argument', '?대쫫? ?꾩닔 ?낅젰 ??ぉ?낅땲??');
  }
  if (!sanitized.phone || !/^010\d{8}$/.test(String(sanitized.phone))) {
    throw new functions.https.HttpsError('invalid-argument', '?꾪솕踰덊샇 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎. (01000000000)');
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

export const confirmReservation = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, sessionId, formData } = data?.data || data;
  const requestId = sanitizeRequestId((data?.data || data)?.requestId);
  if (!schoolId || !sessionId || !formData) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId, sessionId, formData媛 ?꾩슂?⑸땲??');
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
    throw new functions.https.HttpsError('resource-exhausted', `?붿껌???덈Т 鍮좊쫭?덈떎. ${rateLimit.retryAfter}珥????ㅼ떆 ?쒕룄??二쇱꽭??`);
  }

  const sanitizedFormData = sanitizeFormData(formData);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const reservationRef = reservationsRef(db, schoolId).doc(sessionId);
  const queueEntryRef = queueEntriesRef(db, schoolId).doc(auth.uid);
  const registrationRef = db.doc(`schools/${schoolId}/registrations/${sessionId}`);

  const result = await db.runTransaction(async (transaction) => {
    const [schoolSnapshot, reservationSnapshot, queueEntrySnapshot, registrationSnapshot] = await Promise.all([
      transaction.get(schoolRef),
      transaction.get(reservationRef),
      transaction.get(queueEntryRef),
      transaction.get(registrationRef)
    ]);
    if (!schoolSnapshot.exists || !reservationSnapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', '?좏슚???깅줉 ?몄뀡???꾨떃?덈떎.');
    }

    const reservation = reservationSnapshot.data() as ReservationDoc;
    const schoolData = schoolSnapshot.data()!;
    const round = getRoundById(schoolData, reservation.roundId) || getResolvedAdmissionRound(schoolData);
    const stateRef = queueStateRef(db, schoolId, round.id);
    const lockRef = requestLockRef(db, schoolId, `${round.id}_${requestId}`);
    const [stateSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(lockRef)
    ]);
    if (lockSnapshot.exists) {
      return (lockSnapshot.data() as RequestLockDoc).result;
    }
    if (reservation.userId !== auth.uid) {
      throw new functions.https.HttpsError('permission-denied', '?대떦 ?몄뀡???묎렐?????놁뒿?덈떎.');
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
      return result;
    }

    const now = Date.now();
    if (reservation.status !== 'reserved' && reservation.status !== 'processing') {
      throw new functions.https.HttpsError('failed-precondition', '?좏슚???깅줉 ?몄뀡???꾨떃?덈떎.');
    }
    if (now > reservation.expiresAt) {
      throw new functions.https.HttpsError('deadline-exceeded', '?깅줉 ?몄뀡??留뚮즺?섏뿀?듬땲??');
    }

    const duplicateQuery = db
      .collection(`schools/${schoolId}/registrations`)
      .where('phone', '==', sanitizedFormData.phone)
      .where('status', 'in', ['confirmed', 'waitlisted'])
      .limit(1);
    const duplicateSnapshot = await transaction.get(duplicateQuery);
    if (!duplicateSnapshot.empty) {
      throw new functions.https.HttpsError('already-exists', '?대? ?숈씪???꾪솕踰덊샇濡??좎껌???대젰???덉뒿?덈떎.');
    }

    const { maxCapacity, waitlistCapacity } = getRoundCapacity(round);
    const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);

    let status: 'confirmed' | 'waitlisted' = 'confirmed';
    let rank: number | null = null;
    let nextConfirmedCount = queueState.confirmedCount;
    let nextWaitlistedCount = queueState.waitlistedCount;

    if (queueState.confirmedCount < maxCapacity) {
      nextConfirmedCount += 1;
    } else if (queueState.waitlistedCount < waitlistCapacity) {
      status = 'waitlisted';
      nextWaitlistedCount += 1;
      rank = nextWaitlistedCount;
    } else {
      throw new functions.https.HttpsError('resource-exhausted', 'FULL_CAPACITY');
    }

    const activeReservationCount = Math.max(0, queueState.activeReservationCount - 1);
    const nextState = {
      ...queueState,
      confirmedCount: nextConfirmedCount,
      waitlistedCount: nextWaitlistedCount,
      activeReservationCount,
      availableCapacity: Math.max(
        0,
        queueState.totalCapacity - nextConfirmedCount - nextWaitlistedCount - activeReservationCount
      ),
      updatedAt: now
    };
    const nextAdvance = getQueueAdvanceAmount(nextState, 1);
    const promotionDocs = nextAdvance > 0
      ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, nextState.currentNumber, nextAdvance)
      : [];

    transaction.set(registrationRef, {
      ...sanitizedFormData,
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
    transaction.set(stateRef, {
      ...nextState,
      pendingAdmissionCount: nextState.pendingAdmissionCount + promotionDocs.length,
      currentNumber: nextState.currentNumber + promotionDocs.length,
      lastAdvancedAt: promotionDocs.length > 0 ? now : nextState.lastAdvancedAt
    }, { merge: true });
    promoteEligibleEntries(transaction, promotionDocs, now);

    if (queueEntrySnapshot.exists) {
      const queueEntry = queueEntrySnapshot.data() as QueueEntryDoc;
      if (queueEntry.roundId === round.id) {
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
    return result;
  });

  const reservationSnapshot = await reservationRef.get();
  const reservation = reservationSnapshot.exists ? (reservationSnapshot.data() as ReservationDoc) : null;
  if (reservation?.roundId) {
    await clearQueueNumberFromRtdb(schoolId, reservation.roundId, auth.uid).catch(() => undefined);
  }
  return result;
});

export const cleanupExpiredReservations = functionsV1.pubsub
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
        await Promise.all(queueCleanupResult.clearedUserIds.map((userId) => clearQueueNumberFromRtdb(schoolId, round.id, userId)));
        expiredQueueCount += queueCleanupResult.expiredWaiting + queueCleanupResult.expiredEligible;
      }
    }

    functions.logger.info('[cleanupExpiredReservations] completed', { expiredCount, expiredQueueCount });
    return { expiredCount, expiredQueueCount };
  });

export const autoAdvanceQueue = functionsV1.pubsub
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
        const queueState = buildQueueStateDoc(schoolData, round, stateSnapshot.exists ? stateSnapshot.data() as QueueStateDoc : null);
        const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
        const nowMs = Date.now();

        if (waitingCount <= 0 || queueState.availableCapacity <= 0 || getAvailableWriterSlots(queueState) <= 0) {
          return 0;
        }
        const advanceAmount = getQueueAdvanceAmount(queueState);
        if (advanceAmount <= 0) {
          return 0;
        }

        const promotionDocs = await loadEntriesForPromotion(transaction, db, schoolId, round.id, queueState.currentNumber, advanceAmount);
        const promotedCount = promoteEligibleEntries(transaction, promotionDocs, nowMs);
        if (promotedCount <= 0) {
          return 0;
        }

        transaction.set(stateRef, {
          ...queueState,
          pendingAdmissionCount: queueState.pendingAdmissionCount + promotedCount,
          currentNumber: queueState.currentNumber + promotedCount,
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
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId } = data?.data || data;
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId媛 ?꾩슂?⑸땲??');
  }

  const adminSnapshot = await db.doc(`admins/${auth.uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData || (adminData.role !== 'MASTER' && adminData.assignedSchoolId !== schoolId)) {
    throw new functions.https.HttpsError('permission-denied', '?대떦 ?숆탳 ?뺣낫瑜?議고쉶??沅뚰븳???놁뒿?덈떎.');
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
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId, action } = data?.data || data;
  if (!schoolId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId? action???꾩슂?⑸땲??');
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
    await Promise.all(queueCleanupResult.clearedUserIds.map((userId) => clearQueueNumberFromRtdb(schoolId, round.id, userId)));

    const queueState = await recalculateQueueState(db, schoolId);
    return {
      success: true,
      action,
      expiredCount,
      expiredQueueCount: queueCleanupResult.expiredWaiting + queueCleanupResult.expiredEligible,
      queueState
    };
  }

  throw new functions.https.HttpsError('invalid-argument', '吏?먰븯吏 ?딅뒗 action?낅땲??');
});

async function deleteCollectionInBatches(
  collection: admin.firestore.CollectionReference,
  batchSize = 200
) {
  while (true) {
    const snapshot = await collection.limit(batchSize).get();
    if (snapshot.empty) {
      return;
    }

    const batch = admin.firestore().batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

export const resetSchoolState = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const db = admin.firestore();
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '濡쒓렇?몄씠 ?꾩슂?⑸땲??');
  }

  const { schoolId } = data?.data || data;
  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId媛 ?꾩슂?⑸땲??');
  }

  const adminSnapshot = await db.doc(`admins/${auth.uid}`).get();
  const adminData = adminSnapshot.data();
  if (!adminSnapshot.exists || !adminData || adminData.role !== 'MASTER') {
    throw new functions.https.HttpsError('permission-denied', 'MASTER 沅뚰븳???꾩슂?⑸땲??');
  }

  const schoolRef = db.doc(`schools/${schoolId}`);
  const schoolSnapshot = await schoolRef.get();
  if (!schoolSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', '?숆탳 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
  }

  const schoolData = schoolSnapshot.data()!;
  const now = Date.now();

  await Promise.all([
    deleteCollectionInBatches(queueEntriesRef(db, schoolId)),
    deleteCollectionInBatches(reservationsRef(db, schoolId)),
    deleteCollectionInBatches(db.collection(`schools/${schoolId}/registrations`)),
    deleteCollectionInBatches(db.collection(`schools/${schoolId}/requestLocks`))
  ]);
  await queueIssuerRef(schoolId, 'round1').remove();
  await queueIssuerRef(schoolId, 'round2').remove();

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

  return { success: true };
});

