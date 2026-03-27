import * as functions from 'firebase-functions';
import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { randomBytes } from 'crypto';

// Firebase Admin SDK 초기화 (ADC 사용)
admin.initializeApp();

// 환경 변수에서 NHN Cloud 설정 가져오기
// 사용법: firebase functions:config:set nhn.appkey="YOUR_APP_KEY" nhn.secretkey="YOUR_SECRET_KEY" nhn.sender="01012345678"
const functionsConfig = (() => {
    try {
        return (functionsV1 as any).config();
    } catch (error) {
        return {};
    }
})();
const firestoreTriggers = functionsV1.firestore;
const pubsubTriggers = functionsV1.pubsub;
const NHN_APP_KEY = (functionsConfig as any).nhn?.appkey;
const NHN_SECRET_KEY = (functionsConfig as any).nhn?.secretkey;

// 알림톡 발송 함수
async function sendAlimTalk(to: string, templateCode: string, templateParams: any) {
    if (!NHN_APP_KEY || !NHN_SECRET_KEY) {
        console.error("NHN Cloud credentials are not configured.");
        return;
    }

    const url = `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/${NHN_APP_KEY}/messages`;

    // 템플릿 파라미터가 없으면 빈 객체로 설정
    // 실제 구현 시 템플릿에 따라 필요한 파라미터를 매핑해야 합니다.
    // 여기서는 단순히 templateParameter 맵을 전달한다고 가정합니다.

    // NHN Cloud API 헤더 설정 (AppKey는 URL에 포함됨, SecretKey는 X-Secret-Key 헤더로 보낼 수도 있고, SenderKey는 바디에 포함)
    // 알림톡은 보통 SenderKey(카카오 채널 키)를 사용함.
    // 여기서는 사용자가 "App Key, Secret Key 등은 Firebase 환경변수로 관리"라고 했으므로
    // nhn.secretkey를 X-Secret-Key 헤더로 사용하고, nhn.senderkey를 바디의 senderKey로 사용하는 것이 정확함.
    // 하지만 정보가 부족하므로 nhn.secretkey를 senderKey로 가정하거나, 추가 설정이 필요함을 주석으로 남김.

    // 수정: NHN Cloud AlimTalk API v1.5 기준
    // POST /alimtalk/v1.5/appkeys/{appKey}/messages
    // Header: X-Secret-Key: {secretKey}
    // Body: senderKey: {senderKey} (카카오 비즈니스 채널 키)

    // 사용자가 Secret Key라고 했지만 알림톡 발송에는 Sender Key가 필수임.
    // 따라서 config에 nhn.sender_key 도 추가로 필요하다고 가정하고 코드를 작성함.
    const NHN_SENDER_KEY = (functionsConfig as any).nhn?.sender_key;

    if (!NHN_SENDER_KEY) {
        console.error("NHN Sender Key (Kakao Channel Key) is missing.");
        return;
    }

    try {
        const response = await axios.post(url, {
            senderKey: NHN_SENDER_KEY,
            templateCode: templateCode,
            recipientList: [{
                recipientNo: to.replace(/-/g, ''),
                templateParameter: templateParams
            }]
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'X-Secret-Key': NHN_SECRET_KEY
            }
        });

        if (response.data.header.isSuccessful) {
            console.log(`AlimTalk sent to ${to} (Template: ${templateCode})`);
        } else {
            console.error(`AlimTalk failed: ${response.data.header.resultMessage}`);
        }
    } catch (error) {
        console.error("Error sending AlimTalk:", error);
    }
}

// 1. onCreate 트리거: 직접 발송 방식 (onRegistrationCreateQueued로 대체됨, 중복 방지를 위해 비활성화)
// export const onRegistrationCreate = ... (하단 onRegistrationCreateQueued 사용)
const _unusedOnRegistrationCreate = firestoreTriggers
    .document('schools/{schoolId}/registrations/{registrationId}')
    .onCreate(async (snap, context) => {
        const newData = snap.data();
        const schoolId = context.params.schoolId;

        // 문자 수신 동의 확인
        if (newData.agreedSms !== true) {
            console.log("User did not agree to SMS/AlimTalk.");
            return;
        }

        // 학교 설정 가져오기 (템플릿 코드 조회)
        const schoolDoc = await admin.firestore().doc(`schools/${schoolId}`).get();
        if (!schoolDoc.exists) {
            console.error(`School ${schoolId} not found.`);
            return;
        }
        const schoolConfig = schoolDoc.data();
        const alimtalkSettings = schoolConfig?.alimtalkSettings;

        if (!alimtalkSettings) {
            console.log("AlimTalk settings not found for this school.");
            return;
        }

        const templateParams = {
            studentName: newData.studentName,
            schoolName: schoolConfig?.name || "학교",
            // 필요한 경우 추가 파라미터 매핑
        };

        if (newData.status === 'confirmed') {
            if (alimtalkSettings.successTemplate) {
                await sendAlimTalk(newData.phone, alimtalkSettings.successTemplate, templateParams);
            }
        } else if (newData.status === 'waitlisted') {
            if (alimtalkSettings.waitlistTemplate) {
                // 대기 순번 추가
                const waitlistParams = {
                    ...templateParams,
                    rank: newData.rank || "Unknown"
                };
                await sendAlimTalk(newData.phone, alimtalkSettings.waitlistTemplate, waitlistParams);
            }
        }
    });

// 2. onUpdate 트리거: 상태 변경 시 (대기 -> 확정) 승급 알림톡 발송
const _unusedOnRegistrationUpdate = firestoreTriggers
    .document('schools/{schoolId}/registrations/{registrationId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const oldData = change.before.data();
        const schoolId = context.params.schoolId;

        // 문자 수신 동의 확인
        if (newData.agreedSms !== true) {
            return;
        }

        // 상태가 waitlisted -> confirmed 로 변경된 경우만 처리
        if (oldData.status === 'waitlisted' && newData.status === 'confirmed') {
             // 학교 설정 가져오기
            const schoolDoc = await admin.firestore().doc(`schools/${schoolId}`).get();
            const schoolConfig = schoolDoc.data();
            const alimtalkSettings = schoolConfig?.alimtalkSettings;

            if (alimtalkSettings && alimtalkSettings.promoteTemplate) {
                const templateParams = {
                    studentName: newData.studentName,
                    schoolName: schoolConfig?.name || "학교"
                };
                await sendAlimTalk(newData.phone, alimtalkSettings.promoteTemplate, templateParams);
            }
        }

        // canceled로 변경 시에는 발송하지 않음 (요구사항)
    });

// 3. onDelete 트리거: 신청 내역 삭제 시 통계 및 슬롯 복구
export const onRegistrationDelete = firestoreTriggers
    .document('schools/{schoolId}/registrations/{registrationId}')
    .onDelete(async (snap, context) => {
        const deletedData = snap.data();
        const schoolId = context.params.schoolId;
        const status = deletedData?.status;

        if (status === 'confirmed' || status === 'waitlisted') {
            const schoolRef = admin.firestore().doc(`schools/${schoolId}`);
            const updateField = status === 'confirmed' ? 'stats.confirmedCount' : 'stats.waitlistedCount';
            
            try {
                // Firestore 통계 업데이트
                await schoolRef.update({
                    [updateField]: admin.firestore.FieldValue.increment(-1)
                });

                // RTDB slots 업데이트 (슬롯 반환)
                const now = Date.now();
                await admin.database().ref(`slots/${schoolId}`).transaction((current: SlotData | null) => {
                    if (!current) return;
                    return {
                        ...current,
                        confirmed: Math.max(0, (current.confirmed || 0) - 1),
                        available: (current.available || 0) + 1,
                        lastUpdated: now
                    };
                });
                
                functions.logger.info(`[RegistrationDelete] Success: ${context.params.registrationId} (School: ${schoolId}, Status: ${status})`);
            } catch (error) {
                functions.logger.error(`[RegistrationDelete] Error:`, error);
            }
        }
    });

// 3. HTTP 트리거: NHN 알림톡 템플릿 목록 조회
export const getAlimtalkTemplates = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    functions.logger.info('[AlimTalk Template Fetch] Function invoked', new Date().toISOString());
    
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '??? ?????.');
    }

    const { appKey, secretKey } = data;

    if (!appKey || !secretKey) {
        throw new functions.https.HttpsError('invalid-argument', 'App Key? Secret Key? ?????.');
    }

    const url = `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/${appKey}/templates`;

    try {
        console.log(`[AlimTalk] Fetching templates from: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'X-Secret-Key': secretKey
            }
        });

        console.log(`[AlimTalk] API Response Status:`, response.status);
        console.log(`[AlimTalk] API Response Data:`, JSON.stringify(response.data));

        const responseBody = response.data || {};
        const isSuccessful =
            responseBody.header?.isSuccessful === true ||
            responseBody.isSuccessful === true ||
            response.status === 200;

        const templates =
            responseBody.templateList ||
            responseBody.templates ||
            responseBody.body?.templateList ||
            responseBody.body?.templates ||
            responseBody.data?.templateList ||
            responseBody.data?.templates ||
            responseBody.result?.templateList ||
            responseBody.result?.templates ||
            [];

        if (isSuccessful) {
            console.log(`[AlimTalk] Found ${templates.length} templates`);
            
            return {
                success: true,
                templates: templates
            };
        } else {
            const errorMsg =
                responseBody.header?.resultMessage ||
                responseBody.body?.message ||
                responseBody.data?.message ||
                responseBody.message ||
                '? ? ?? ??';
            console.error(`[AlimTalk] API Error: ${errorMsg}`);
            throw new functions.https.HttpsError('internal', `NHN API ??: ${errorMsg}`);
        }
    } catch (error: any) {
        console.error('[AlimTalk] Error fetching templates:', error.response?.data || error.message);
        
        if (error.response) {
            console.error('[AlimTalk] Error response status:', error.response.status);
            console.error('[AlimTalk] Error response data:', JSON.stringify(error.response.data));
        }
        
        throw new functions.https.HttpsError('internal', `??? ?? ??: ${error.response?.data?.message || error.message}`);
    }
});

// ============ Slot Reservation System (RTDB) ============

interface SlotData {
    total: number;
    reserved: number;
    confirmed: number;
    available: number;
    lastUpdated: number;
}

interface ReservationData {
    userId: string;
    status: 'reserved' | 'processing' | 'confirmed' | 'expired';
    createdAt: number;
    expiresAt: number;
    queueNumber?: number | null;
    data?: any;
    processingAt?: number;
    confirmedAt?: number;
    expiredAt?: number;
    finalStatus?: 'confirmed' | 'waitlisted';
    registrationId?: string;
}

interface QueueMetaData {
    currentNumber: number;
    lastAssignedNumber: number;
    lastAdvancedAt: number;
    updatedAt: number;
}

interface QueueEntryData {
    number: number;
    joinedAt: number;
    lastSeenAt: number;
}

interface QueueStateData {
    meta?: QueueMetaData;
    entries?: Record<string, QueueEntryData>;
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

function getTotalCapacity(schoolData: admin.firestore.DocumentData) {
    const maxCapacity = schoolData.maxCapacity || 0;
    const waitlistCapacity = schoolData.waitlistCapacity || 0;

    return {
        maxCapacity,
        waitlistCapacity,
        totalCapacity: maxCapacity + waitlistCapacity
    };
}

function isQueueEnabled(schoolData: admin.firestore.DocumentData) {
    return schoolData.queueSettings?.enabled !== false;
}

function assertSchoolOpen(schoolData: admin.firestore.DocumentData) {
    if (schoolData.isActive === false) {
        throw new functions.https.HttpsError('failed-precondition', '현재 등록을 받지 않습니다.');
    }

    const openTime = new Date(schoolData.openDateTime || 0).getTime();

    if (!openTime || Number.isNaN(openTime)) {
        throw new functions.https.HttpsError('failed-precondition', '등록 시작 시간이 설정되지 않았습니다.');
    }

    if (Date.now() < openTime) {
        throw new functions.https.HttpsError('failed-precondition', '아직 등록 시작 시간이 아닙니다.');
    }
}

function getQueueMeta(queueState: QueueStateData | null | undefined): QueueMetaData {
    return {
        currentNumber: queueState?.meta?.currentNumber || 0,
        lastAssignedNumber: queueState?.meta?.lastAssignedNumber || 0,
        lastAdvancedAt: queueState?.meta?.lastAdvancedAt || 0,
        updatedAt: queueState?.meta?.updatedAt || 0
    };
}

async function getSchoolData(schoolId: string) {
    const schoolDoc = await admin.firestore().doc(`schools/${schoolId}`).get();

    if (!schoolDoc.exists) {
        throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
    }

    return schoolDoc.data()!;
}

async function assertMasterAdmin(uid: string) {
    const adminDoc = await admin.firestore().doc(`admins/${uid}`).get();
    const adminData = adminDoc.data();

    if (!adminDoc.exists || adminData?.role !== 'MASTER') {
        throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다.');
    }

    return adminData;
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

async function findActiveReservation(schoolId: string, userId: string) {
    const snapshot = await admin.database()
        .ref(`reservations/${schoolId}`)
        .orderByChild('userId')
        .equalTo(userId)
        .once('value');

    if (!snapshot.exists()) {
        return null;
    }

    const now = Date.now();
    let activeReservation: (ReservationData & { id: string }) | null = null;

    snapshot.forEach((child) => {
        const reservation = child.val() as ReservationData;

        if (
            reservation.status === 'reserved' &&
            reservation.expiresAt > now &&
            (!activeReservation || reservation.expiresAt > activeReservation.expiresAt)
        ) {
            activeReservation = {
                ...reservation,
                id: child.key as string
            };
        }
    });

    return activeReservation;
}

async function expireReservation(schoolId: string, sessionId: string, now: number) {
    const reservationRef = admin.database().ref(`reservations/${schoolId}/${sessionId}`);

    // 트랜잭션으로 status 변경 — 이미 처리된 세션은 commit되지 않아 슬롯 이중 반환을 막음
    const txResult = await reservationRef.transaction((current: ReservationData | null) => {
        if (!current || current.status !== 'reserved') return; // 이미 처리됨 → abort
        return { ...current, status: 'expired', expiredAt: now };
    });

    if (!txResult.committed) return; // 이미 만료/확정된 세션이므로 슬롯 반환 불필요

    const expiredData = txResult.snapshot.val() as ReservationData;
    if (expiredData && expiredData.userId) {
        // 사용자의 대기열 번호도 무효화하여 재진입 시 새로운 번호를 받도록 함
        await admin.database().ref(`queue/${schoolId}/entries/${expiredData.userId}`).remove();
    }

    await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
        if (!currentData) return currentData;
        return {
            ...currentData,
            reserved: Math.max(0, currentData.reserved - 1),
            available: currentData.available + 1,
            lastUpdated: now
        };
    });
}

async function restoreProcessingReservation(
    schoolId: string,
    sessionId: string,
    userId: string,
    now: number
) {
    await admin.database().ref(`reservations/${schoolId}/${sessionId}`).transaction((current: ReservationData | null) => {
        if (!current || current.userId !== userId || current.status !== 'processing') {
            return;
        }

        if (current.expiresAt <= now) {
            return {
                ...current,
                status: 'expired',
                expiredAt: now
            };
        }

        return {
            ...current,
            status: 'reserved',
            processingAt: null
        } as any;
    });
}

async function finalizeReservedSlot(schoolId: string, now: number) {
    const schoolData = await getSchoolData(schoolId);
    const { totalCapacity } = getTotalCapacity(schoolData);
    const slotResult = await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
        if (!currentData) {
            return {
                total: totalCapacity,
                reserved: 0,
                confirmed: 1,
                available: Math.max(0, totalCapacity - 1),
                lastUpdated: now
            };
        }

        return {
            ...currentData,
            reserved: Math.max(0, currentData.reserved - 1),
            confirmed: currentData.confirmed + 1,
            lastUpdated: now
        };
    });

    return slotResult.committed;
}

async function rollbackFinalizedSlot(schoolId: string, now: number) {
    await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
        if (!currentData || currentData.confirmed <= 0) {
            return currentData;
        }

        return {
            ...currentData,
            reserved: currentData.reserved + 1,
            confirmed: Math.max(0, currentData.confirmed - 1),
            lastUpdated: now
        };
    });
}

async function handleConfirmReservation(
    schoolId: string,
    sessionId: string,
    userId: string,
    sanitizedFormData: any
) {
    const reservationRef = admin.database().ref(`reservations/${schoolId}/${sessionId}`);
    const registrationRef = admin.firestore().doc(`schools/${schoolId}/registrations/${sessionId}`);
    let lockedReservation = false;
    let slotFinalized = false;
    let finalResult: { registrationId: string; status: 'confirmed' | 'waitlisted'; rank?: number | null } | null = null;

    try {
        const initialReservationSnapshot = await reservationRef.once('value');
        const initialReservation = initialReservationSnapshot.val() as ReservationData | null;

        if (!initialReservation) {
            throw new functions.https.HttpsError('failed-precondition', '유효하지 않은 세션입니다.');
        }

        if (initialReservation.userId !== userId) {
            throw new functions.https.HttpsError('permission-denied', '이 세션에 접근할 수 없습니다.');
        }

        if (initialReservation.status === 'confirmed' && initialReservation.registrationId) {
            const existingRegistration = await registrationRef.get();
            return {
                success: true,
                registrationId: initialReservation.registrationId,
                status: (existingRegistration.data()?.status || initialReservation.finalStatus || 'confirmed') as 'confirmed' | 'waitlisted'
            };
        }

        const now = Date.now();
        if (now > initialReservation.expiresAt) {
            await expireReservation(schoolId, sessionId, now);
            throw new functions.https.HttpsError('deadline-exceeded', '세션이 만료되었습니다. 다시 시도해주세요.');
        }

        let lockOutcome: string = 'unchanged';
        const lockResult = await reservationRef.transaction((current: ReservationData | null) => {
            if (!current || current.userId !== userId) {
                return;
            }

            if (current.status !== 'reserved') {
                return;
            }

            if (current.expiresAt <= now) {
                lockOutcome = 'expired';
                return {
                    ...current,
                    status: 'expired',
                    expiredAt: now
                };
            }

            lockOutcome = 'processing';
            return {
                ...current,
                status: 'processing',
                processingAt: now
            };
        });

        const lockedState = (await reservationRef.once('value')).val() as ReservationData | null;
        if (!lockedState || lockedState.userId !== userId) {
            throw new functions.https.HttpsError('failed-precondition', '유효하지 않은 등록 세션입니다.');
        }

        if (lockOutcome === 'expired' || lockedState.status === 'expired') {
            throw new functions.https.HttpsError('deadline-exceeded', '세션이 만료되었습니다. 다시 시도해주세요.');
        }

        lockedReservation = true;

        const didFinalizeSlot = await finalizeReservedSlot(schoolId, now);
        if (!didFinalizeSlot) {
            throw new functions.https.HttpsError('resource-exhausted', 'SLOT_STATE_INVALID');
        }
        slotFinalized = true;

        const schoolRef = admin.firestore().doc(`schools/${schoolId}`);
        finalResult = await admin.firestore().runTransaction(async (transaction) => {
            const schoolDoc = await transaction.get(schoolRef);
            const existingRegDoc = await transaction.get(registrationRef);

            if (!schoolDoc.exists) {
                throw new Error('School not found');
            }

            if (existingRegDoc.exists) {
                const existingData = existingRegDoc.data()!;
                return {
                    registrationId: existingRegDoc.id,
                    status: existingData.status as 'confirmed' | 'waitlisted',
                    rank: existingData.rank ?? null
                };
            }

            const duplicateSnapshot = await transaction.get(
                admin.firestore()
                    .collection(`schools/${schoolId}/registrations`)
                    .where('phone', '==', sanitizedFormData.phone)
                    .where('status', 'in', ['confirmed', 'waitlisted'])
                    .limit(1)
            );
            if (!duplicateSnapshot.empty) {
                throw new functions.https.HttpsError('already-exists', '이미 동일한 전화번호로 신청된 내역이 있습니다.');
            }

            const schoolData = schoolDoc.data()!;
            const maxCapacity = schoolData.maxCapacity || 0;
            const waitlistCapacity = schoolData.waitlistCapacity || 0;
            const confirmedCount = schoolData.stats?.confirmedCount || 0;
            const waitlistedCount = schoolData.stats?.waitlistedCount || 0;

            let status: 'confirmed' | 'waitlisted' = 'confirmed';
            let rank: number | null = null;

            if (confirmedCount < maxCapacity) {
                transaction.update(schoolRef, {
                    'stats.confirmedCount': confirmedCount + 1
                });
            } else if (waitlistedCount < waitlistCapacity) {
                status = 'waitlisted';
                rank = waitlistedCount + 1;
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': waitlistedCount + 1
                });
            } else {
                throw new Error('Capacity full');
            }

            transaction.set(registrationRef, {
                ...sanitizedFormData,
                sessionId,
                schoolId,
                status,
                rank,
                submittedAt: now,
                updatedAt: now
            });

            return {
                registrationId: registrationRef.id,
                status,
                rank
            };
        });

        await reservationRef.update({
            status: 'confirmed',
            data: sanitizedFormData,
            confirmedAt: now,
            finalStatus: finalResult.status,
            rank: finalResult.rank ?? null,
            registrationId: finalResult.registrationId,
            processingAt: null
        });

        return {
            success: true,
            registrationId: finalResult.registrationId,
            status: finalResult.status,
            rank: finalResult.rank ?? null
        };
    } catch (error) {
        if (!finalResult && slotFinalized) {
            await rollbackFinalizedSlot(schoolId, Date.now());
        }

        if (!finalResult && lockedReservation) {
            await restoreProcessingReservation(schoolId, sessionId, userId, Date.now());
        }

        if (!finalResult) {
            const existingRegistration = await registrationRef.get();
            if (existingRegistration.exists) {
                const existingData = existingRegistration.data()!;
                await reservationRef.update({
                    status: 'confirmed',
                    data: sanitizedFormData,
                    confirmedAt: Date.now(),
                    finalStatus: existingData.status,
                    rank: existingData.rank ?? null,
                    registrationId: existingRegistration.id,
                    processingAt: null
                });

                return {
                    success: true,
                    registrationId: existingRegistration.id,
                    status: existingData.status as 'confirmed' | 'waitlisted',
                    rank: existingData.rank ?? null
                };
            }
        }

        throw error;
    }
}

async function createReservationSession(schoolId: string, userId: string) {
    const schoolData = await getSchoolData(schoolId);
    assertSchoolOpen(schoolData);

    const queueEnabled = isQueueEnabled(schoolData);
    let queueNumber: number | null = null;

    if (queueEnabled) {
        const queueSnapshot = await admin.database().ref(`queue/${schoolId}`).once('value');
        const queueState = queueSnapshot.val() as QueueStateData | null;
        const queueMeta = getQueueMeta(queueState);
        const queueEntry = queueState?.entries?.[userId];

        if (!queueEntry) {
            throw new functions.https.HttpsError('failed-precondition', '대기열 번호가 없습니다. 먼저 대기열에 입장해주세요.');
        }

        if (queueEntry.number > queueMeta.currentNumber) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `아직 입장 가능한 순서가 아닙니다. my=${queueEntry.number}, current=${queueMeta.currentNumber}`
            );
        }

        queueNumber = queueEntry.number;
    }

    const existingReservation = await findActiveReservation(schoolId, userId);
    if (existingReservation) {
        return {
            success: true,
            sessionId: existingReservation.id,
            expiresAt: existingReservation.expiresAt,
            queueNumber: existingReservation.queueNumber ?? queueNumber
        };
    }

    const { totalCapacity } = getTotalCapacity(schoolData);
    const now = Date.now();
    const slotsRef = admin.database().ref(`slots/${schoolId}`);

    // 동시 다수 요청 시 RTDB 트랜잭션 충돌을 재시도(최대 5회, 지수 백오프)로 처리
    // 용량 소진(available=0)은 재시도 없이 즉시 에러 반환
    let committed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
        const result = await slotsRef.transaction((currentData: SlotData | null) => {
            if (!currentData) {
                return {
                    total: totalCapacity,
                    reserved: 1,
                    confirmed: 0,
                    available: totalCapacity - 1,
                    lastUpdated: now
                };
            }
            if (currentData.available <= 0) return; // 용량 소진 → abort
            return {
                ...currentData,
                total: totalCapacity,
                reserved: currentData.reserved + 1,
                available: currentData.available - 1,
                lastUpdated: now
            };
        });

        if (result.committed) {
            committed = true;
            break;
        }

        // 용량 소진(available=0)이면 재시도 불필요
        const snap = await slotsRef.once('value');
        const currentSlots = snap.val() as SlotData | null;
        if (currentSlots && currentSlots.available <= 0) break;

        // 일시적 충돌 → 지수 백오프 후 재시도
        await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt) + Math.random() * 50));
    }

    if (!committed) {
        throw new functions.https.HttpsError('resource-exhausted', '죄송합니다. 현재 가능한 등록 인원이 없습니다.');
    }

    const sessionId = `session_${Date.now()}_${randomBytes(12).toString('hex')}`;
    const expiresAt = Date.now() + (5 * 60 * 1000);

    await admin.database().ref(`reservations/${schoolId}/${sessionId}`).set({
        userId,
        status: 'reserved',
        createdAt: Date.now(),
        expiresAt,
        queueNumber
    } as ReservationData);

    return {
        success: true,
        sessionId,
        expiresAt,
        queueNumber
    };
}

export const joinQueue = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId } = data?.data || data;
    const userId = auth.uid;

    if (!schoolId) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    // joinQueue Rate Limiting (인당 1분에 3회)
    const joinRateLimit = await checkRateLimit(admin.firestore(), `joinQueue_${userId}`, 3, 60000);
    if (!joinRateLimit.allowed) {
        throw new functions.https.HttpsError(
            'resource-exhausted',
            `너무 빠른 요청입니다. ${joinRateLimit.retryAfter}초 후에 다시 시도해주세요.`
        );
    }

    const schoolData = await getSchoolData(schoolId);
    assertSchoolOpen(schoolData);

    if (!isQueueEnabled(schoolData)) {
        throw new functions.https.HttpsError('failed-precondition', '현재 학교는 대기열을 사용하지 않습니다.');
    }

    const queueRef = admin.database().ref(`queue/${schoolId}`);
    const now = Date.now();
    const result = await queueRef.transaction((currentData: QueueStateData | null) => {
        const nextState: QueueStateData = currentData || {};
        const meta = getQueueMeta(nextState);
        const entries = nextState.entries || {};
        const existingEntry = entries[userId];

        if (existingEntry) {
            // 이미 입장 순서가 지났는데 세션도 없는 경우(만료 등), 새로운 번호를 발급받을 수 있도록 함
            // 단, 여기서 세션 존재 여부를 알 수 없으므로, lastSeenAt이 너무 오래되었거나 
            // 클라이언트에서 명시적으로 초기화 요청을 할 때 혹은 입장이 한참 지난 경우를 고려하나
            // 단순하게는 cleanup에서 삭제해주는 것이 가장 깔끔함.
            // 여기서는 존재할 경우 일단 업데이트만 하고 유지.
            entries[userId] = {
                ...existingEntry,
                lastSeenAt: now
            };

            return {
                ...nextState,
                meta: {
                    ...meta,
                    updatedAt: now
                },
                entries
            };
        }

        const nextNumber = meta.lastAssignedNumber + 1;
        entries[userId] = {
            number: nextNumber,
            joinedAt: now,
            lastSeenAt: now
        };

        // 첫 사용자이거나 대기열이 비어있는 경우: 즉시 currentNumber를 동기화하여
        // autoAdvanceQueue 스케줄러(매 1분)를 기다리지 않고 바로 진입 가능하게 함
        const isFirstEntry = Object.keys(entries).length === 1;
        const needsImmediateAdvance = meta.currentNumber < nextNumber && (
            isFirstEntry ||
            meta.lastAdvancedAt === 0
        );
        const newCurrentNumber = needsImmediateAdvance
            ? nextNumber
            : meta.currentNumber;

        return {
            ...nextState,
            meta: {
                currentNumber: newCurrentNumber,
                lastAssignedNumber: nextNumber,
                lastAdvancedAt: needsImmediateAdvance ? now : meta.lastAdvancedAt,
                updatedAt: now
            },
            entries
        };
    });

    const queueState = result.snapshot?.val() as QueueStateData | null;
    const queueEntry = queueState?.entries?.[userId];
    const queueMeta = getQueueMeta(queueState);

    if (!queueEntry) {
        throw new functions.https.HttpsError('internal', '대기열 번호를 발급하지 못했습니다.');
    }

    return {
        success: true,
        number: queueEntry.number,
        currentNumber: queueMeta.currentNumber,
        lastAssignedNumber: queueMeta.lastAssignedNumber
    };
});

/**
 * Reserve a slot using RTDB transaction
 * Prevents "writing while capacity fills up" issue
 */
export const reserveSlot = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const logger = functions.logger;
    logger.info('[ReserveSlot] Function invoked', { timestamp: new Date().toISOString() });

    const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId } = data?.data || data;
    const userId = auth.uid;

    if (!schoolId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다 (schoolId).'
        );
    }

    try {
        const reservationSession = await createReservationSession(schoolId, userId);
        logger.info('[ReserveSlot] Success', {
            schoolId,
            sessionId: reservationSession.sessionId,
            expiresAt: reservationSession.expiresAt
        });
        return reservationSession;
    } catch (error: any) {
        logger.error('[ReserveSlot] Error:', error);

        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        throw new functions.https.HttpsError(
            'internal',
            '슬롯 예약 중 오류가 발생했습니다. 다시 시도해주세요.'
        );
    }
});

export const startRegistrationSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId } = data?.data || data;
    const userId = auth.uid;

    if (!schoolId) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    return createReservationSession(schoolId, userId);
});

/**
 * 클라이언트에서 세션 만료를 감지했을 때 서버에 알리는 엔드포인트.
 * expireReservation을 호출하여 슬롯 반환 + 대기열 entry 삭제를 보장한다.
 */
export const forceExpireSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId, sessionId } = data?.data || data;

    if (!schoolId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    await expireReservation(schoolId, sessionId, Date.now());

    return { success: true };
});

export const getReservationSession = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId, sessionId } = data?.data || data;
    const userId = auth.uid;

    if (!schoolId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    const reservationRef = admin.database().ref(`reservations/${schoolId}/${sessionId}`);
    const reservationSnapshot = await reservationRef.once('value');
    const reservation = reservationSnapshot.val() as ReservationData | null;

    if (!reservation || reservation.status !== 'reserved') {
        throw new functions.https.HttpsError('failed-precondition', '유효하지 않은 등록 세션입니다.');
    }

    if (reservation.userId !== userId) {
        throw new functions.https.HttpsError('permission-denied', '이 세션에 접근할 수 없습니다.');
    }

    if (Date.now() > reservation.expiresAt) {
        await expireReservation(schoolId, sessionId, Date.now());
        throw new functions.https.HttpsError('deadline-exceeded', '등록 세션이 만료되었습니다.');
    }

    return {
        success: true,
        expiresAt: reservation.expiresAt,
        queueNumber: reservation.queueNumber || null
    };
});

/**
 * Confirm reservation (submit form)
 * Since slot is already reserved, this should 100% succeed
 */
// formData에 허용된 필드 목록 (임의 필드 삽입 방지)
const ALLOWED_FORM_FIELDS = [
    'studentName', 'phone', 'phoneLast4',
    'email', 'studentId', 'schoolName', 'grade', 'address', 'agreedSms'
];

export const confirmReservation = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const logger = functions.logger;
    logger.info('[ConfirmReservation] Function invoked', { timestamp: new Date().toISOString() });

    const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId, sessionId, formData } = data?.data || data;
    const userId = auth.uid;

    const confirmRateLimit = await checkRateLimit(
        admin.firestore(),
        getRateLimitIdentifier(rawRequest, `confirmReservation_${userId}_${sessionId}`),
        5,
        60000
    );
    if (!confirmRateLimit.allowed) {
        throw new functions.https.HttpsError(
            'resource-exhausted',
            `너무 빠른 요청입니다. ${confirmRateLimit.retryAfter}초 후에 다시 시도해주세요.`
        );
    }

    if (!schoolId || !sessionId || !formData) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다.'
        );
    }

    // formData 허용 필드만 추출 (임의 필드 주입 방지)
    if (typeof formData !== 'object' || formData === null) {
        throw new functions.https.HttpsError('invalid-argument', '폼 데이터가 올바르지 않습니다.');
    }
    const sanitizedFormData: any = {};
    for (const key of ALLOWED_FORM_FIELDS) {
        if (formData[key] !== undefined) {
            sanitizedFormData[key] = formData[key];
        }
    }

    // 필수 필드 검증
    if (!sanitizedFormData.studentName || typeof sanitizedFormData.studentName !== 'string' || sanitizedFormData.studentName.trim().length === 0) {
        throw new functions.https.HttpsError('invalid-argument', '학생 이름이 올바르지 않습니다.');
    }
    if (!sanitizedFormData.phone || !/^010\d{8}$/.test(sanitizedFormData.phone)) {
        throw new functions.https.HttpsError('invalid-argument', '전화번호 형식이 올바르지 않습니다. (01000000000)');
    }

    // 문자열 필드 길이 제한 (XSS/과도한 데이터 방지)
    sanitizedFormData.phoneLast4 = sanitizedFormData.phone.slice(-4);
    sanitizedFormData.studentName = sanitizedFormData.studentName.trim().substring(0, 50);
    if (sanitizedFormData.schoolName) sanitizedFormData.schoolName = String(sanitizedFormData.schoolName).trim().substring(0, 100);
    if (sanitizedFormData.address) sanitizedFormData.address = String(sanitizedFormData.address).trim().substring(0, 200);
    if (sanitizedFormData.studentId) sanitizedFormData.studentId = String(sanitizedFormData.studentId).trim().substring(0, 20);
    if (sanitizedFormData.grade) sanitizedFormData.grade = String(sanitizedFormData.grade).trim().substring(0, 10);
    if (sanitizedFormData.email) sanitizedFormData.email = String(sanitizedFormData.email).trim().substring(0, 200);

    try {
        const result = await handleConfirmReservation(schoolId, sessionId, userId, sanitizedFormData);
        logger.info('[ConfirmReservation] Success', { schoolId, sessionId, regId: result.registrationId, status: result.status });
        return result;
    } catch (error: any) {
        logger.error('[ConfirmReservation] Error:', error);

        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        throw new functions.https.HttpsError(
            'internal',
            '신청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
        );
    }

});

async function runCleanupExpiredReservations() {
    const logger = functions.logger;
    logger.info('[CleanupExpiredReservations] Starting cleanup');

    try {
        const db = admin.firestore();
        const schoolsSnapshot = await db.collection('schools').get();

        let totalReleased = 0;

        for (const schoolDoc of schoolsSnapshot.docs) {
            const schoolId = schoolDoc.id;
            const now = Date.now();

            // Find expired reservations
            const expiredSnapshot = await admin.database()
                .ref(`reservations/${schoolId}`)
                .once('value');

            if (expiredSnapshot.exists()) {
                // ── 1단계: reserved 상태인 만료 세션 처리 ──────────────────
                // 각 예약을 개별 트랜잭션으로 'reserved' → 'expired' 원자적 전환.
                // 이미 다른 경로에서 처리된 예약은 건너뛰어 슬롯 이중 반환을 막습니다.
                let releaseCount = 0;
                const expiredEntries: { key: string }[] = [];

                expiredSnapshot.forEach((child) => {
                    const reservation = child.val() as ReservationData;
                    if (reservation.status === 'reserved' && reservation.expiresAt <= now) {
                        expiredEntries.push({ key: child.key as string });
                    }
                });

                for (const entry of expiredEntries) {
                    const reservationRef = admin.database().ref(`reservations/${schoolId}/${entry.key}`);
                    const txResult = await reservationRef.transaction((current: ReservationData | null) => {
                        if (!current || current.status !== 'reserved') return;
                        return { ...current, status: 'expired', expiredAt: now };
                    });
                    if (txResult.committed) {
                        releaseCount++;
                        // 만료된 사용자의 대기열 번호도 무효화(삭제)하여 재진입 시 새로운 번호를 받도록 함
                        const expiredData = txResult.snapshot.val() as ReservationData;
                        if (expiredData && expiredData.userId) {
                            await admin.database().ref(`queue/${schoolId}/entries/${expiredData.userId}`).remove();
                        }
                    }
                }

                if (releaseCount > 0) {
                    await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
                        if (!currentData) return null;
                        return {
                            ...currentData,
                            reserved: Math.max(0, currentData.reserved - releaseCount),
                            available: currentData.available + releaseCount,
                            lastUpdated: now
                        };
                    });

                    totalReleased += releaseCount;
                    logger.info(`[CleanupExpiredReservations] Released ${releaseCount} slots for ${schoolId}`);
                }

                // ── 2단계: 슬롯 누수 복구 ───────────────────────────────────
                // expireReservation에서 status는 expired로 됐지만 슬롯 반환이
                // 실패한 경우를 감지합니다. RTDB reserved 카운터와 실제
                // reserved 상태 세션 수를 비교해 차이만큼 슬롯을 복구합니다.
                const slotsSnap = await admin.database().ref(`slots/${schoolId}`).once('value');
                const slotData = slotsSnap.val() as SlotData | null;

                if (slotData && slotData.reserved > 0) {
                    let actualReservedCount = 0;
                    expiredSnapshot.forEach((child) => {
                        const reservation = child.val() as ReservationData;
                        if (reservation.status === 'reserved') {
                            actualReservedCount++;
                        }
                    });
                    // 이미 처리된 세션들은 제외한 후 다시 읽음 (최신 상태 반영)
                    const freshSnap = await admin.database().ref(`reservations/${schoolId}`).once('value');
                    let freshReservedCount = 0;
                    freshSnap.forEach((child) => {
                        const reservation = child.val() as ReservationData;
                        if (reservation.status === 'reserved') freshReservedCount++;
                    });

                    const leaked = slotData.reserved - releaseCount - freshReservedCount;
                    if (leaked > 0) {
                        await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
                            if (!currentData) return null;
                            return {
                                ...currentData,
                                reserved: Math.max(0, currentData.reserved - leaked),
                                available: currentData.available + leaked,
                                lastUpdated: now
                            };
                        });
                        logger.warn(`[CleanupExpiredReservations] Recovered ${leaked} leaked slots for ${schoolId}`);
                        totalReleased += leaked;
                    }
                }
            }
        }

        logger.info(`[CleanupExpiredReservations] Completed. Total released: ${totalReleased}`);
        return { totalReleased };

    } catch (error: any) {
        logger.error('[CleanupExpiredReservations] Error:', error);
        throw error;
    }
}

/**
 * Cleanup expired reservations
 * Runs every 1 minute
 */
export const cleanupExpiredReservations = pubsubTriggers
    .schedule('*/1 * * * *')
    .timeZone('Asia/Seoul')
    .onRun(async () => {
        await runCleanupExpiredReservations();
        return null;
});

// ============ Traffic Control & Registration ============

/**
 * Rate limiting helper to prevent spam/abuse
 * Uses Firestore to track request counts per IP/session
 */
async function checkRateLimit(
    db: admin.firestore.Firestore,
    identifier: string,
    maxRequests: number = 5,
    windowMs: number = 60000 // 1 minute
): Promise<{ allowed: boolean; retryAfter?: number }> {
    const now = Date.now();
    const rateLimitRef = db.collection('rateLimits').doc(identifier);

    try {
        let result: { allowed: boolean; retryAfter?: number } = { allowed: true };

        await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(rateLimitRef);

            if (!doc.exists) {
                transaction.set(rateLimitRef, {
                    count: 1,
                    firstRequest: now,
                    lastRequest: now
                });
                result = { allowed: true };
                return;
            }

            const data = doc.data()!;
            const timeSinceFirst = now - data.firstRequest;

            if (timeSinceFirst > windowMs) {
                transaction.update(rateLimitRef, {
                    count: 1,
                    firstRequest: now,
                    lastRequest: now
                });
                result = { allowed: true };
                return;
            }

            if (data.count >= maxRequests) {
                const retryAfter = Math.max(1, Math.ceil((windowMs - timeSinceFirst) / 1000));
                result = {
                    allowed: false,
                    retryAfter
                };
                return;
            }

            transaction.update(rateLimitRef, {
                count: (data.count || 0) + 1,
                lastRequest: now
            });
            result = { allowed: true };
        });

        return result;
    } catch (error) {
        logWithContext('checkRateLimit', 'error', 'Rate limit check failed', { identifier, error });
        return { allowed: true };
    }
}

/**
 * Main registration endpoint with traffic control
 * This is the SINGLE entry point for all registrations
 */
export const registerRegistration = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const logger = functions.logger;
    logger.info('[Registration] Function invoked', { timestamp: new Date().toISOString() });
    const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
    
    // Extract request data
    const {
        schoolId,
        studentName,
        phone,
        email,
        studentId,
        schoolName,
        grade,
        address,
        agreedSms
    } = data;
    
    // Validation
    if (!schoolId || !studentName || !phone) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다 (schoolId, studentName, phone).'
        );
    }
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }
    
    // 대기열 활성화 학교는 세션 기반 confirmReservation으로만 신청 가능
    const schoolDataForQueue = await getSchoolData(schoolId);
    if (isQueueEnabled(schoolDataForQueue)) {
        throw new functions.https.HttpsError('failed-precondition', '이 학교는 대기열을 사용합니다. /gate 경로를 통해 신청해주세요.');
    }
    
    // Extract identifier for rate limiting
    // Use IP if available, otherwise use phoneLast4 as fallback
    const phoneLast4 = phone.slice(-4);
    const identifier = rawRequest?.ip || `phone_${phoneLast4}`;
    
    // 1. Rate Limiting Check
    logger.info('[RateLimit] Checking for:', identifier);
    const rateLimitResult = await checkRateLimit(admin.firestore(), identifier, 5, 60000);
    
    if (!rateLimitResult.allowed) {
        logger.warn('[RateLimit] Exceeded for:', identifier);
        throw new functions.https.HttpsError(
            'resource-exhausted',
            `너무 빠른 요청입니다. ${rateLimitResult.retryAfter}초 후에 다시 시도해주세요.`
        );
    }
    
    // 2. Registration with Transaction (atomic capacity check)
    try {
        const schoolRef = admin.firestore().doc(`schools/${schoolId}`);
        const newRegRef = admin.firestore().collection(`schools/${schoolId}/registrations`).doc();

        const result = await admin.firestore().runTransaction(async (transaction) => {
            const schoolDoc = await transaction.get(schoolRef);
            if (!schoolDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    '학교 정보를 찾을 수 없습니다.'
                );
            }

            // 중복 전화번호 확인 (동일 번호로 이미 신청된 경우 거부)
            const duplicateSnapshot = await transaction.get(
                admin.firestore()
                    .collection(`schools/${schoolId}/registrations`)
                    .where('phone', '==', phone)
                    .where('status', 'in', ['confirmed', 'waitlisted'])
                    .limit(1)
            );
            if (!duplicateSnapshot.empty) {
                throw new functions.https.HttpsError('already-exists', '이미 동일한 전화번호로 신청된 내역이 있습니다.');
            }

            const schoolData = schoolDoc.data()!;
            const currentConfirmed = schoolData.stats?.confirmedCount || 0;
            const currentWaitlisted = schoolData.stats?.waitlistedCount || 0;
            const maxCapacity = schoolData.maxCapacity || 0;
            const waitlistCapacity = schoolData.waitlistCapacity || 0;

            let status: 'confirmed' | 'waitlisted';
            let rank: number | null = null;

            // Capacity check with atomic update
            if (currentConfirmed < maxCapacity) {
                status = 'confirmed';
                transaction.update(schoolRef, {
                    'stats.confirmedCount': currentConfirmed + 1
                });
            } else if (currentWaitlisted < waitlistCapacity) {
                status = 'waitlisted';
                rank = currentWaitlisted + 1;
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': currentWaitlisted + 1
                });
            } else {
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    'FULL_CAPACITY'
                );
            }
            
            // Create registration document
            const regData = {
                id: newRegRef.id,
                schoolId,
                studentName,
                phone,
                phoneLast4,
                status,
                rank: rank || undefined,
                submittedAt: Date.now(),
                updatedAt: Date.now(),
                email: email || null,
                address: address || null,
                schoolName: schoolName || null,
                grade: grade || null,
                studentId: studentId || null,
                agreedSms: agreedSms === true
            };
            
            transaction.set(newRegRef, regData);
            
            logger.info('[Registration] Success:', { schoolId, status, rank });
            
            return { status, rank, registrationId: newRegRef.id };
        });
        
        return {
            success: true,
            ...result
        };
        
    } catch (error: any) {
        logger.error('[Registration] Transaction failed:', error);
        
        if (error.message === 'FULL_CAPACITY' || 
            (error instanceof functions.https.HttpsError && error.code === 'resource-exhausted')) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                '죄송합니다. 정원 및 대기열이 모두 마감되었습니다.'
            );
        }
        
        throw new functions.https.HttpsError(
            'internal',
            '신청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
        );
    }
});


// ============ AlimTalk Queue System ============

/**
 * Queue AlimTalk sending to prevent API overload
 * Instead of sending immediately in onCreate trigger, we queue it
 * and process it in batches with rate limiting
 */
interface AlimTalkQueueItem {
    to: string;
    templateCode: string;
    templateParams: any;
    schoolId: string;
    registrationId: string;
    priority: number;
    createdAt: number;
    retries: number;
}

async function enqueueAlimTalk(
    db: admin.firestore.Firestore,
    item: Omit<AlimTalkQueueItem, 'createdAt' | 'retries'>
): Promise<void> {
    const queueRef = db.collection('alimtalkQueue').doc();
    await queueRef.set({
        ...item,
        createdAt: Date.now(),
        retries: 0,
        status: 'pending'
    });
}

async function processQueuedAlimTalkItem(
    docRef: admin.firestore.DocumentReference,
    queueItem: AlimTalkQueueItem & { status?: string; lastErrorAt?: number }
) {
    if (!NHN_APP_KEY || !NHN_SECRET_KEY) {
        console.error('[AlimTalkQueue] NHN Cloud credentials not configured.');
        await docRef.update({ status: 'failed', error: 'Credentials not configured' });
        return;
    }

    const NHN_SENDER_KEY = (functionsConfig as any).nhn?.sender_key;
    if (!NHN_SENDER_KEY) {
        console.error('[AlimTalkQueue] Sender key not configured.');
        await docRef.update({ status: 'failed', error: 'Sender key not configured' });
        return;
    }

    try {
        const url = `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/${NHN_APP_KEY}/messages`;

        const response = await axios.post(url, {
            senderKey: NHN_SENDER_KEY,
            templateCode: queueItem.templateCode,
            recipientList: [{
                recipientNo: queueItem.to.replace(/-/g, ''),
                templateParameter: queueItem.templateParams
            }]
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'X-Secret-Key': NHN_SECRET_KEY
            }
        });

        if (response.data.header.isSuccessful) {
            console.log(`[AlimTalkQueue] Sent to ${queueItem.to} (Template: ${queueItem.templateCode})`);
            await docRef.update({
                status: 'sent',
                sentAt: Date.now(),
                response: response.data,
                lastError: admin.firestore.FieldValue.delete(),
                lastErrorAt: admin.firestore.FieldValue.delete()
            });
            return;
        }

        console.error(`[AlimTalkQueue] Failed: ${response.data.header.resultMessage}`);
        await docRef.update({
            status: 'failed',
            error: response.data.header.resultMessage,
            retries: (queueItem.retries || 0) + 1,
            lastErrorAt: Date.now()
        });
    } catch (error: any) {
        console.error('[AlimTalkQueue] Error:', error);

        const currentRetries = queueItem.retries || 0;
        if (currentRetries < 3) {
            console.log(`[AlimTalkQueue] Will retry (${currentRetries + 1}/3)`);
            await docRef.update({
                retries: currentRetries + 1,
                status: 'pending',
                lastError: error.message || 'Unknown error',
                lastErrorAt: Date.now()
            });
            return;
        }

        await docRef.update({
            status: 'failed',
            error: error.message || 'Unknown error',
            retries: currentRetries + 1,
            lastErrorAt: Date.now()
        });
    }
}

async function runRetryPendingAlimTalkQueue() {
    const pendingSnapshot = await admin.firestore()
        .collection('alimtalkQueue')
        .where('status', '==', 'pending')
        .where('retries', '<', 3)
        .limit(20)
        .get();

    for (const doc of pendingSnapshot.docs) {
        await processQueuedAlimTalkItem(
            doc.ref,
            doc.data() as AlimTalkQueueItem & { status?: string; lastErrorAt?: number }
        );
    }

    return { processed: pendingSnapshot.size };
}

/**
 * Process AlimTalk queue - triggered by new queue items
 * This function processes items one by one with built-in rate limiting
 */
export const processAlimTalkQueue = firestoreTriggers
    .document('alimtalkQueue/{queueId}')
    .onCreate(async (snap, context) => {
        const queueItem = snap.data() as AlimTalkQueueItem;
        await processQueuedAlimTalkItem(snap.ref, queueItem);
        return;
    });

/**
 * Modify onCreate trigger to use queue instead of direct sending
 */
export const onRegistrationCreateQueued = firestoreTriggers
    .document('schools/{schoolId}/registrations/{registrationId}')
    .onCreate(async (snap, context) => {
        const newData = snap.data();
        const schoolId = context.params.schoolId;
        const registrationId = context.params.registrationId;
        
        // 문자 수신 동의 확인
        if (newData.agreedSms !== true) {
            console.log('[Queue] User did not agree to SMS/AlimTalk.');
            return;
        }
        
        // 학교 설정 가져오기 (템플릿 코드 조회)
        const schoolDoc = await admin.firestore().doc(`schools/${schoolId}`).get();
        if (!schoolDoc.exists) {
            console.error(`[Queue] School ${schoolId} not found.`);
            return;
        }
        
        const schoolConfig = schoolDoc.data();
        const alimtalkSettings = schoolConfig?.alimtalkSettings;
        
        if (!alimtalkSettings) {
            console.log('[Queue] AlimTalk settings not found for this school.');
            return;
        }
        
        const templateParams = {
            studentName: newData.studentName,
            schoolName: schoolConfig?.name || "학교"
        };
        
        // Enqueue AlimTalk instead of sending directly
        if (newData.status === 'confirmed' && alimtalkSettings.successTemplate) {
            await enqueueAlimTalk(admin.firestore(), {
                to: newData.phone,
                templateCode: alimtalkSettings.successTemplate,
                templateParams,
                schoolId,
                registrationId,
                priority: 1 // High priority for confirmations
            });
            console.log('[Queue] Enqueued confirmation AlimTalk for:', newData.phone);
        } else if (newData.status === 'waitlisted' && alimtalkSettings.waitlistTemplate) {
            const waitlistParams = {
                ...templateParams,
                rank: newData.rank || "Unknown"
            };
            await enqueueAlimTalk(admin.firestore(), {
                to: newData.phone,
                templateCode: alimtalkSettings.waitlistTemplate,
                templateParams: waitlistParams,
                schoolId,
                registrationId,
                priority: 2 // Medium priority for waitlist
            });
            console.log('[Queue] Enqueued waitlist AlimTalk for:', newData.phone);
        }
    });

export const retryPendingAlimTalkQueue = pubsubTriggers
    .schedule('every 5 minutes')
    .timeZone('Asia/Seoul')
    .onRun(async () => {
        await runRetryPendingAlimTalkQueue();
        return null;
    });


// ============ Monitoring & Logging ============
/**
 * Enhanced logging wrapper for Cloud Functions
 */
function logWithContext(
    functionName: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    context?: any
): void {
    const logger = functions.logger;
    const safeContext = context && typeof context === 'object'
        ? Object.fromEntries(
            Object.entries(context).map(([key, value]) => {
                if (value instanceof Error) {
                    return [key, {
                        name: value.name,
                        message: value.message,
                        stack: value.stack
                    }];
                }

                return [key, value];
            })
        )
        : context;
    const logData = {
        function: functionName,
        timestamp: new Date().toISOString(),
        ...safeContext
    };
    
    if (level === 'error') {
        logger.error(`[${functionName}] ${message}`, logData);
    } else if (level === 'warn') {
        logger.warn(`[${functionName}] ${message}`, logData);
    } else {
        logger.info(`[${functionName}] ${message}`, logData);
    }
}

/**
 * Scheduled function to clean up old rate limit records and metrics
 * Runs every hour
 */
export const scheduledCleanup = pubsubTriggers
    .schedule('every 60 minutes')
    .onRun(async (context) => {
        const db = admin.firestore();
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        
        try {
            // Clean up old rate limit records (older than 1 hour)
            const rateLimitsSnapshot = await db
                .collection('rateLimits')
                .where('lastRequest', '<', oneHourAgo)
                .limit(500)
                .get();
            
            const rateLimitBatch = db.batch();
            rateLimitsSnapshot.docs.forEach(doc => {
                rateLimitBatch.delete(doc.ref);
            });
            await rateLimitBatch.commit();
            
            logWithContext('scheduledCleanup', 'info', 
                `Cleaned up ${rateLimitsSnapshot.size} old rate limit records`);
            
            // Clean up successful alimtalk queue items (older than 7 days)
            const alimtalkQueueSnapshot = await db
                .collection('alimtalkQueue')
                .where('status', '==', 'sent')
                .where('createdAt', '<', sevenDaysAgo)
                .limit(500)
                .get();
            
            const alimtalkBatch = db.batch();
            alimtalkQueueSnapshot.docs.forEach(doc => {
                alimtalkBatch.delete(doc.ref);
            });
            await alimtalkBatch.commit();
            
            logWithContext('scheduledCleanup', 'info', 
                `Cleaned up ${alimtalkQueueSnapshot.size} old AlimTalk queue items`);
            
            // Clean up old registration metrics (older than 30 days)
            const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
            const metricsSnapshot = await db
                .collection('registrationMetrics')
                .where('createdAt', '<', thirtyDaysAgo)
                .limit(500)
                .get();
            
            const metricsBatch = db.batch();
            metricsSnapshot.docs.forEach(doc => {
                metricsBatch.delete(doc.ref);
            });
            await metricsBatch.commit();
            
            logWithContext('scheduledCleanup', 'info', 
                `Cleaned up ${metricsSnapshot.size} old metric records`);
            
            return null;
        } catch (error) {
            logWithContext('scheduledCleanup', 'error', 'Cleanup failed', { error });
            throw error;
        }
    });

export const runMaintenanceTask = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    await assertMasterAdmin(auth.uid);

    const { task, schoolId, sessionId } = data?.data || data;
    if (!task) {
        throw new functions.https.HttpsError('invalid-argument', 'task가 필요합니다.');
    }

    if (task === 'cleanupExpiredReservations') {
        return {
            success: true,
            task,
            ...(await runCleanupExpiredReservations())
        };
    }

    if (task === 'retryPendingAlimTalkQueue') {
        return {
            success: true,
            task,
            ...(await runRetryPendingAlimTalkQueue())
        };
    }

    if (task === 'forceExpireReservation') {
        if (!schoolId || !sessionId) {
            throw new functions.https.HttpsError('invalid-argument', 'schoolId와 sessionId가 필요합니다.');
        }

        await expireReservation(schoolId, sessionId, Date.now());
        return {
            success: true,
            task,
            schoolId,
            sessionId
        };
    }

    throw new functions.https.HttpsError('invalid-argument', '지원하지 않는 maintenance task입니다.');
});

/**
 * Real-time statistics endpoint for admin dashboard
 * Returns current registration stats, rate limit status, and queue status
 */
export const getSystemStats = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    // Check authentication
    if (!auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            '인증이 필요합니다.'
        );
    }
    
    await assertMasterAdmin(auth.uid);
    const { schoolId } = data;
    
    if (!schoolId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'schoolId가 필요합니다.'
        );
    }
    
    const db = admin.firestore();
    
    try {
        // Get school stats
        const schoolDoc = await db.doc(`schools/${schoolId}`).get();
        if (!schoolDoc.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                '학교 정보를 찾을 수 없습니다.'
            );
        }
        
        const schoolData = schoolDoc.data()!;
        const maxCapacity = schoolData.maxCapacity || 0;
        const waitlistCapacity = schoolData.waitlistCapacity || 0;
        const confirmedCount = schoolData.stats?.confirmedCount || 0;
        const waitlistedCount = schoolData.stats?.waitlistedCount || 0;
        
        // Get active rate limits (last 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const rateLimitsSnapshot = await db
            .collection('rateLimits')
            .where('lastRequest', '>', fiveMinutesAgo)
            .get();
        
        const activeRateLimits = rateLimitsSnapshot.size;
        
        // Get pending AlimTalk queue
        const alimtalkQueueSnapshot = await db
            .collection('alimtalkQueue')
            .where('schoolId', '==', schoolId)
            .where('status', '==', 'pending')
            .get();
        
        const pendingAlimtalk = alimtalkQueueSnapshot.size;
        
        // Get recent registrations (last 10 minutes)
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        const recentRegistrations = await db
            .collection(`schools/${schoolId}/registrations`)
            .where('submittedAt', '>', tenMinutesAgo)
            .orderBy('submittedAt', 'desc')
            .limit(20)
            .get();
        
        const recentActivity = recentRegistrations.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        return {
            success: true,
            stats: {
                capacity: {
                    max: maxCapacity,
                    waitlistMax: waitlistCapacity,
                    confirmed: confirmedCount,
                    waitlisted: waitlistedCount,
                    confirmedRemaining: Math.max(0, maxCapacity - confirmedCount),
                    waitlistedRemaining: Math.max(0, waitlistCapacity - waitlistedCount)
                },
                traffic: {
                    activeRateLimits,
                    pendingAlimtalk
                },
                recentActivity
            },
            timestamp: Date.now()
        };
        
    } catch (error: any) {
        logWithContext('getSystemStats', 'error', 'Failed to fetch stats', { error, schoolId });
        throw error;
    }
});


// ============ Additional Features ============

/**
 * Auto-advance queue based on capacity availability
 * Automatically increments currentNumber when there's available confirmed capacity
 * Runs every 30 seconds
 */
export const autoAdvanceQueue = pubsubTriggers
    .schedule('* * * * *')
    .timeZone('Asia/Seoul')
    .onRun(async (context) => {
    const db = admin.firestore();
    
    logWithContext('autoAdvanceQueue', 'info', 'Starting auto-advance queue check');
    
    try {
        const schoolsSnapshot = await db.collection('schools').get();
        
        let advancedCount = 0;
        
        for (const schoolDoc of schoolsSnapshot.docs) {
            const schoolId = schoolDoc.id;
            const schoolData = schoolDoc.data()!;
            
            if (!isQueueEnabled(schoolData)) continue;
            if (schoolData.isActive === false) continue;

            const { totalCapacity } = getTotalCapacity(schoolData);
            if (totalCapacity <= 0) continue;
             
            // Get current queue state from RTDB
            const queueRef = admin.database().ref(`queue/${schoolId}`);
            const queueSnapshot = await queueRef.once('value');
            
            if (!queueSnapshot.exists()) continue;
            
            const queueData = queueSnapshot.val() as QueueStateData;
            const queueMeta = getQueueMeta(queueData);
            const currentNumber = queueMeta.currentNumber;
            const lastAssignedNumber = queueMeta.lastAssignedNumber;
            const waitingCount = lastAssignedNumber - currentNumber;
            if (waitingCount <= 0) continue;

            const now = Date.now();
            const batchInterval = schoolData.queueSettings?.batchInterval || 60000;
            if (queueMeta.lastAdvancedAt && now - queueMeta.lastAdvancedAt < batchInterval) continue;

            const slotSnapshot = await admin.database().ref(`slots/${schoolId}`).once('value');
            const slotData = slotSnapshot.val() as SlotData | null;
            const availableSlots = slotData?.available ?? totalCapacity;
            if (availableSlots <= 0) continue;
             
            const batchSize = schoolData.queueSettings?.batchSize || 80;
            const advanceAmount = Math.min(waitingCount, availableSlots, batchSize);
            const newCurrentNumber = currentNumber + advanceAmount;

            await queueRef.child('meta').update({
                currentNumber: newCurrentNumber,
                lastAdvancedAt: now,
                updatedAt: now
            });

            advancedCount += advanceAmount;

            logWithContext('autoAdvanceQueue', 'info', 
                `Advanced queue for ${schoolId}`, 
                { advanceAmount, newCurrentNumber, waitingCount, availableSlots }
            );
        }
        
        logWithContext('autoAdvanceQueue', 'info', 
            `Auto-advance complete`, 
            { schoolsProcessed: schoolsSnapshot.size, totalAdvanced: advancedCount }
        );
        
        return null;
    } catch (error) {
        logWithContext('autoAdvanceQueue', 'error', 'Auto-advance failed', { error });
        throw error;
    }
    });

/**
 * Capacity alert notification for admins
 * Sends alerts when confirmed/waitlisted capacity is running low
 * Triggered by school document updates
 */
export const onSchoolUpdate = firestoreTriggers
    .document('schools/{schoolId}')
    .onWrite(async (change, context) => {
        const schoolId = context.params.schoolId;
        const newData = change.after.exists ? change.after.data() : null;
        const oldData = change.before.exists ? change.before.data() : null;
        
        if (!newData) return; // Document deleted
        
        const maxCapacity = newData.maxCapacity || 0;
        const waitlistCapacity = newData.waitlistCapacity || 0;
        const confirmedCount = newData.stats?.confirmedCount || 0;
        const waitlistedCount = newData.stats?.waitlistedCount || 0;
        
        const confirmedRemaining = maxCapacity - confirmedCount;
        const waitlistedRemaining = waitlistCapacity - waitlistedCount;
        
        const oldConfirmedRemaining = oldData ? (maxCapacity - (oldData.stats?.confirmedCount || 0)) : confirmedRemaining;
        const oldWaitlistedRemaining = oldData ? (waitlistCapacity - (oldData.stats?.waitlistedCount || 0)) : waitlistedRemaining;
        
        const alerts: string[] = [];
        
        // Check confirmed capacity alerts
        if (confirmedRemaining <= 10 && oldConfirmedRemaining > 10) {
            alerts.push(`⚠️ 확정 임박: ${confirmedRemaining}명 남음`);
        } else if (confirmedRemaining <= 5 && oldConfirmedRemaining > 5) {
            alerts.push(`🚨 긴급: 확정 ${confirmedRemaining}명 남음`);
        } else if (confirmedRemaining === 0 && oldConfirmedRemaining > 0) {
            alerts.push(`🔒 확정 마감`);
        }
        
        // Check waitlist capacity alerts
        if (waitlistedRemaining <= 10 && oldWaitlistedRemaining > 10) {
            alerts.push(`⚠️ 대기열 임박: ${waitlistedRemaining}명 남음`);
        } else if (waitlistedRemaining === 0 && oldWaitlistedRemaining > 0) {
            alerts.push(`🔒 대기열 마감`);
        }
        
        if (alerts.length > 0) {
            logWithContext('onSchoolUpdate', 'info', 
                `Capacity alerts for ${schoolId}`, 
                { alerts, confirmedRemaining, waitlistedRemaining }
            );
            
            // Store alerts for admin dashboard
            const alertsRef = admin.firestore().collection('capacityAlerts').doc();
            await alertsRef.set({
                schoolId,
                schoolName: newData.name || 'Unknown',
                alerts,
                confirmedRemaining,
                waitlistedRemaining,
                confirmedCount,
                waitlistedCount,
                timestamp: new Date(),
                createdAt: Date.now(),
                read: false
            });
            
            // Optionally send AlimTalk to school admins if configured
            // This would require school admin contact info in schoolConfig
        }
    });


// ============ A/B Testing System ============

/**
 * A/B Test Configuration
 * Group A: With Queue (current flow)
 * Group B: Without Queue (direct registration)
 */
interface ABTestConfig {
    schoolId: string;
    enabled: boolean;
    splitRatio: number; // 0-100, percentage for Group A
}


/**
 * Assign user to A/B test group (helper function)
 * Uses deterministic hashing based on userId for consistent assignment
 */
function assignABTestGroup(userId: string, schoolId: string, splitRatio: number = 50): 'A' | 'B' {
    // Create a hash from userId + schoolId
    const hash = userId + schoolId;
    let hashValue = 0;
    for (let i = 0; i < hash.length; i++) {
        hashValue = ((hashValue << 5) - hashValue) + hash.charCodeAt(i);
        hashValue = hashValue & hashValue; // Convert to 32bit integer
    }
    
    // Use absolute value and modulo 100
    const score = Math.abs(hashValue) % 100;
    
    return score < splitRatio ? 'A' : 'B';
}

/**
 * Get A/B test configuration for a school
 */
async function getABTestConfig(
    db: admin.firestore.Firestore,
    schoolId: string
): Promise<ABTestConfig | null> {
    const schoolDoc = await db.doc(`schools/${schoolId}`).get();
    if (!schoolDoc.exists) return null;
    
    const schoolData = schoolDoc.data()!;
    const abTestSettings = schoolData.abTestSettings;
    
    if (!abTestSettings || !abTestSettings.enabled) {
        return null;
    }
    
    return {
        schoolId,
        enabled: abTestSettings.enabled || false,
        splitRatio: abTestSettings.splitRatio || 50
    };
}

/**
 * Log A/B test metrics
 */
async function logABTestMetric(
    db: admin.firestore.Firestore,
    data: {
        schoolId: string;
        group: 'A' | 'B';
        event: 'page_view' | 'queue_enter' | 'register_start' | 'register_complete' | 'register_fail' | 'queue_exit';
        userId?: string;
        duration?: number;
        metadata?: any;
    }
): Promise<void> {
    const metricRef = db.collection('abTestMetrics').doc();
    await metricRef.set({
        ...data,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: Date.now()
    });
}

/**
 * A/B Test assignment endpoint
 * Returns which group a user belongs to
 */
export const getABTestGroup = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, rawRequest } = normalizeCallableRequest(request, legacyContext);
    const { schoolId, userId } = data;
    
    
    if (!schoolId) {
        throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
    }
    
    const identifier = rawRequest?.ip || `abtest_${String(schoolId)}_${String(userId || 'anon')}`;
    const rateLimitResult = await checkRateLimit(admin.firestore(), identifier, 30, 60000);
    if (!rateLimitResult.allowed) {
        throw new functions.https.HttpsError('resource-exhausted', `너무 빠른 요청입니다. ${rateLimitResult.retryAfter}초 후에 다시 시도해주세요.`);
    }
    
    const config = await getABTestConfig(admin.firestore(), schoolId);
    
    if (!config || !config.enabled) {
        // A/B test not enabled, default to Group A (with queue)
        return {
            enabled: false,
            group: 'A',
            reason: 'A/B 테스트가 비활성화되어 있습니다.'
        };
    }
    
    // Assign group (use userId if available, otherwise use IP)
    const group = assignABTestGroup(identifier, schoolId, config.splitRatio);
    // Log assignment
    await logABTestMetric(admin.firestore(), {
        schoolId,
        group,
        event: 'page_view',
        userId: userId || null,
        metadata: { splitRatio: config.splitRatio }
    });
    
    return {
        enabled: true,
        group,
        config: {
            splitRatio: config.splitRatio
        }
    };
});

/**
 * Modified registerRegistration with A/B test tracking
 */
export const registerRegistrationWithAB = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const logger = functions.logger;
    logger.info('[RegistrationWithAB] Function invoked', { timestamp: new Date().toISOString() });
    const { data, auth, rawRequest } = normalizeCallableRequest(request, legacyContext);
    
    // Extract request data
    const {
        schoolId,
        studentName,
        phone,
        email,
        studentId,
        schoolName,
        grade,
        address,
        agreedSms,
        abTestGroup
    } = data;
    
    // Validation
    if (!schoolId || !studentName || !phone) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다 (schoolId, studentName, phone).'
        );
    }
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }
    // 대기열 활성화 학교는 세션 기반 confirmReservation으로만 신청 가능
    const schoolDataForQueueAB = await getSchoolData(schoolId);
    if (isQueueEnabled(schoolDataForQueueAB)) {
        throw new functions.https.HttpsError('failed-precondition', '이 학교는 대기열을 사용합니다. /gate 경로를 통해 신청해주세요.');
    }
    
    const startTime = Date.now();
    const identifier = rawRequest?.ip || `phone_${phone.split('-').pop()}`;
    
    // Log registration start
    if (abTestGroup) {
        await logABTestMetric(admin.firestore(), {
            schoolId,
            group: abTestGroup,
            event: 'register_start',
            userId: identifier
        });
    }
    
    // 1. Rate Limiting Check (skip for Group B in A/B test)
    if (abTestGroup !== 'B') {
        logger.info('[RateLimit] Checking for:', identifier);
        const rateLimitResult = await checkRateLimit(admin.firestore(), identifier, 5, 60000);
        
        if (!rateLimitResult.allowed) {
            logger.warn('[RateLimit] Exceeded for:', identifier);
            
            if (abTestGroup) {
                await logABTestMetric(admin.firestore(), {
                    schoolId,
                    group: abTestGroup,
                    event: 'register_fail',
                    userId: identifier,
                    metadata: { reason: 'rate_limit_exceeded' }
                });
            }
            
            throw new functions.https.HttpsError(
                'resource-exhausted',
                `너무 빠른 요청입니다. ${rateLimitResult.retryAfter}초 후에 다시 시도해주세요.`
            );
        }
    }
    
    // 2. Registration with Transaction
    try {
        const schoolRef = admin.firestore().doc(`schools/${schoolId}`);
        const newRegRef = admin.firestore().collection(`schools/${schoolId}/registrations`).doc();

        const result = await admin.firestore().runTransaction(async (transaction) => {
            const schoolDoc = await transaction.get(schoolRef);
            if (!schoolDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    '학교 정보를 찾을 수 없습니다.'
                );
            }

            // 중복 전화번호 확인 (동일 번호로 이미 신청된 경우 거부)
            const duplicateSnapshot = await transaction.get(
                admin.firestore()
                    .collection(`schools/${schoolId}/registrations`)
                    .where('phone', '==', phone)
                    .where('status', 'in', ['confirmed', 'waitlisted'])
                    .limit(1)
            );
            if (!duplicateSnapshot.empty) {
                throw new functions.https.HttpsError('already-exists', '이미 동일한 전화번호로 신청된 내역이 있습니다.');
            }

            const schoolData = schoolDoc.data()!;
            const currentConfirmed = schoolData.stats?.confirmedCount || 0;
            const currentWaitlisted = schoolData.stats?.waitlistedCount || 0;
            const maxCapacity = schoolData.maxCapacity || 0;
            const waitlistCapacity = schoolData.waitlistCapacity || 0;

            let status: 'confirmed' | 'waitlisted';
            let rank: number | null = null;

            if (currentConfirmed < maxCapacity) {
                status = 'confirmed';
                transaction.update(schoolRef, {
                    'stats.confirmedCount': currentConfirmed + 1
                });
            } else if (currentWaitlisted < waitlistCapacity) {
                status = 'waitlisted';
                rank = currentWaitlisted + 1;
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': currentWaitlisted + 1
                });
            } else {
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    'FULL_CAPACITY'
                );
            }
            
            const regData = {
                id: newRegRef.id,
                schoolId,
                studentName,
                phone,
                phoneLast4: phone.split('-').pop() || '',
                status,
                rank: rank || undefined,
                submittedAt: Date.now(),
                updatedAt: Date.now(),
                email: email || null,
                address: address || null,
                schoolName: schoolName || null,
                grade: grade || null,
                studentId: studentId || null,
                agreedSms: agreedSms === true,
                abTestGroup: abTestGroup || null
            };
            
            transaction.set(newRegRef, regData);
            
            logger.info('[Registration] Success:', { schoolId, status, rank });
            
            return { status, rank, registrationId: newRegRef.id };
        });
        
        // Log successful registration
        const duration = Date.now() - startTime;
        if (abTestGroup) {
            await logABTestMetric(admin.firestore(), {
                schoolId,
                group: abTestGroup,
                event: 'register_complete',
                userId: identifier,
                duration,
                metadata: { status: result.status, rank: result.rank }
            });
        }
        
        return {
            success: true,
            ...result
        };
        
    } catch (error: any) {
        logger.error('[Registration] Transaction failed:', error);
        
        const duration = Date.now() - startTime;
        if (abTestGroup) {
            await logABTestMetric(admin.firestore(), {
                schoolId,
                group: abTestGroup,
                event: 'register_fail',
                userId: identifier,
                duration,
                metadata: { 
                    error: error.message,
                    code: error.code
                }
            });
        }
        
        if (error.message === 'FULL_CAPACITY' || 
            (error instanceof functions.https.HttpsError && error.code === 'resource-exhausted')) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                '죄송합니다. 정원 및 대기열이 모두 마감되었습니다.'
            );
        }
        
        throw new functions.https.HttpsError(
            'internal',
            '신청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
        );
    }
});

/**
 * Get A/B test results and analytics
 */
export const getABTestResults = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            '인증이 필요합니다.'
        );
    }
    
    await assertMasterAdmin(auth.uid);
    const { schoolId } = data;
    
    if (!schoolId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'schoolId가 필요합니다.'
        );
    }
    
    const db = admin.firestore();
    
    try {
        // Get metrics from last 24 hours
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        const metricsSnapshot = await db
            .collection('abTestMetrics')
            .where('schoolId', '==', schoolId)
            .where('createdAt', '>', twentyFourHoursAgo)
            .get();
        
        const metrics = metricsSnapshot.docs.map(doc => doc.data());
        
        // Calculate statistics for each group
        const groupA = metrics.filter((m: any) => m.group === 'A');
        const groupB = metrics.filter((m: any) => m.group === 'B');
        
        const calculateStats = (groupMetrics: any[]) => {
            const pageViews = groupMetrics.filter((m: any) => m.event === 'page_view').length;
            const registerStarts = groupMetrics.filter((m: any) => m.event === 'register_start').length;
            const registerCompletes = groupMetrics.filter((m: any) => m.event === 'register_complete').length;
            const registerFails = groupMetrics.filter((m: any) => m.event === 'register_fail').length;
            
            const conversionRate = pageViews > 0 ? (registerCompletes / pageViews * 100).toFixed(2) : '0.00';
            const successRate = registerStarts > 0 ? (registerCompletes / registerStarts * 100).toFixed(2) : '0.00';
            
            // Average duration
            const completesWithDuration = groupMetrics.filter((m: any) => 
                m.event === 'register_complete' && m.duration
            );
            const avgDuration = completesWithDuration.length > 0
                ? (completesWithDuration.reduce((sum: number, m: any) => sum + m.duration, 0) / completesWithDuration.length / 1000).toFixed(2)
                : '0.00';
            
            return {
                pageViews,
                registerStarts,
                registerCompletes,
                registerFails,
                conversionRate: parseFloat(conversionRate),
                successRate: parseFloat(successRate),
                avgDuration: parseFloat(avgDuration)
            };
        };
        
        const statsA = calculateStats(groupA);
        const statsB = calculateStats(groupB);
        
        // Calculate improvements
        const conversionImprovement = statsB.conversionRate > 0
            ? ((statsA.conversionRate - statsB.conversionRate) / statsB.conversionRate * 100).toFixed(2)
            : '0.00';
        
        return {
            success: true,
            groupA: statsA,
            groupB: statsB,
            comparison: {
                conversionImprovement: parseFloat(conversionImprovement),
                winner: statsA.conversionRate > statsB.conversionRate ? 'A' : 'B'
            },
            totalParticipants: metrics.length,
            timestamp: Date.now()
        };
    } catch (error: any) {
        console.error('[ABTestResults] Error:', error);
        throw new functions.https.HttpsError(
            'internal',
            'A/B 테스트 결과를 불러오는데 실패했습니다.'
        );
    }
});


export const getAdminReservations = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '??? ?????.');
    }

    const { schoolId } = data;
    if (!schoolId) {
        throw new functions.https.HttpsError('invalid-argument', 'schoolId? ?????.');
    }

    await assertAdminAccessToSchool(auth.uid, schoolId);

    const snapshot = await admin.database().ref(`reservations/${schoolId}`).once('value');
    if (!snapshot.exists()) {
        return { success: true, reservations: [] };
    }

    const reservations = Object.entries(snapshot.val() || {})
        .map(([id, reservation]) => ({
            id,
            ...(reservation as Record<string, any>)
        }))
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
        success: true,
        reservations
    };
});

export const syncSchoolSlots = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId, total } = data;
    if (!schoolId || typeof total !== 'number' || total < 0) {
        throw new functions.https.HttpsError('invalid-argument', 'schoolId와 total은 필수이며 양수여야 합니다.');
    }

    await assertAdminAccessToSchool(auth.uid, schoolId);

    const slotsRef = admin.database().ref(`slots/${schoolId}`);
    const result = await slotsRef.transaction((currentData: SlotData | null) => {
        const reserved = Math.max(0, currentData?.reserved || 0);
        const confirmed = Math.max(0, currentData?.confirmed || 0);
        const safeTotal = Math.max(total, reserved + confirmed);

        return {
            total: safeTotal,
            reserved,
            confirmed,
            available: Math.max(0, safeTotal - reserved - confirmed),
            lastUpdated: Date.now()
        };
    });

    return {
        success: true,
        slots: result.snapshot?.val() || null
    };
});

/**
 * 학교 데이터 전체 초기화 (Reset All State)
 * 신청 내역, 예약 세션, 대기열, 통계를 모두 0으로 초기화합니다.
 */
export const resetSchoolState = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, auth } = normalizeCallableRequest(request, legacyContext);
    if (!auth) throw new functions.https.HttpsError('unauthenticated', '인증이 필요하며 관리자만 가능합니다.');
    
    const { schoolId } = data;
    if (!schoolId) throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');

    // 1. 관리자 권한 확인 (MASTER 또는 해당 학교 관리자)
    await assertAdminAccessToSchool(auth.uid, schoolId);

    const now = Date.now();
    const db = admin.firestore();
    const rtdb = admin.database();

    try {
        // 2. Firestore 신청 내역(Registrations) 전체 삭제 (Batch)
        const registrationsRef = db.collection(`schools/${schoolId}/registrations`);
        const snapshot = await registrationsRef.get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        // 3. Firestore 학교 통계(Stats) 초기화
        await db.doc(`schools/${schoolId}`).update({
            'stats.confirmedCount': 0,
            'stats.waitlistedCount': 0,
            'updatedAt': now
        });

        // 4. Firestore AB 테스트 메트릭 삭제
        const metricsRef = db.collection('abTestMetrics').where('schoolId', '==', schoolId);
        const metricsSnapshot = await metricsRef.get();
        if (!metricsSnapshot.empty) {
            const mBatch = db.batch();
            metricsSnapshot.docs.forEach(doc => mBatch.delete(doc.ref));
            await mBatch.commit();
        }

        // 5. RTDB 슬롯(Slots) 초기화
        const schoolDoc = await db.doc(`schools/${schoolId}`).get();
        const schoolData = schoolDoc.data();
        const totalCap = (schoolData?.maxCapacity || 0) + (schoolData?.waitlistCapacity || 0);

        await rtdb.ref(`slots/${schoolId}`).set({
            total: totalCap,
            reserved: 0,
            confirmed: 0,
            available: totalCap,
            lastUpdated: now
        });

        // 6. RTDB 예약 세션(Reservations) 및 대기열(Queue) 전체 삭제
        await rtdb.ref(`reservations/${schoolId}`).remove();
        await rtdb.ref(`queue/${schoolId}`).remove();
        
        // 대기열 메타 정보 초기화
        await rtdb.ref(`queue/${schoolId}/meta`).set({
            currentNumber: 0,
            lastAssignedNumber: 0,
            lastAdvancedAt: 0,
            updatedAt: now
        });

        functions.logger.info(`[ResetSchoolState] Success: Full reset performed for school ${schoolId} by ${auth.uid}`);
        return { success: true, message: '모든 데이터가 성공적으로 초기화되었습니다.' };
    } catch (error) {
        functions.logger.error(`[ResetSchoolState] Error:`, error);
        throw new functions.https.HttpsError('internal', '초기화 작업 중 오류가 발생했습니다.');
    }
});

// ============ Registration Lookup & Cancel (공개 사용자용) ============

/**
 * 신청 내역 조회
 * Firestore 직접 읽기 권한 없이 이름+전화번호 뒤 4자리로 조회합니다.
 */
export const lookupRegistration = functionsV1.https.onCall(async (request: any, legacyContext?: any) => {
    const { data, rawRequest } = normalizeCallableRequest(request, legacyContext);
    const { schoolId, studentName, phoneLast4 } = data?.data || data;
    const lookupRateLimit = await checkRateLimit(
        admin.firestore(),
        getRateLimitIdentifier(rawRequest, `lookupRegistration_${schoolId}_${String(studentName)}_${String(phoneLast4)}`),
        10,
        60000
    );
    if (!lookupRateLimit.allowed) {
        throw new functions.https.HttpsError(
            'resource-exhausted',
            `너무 빠른 요청입니다. ${lookupRateLimit.retryAfter}초 후에 다시 시도해주세요.`
        );
    }

    if (!schoolId || !studentName || !phoneLast4) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    if (typeof studentName !== 'string' || studentName.trim().length === 0 || studentName.length > 50) {
        throw new functions.https.HttpsError('invalid-argument', '이름이 올바르지 않습니다.');
    }
    if (typeof phoneLast4 !== 'string' || !/^\d{4}$/.test(phoneLast4)) {
        throw new functions.https.HttpsError('invalid-argument', '전화번호 뒤 4자리가 올바르지 않습니다.');
    }

    try {
        const snapshot = await admin.firestore()
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

        // 민감 정보는 마스킹하여 반환 (전화번호 뒤 4자리만 확인용)
        return {
            success: true,
            registration: {
                id: doc.id,
                studentName: reg.studentName,
                phone: reg.phone,
                status: reg.status,
                rank: reg.rank ?? null,
                submittedAt: reg.submittedAt,
                updatedAt: reg.updatedAt
            }
        };
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', '조회 중 오류가 발생했습니다.');
    }
});

/**
 * 신청 취소
 * 이름+전화번호 뒤 4자리로 인증 후 취소하며, 슬롯을 반환합니다.
 */
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
        throw new functions.https.HttpsError(
            'resource-exhausted',
            `너무 빠른 요청입니다. ${cancelRateLimit.retryAfter}초 후에 다시 시도해주세요.`
        );
    }

    if (!schoolId || !registrationId || !studentName || !phoneLast4) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
    }

    if (typeof phoneLast4 !== 'string' || !/^\d{4}$/.test(phoneLast4)) {
        throw new functions.https.HttpsError('invalid-argument', '전화번호 뒤 4자리가 올바르지 않습니다.');
    }

    try {
        const regRef = admin.firestore().doc(`schools/${schoolId}/registrations/${registrationId}`);
        const schoolRef = admin.firestore().doc(`schools/${schoolId}`);

        const canceledStatus = await admin.firestore().runTransaction(async (transaction) => {
            const regDoc = await transaction.get(regRef);
            const schoolDoc = await transaction.get(schoolRef);
            if (!regDoc.exists) {
                throw new functions.https.HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
            }

            if (!schoolDoc.exists) {
                throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
            }

            const reg = regDoc.data()!;
            const schoolData = schoolDoc.data()!;
            const currentConfirmed = schoolData.stats?.confirmedCount || 0;
            const currentWaitlisted = schoolData.stats?.waitlistedCount || 0;

            // 본인 확인 (이름 + 전화번호 뒤 4자리)
            if (reg.studentName !== studentName.trim() || reg.phoneLast4 !== phoneLast4) {
                throw new functions.https.HttpsError('permission-denied', '본인 확인에 실패했습니다.');
            }

            if (reg.status === 'canceled') {
                throw new functions.https.HttpsError('failed-precondition', '이미 취소된 신청입니다.');
            }

            const prevStatus = reg.status as 'confirmed' | 'waitlisted';

            transaction.update(regRef, {
                status: 'canceled',
                updatedAt: Date.now(),
                cancellationReason: 'user_requested'
            });

            // 슬롯 카운터 감소 (취소된 슬롯 반환)
            if (prevStatus === 'confirmed') {
                transaction.update(schoolRef, {
                    'stats.confirmedCount': Math.max(0, currentConfirmed - 1)
                });
            } else if (prevStatus === 'waitlisted') {
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': Math.max(0, currentWaitlisted - 1)
                });
            }

            return prevStatus;
        });

        // RTDB 슬롯 반환
        const now = Date.now();
        await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
            if (!currentData) return null;
            return {
                ...currentData,
                confirmed: Math.max(0, currentData.confirmed - 1),
                available: currentData.available + 1,
                lastUpdated: now
            };
        });

        functions.logger.info('[CancelRegistration] Success', { schoolId, registrationId, prevStatus: canceledStatus });

        return { success: true };
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', '취소 처리 중 오류가 발생했습니다.');
    }
});
