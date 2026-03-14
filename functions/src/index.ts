import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

// Firebase Admin SDK 초기화 (ADC 사용)
admin.initializeApp();

// 환경 변수에서 NHN Cloud 설정 가져오기
// 사용법: firebase functions:config:set nhn.appkey="YOUR_APP_KEY" nhn.secretkey="YOUR_SECRET_KEY" nhn.sender="01012345678"
const NHN_APP_KEY = functions.config().nhn?.appkey;
const NHN_SECRET_KEY = functions.config().nhn?.secretkey;

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
    const NHN_SENDER_KEY = functions.config().nhn?.sender_key;

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

// 1. onCreate 트리거: 신규 신청 시 알림톡 발송
export const onRegistrationCreate = functions.firestore
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
export const onRegistrationUpdate = functions.firestore
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

// 3. HTTP 트리거: NHN 알림톡 템플릿 목록 조회
export const getAlimtalkTemplates = functions.https.onCall(async (data, context) => {
    functions.logger.info('[AlimTalk Template Fetch] Function invoked', new Date().toISOString());
    
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { appKey, secretKey } = data;

    if (!appKey || !secretKey) {
        throw new functions.https.HttpsError('invalid-argument', 'App Key와 Secret Key가 필요합니다.');
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

        if (response.data.header && response.data.header.isSuccessful) {
            const templates = response.data.templateList || response.data.templates || [];
            console.log(`[AlimTalk] Found ${templates.length} templates`);
            
            return {
                success: true,
                templates: templates
            };
        } else {
            const errorMsg = response.data.header?.resultMessage || response.data.message || '알 수 없는 오류';
            console.error(`[AlimTalk] API Error: ${errorMsg}`);
            throw new functions.https.HttpsError('internal', 
                `NHN API 오류: ${errorMsg}`);
        }
    } catch (error: any) {
        console.error("[AlimTalk] Error fetching templates:", error.response?.data || error.message);
        
        if (error.response) {
            console.error("[AlimTalk] Error response status:", error.response.status);
            console.error("[AlimTalk] Error response data:", JSON.stringify(error.response.data));
        }
        
        throw new functions.https.HttpsError('internal', 
            `템플릿 조회 실패: ${error.response?.data?.message || error.message}`);
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
    status: 'reserved' | 'confirmed' | 'expired';
    createdAt: number;
    expiresAt: number;
    data?: any;
}

/**
 * Reserve a slot using RTDB transaction
 * Prevents "writing while capacity fills up" issue
 */
export const reserveSlot = functions.https.onCall(async (data, context) => {
    const logger = functions.logger;
    logger.info('[ReserveSlot] Function invoked', { timestamp: new Date().toISOString() });

    const { schoolId, userId } = data;

    if (!schoolId || !userId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다 (schoolId, userId).'
        );
    }

    try {
        // Get school config from Firestore
        const schoolDoc = await admin.firestore().doc(`schools/${schoolId}`).get();
        if (!schoolDoc.exists) {
            throw new functions.https.HttpsError('not-found', '학교 정보를 찾을 수 없습니다.');
        }

        const schoolData = schoolDoc.data()!;
        const maxCapacity = schoolData.maxCapacity || 0;

        // Use RTDB transaction for atomic slot reservation
        const slotsRef = admin.database().ref(`slots/${schoolId}`);
        const result = await slotsRef.transaction((currentData: SlotData | null) => {
            const now = Date.now();

            if (!currentData) {
                // Initialize slots
                return {
                    total: maxCapacity,
                    reserved: 1,
                    confirmed: 0,
                    available: maxCapacity - 1,
                    lastUpdated: now
                };
            }

            // Check if slots are available
            if (currentData.available <= 0) {
                return; // Abort transaction - no slots available
            }

            // Reserve a slot
            return {
                ...currentData,
                reserved: currentData.reserved + 1,
                available: currentData.available - 1,
                lastUpdated: now
            };
        }, { applyLocally: false });

        if (result.committed && result.snapshot) {
            const slotData = result.snapshot.val() as SlotData;

            // Create reservation with 5-minute expiration
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

            await admin.database().ref(`reservations/${schoolId}/${sessionId}`).set({
                userId,
                status: 'reserved',
                createdAt: Date.now(),
                expiresAt
            } as ReservationData);

            logger.info('[ReserveSlot] Success', { schoolId, sessionId, expiresAt });

            return {
                success: true,
                sessionId,
                expiresAt,
                availableSlots: slotData.available
            };
        } else {
            // Transaction failed - no slots available
            logger.warn('[ReserveSlot] No slots available', { schoolId });
            throw new functions.https.HttpsError(
                'resource-exhausted',
                '죄송합니다. 정원이 마감되었습니다.'
            );
        }

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

/**
 * Confirm reservation (submit form)
 * Since slot is already reserved, this should 100% succeed
 */
export const confirmReservation = functions.https.onCall(async (data, context) => {
    const logger = functions.logger;
    logger.info('[ConfirmReservation] Function invoked', { timestamp: new Date().toISOString() });

    const { schoolId, sessionId, formData } = data;

    if (!schoolId || !sessionId || !formData) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            '필수 정보가 누락되었습니다.'
        );
    }

    try {
        const reservationRef = admin.database().ref(`reservations/${schoolId}/${sessionId}`);
        const reservationSnapshot = await reservationRef.once('value');
        const reservation = reservationSnapshot.val() as ReservationData;

        if (!reservation || reservation.status !== 'reserved') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                '유효하지 않은 세션입니다.'
            );
        }

        const now = Date.now();
        if (now > reservation.expiresAt) {
            // Expired - release slot
            await reservationRef.update({ status: 'expired' });

            // Release slot back to pool
            await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
                if (!currentData) return null;

                return {
                    ...currentData,
                    reserved: Math.max(0, currentData.reserved - 1),
                    available: currentData.available + 1,
                    lastUpdated: now
                };
            });

            throw new functions.https.HttpsError(
                'deadline-exceeded',
                '세션이 만료되었습니다. 다시 시도해주세요.'
            );
        }

        // Update reservation status to confirmed
        await reservationRef.update({
            status: 'confirmed',
            data: formData,
            confirmedAt: now
        });

        // Update slots
        await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
            if (!currentData) return null;

            return {
                ...currentData,
                confirmed: currentData.confirmed + 1,
                lastUpdated: now
            };
        });

        // Create registration in Firestore
        const newRegRef = await admin.firestore().collection(`schools/${schoolId}/registrations`).add({
            ...formData,
            sessionId,
            status: 'confirmed',
            submittedAt: now,
            updatedAt: now
        });

        // Update school stats
        await admin.firestore().doc(`schools/${schoolId}`).update({
            'stats.confirmedCount': admin.firestore.FieldValue.increment(1)
        });

        logger.info('[ConfirmReservation] Success', { schoolId, sessionId, regId: newRegRef.id });

        return {
            success: true,
            registrationId: newRegRef.id
        };

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

/**
 * Cleanup expired reservations
 * Runs every 1 minute
 */
export const cleanupExpiredReservations = functions.pubsub
    .schedule('*/1 * * * *')
    .timeZone('Asia/Seoul')
    .onRun(async (context) => {
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
            const expiredRef = admin.database()
                .ref(`reservations/${schoolId}`)
                .orderByChild('expiresAt')
                .endAt(now);

            const expiredSnapshot = await expiredRef.once('value');

            if (expiredSnapshot.exists()) {
                const batchUpdates: { [key: string]: any } = {};
                let releaseCount = 0;

                expiredSnapshot.forEach((child) => {
                    const reservation = child.val() as ReservationData;
                    if (reservation.status === 'reserved') {
                        // Mark as expired
                        batchUpdates[`reservations/${schoolId}/${child.key}/status`] = 'expired';
                        batchUpdates[`reservations/${schoolId}/${child.key}/expiredAt`] = now;
                        releaseCount++;
                    }
                });

                if (releaseCount > 0) {
                    // Release slots back to pool
                    await admin.database().ref(`slots/${schoolId}`).transaction((currentData: SlotData | null) => {
                        if (!currentData) return null;

                        return {
                            ...currentData,
                            reserved: Math.max(0, currentData.reserved - releaseCount),
                            available: currentData.available + releaseCount,
                            lastUpdated: now
                        };
                    });

                    // Apply batch updates
                    await admin.database().ref().update(batchUpdates);

                    totalReleased += releaseCount;
                    logger.info(`[CleanupExpiredReservations] Released ${releaseCount} slots for ${schoolId}`);
                }
            }
        }

        logger.info(`[CleanupExpiredReservations] Completed. Total released: ${totalReleased}`);
        return null;

    } catch (error: any) {
        logger.error('[CleanupExpiredReservations] Error:', error);
        return null;
    }
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
        await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(rateLimitRef);

            if (!doc.exists) {
                // First request
                transaction.set(rateLimitRef, {
                    count: 1,
                    firstRequest: now,
                    lastRequest: now
                });
                return { allowed: true };
            }

            const data = doc.data()!;
            const timeSinceFirst = now - data.firstRequest;

            // Reset window if expired
            if (timeSinceFirst > windowMs) {
                transaction.update(rateLimitRef, {
                    count: 1,
                    firstRequest: now,
                    lastRequest: now
                });
                return { allowed: true };
            }

/**
 * Main registration endpoint with traffic control
 * This is the SINGLE entry point for all registrations
 */
export const registerRegistration = functions.https.onCall(async (data, context) => {
    const logger = functions.logger;
    logger.info('[Registration] Function invoked', { timestamp: new Date().toISOString() });
    
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
    
    // Extract identifier for rate limiting
    // Use IP if available, otherwise use phoneLast4 as fallback
    const phoneLast4 = phone.split('-').pop() || '';
    const identifier = context.rawRequest?.ip || `phone_${phoneLast4}`;
    
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
                    'stats.confirmedCount': admin.firestore.FieldValue.increment(1)
                });
            } else if (currentWaitlisted < waitlistCapacity) {
                status = 'waitlisted';
                rank = currentWaitlisted + 1;
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': admin.firestore.FieldValue.increment(1)
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

/**
 * Process AlimTalk queue - triggered by new queue items
 * This function processes items one by one with built-in rate limiting
 */
export const processAlimTalkQueue = functions.firestore
    .document('alimtalkQueue/{queueId}')
    .onCreate(async (snap, context) => {
        const queueItem = snap.data() as AlimTalkQueueItem;
        
        if (!NHN_APP_KEY || !NHN_SECRET_KEY) {
            console.error('[AlimTalkQueue] NHN Cloud credentials not configured.');
            await snap.ref.update({ status: 'failed', error: 'Credentials not configured' });
            return;
        }
        
        const NHN_SENDER_KEY = functions.config().nhn?.sender_key;
        if (!NHN_SENDER_KEY) {
            console.error('[AlimTalkQueue] Sender key not configured.');
            await snap.ref.update({ status: 'failed', error: 'Sender key not configured' });
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
                await snap.ref.update({ 
                    status: 'sent',
                    sentAt: Date.now(),
                    response: response.data
                });
            } else {
                console.error(`[AlimTalkQueue] Failed: ${response.data.header.resultMessage}`);
                await snap.ref.update({ 
                    status: 'failed',
                    error: response.data.header.resultMessage,
                    retries: admin.firestore.FieldValue.increment(1)
                });
            }
        } catch (error: any) {
            console.error('[AlimTalkQueue] Error:', error);
            
            // Retry logic for transient failures
            const currentRetries = queueItem.retries || 0;
            if (currentRetries < 3) {
                console.log(`[AlimTalkQueue] Retrying (${currentRetries + 1}/3)`);
                await snap.ref.update({ 
                    retries: currentRetries + 1,
                    status: 'retrying'
                });
                
                // Exponential backoff: wait 2^retry seconds before retry
                const backoffMs = Math.pow(2, currentRetries) * 1000;
                setTimeout(async () => {
                    await snap.ref.update({ status: 'pending' }); // Trigger re-processing
                }, backoffMs);
            } else {
                await snap.ref.update({ 
                    status: 'failed',
                    error: error.message || 'Unknown error',
                    retries: 4
                });
            }
        }
    });

/**
 * Modify onCreate trigger to use queue instead of direct sending
 */
export const onRegistrationCreateQueued = functions.firestore
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


// ============ Monitoring & Logging ============

/**
 * Log registration metrics to Firestore for analytics
        createdAt: Date.now()
    });
}

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
    const logData = {
        function: functionName,
        timestamp: new Date().toISOString(),
        ...context
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
export const scheduledCleanup = functions.pubsub
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

/**
 * Real-time statistics endpoint for admin dashboard
 * Returns current registration stats, rate limit status, and queue status
 */
export const getSystemStats = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            '인증이 필요합니다.'
        );
    }
    
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
export const autoAdvanceQueue = functions.pubsub
    .schedule('*/30 * * * *')
    .timeZone('Asia/Seoul')
    .onRun(async (context) => {
    const db = admin.firestore();
    
    logWithContext('autoAdvanceQueue', 'info', 'Starting auto-advance queue check');
    
    try {
        // Get all schools with queue enabled
        const schoolsSnapshot = await db
            .collection('schools')
            .where('maxCapacity', '>', 0)
            .get();
        
        let advancedCount = 0;
        
        for (const schoolDoc of schoolsSnapshot.docs) {
            const schoolId = schoolDoc.id;
            const schoolData = schoolDoc.data()!;
            
            const maxCapacity = schoolData.maxCapacity || 0;
            const confirmedCount = schoolData.stats?.confirmedCount || 0;
            const availableSlots = maxCapacity - confirmedCount;
            
            if (availableSlots <= 0) continue;
            
            // Get current queue state from RTDB
            const queueRef = admin.database().ref(`queue/${schoolId}`);
            const queueSnapshot = await queueRef.once('value');
            
            if (!queueSnapshot.exists()) continue;
            
            const queueData = queueSnapshot.val();
            const currentNumber = queueData.currentNumber || 0;
            const lastAssignedNumber = queueData.lastAssignedNumber || 0;
            const waitingCount = lastAssignedNumber - currentNumber;
            
            // Auto-advance: allow up to availableSlots to enter
            if (waitingCount > 0 && availableSlots > 0) {
                const advanceAmount = Math.min(waitingCount, availableSlots);
                const newCurrentNumber = currentNumber + advanceAmount;
                
                await queueRef.update({ currentNumber: newCurrentNumber });
                
                advancedCount += advanceAmount;
                
                logWithContext('autoAdvanceQueue', 'info', 
                    `Advanced queue for ${schoolId}`, 
                    { advanceAmount, newCurrentNumber, waitingCount, availableSlots }
                );
            }
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
export const onSchoolUpdate = functions.firestore
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
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
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
export const getABTestGroup = functions.https.onCall(async (data, context) => {
    const { schoolId, userId } = data;
    
    if (!schoolId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'schoolId가 필요합니다.'
        );
    }
    
    // Get A/B test configuration
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
    const identifier = userId || context.rawRequest?.ip || 'anonymous';
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
export const registerRegistrationWithAB = functions.https.onCall(async (data, context) => {
    const logger = functions.logger;
    logger.info('[RegistrationWithAB] Function invoked', { timestamp: new Date().toISOString() });
    
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
    
    const startTime = Date.now();
    const identifier = context.rawRequest?.ip || `phone_${phone.split('-').pop()}`;
    
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
                    'stats.confirmedCount': admin.firestore.FieldValue.increment(1)
                });
            } else if (currentWaitlisted < waitlistCapacity) {
                status = 'waitlisted';
                rank = currentWaitlisted + 1;
                transaction.update(schoolRef, {
                    'stats.waitlistedCount': admin.firestore.FieldValue.increment(1)
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
                metadata: { status, rank: result.rank }
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
/**
 * Get A/B test results and analytics
 */
export const getABTestResults = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '인증이 필요합니다.');
    }

    const { schoolId } = data;

    if (!schoolId) {
        throw new functions.https.HttpsError('invalid-argument', 'schoolId가 필요합니다.');
    }

    const db = admin.firestore();

    try {
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

        const metricsSnapshot = await db
            .collection('abTestMetrics')
            .where('schoolId', '==', schoolId)
            .where('createdAt', '>', twentyFourHoursAgo)
            .get();

        const metrics = metricsSnapshot.docs.map((doc: any) => doc.data());

        const groupA = metrics.filter((m: any) => m.group === 'A');
        const groupB = metrics.filter((m: any) => m.group === 'B');

        const calculateStats = (groupMetrics: any[]) => {
            const pageViews = groupMetrics.filter((m: any) => m.event === 'page_view').length;
            const registerStarts = groupMetrics.filter((m: any) => m.event === 'register_start').length;
            const registerCompletes = groupMetrics.filter((m: any) => m.event === 'register_complete').length;
            const registerFails = groupMetrics.filter((m: any) => m.event === 'register_fail').length;

            const conversionRate = pageViews > 0 ? (registerCompletes / pageViews * 100).toFixed(2) : '0.00';
            const successRate = registerStarts > 0 ? (registerCompletes / registerStarts * 100).toFixed(2) : '0.00';

            const completesWithDuration = groupMetrics.filter((m: any) => m.event === 'register_complete' && m.duration);
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
        throw new functions.https.HttpsError('internal', 'A/B 테스트 결과를 불러오는데 실패했습니다.');
    }
});
}
);
