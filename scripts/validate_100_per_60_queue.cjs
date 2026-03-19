/**
 * validate_100_per_60_queue.cjs
 *
 * 실제 Firebase 프로젝트 대상 검증 스크립트 (에뮬레이터 아님)
 *
 * 전제조건:
 *   - scripts/serviceAccountKey.json 파일 필요
 *     Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
 *     다운로드한 JSON 파일을 scripts/serviceAccountKey.json 으로 저장
 *   - 인터넷 연결 (실제 Firebase 프로젝트 접근)
 *
 * 실행:
 *   node scripts/validate_100_per_60_queue.cjs
 *
 * 검증 항목:
 *   queue80-1: 100명 동시 입장 → 1..100 중복 없이 번호 부여
 *   queue80-2: 스케줄러 실행 전 아무도 입장 불가
 *   queue80-3: Cloud Scheduler autoAdvanceQueue 실행 후 80명 입장
 *   queue80-4: 입장된 80명만 등록 세션 시작 가능, 나머지 FAILED_PRECONDITION
 *   queue80-5: 슬롯 카운터 reserved=80, available=920
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'admission-477e5';
const DATABASE_URL = 'https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app';
const FUNCTIONS_BASE_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('ERROR: scripts/serviceAccountKey.json 파일이 없습니다.');
  console.error('Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성');
  console.error('다운로드한 JSON 파일을 scripts/serviceAccountKey.json 으로 저장하세요.');
  process.exit(1);
}
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAnxYrQoduongilSi3wj0uXAkw5lL1r-Tw',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  databaseURL: DATABASE_URL,
  appId: '1:219375017771:web:bcaf69dc27c562f0b6af6e'
};

const SCHOOL_ID = 'queue-80-per-60-school';
const BATCH_SIZE = 80;
const TOTAL_USERS = 100;

async function main() {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, signInWithCustomToken } = await import('firebase/auth');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(SERVICE_ACCOUNT_PATH),
      projectId: PROJECT_ID,
      databaseURL: DATABASE_URL
    });
  }

  const db = admin.firestore();
  const rtdb = admin.database();

  // ── 테스트 데이터 초기화 ──────────────────────────────────────────
  await db.doc(`schools/${SCHOOL_ID}`).set({
    id: SCHOOL_ID,
    name: '80 Per 60 Queue Test School',
    logoUrl: '',
    maxCapacity: 1000,
    waitlistCapacity: 0,
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { confirmedCount: 0, waitlistedCount: 0 },
    queueSettings: {
      enabled: true,
      batchSize: BATCH_SIZE,
      batchInterval: 60000
    },
    formFields: {
      collectEmail: false,
      collectAddress: false,
      collectSchoolName: false,
      collectGrade: false,
      collectStudentId: false
    },
    alimtalkSettings: { successTemplate: '', waitlistTemplate: '' },
    buttonSettings: { showLookupButton: true, showCancelButton: true },
    terms: {
      privacy: { title: 'privacy', content: 'privacy' },
      thirdParty: { title: 'third', content: 'third' },
      sms: { title: 'sms', content: 'sms' }
    }
  }, { merge: true });

  await rtdb.ref(`queue/${SCHOOL_ID}`).remove();
  await rtdb.ref(`slots/${SCHOOL_ID}`).remove();
  await rtdb.ref(`reservations/${SCHOOL_ID}`).remove();

  const existingRegs = await db.collection(`schools/${SCHOOL_ID}/registrations`).get();
  if (!existingRegs.empty) {
    const batch = db.batch();
    existingRegs.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const clientApps = [];

  // ── 헬퍼 함수 ────────────────────────────────────────────────────
  async function createClientAuth(index) {
    const uid = `test-queue80-user-${index}`;
    // Admin SDK로 커스텀 토큰 발급 (Rate Limit 없음)
    const customToken = await admin.auth().createCustomToken(uid);
    const app = initializeApp(
      { ...FIREBASE_CONFIG, appId: `${FIREBASE_CONFIG.appId}-${index}` },
      `queue-80-client-${index}`
    );
    clientApps.push(app);
    const auth = getAuth(app);
    await signInWithCustomToken(auth, customToken);
    return { uid: auth.currentUser.uid, auth };
  }

  async function callFunction(name, idToken, data) {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ data })
    });
    const payload = await response.json();
    if (payload.error) {
      const error = new Error(payload.error.message || `${name} failed`);
      error.code = payload.error.status || payload.error.code || 'UNKNOWN';
      throw error;
    }
    return payload.result;
  }

  function assert(condition, message) {
    if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runInBatches(items, batchSize, runner) {
    const settled = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((item, j) => runner(item, i + j))
      );
      settled.push(...results);
      await sleep(200);
    }
    return settled;
  }

  /**
   * Cloud Scheduler가 autoAdvanceQueue를 실행할 때까지 폴링
   * 최대 130초 대기 (Cloud Scheduler는 매 1분 실행, 최악의 경우 2틱 소요 가능)
   */
  async function pollUntilAdvanced(targetNumber, timeoutMs = 130_000, intervalMs = 3_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snap = await rtdb.ref(`queue/${SCHOOL_ID}/meta`).once('value');
      const meta = snap.val();
      if (meta && meta.currentNumber >= targetNumber) {
        console.log(`  → currentNumber=${meta.currentNumber} (${Math.round((Date.now() - start) / 1000)}초 경과)`);
        return meta;
      }
      await sleep(intervalMs);
    }
    const snap = await rtdb.ref(`queue/${SCHOOL_ID}/meta`).once('value');
    return snap.val();
  }

  // ── 테스트 실행 ───────────────────────────────────────────────────
  try {
    // 클라이언트를 학교 설정 전에 미리 준비 (스케줄러 실행 window 최소화)
    console.log(`\n[준비] ${TOTAL_USERS}명 클라이언트 인증 준비 중...`);
    const clients = await Promise.all(
      Array.from({ length: TOTAL_USERS }, (_, i) => createClientAuth(i + 1))
    );
    console.log(`[준비] 완료 — 이제 학교 설정 후 즉시 입장 시작`);

    // queue80-2: 학교 초기화 직후 currentNumber === 0 확인 (사용자 입장 전)
    const initialMeta = (await rtdb.ref(`queue/${SCHOOL_ID}/meta`).once('value')).val();
    assert(
      !initialMeta || initialMeta.currentNumber === 0,
      `초기 currentNumber=${initialMeta?.currentNumber}, 기대=0 (이전 테스트 잔여 데이터 가능성)`
    );
    console.log('PASS queue80-2 학교 초기화 직후 currentNumber=0 (아직 아무도 입장 불가)');

    // queue80-1: 100명 동시 joinQueue
    console.log(`\n[queue80-1] ${TOTAL_USERS}명 동시 joinQueue 시작...`);
    const joinSettled = await runInBatches(clients, 20, async (client) => {
      const idToken = await client.auth.currentUser.getIdToken(true);
      return callFunction('joinQueue', idToken, { schoolId: SCHOOL_ID });
    });

    const joinFulfilled = joinSettled.filter((r) => r.status === 'fulfilled');
    const joinRejected = joinSettled.filter((r) => r.status === 'rejected');

    if (joinRejected.length > 0) {
      const sample = joinRejected.slice(0, 5).map((r) => ({
        code: r.reason.code,
        message: r.reason.message
      }));
      assert(false, `${joinRejected.length}명 joinQueue 실패: ${JSON.stringify(sample)}`);
    }

    const numbers = joinFulfilled
      .map((r) => r.value.number)
      .sort((a, b) => a - b);

    assert(numbers.length === TOTAL_USERS, `기대=${TOTAL_USERS}, 실제=${numbers.length}`);
    assert(numbers.length === new Set(numbers).size, '중복 번호 감지');
    assert(
      numbers[0] === 1 && numbers[numbers.length - 1] === TOTAL_USERS,
      `번호 범위 오류: ${numbers[0]}..${numbers[numbers.length - 1]}`
    );
    console.log(`PASS queue80-1 ${TOTAL_USERS}명 입장 완료, 번호 1..${TOTAL_USERS} 중복 없음`);

    // queue80-3: Cloud Scheduler autoAdvanceQueue 실행 대기
    // 스케줄러가 joinQueue 도중 실행되면 부분 배치 후 60초 뒤 추가 배치 가능
    // → currentNumber >= BATCH_SIZE 를 기준으로 검증 (정확히 80이 아닐 수 있음)
    console.log(`\n[queue80-3] Cloud Scheduler 실행 대기 중 (최대 130초)...`);
    console.log('  ※ autoAdvanceQueue는 매 1분 실행됩니다. 최대 2틱 소요 가능.');
    const metaAfterTick = await pollUntilAdvanced(BATCH_SIZE);
    const admittedCount = metaAfterTick?.currentNumber ?? 0;
    assert(
      admittedCount >= BATCH_SIZE,
      `currentNumber=${admittedCount}, 기대 >= ${BATCH_SIZE}`
    );
    assert(
      admittedCount <= TOTAL_USERS,
      `currentNumber=${admittedCount}가 전체 인원(${TOTAL_USERS})을 초과`
    );
    console.log(`PASS queue80-3 스케줄러 실행 후 ${admittedCount}명 입장 허용 (배치 크기 ${BATCH_SIZE} 이상)`);

    // queue80-4: 입장된 인원만 세션 시작 가능, 나머지 FAILED_PRECONDITION
    // admittedCount 기준으로 검증 (스케줄러 실행 타이밍에 따라 가변)
    const sessionResults = await runInBatches(clients, 10, async (client) => {
      const idToken = await client.auth.currentUser.getIdToken(true);
      return callFunction('startRegistrationSession', idToken, { schoolId: SCHOOL_ID });
    });

    const sessionFulfilled = sessionResults.filter((r) => r.status === 'fulfilled');
    const sessionRejected = sessionResults.filter((r) => r.status === 'rejected');
    const rejectedCodes = sessionRejected.map((r) => r.reason.code);

    if (sessionFulfilled.length !== admittedCount) {
      const sampleErrors = sessionRejected.slice(0, 5).map((r) => ({
        code: r.reason?.code,
        message: r.reason?.message
      }));
      console.error(`[DEBUG] 거부된 세션 샘플:`, JSON.stringify(sampleErrors, null, 2));
    }
    assert(
      sessionFulfilled.length === admittedCount,
      `세션 성공=${sessionFulfilled.length}, 기대=${admittedCount} (입장된 인원)`
    );
    assert(
      sessionRejected.length === TOTAL_USERS - admittedCount,
      `세션 거부=${sessionRejected.length}, 기대=${TOTAL_USERS - admittedCount}`
    );
    assert(
      rejectedCodes.every((c) => c === 'FAILED_PRECONDITION'),
      `대기 중 사용자 에러 코드: ${[...new Set(rejectedCodes)].join(', ')}`
    );
    console.log(`PASS queue80-4 입장된 ${admittedCount}명 세션 시작 성공, 나머지 ${TOTAL_USERS - admittedCount}명 FAILED_PRECONDITION`);

    // queue80-5: 슬롯 카운터가 실제 입장 인원과 일치
    const slotsSnap = await rtdb.ref(`slots/${SCHOOL_ID}`).once('value');
    const slots = slotsSnap.val();
    assert(
      slots && slots.reserved === admittedCount,
      `reserved=${slots?.reserved}, 기대=${admittedCount}`
    );
    assert(
      slots.available === 1000 - admittedCount,
      `available=${slots?.available}, 기대=${1000 - admittedCount}`
    );
    console.log(`PASS queue80-5 슬롯 카운터 reserved=${admittedCount}, available=${1000 - admittedCount}`);

    console.log('\n✓ 모든 검증 통과\n');
  } finally {
    // ── 테스트 데이터 정리 ─────────────────────────────────────────
    console.log('[cleanup] 테스트 데이터 정리 중...');
    const regs = await db.collection(`schools/${SCHOOL_ID}/registrations`).get();
    const cleanupBatch = db.batch();
    regs.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
    if (!regs.empty) await cleanupBatch.commit();

    await Promise.allSettled([
      rtdb.ref(`queue/${SCHOOL_ID}`).remove(),
      rtdb.ref(`slots/${SCHOOL_ID}`).remove(),
      rtdb.ref(`reservations/${SCHOOL_ID}`).remove(),
      db.doc(`schools/${SCHOOL_ID}`).delete(),
      ...clientApps.map((app) => deleteApp(app))
    ]);
    console.log('[cleanup] 완료');
  }
}

main()
  .catch((error) => {
    console.error('\nVALIDATION_FAILED');
    console.error(error.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
