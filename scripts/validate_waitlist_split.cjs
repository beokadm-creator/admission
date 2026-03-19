/**
 * validate_waitlist_split.cjs
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
 *   node scripts/validate_waitlist_split.cjs
 *
 * 검증 항목:
 *   waitlist-1: 첫 2명은 confirmed
 *   waitlist-2: 3번째는 waitlisted (rank=1)
 *   waitlist-3: 학교 stats confirmedCount=2, waitlistedCount=1
 *   waitlist-4: AlimTalk 큐에 TPL_CONFIRMED x2, TPL_WAITLIST x1 적재
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'admission-477e5';

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('ERROR: scripts/serviceAccountKey.json 파일이 없습니다.');
  console.error('Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성');
  console.error('다운로드한 JSON 파일을 scripts/serviceAccountKey.json 으로 저장하세요.');
  process.exit(1);
}
const DATABASE_URL = 'https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app';
const FUNCTIONS_BASE_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAnxYrQoduongilSi3wj0uXAkw5lL1r-Tw',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  databaseURL: DATABASE_URL,
  appId: '1:219375017771:web:bcaf69dc27c562f0b6af6e'
};

const SCHOOL_ID = 'waitlist-split-test-school';

async function main() {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, signInAnonymously } = await import('firebase/auth');

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
    name: 'Waitlist Split Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 2,
    waitlistCapacity: 1,
    isActive: true,
    queueSettings: {
      enabled: false,
      batchSize: 2,
      batchInterval: 60000
    },
    stats: {
      confirmedCount: 0,
      waitlistedCount: 0
    },
    alimtalkSettings: {
      successTemplate: 'TPL_CONFIRMED',
      waitlistTemplate: 'TPL_WAITLIST',
      promoteTemplate: 'TPL_PROMOTE'
    },
    formFields: {
      collectEmail: false,
      collectAddress: false,
      collectSchoolName: false,
      collectGrade: false,
      collectStudentId: false
    },
    buttonSettings: { showLookupButton: true, showCancelButton: true },
    terms: {
      privacy: { title: 'privacy', content: 'privacy' },
      thirdParty: { title: 'third', content: 'third' },
      sms: { title: 'sms', content: 'sms' }
    }
  }, { merge: true });

  await rtdb.ref(`slots/${SCHOOL_ID}`).remove();
  await rtdb.ref(`reservations/${SCHOOL_ID}`).remove();

  const cleanupPaths = [`schools/${SCHOOL_ID}/registrations`];
  for (const path of cleanupPaths) {
    const snap = await db.collection(path).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  // alimtalkQueue에서 이 학교 관련 항목만 정리
  const existingQueue = await db.collection('alimtalkQueue')
    .where('schoolId', '==', SCHOOL_ID)
    .get();
  if (!existingQueue.empty) {
    const batch = db.batch();
    existingQueue.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const clientApps = [];

  // ── 헬퍼 함수 ────────────────────────────────────────────────────
  async function createClient(index) {
    const app = initializeApp(
      { ...FIREBASE_CONFIG, appId: `${FIREBASE_CONFIG.appId}-waitlist-${index}` },
      `waitlist-client-${index}`
    );
    clientApps.push(app);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    return { idToken: await auth.currentUser.getIdToken(true) };
  }

  async function callFunction(name, data, idToken) {
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

  async function waitForAlimTalkQueue(expectedCount, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snap = await db.collection('alimtalkQueue')
        .where('schoolId', '==', SCHOOL_ID)
        .get();
      if (snap.size >= expectedCount) return snap;
      await sleep(500);
    }
    return db.collection('alimtalkQueue').where('schoolId', '==', SCHOOL_ID).get();
  }

  // ── 테스트 실행 ───────────────────────────────────────────────────
  try {
    const clients = await Promise.all([1, 2, 3].map((n) => createClient(n)));

    const results = [];
    for (let i = 0; i < clients.length; i++) {
      const session = await callFunction(
        'startRegistrationSession',
        { schoolId: SCHOOL_ID },
        clients[i].idToken
      );
      const result = await callFunction(
        'confirmReservation',
        {
          schoolId: SCHOOL_ID,
          sessionId: session.sessionId,
          formData: {
            studentName: `테스터 ${i + 1}`,
            phone: `010-5555-000${i + 1}`,
            agreedSms: true
          }
        },
        clients[i].idToken
      );
      results.push(result);
    }

    // 등록 결과 조회
    const registrations = await db
      .collection(`schools/${SCHOOL_ID}/registrations`)
      .orderBy('submittedAt')
      .get();
    const regData = registrations.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const statsDoc = await db.doc(`schools/${SCHOOL_ID}`).get();
    const stats = statsDoc.data().stats;

    const alimtalkSnap = await waitForAlimTalkQueue(3);
    const queuedTemplates = alimtalkSnap.docs.map((doc) => doc.data().templateCode).sort();

    // ── 검증 ──────────────────────────────────────────────────────
    assert(results[0].status === 'confirmed', `1번째 결과=${results[0].status}, 기대=confirmed`);
    assert(results[1].status === 'confirmed', `2번째 결과=${results[1].status}, 기대=confirmed`);
    assert(results[2].status === 'waitlisted', `3번째 결과=${results[2].status}, 기대=waitlisted`);
    assert(results[2].rank === 1, `대기 순위=${results[2].rank}, 기대=1`);
    console.log('PASS waitlist-1 첫 2명 confirmed');
    console.log('PASS waitlist-2 3번째 waitlisted (rank=1)');

    assert(stats.confirmedCount === 2, `confirmedCount=${stats.confirmedCount}, 기대=2`);
    assert(stats.waitlistedCount === 1, `waitlistedCount=${stats.waitlistedCount}, 기대=1`);
    console.log('PASS waitlist-3 stats confirmedCount=2, waitlistedCount=1');

    const statuses = regData.map((r) => r.status);
    assert(
      JSON.stringify(statuses) === JSON.stringify(['confirmed', 'confirmed', 'waitlisted']),
      `등록 상태 순서: ${JSON.stringify(statuses)}`
    );
    assert(regData[2].rank === 1, `DB 대기 rank=${regData[2].rank}, 기대=1`);

    const expectedTemplates = ['TPL_CONFIRMED', 'TPL_CONFIRMED', 'TPL_WAITLIST'].sort();
    assert(
      JSON.stringify(queuedTemplates) === JSON.stringify(expectedTemplates),
      `AlimTalk 템플릿: ${JSON.stringify(queuedTemplates)}, 기대: ${JSON.stringify(expectedTemplates)}`
    );
    console.log('PASS waitlist-4 AlimTalk 큐 TPL_CONFIRMED x2, TPL_WAITLIST x1');

    console.log('\n✓ 모든 검증 통과\n');
  } finally {
    // ── 테스트 데이터 정리 ─────────────────────────────────────────
    console.log('[cleanup] 테스트 데이터 정리 중...');
    const regs = await db.collection(`schools/${SCHOOL_ID}/registrations`).get();
    const cleanupBatch = db.batch();
    regs.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
    if (!regs.empty) await cleanupBatch.commit();

    const aqSnap = await db.collection('alimtalkQueue')
      .where('schoolId', '==', SCHOOL_ID)
      .get();
    if (!aqSnap.empty) {
      const aqBatch = db.batch();
      aqSnap.docs.forEach((doc) => aqBatch.delete(doc.ref));
      await aqBatch.commit();
    }

    await Promise.allSettled([
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
