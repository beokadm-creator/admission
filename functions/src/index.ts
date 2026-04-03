/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import axios from 'axios';
export {
  autoAdvanceQueue,
  cleanupExpiredReservations,
  confirmReservation,
  forceExpireSession,
  getAdminReservations,
  getReservationSession,
  heartbeatQueuePresence,
  joinQueue,
  resetSchoolState,
  runAdminQueueAction,
  startRegistrationSession
} from './firestoreQueue';

if (admin.apps.length === 0) {
  admin.initializeApp({
    databaseURL:
      process.env.FIREBASE_DATABASE_URL || 'https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
}

const functionsConfig = (() => {
  try {
    return (functionsV1 as any).config();
  } catch {
    return {};
  }
})();

const firestoreTriggers = functionsV1.firestore;
const NHN_APP_KEY = (functionsConfig as any).nhn?.appkey;
const NHN_SECRET_KEY = (functionsConfig as any).nhn?.secretkey;
const NHN_SENDER_KEY = (functionsConfig as any).nhn?.sender_key;

interface AlimTalkCredentials {
  appKey?: string;
  secretKey?: string;
  senderKey?: string;
}

interface AdmissionRoundConfig {
  id: string;
  label: string;
  openDateTime: string;
  maxCapacity: number;
  waitlistCapacity: number;
  enabled: boolean;
}

interface NormalizedCallableRequest {
  data: any;
  auth: any;
  rawRequest: any;
}

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

function getRateLimitIdentifier(rawRequest: any, fallback: string) {
  const ipAddress =
    rawRequest?.ip ||
    rawRequest?.headers?.['x-forwarded-for'] ||
    rawRequest?.headers?.['fastly-client-ip'];

  if (typeof ipAddress === 'string' && ipAddress.trim().length > 0) {
    return `ip_${ipAddress.split(',')[0].trim()}`;
  }

  return fallback;
}

function normalizeAdmissionRounds(schoolData: any): AdmissionRoundConfig[] {
  if (Array.isArray(schoolData?.admissionRounds) && schoolData.admissionRounds.length > 0) {
    return schoolData.admissionRounds;
  }

  return [
    {
      id: 'round1',
      label: '1차',
      openDateTime: schoolData?.openDateTime || '',
      maxCapacity: Number(schoolData?.maxCapacity || 0),
      waitlistCapacity: Number(schoolData?.waitlistCapacity || 0),
      enabled: true
    }
  ];
}

function getRoundCapacity(schoolData: any, roundId?: string | null) {
  const round = normalizeAdmissionRounds(schoolData).find((item) => item.id === roundId) || normalizeAdmissionRounds(schoolData)[0];
  return {
    roundId: round.id,
    totalCapacity: Number(round.maxCapacity || 0) + Number(round.waitlistCapacity || 0)
  };
}

async function checkRateLimit(
  db: admin.firestore.Firestore,
  identifier: string,
  maxRequests = 5,
  windowMs = 60000
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

async function assertAdminAccessToSchool(uid: string, schoolId: string) {
  const adminDoc = await admin.firestore().doc(`admins/${uid}`).get();
  const adminData = adminDoc.data();

  if (!adminDoc.exists || !adminData) {
    throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다.');
  }

  if (adminData.role === 'MASTER') {
    return adminData;
  }

  if (adminData.role === 'SCHOOL' && adminData.assignedSchoolId === schoolId) {
    return adminData;
  }

  throw new functions.https.HttpsError('permission-denied', '이 학교에 대한 접근 권한이 없습니다.');
}

async function getSchoolAlimTalkConfig(schoolId: string) {
  const [schoolDoc, privateSettingsDoc] = await Promise.all([
    admin.firestore().doc(`schools/${schoolId}`).get(),
    admin.firestore().doc(`schools/${schoolId}/privateSettings/alimtalk`).get()
  ]);

  return {
    schoolConfig: schoolDoc.exists ? schoolDoc.data() : null,
    credentials: {
      appKey: privateSettingsDoc.data()?.nhnAppKey || NHN_APP_KEY,
      secretKey: privateSettingsDoc.data()?.nhnSecretKey || NHN_SECRET_KEY,
      senderKey: privateSettingsDoc.data()?.nhnSenderKey || NHN_SENDER_KEY
    } as AlimTalkCredentials
  };
}

async function sendAlimTalk(to: string, templateCode: string, templateParams: any, credentials?: AlimTalkCredentials) {
  const appKey = credentials?.appKey || NHN_APP_KEY;
  const secretKey = credentials?.secretKey || NHN_SECRET_KEY;
  const senderKey = credentials?.senderKey || NHN_SENDER_KEY;

  if (!appKey || !secretKey || !senderKey) {
    functions.logger.warn('[AlimTalk] Missing NHN credentials. Skipping send.');
    return;
  }

  const url = `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/${appKey}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        senderKey,
        templateCode,
        recipientList: [
          {
            recipientNo: to.replace(/-/g, ''),
            templateParameter: templateParams
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'X-Secret-Key': secretKey
        }
      }
    );

    if (!response.data?.header?.isSuccessful) {
      functions.logger.error('[AlimTalk] Send failed', response.data);
    }
  } catch (error) {
    functions.logger.error('[AlimTalk] Error sending message', error);
  }
}

export const onRegistrationDelete = firestoreTriggers
  .document('schools/{schoolId}/registrations/{registrationId}')
  .onDelete(async (snap, context) => {
    const deletedData = snap.data();
    const schoolId = context.params.schoolId;
    const status = deletedData?.status;

    if (status !== 'confirmed' && status !== 'waitlisted') {
      return;
    }

    const schoolRef = admin.firestore().doc(`schools/${schoolId}`);
    const roundMeta = getRoundCapacity((deletedData || {}) as any, deletedData?.admissionRoundId);
    const queueStateRef = admin.firestore().doc(`schools/${schoolId}/queueState/${roundMeta.roundId}`);

    await admin.firestore().runTransaction(async (transaction) => {
      const [schoolDoc, queueStateDoc] = await Promise.all([
        transaction.get(schoolRef),
        transaction.get(queueStateRef)
      ]);

      if (!schoolDoc.exists) {
        return;
      }

      const schoolData = schoolDoc.data()!;
      const confirmedCount = Math.max(0, Number(schoolData.stats?.confirmedCount || 0) - (status === 'confirmed' ? 1 : 0));
      const waitlistedCount = Math.max(0, Number(schoolData.stats?.waitlistedCount || 0) - (status === 'waitlisted' ? 1 : 0));
      const totalCapacity = Number(queueStateDoc.data()?.totalCapacity || roundMeta.totalCapacity);
      const activeReservationCount = Number(queueStateDoc.data()?.activeReservationCount || 0);
      const updatedAt = Date.now();

      transaction.set(schoolRef, {
        stats: {
          confirmedCount,
          waitlistedCount
        },
        updatedAt
      }, { merge: true });

      transaction.set(queueStateRef, {
        confirmedCount,
        waitlistedCount,
        totalCapacity,
        availableCapacity: Math.max(0, totalCapacity - confirmedCount - waitlistedCount - activeReservationCount),
        updatedAt
      }, { merge: true });

      if (deletedData?.queueIdentityHash && roundMeta.roundId) {
        transaction.delete(
          admin.firestore().doc(`schools/${schoolId}/queueIdentityLocks/${roundMeta.roundId}_${deletedData.queueIdentityHash}`)
        );
      }
    });
  });

export const getAlimtalkTemplates = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, appKey, secretKey } = data;
  if (!appKey || !secretKey) {
    throw new functions.https.HttpsError('invalid-argument', 'App Key와 Secret Key가 필요합니다.');
  }

  if (!schoolId) {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
  }

  await assertAdminAccessToSchool(auth.uid, schoolId);

  const url = `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/${appKey}/templates`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': secretKey
      }
    });

    const responseBody = response.data || {};
    const isSuccessful = responseBody.header?.isSuccessful === true || response.status === 200;
    const templates =
      responseBody.templateList ||
      responseBody.templates ||
      responseBody.body?.templateList ||
      responseBody.body?.templates ||
      responseBody.data?.templateList ||
      responseBody.data?.templates ||
      [];

    if (!isSuccessful) {
      throw new functions.https.HttpsError('internal', responseBody.header?.resultMessage || 'NHN 템플릿 조회에 실패했습니다.');
    }

    return {
      success: true,
      templates
    };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.response?.data?.message || error.message || '템플릿 조회 중 오류가 발생했습니다.');
  }
});

export const lookupRegistration = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const { data } = normalizeCallableRequest(request, legacyContext);
  const { schoolId, studentName, phoneLast4 } = data?.data || data;

  if (!schoolId || !studentName || !phoneLast4) {
    throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
  }

  const snapshot = await admin
    .firestore()
    .collection(`schools/${schoolId}/registrations`)
    .where('studentName', '==', studentName.trim())
    .where('phoneLast4', '==', phoneLast4)
    .orderBy('submittedAt', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError('not-found', '일치하는 신청 내역이 없습니다.');
  }

  const doc = snapshot.docs[0];
  const reg = doc.data();

  return {
    success: true,
    registration: {
      id: doc.id,
      studentName: reg.studentName,
      phone: typeof reg.phone === 'string' ? reg.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : null,
      status: reg.status,
      rank: reg.rank ?? null,
      submittedAt: reg.submittedAt,
      updatedAt: reg.updatedAt
    }
  };
});

export const cancelRegistration = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const { data, rawRequest } = normalizeCallableRequest(request, legacyContext);
  const { schoolId, registrationId, studentName, phoneLast4 } = data?.data || data;
  const cancelRateLimit = await checkRateLimit(
    admin.firestore(),
    getRateLimitIdentifier(rawRequest, `cancelRegistration_${schoolId}_${registrationId}_${String(phoneLast4)}`),
    5,
    60000
  );

  if (!cancelRateLimit.allowed) {
    throw new functions.https.HttpsError('resource-exhausted', `요청이 너무 빈번합니다. ${cancelRateLimit.retryAfter}초 후에 다시 시도해 주세요.`);
  }

  if (!schoolId || !registrationId || !studentName || !phoneLast4) {
    throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
  }

  if (typeof phoneLast4 !== 'string' || !/^\d{4}$/.test(phoneLast4)) {
    throw new functions.https.HttpsError('invalid-argument', '전화번호 뒤 4자리가 올바르지 않습니다.');
  }

  const regRef = admin.firestore().doc(`schools/${schoolId}/registrations/${registrationId}`);
  const schoolRef = admin.firestore().doc(`schools/${schoolId}`);

  await admin.firestore().runTransaction(async (transaction) => {
    const [regDoc, schoolDoc] = await Promise.all([
      transaction.get(regRef),
      transaction.get(schoolRef)
    ]);

    if (!regDoc.exists) {
      throw new functions.https.HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
    }

    if (!schoolDoc.exists) {
      throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
    }

    const reg = regDoc.data()!;
    const schoolData = schoolDoc.data()!;
    const roundMeta = getRoundCapacity(schoolData, reg.admissionRoundId);
    const queueStateRef = admin.firestore().doc(`schools/${schoolId}/queueState/${roundMeta.roundId}`);
    const queueStateDoc = await transaction.get(queueStateRef);
    const queueState = queueStateDoc.exists ? queueStateDoc.data() || {} : {};
    const currentConfirmed = Number(schoolData.stats?.confirmedCount || 0);
    const currentWaitlisted = Number(schoolData.stats?.waitlistedCount || 0);
    const activeReservationCount = Number(queueState.activeReservationCount || 0);
    const totalCapacity = Number(queueState.totalCapacity || roundMeta.totalCapacity);

    if (reg.studentName !== studentName.trim() || reg.phoneLast4 !== phoneLast4) {
      throw new functions.https.HttpsError('permission-denied', '본인 확인에 실패했습니다.');
    }

    if (reg.status === 'canceled') {
      throw new functions.https.HttpsError('failed-precondition', '이미 취소된 신청입니다.');
    }

    const prevStatus = reg.status as 'confirmed' | 'waitlisted';
    const confirmedCount = Math.max(0, currentConfirmed - (prevStatus === 'confirmed' ? 1 : 0));
    const waitlistedCount = Math.max(0, currentWaitlisted - (prevStatus === 'waitlisted' ? 1 : 0));
    const updatedAt = Date.now();

    transaction.update(regRef, {
      status: 'canceled',
      updatedAt,
      cancellationReason: 'user_requested'
    });
    if (reg.queueIdentityHash && roundMeta.roundId) {
      transaction.delete(
        admin.firestore().doc(`schools/${schoolId}/queueIdentityLocks/${roundMeta.roundId}_${reg.queueIdentityHash}`)
      );
    }

    transaction.set(schoolRef, {
      stats: {
        confirmedCount,
        waitlistedCount
      },
      updatedAt
    }, { merge: true });

    transaction.set(queueStateRef, {
      confirmedCount,
      waitlistedCount,
      totalCapacity,
      availableCapacity: Math.max(0, totalCapacity - confirmedCount - waitlistedCount - activeReservationCount),
      updatedAt
    }, { merge: true });
  });

  return { success: true };
});

export const syncSchoolSlots = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
  const { data, auth } = normalizeCallableRequest(request, legacyContext);
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { schoolId, total } = data?.data || data;
  if (!schoolId || typeof total !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'schoolId와 total이 필요합니다.');
  }

  await assertAdminAccessToSchool(auth.uid, schoolId);

  const queueStateRef = admin.firestore().doc(`schools/${schoolId}/queueState/round1`);
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(queueStateRef);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const confirmedCount = Number(current.confirmedCount || 0);
    const waitlistedCount = Number(current.waitlistedCount || 0);
    const activeReservationCount = Number(current.activeReservationCount || 0);
    const updatedAt = Date.now();

    transaction.set(queueStateRef, {
      totalCapacity: total,
      availableCapacity: Math.max(0, total - confirmedCount - waitlistedCount - activeReservationCount),
      updatedAt
    }, { merge: true });
  });

  return { success: true };
});

export const runMaintenanceTask = functionsV1.https.onCall(async () => {
  return {
    success: true,
    message: 'Legacy RTDB maintenance tasks were removed. Use Firestore queue jobs instead.'
  };
});

export const onRegistrationCreateQueued = firestoreTriggers
  .document('schools/{schoolId}/registrations/{registrationId}')
  .onCreate(async (snap, context) => {
    const newData = snap.data();
    const schoolId = context.params.schoolId;

    if (newData.agreedSms !== true) {
      return;
    }

    const { schoolConfig, credentials } = await getSchoolAlimTalkConfig(schoolId);
    if (!schoolConfig) {
      return;
    }

    const alimtalkSettings = schoolConfig?.alimtalkSettings;
    if (!alimtalkSettings) {
      return;
    }

    const templateParams = {
      studentName: newData.studentName,
      schoolName: schoolConfig?.name || '학교'
    };

    if (newData.status === 'confirmed' && alimtalkSettings.successTemplate) {
      await sendAlimTalk(newData.phone, alimtalkSettings.successTemplate, templateParams, credentials);
    }

    if (newData.status === 'waitlisted' && alimtalkSettings.waitlistTemplate) {
      await sendAlimTalk(newData.phone, alimtalkSettings.waitlistTemplate, {
        ...templateParams,
        rank: newData.rank || 'Unknown'
      }, credentials);
    }
  });

export const onRegistrationUpdateQueued = firestoreTriggers
  .document('schools/{schoolId}/registrations/{registrationId}')
  .onUpdate(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();
    const schoolId = context.params.schoolId;

    if (newData.agreedSms !== true) {
      return;
    }

    if (oldData.status === 'waitlisted' && newData.status === 'confirmed') {
      const { schoolConfig, credentials } = await getSchoolAlimTalkConfig(schoolId);
      const alimtalkSettings = schoolConfig?.alimtalkSettings;

      if (alimtalkSettings?.promoteTemplate) {
        await sendAlimTalk(newData.phone, alimtalkSettings.promoteTemplate, {
          studentName: newData.studentName,
          schoolName: schoolConfig?.name || '학교'
        }, credentials);
      }
    }
  });

