const admin = require('firebase-admin');

async function main() {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'queue-test-school';
  const functionsBaseUrl = `http://127.0.0.1:15005/${projectId}/us-central1`;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18085';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19005';

  const databaseNamespaces = [projectId, `${projectId}-default-rtdb`];
  const defaultApp = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        projectId,
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}`
      });

  const dbApps = databaseNamespaces.map((namespace) => {
    const appName = `queue-db-${namespace}`;
    const existing = admin.apps.find((app) => app.name === appName);
    if (existing) {
      return { namespace, app: existing };
    }

    return {
      namespace,
      app: admin.initializeApp({
        projectId,
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${namespace}`
      }, appName)
    };
  });

  await defaultApp.firestore().doc(`schools/${schoolId}`).set({
    id: schoolId,
    name: 'Queue Verification School',
    logoUrl: '',
    maxCapacity: 3,
    waitlistCapacity: 2,
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { confirmedCount: 0, waitlistedCount: 0 },
    queueSettings: { enabled: true, batchSize: 3, batchInterval: 1000 },
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

  await Promise.all(dbApps.map(({ app }) => app.database().ref(`queue/${schoolId}`).remove()));
  await Promise.all(dbApps.map(({ app }) => app.database().ref(`slots/${schoolId}`).remove()));
  await Promise.all(dbApps.map(({ app }) => app.database().ref(`reservations/${schoolId}`).remove()));

  const clientApps = [];

  async function createClientAuth(index) {
    const app = initializeApp({
      apiKey: 'demo-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId: `demo-queue-app-${index}`
    }, `queue-client-${index}`);
    clientApps.push(app);

    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInAnonymously(auth);
    const idToken = await auth.currentUser.getIdToken(true);
    return { uid: auth.currentUser.uid, idToken, auth };
  }

  async function callFunction(name, idToken, data) {
    const response = await fetch(`${functionsBaseUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ data })
    });

    const payload = await response.json();
    if (payload.error) {
      const error = new Error(payload.error.message || `Callable ${name} failed`);
      error.code = payload.error.status || payload.error.code || 'UNKNOWN';
      throw error;
    }

    return payload.result;
  }

  async function getDatabaseValue(path) {
    for (const { namespace, app } of dbApps) {
      const snapshot = await app.database().ref(path).once('value');
      if (snapshot.exists()) {
        return { namespace, value: snapshot.val() };
      }
    }
    return { namespace: null, value: null };
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  try {
    // --- verifyConcurrentJoin ---
    const clients = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createClientAuth(index + 1))
    );

    const results = await Promise.all(
      clients.map((client) => callFunction('joinQueue', client.idToken, { schoolId }))
    );

    const numbers = results.map((result) => result.number).sort((a, b) => a - b);
    assert(numbers.length === new Set(numbers).size, 'Duplicate queue numbers detected');
    assert(numbers[0] === 1, 'Queue numbering did not start at 1');
    assert(numbers[numbers.length - 1] === clients.length, 'Queue numbering is not sequential');

    // Refresh token and re-join with first client — should return same number
    const firstClientToken = await clients[0].auth.currentUser.getIdToken(true);
    const repeat = await callFunction('joinQueue', firstClientToken, { schoolId });
    assert(repeat.number === results[0].number, `Same user should keep original number: got ${repeat.number}, expected ${results[0].number}`);

    console.log('PASS queue-join-1 concurrent join assigned unique sequential numbers:', numbers.join(', '));
    console.log('PASS queue-join-2 repeat join returns same number:', repeat.number);

    // --- verifyConcurrentSessionIssue ---
    // Disable queue so startRegistrationSession is not gated by turn
    await defaultApp.firestore().doc(`schools/${schoolId}`).set({
      queueSettings: { enabled: false, batchSize: 3, batchInterval: 1000 },
      updatedAt: Date.now()
    }, { merge: true });

    // maxCapacity(3) + waitlistCapacity(2) = 5 total slots; 6 clients → 5 succeed, 1 fails
    const sessionResults = await Promise.allSettled(
      clients.slice(0, 6).map((client) =>
        callFunction('startRegistrationSession', client.idToken, { schoolId })
      )
    );

    const fulfilled = sessionResults.filter((r) => r.status === 'fulfilled');
    const rejected = sessionResults.filter((r) => r.status === 'rejected');

    if (fulfilled.length !== 5 || rejected.length !== 1) {
      console.log('SESSION_RESULT_DETAILS', sessionResults);
    }

    assert(fulfilled.length === 5, `Expected 5 successful reservation sessions, got ${fulfilled.length}`);
    assert(rejected.length === 1, `Expected 1 rejection due to capacity, got ${rejected.length}`);

    const slotResult = await getDatabaseValue(`slots/${schoolId}`);
    assert(slotResult.value !== null, 'Slot data not found in RTDB');
    assert(slotResult.value.reserved === 5, `Expected reserved=5, got ${slotResult.value?.reserved}`);
    assert(slotResult.value.available === 0, `Expected available=0, got ${slotResult.value?.available}`);

    console.log('PASS capacity-1 concurrent sessions capped at total capacity');
    console.log('PASS capacity-2 slot counters reflect reservation state');
    console.log('All queue verification checks passed.');
  } finally {
    await Promise.allSettled([
      ...clientApps.map((app) => deleteApp(app)),
      ...dbApps.map(({ app }) => app.delete())
    ]);
  }
}

main().catch((error) => {
  console.error('Queue verification failed.');
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
