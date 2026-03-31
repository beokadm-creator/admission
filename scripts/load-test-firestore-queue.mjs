#!/usr/bin/env node

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'admission-477e5';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18085';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19005';
const FUNCTIONS_PORT = process.env.PORT || '15005';
const FUNCTIONS_BASE = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1`;

const TEST_SCHOOL_ID = 'load-test-school';
const TEST_MAX_CAPACITY = 30;
const TEST_WAITLIST_CAPACITY = 10;
const TEST_MAX_ACTIVE_SESSIONS = 60;
const TEST_BATCH_SIZE = 1;
const TEST_BATCH_INTERVAL_MS = 10_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--scenario');
  if (idx === -1) return { showHelp: true };
  const scenario = args[idx + 1];
  if (!scenario || !['concurrency', 'idempotency', 'expiry', 'all'].includes(scenario)) {
    return { showHelp: true, error: true };
  }
  const userIdx = args.indexOf('--users');
  const batchIdx = args.indexOf('--batch');
  const batchDelayIdx = args.indexOf('--batch-delay-ms');
  const users = userIdx !== -1 ? Number(args[userIdx + 1]) : 30;
  const batch = batchIdx !== -1 ? Number(args[batchIdx + 1]) : 3;
  const batchDelayMs = batchDelayIdx !== -1 ? Number(args[batchDelayIdx + 1]) : 0;
  const maxCapacityIdx = args.indexOf('--max-capacity');
  const waitlistCapacityIdx = args.indexOf('--waitlist-capacity');
  const maxCapacity = maxCapacityIdx !== -1 ? Number(args[maxCapacityIdx + 1]) : TEST_MAX_CAPACITY;
  const waitlistCapacity = waitlistCapacityIdx !== -1 ? Number(args[waitlistCapacityIdx + 1]) : TEST_WAITLIST_CAPACITY;
  return { scenario, users, batch, batchDelayMs, maxCapacity, waitlistCapacity };
}

function printHelp() {
  console.log(`
Firestore queue validation

Usage:
  node scripts/load-test-firestore-queue.mjs --scenario <scenario> [--users <count>] [--batch <count>] [--batch-delay-ms <ms>] [--max-capacity <count>] [--waitlist-capacity <count>]

Scenarios:
  concurrency
  idempotency
  expiry
  all
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let db;
let rtdb;
let testUserCounter = 0;

async function initAdmin() {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = DATABASE_HOST;

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: PROJECT_ID,
      databaseURL: `http://${DATABASE_HOST}?ns=${PROJECT_ID}-default-rtdb`
    });
  }

  db = admin.firestore();
  rtdb = admin.database();
}

async function callFunction(functionName, idToken, data) {
  const response = await fetch(`${FUNCTIONS_BASE}/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });

  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message || `${functionName} failed`);
    error.code = payload.error.code || payload.error.status || 'UNKNOWN';
    throw error;
  }

  return payload.data || payload.result || payload;
}

async function createTestUser() {
  const uid = `load-test-uid-${testUserCounter++}`;
  const customToken = await admin.auth().createCustomToken(uid);
  const tokenResponse = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenData.idToken) {
    throw new Error(`Failed to get idToken for ${uid}`);
  }

  return { uid, idToken: tokenData.idToken };
}

async function getQueueEntry(userId) {
  const snapshot = await db.doc(`schools/${TEST_SCHOOL_ID}/queueEntries/${userId}`).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function waitForQueueEntry(userId, predicate, timeoutMs = 15000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await getQueueEntry(userId);
    if (entry && predicate(entry)) {
      return entry;
    }
    await sleep(intervalMs);
  }
  return await getQueueEntry(userId);
}

async function forceEligible(userId, number) {
  const now = Date.now();
  await db.doc(`schools/${TEST_SCHOOL_ID}/queueEntries/${userId}`).set({
    status: 'eligible',
    number,
    eligibleAt: now,
    updatedAt: now,
    lastSeenAt: now,
  }, { merge: true });

  await db.doc(`schools/${TEST_SCHOOL_ID}/queueState/current`).set({
    currentNumber: Math.max(number, 1),
    pendingAdmissionCount: 1,
    lastAdvancedAt: now,
    updatedAt: now,
  }, { merge: true });
}

async function createTestSchool(options = {}) {
  const maxCapacity = Number(options.maxCapacity || TEST_MAX_CAPACITY);
  const waitlistCapacity = Number(options.waitlistCapacity || TEST_WAITLIST_CAPACITY);
  await db.doc(`schools/${TEST_SCHOOL_ID}`).set({
    id: TEST_SCHOOL_ID,
    name: 'Load Test School',
    logoUrl: '',
    maxCapacity,
    waitlistCapacity,
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { confirmedCount: 0, waitlistedCount: 0 },
    queueSettings: {
      enabled: true,
      batchSize: TEST_BATCH_SIZE,
      batchInterval: TEST_BATCH_INTERVAL_MS,
      maxActiveSessions: TEST_MAX_ACTIVE_SESSIONS,
    },
    formFields: {
      collectEmail: false,
      collectAddress: false,
      collectSchoolName: false,
      collectGrade: false,
      collectStudentId: false,
    },
    alimtalkSettings: { successTemplate: '', waitlistTemplate: '', promoteTemplate: '' },
    buttonSettings: { showLookupButton: true, showCancelButton: true },
    terms: {
      privacy: { title: 'privacy', content: 'privacy' },
      thirdParty: { title: 'third', content: 'third' },
      sms: { title: 'sms', content: 'sms' },
    },
  }, { merge: true });
}

async function cleanupCollection(path) {
  const coll = db.collection(path);
  while (true) {
    const snapshot = await coll.limit(200).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function cleanupTestData(options = {}) {
  const maxCapacity = Number(options.maxCapacity || TEST_MAX_CAPACITY);
  const waitlistCapacity = Number(options.waitlistCapacity || TEST_WAITLIST_CAPACITY);
  await cleanupCollection(`schools/${TEST_SCHOOL_ID}/queueEntries`);
  await cleanupCollection(`schools/${TEST_SCHOOL_ID}/reservations`);
  await cleanupCollection(`schools/${TEST_SCHOOL_ID}/registrations`);
  await cleanupCollection(`schools/${TEST_SCHOOL_ID}/requestLocks`);

  await db.doc(`schools/${TEST_SCHOOL_ID}`).set({
    stats: { confirmedCount: 0, waitlistedCount: 0 },
    updatedAt: Date.now(),
  }, { merge: true });

  await db.doc(`schools/${TEST_SCHOOL_ID}/queueState/current`).set({
    currentNumber: 0,
    lastAssignedNumber: 0,
    lastAdvancedAt: 0,
    activeReservationCount: 0,
    confirmedCount: 0,
    waitlistedCount: 0,
    totalCapacity: maxCapacity + waitlistCapacity,
    availableCapacity: maxCapacity + waitlistCapacity,
    queueEnabled: true,
    pendingAdmissionCount: 0,
    maxActiveSessions: TEST_MAX_ACTIVE_SESSIONS,
    updatedAt: Date.now(),
  }, { merge: true });

  await rtdb.ref(`queueIssuer/${TEST_SCHOOL_ID}`).remove();

  const rateLimitSnapshot = await db.collection('rateLimits').get();
  if (!rateLimitSnapshot.empty) {
    const batch = db.batch();
    rateLimitSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function checkEmulator() {
  try {
    await fetch(`http://${FIRESTORE_HOST}`, { method: 'GET' });
  } catch {
    console.error('Firebase Emulator is not running.');
    process.exit(1);
  }
}

async function runConcurrencyTest(options = {}) {
  console.log('\n━━━ SCENARIO: CONCURRENCY ━━━');
  const users = [];
  const userTokenMap = new Map();
  const USER_COUNT = Number(options.users || 30);
  const BATCH = Number(options.batch || 3);
  const BATCH_DELAY_MS = Number(options.batchDelayMs || 0);

  for (let i = 0; i < USER_COUNT; i++) {
    const user = await createTestUser();
    users.push(user);
    userTokenMap.set(user.uid, user.idToken);
  }

  const joinResults = [];
  const startedAt = Date.now();

  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((user) =>
        callFunction('joinQueue', user.idToken, {
          schoolId: TEST_SCHOOL_ID,
          requestId: `conc-jq-${user.uid}`,
        })
          .then((result) => ({ success: true, result, userId: user.uid }))
          .catch((error) => ({ success: false, error, userId: user.uid }))
      )
    );
    joinResults.push(...results);

    if (BATCH_DELAY_MS > 0 && i + BATCH < users.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const joinSuccesses = joinResults.filter((item) => item.success);
  console.log(`  joinQueue: ${joinSuccesses.length}/${USER_COUNT} success (${Date.now() - startedAt}ms)`);

  const entryStates = await Promise.all(
    joinSuccesses.map(async (item) => ({
      userId: item.userId,
    entry: await waitForQueueEntry(item.userId, (entry) => entry.number != null, 15000),
    }))
  );

  const assignedNumbers = entryStates
    .map((item) => item.entry?.number)
    .filter((value) => Number.isInteger(value));

  const duplicateCount = assignedNumbers.length - new Set(assignedNumbers).size;
  const eligibleItems = entryStates.filter((item) => item.entry?.status === 'eligible').slice(0, 5);

  const sessionResults = await Promise.all(
    eligibleItems.map((item) =>
      callFunction('startRegistrationSession', userTokenMap.get(item.userId), {
        schoolId: TEST_SCHOOL_ID,
        requestId: `conc-srs-${item.userId}`,
      })
        .then((result) => ({ success: true, result, userId: item.userId }))
        .catch((error) => ({ success: false, error, userId: item.userId }))
    )
  );

  const sessionSuccesses = sessionResults.filter((item) => item.success && item.result?.sessionId);
  const confirmItems = sessionSuccesses.slice(0, 3);
  const confirmResults = await Promise.all(
    confirmItems.map((item, index) =>
      callFunction('confirmReservation', userTokenMap.get(item.userId), {
        schoolId: TEST_SCHOOL_ID,
        sessionId: item.result.sessionId,
        requestId: `conc-cr-${item.userId}`,
        formData: {
          studentName: `동시성테스트${index}`,
          phone: `0101000${String(index).padStart(4, '0')}`,
          agreedSms: true,
        },
      })
        .then((result) => ({ success: true, result }))
        .catch((error) => ({ success: false, error }))
    )
  );

  const checksPassed =
    joinSuccesses.length === USER_COUNT &&
    duplicateCount === 0 &&
    sessionSuccesses.length === eligibleItems.length &&
    confirmResults.every((item) => item.success);

  console.log(`  assigned numbers: ${assignedNumbers.length}, duplicates: ${duplicateCount}`);
  console.log(`  eligible users: ${eligibleItems.length}, started sessions: ${sessionSuccesses.length}`);
  console.log(`  confirms: ${confirmResults.filter((item) => item.success).length}/${confirmResults.length}`);
  console.log(`  config: users=${USER_COUNT}, batch=${BATCH}, batchDelayMs=${BATCH_DELAY_MS}`);
  console.log(`  Scenario result: ${checksPassed ? 'PASS' : 'FAIL'}`);

  return { passed: checksPassed };
}

async function runIdempotencyTest() {
  console.log('\n━━━ SCENARIO: IDEMPOTENCY ━━━');
  const user = await createTestUser();

  const joinRequestId = 'idem-join-001';
  const joinResponses = [];
  for (let i = 0; i < 10; i++) {
    joinResponses.push(await callFunction('joinQueue', user.idToken, {
      schoolId: TEST_SCHOOL_ID,
      requestId: joinRequestId,
    }));
  }

  const joinIdentical = joinResponses.every((item) => JSON.stringify(item) === JSON.stringify(joinResponses[0]));
  let latestEntry = await waitForQueueEntry(user.uid, (entry) => entry.number != null, 15000);
  if (!latestEntry || latestEntry.number == null) {
    throw new Error('Queue number was not assigned after joinQueue');
  }

  if (latestEntry.status !== 'eligible') {
    await forceEligible(user.uid, latestEntry.number);
    latestEntry = await waitForQueueEntry(user.uid, (entry) => entry.status === 'eligible', 5000);
  }

  const sessionRequestId = 'idem-session-001';
  const sessionResponses = [];
  for (let i = 0; i < 10; i++) {
    sessionResponses.push(await callFunction('startRegistrationSession', user.idToken, {
      schoolId: TEST_SCHOOL_ID,
      requestId: sessionRequestId,
    }));
  }
  const sessionIdentical = sessionResponses.every((item) => JSON.stringify(item) === JSON.stringify(sessionResponses[0]));
  const sessionId = sessionResponses[0].sessionId;

  const confirmRequestId = 'idem-confirm-001';
  const confirmResponses = [];
  for (let i = 0; i < 5; i++) {
    confirmResponses.push(await callFunction('confirmReservation', user.idToken, {
      schoolId: TEST_SCHOOL_ID,
      sessionId,
      requestId: confirmRequestId,
      formData: {
        studentName: '멱등성테스트',
        phone: '01099990001',
        agreedSms: true,
      },
    }));
  }
  const confirmIdentical = confirmResponses.every((item) => JSON.stringify(item) === JSON.stringify(confirmResponses[0]));

  const activeReservations = await db.collection(`schools/${TEST_SCHOOL_ID}/reservations`)
    .where('userId', '==', user.uid)
    .where('status', 'in', ['reserved', 'processing'])
    .get();

  const checksPassed =
    joinIdentical &&
    sessionIdentical &&
    confirmIdentical &&
    activeReservations.size <= 1 &&
    (await db.doc(`schools/${TEST_SCHOOL_ID}/requestLocks/${joinRequestId}`).get()).exists &&
    (await db.doc(`schools/${TEST_SCHOOL_ID}/requestLocks/${sessionRequestId}`).get()).exists &&
    (await db.doc(`schools/${TEST_SCHOOL_ID}/requestLocks/${confirmRequestId}`).get()).exists;

  console.log(`  join identical: ${joinIdentical}`);
  console.log(`  session identical: ${sessionIdentical}`);
  console.log(`  confirm identical: ${confirmIdentical}`);
  console.log(`  active reservations: ${activeReservations.size}`);
  console.log(`  Scenario result: ${checksPassed ? 'PASS' : 'FAIL'}`);

  return { passed: checksPassed };
}

async function runExpiryRaceTest() {
  console.log('\n━━━ SCENARIO: EXPIRY / RACE CONDITION ━━━');
  const user = await createTestUser();

  await callFunction('joinQueue', user.idToken, {
    schoolId: TEST_SCHOOL_ID,
    requestId: 'race-join-001',
  });

  const entry = await waitForQueueEntry(user.uid, (item) => item.number != null, 15000);
  if (!entry || entry.number == null) {
    throw new Error('Queue number was not assigned for race test');
  }
  if (entry.status !== 'eligible') {
    await forceEligible(user.uid, entry.number);
  }

  const sessionResult = await callFunction('startRegistrationSession', user.idToken, {
    schoolId: TEST_SCHOOL_ID,
    requestId: 'race-session-001',
  });

  await db.doc(`schools/${TEST_SCHOOL_ID}/reservations/${sessionResult.sessionId}`).set({
    expiresAt: Date.now() + 3000,
  }, { merge: true });

  await sleep(2000);

  const [confirmResult, expireResult] = await Promise.all([
    callFunction('confirmReservation', user.idToken, {
      schoolId: TEST_SCHOOL_ID,
      sessionId: sessionResult.sessionId,
      requestId: 'race-confirm-001',
      formData: {
        studentName: '경합테스트',
        phone: '01088880001',
        agreedSms: true,
      },
    }).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
    callFunction('forceExpireSession', user.idToken, {
      schoolId: TEST_SCHOOL_ID,
      sessionId: sessionResult.sessionId,
      requestId: 'race-expire-001',
    }).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
  ]);

  await sleep(1000);
  const reservation = (await db.doc(`schools/${TEST_SCHOOL_ID}/reservations/${sessionResult.sessionId}`).get()).data();
  const finalStatus = reservation?.status;
  const oneTerminalState = finalStatus === 'confirmed' || finalStatus === 'expired';

  const state = (await db.doc(`schools/${TEST_SCHOOL_ID}/queueState/current`).get()).data();
  const activeReservations = await db.collection(`schools/${TEST_SCHOOL_ID}/reservations`)
    .where('status', 'in', ['reserved', 'processing'])
    .get();
  const countMatch = (state?.activeReservationCount ?? 0) === activeReservations.size;

  const checksPassed = oneTerminalState && countMatch && (confirmResult.ok || expireResult.ok);
  console.log(`  confirm ok: ${confirmResult.ok}`);
  console.log(`  expire ok: ${expireResult.ok}`);
  console.log(`  final status: ${finalStatus}`);
  console.log(`  active count match: ${countMatch}`);
  console.log(`  Scenario result: ${checksPassed ? 'PASS' : 'FAIL'}`);

  return { passed: checksPassed };
}

async function runPostTestVerification() {
  console.log('\n━━━ POST-TEST VERIFICATION ━━━');
  const state = (await db.doc(`schools/${TEST_SCHOOL_ID}/queueState/current`).get()).data() || {};
  let passCount = 0;

  const availableCapacity = state.availableCapacity ?? 0;
  const v1 = availableCapacity >= 0;
  console.log(`  [${v1 ? 'PASS' : 'FAIL'}] availableCapacity >= 0 (${availableCapacity})`);
  if (v1) passCount++;

  const lastAssignedNumber = state.lastAssignedNumber ?? 0;
  const currentNumber = state.currentNumber ?? 0;
  const v2 = lastAssignedNumber >= currentNumber;
  console.log(`  [${v2 ? 'PASS' : 'FAIL'}] lastAssignedNumber >= currentNumber (${lastAssignedNumber} >= ${currentNumber})`);
  if (v2) passCount++;

  const activeReservations = await db.collection(`schools/${TEST_SCHOOL_ID}/reservations`)
    .where('status', 'in', ['reserved', 'processing'])
    .get();
  const v3 = (state.activeReservationCount ?? 0) === activeReservations.size;
  console.log(`  [${v3 ? 'PASS' : 'FAIL'}] activeReservationCount matches actual (${state.activeReservationCount ?? 0} == ${activeReservations.size})`);
  if (v3) passCount++;

  const activeByUser = {};
  activeReservations.docs.forEach((doc) => {
    const userId = doc.data().userId;
    activeByUser[userId] = (activeByUser[userId] || 0) + 1;
  });
  const v4 = Object.values(activeByUser).every((count) => count <= 1);
  console.log(`  [${v4 ? 'PASS' : 'FAIL'}] no user has more than one active reservation`);
  if (v4) passCount++;

  const locks = await db.collection(`schools/${TEST_SCHOOL_ID}/requestLocks`).get();
  const lockIds = new Set(locks.docs.map((doc) => doc.id));
  const v5 = lockIds.size === locks.size;
  console.log(`  [${v5 ? 'PASS' : 'FAIL'}] requestLocks unique by requestId`);
  if (v5) passCount++;

  const registrations = await db.collection(`schools/${TEST_SCHOOL_ID}/registrations`).get();
  const expectedTotal = (state.confirmedCount ?? 0) + (state.waitlistedCount ?? 0);
  const v6 = registrations.size === expectedTotal;
  console.log(`  [${v6 ? 'PASS' : 'FAIL'}] registrations match counts (${registrations.size} == ${expectedTotal})`);
  if (v6) passCount++;

  console.log(`  Result: ${passCount}/6 PASS`);
  return { passCount, totalCount: 6 };
}

async function main() {
  const { scenario, showHelp, error, users, batch, batchDelayMs, maxCapacity, waitlistCapacity } = parseArgs();
  if (showHelp) {
    printHelp();
    if (error) process.exit(1);
    return;
  }

  console.log('═══════════════════════════════════════════');
  console.log(' Firestore Queue Load/Consistency Test');
  console.log('═══════════════════════════════════════════');
  console.log(`  Project:    ${PROJECT_ID}`);
  console.log(`  Firestore:  ${FIRESTORE_HOST}`);
  console.log(`  Functions:  http://127.0.0.1:${FUNCTIONS_PORT}`);
  console.log(`  School ID:  ${TEST_SCHOOL_ID}`);
  console.log(`  Scenario:   ${scenario}`);

  await checkEmulator();
  await initAdmin();
  await cleanupTestData({ maxCapacity, waitlistCapacity });
  await createTestSchool({ maxCapacity, waitlistCapacity });

  const scenarioResults = [];
  if (scenario === 'concurrency' || scenario === 'all') {
    scenarioResults.push(await runConcurrencyTest({ users, batch, batchDelayMs }));
  }
  if (scenario === 'idempotency' || scenario === 'all') scenarioResults.push(await runIdempotencyTest());
  if (scenario === 'expiry' || scenario === 'all') scenarioResults.push(await runExpiryRaceTest());

  const verification = await runPostTestVerification();
  const scenarioPassCount = scenarioResults.filter((item) => item.passed).length;
  const allPassed = scenarioPassCount === scenarioResults.length && verification.passCount === verification.totalCount;

  console.log('\n═══════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`  Scenarios:    [${scenarioPassCount}/${scenarioResults.length} pass]`);
  console.log(`  Verification: [${verification.passCount}/${verification.totalCount} PASS]`);
  console.log(`  VERDICT:      ${allPassed ? '✅ APPROVE' : '❌ REJECT'}`);
  console.log('═══════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('\nFATAL ERROR:', error);
  process.exit(2);
});
