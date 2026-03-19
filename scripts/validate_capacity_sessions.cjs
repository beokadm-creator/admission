const admin = require('firebase-admin');

async function main() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'capacity-test-school';
  const functionsBaseUrl = `http://127.0.0.1:15005/${projectId}/us-central1`;
  const databaseBaseUrl = 'http://127.0.0.1:19005';
  const databaseNamespaces = [projectId, `${projectId}-default-rtdb`];

  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18085';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19005';

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}`
    });
  }

  await admin.firestore().doc(`schools/${schoolId}`).set({
    id: schoolId,
    name: 'Capacity Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 3,
    waitlistCapacity: 2,
    isActive: true,
    queueSettings: {
      enabled: false,
      batchSize: 3,
      batchInterval: 1000
    },
    stats: {
      confirmedCount: 0,
      waitlistedCount: 0
    }
  }, { merge: true });

  await admin.database().ref(`queue/${schoolId}`).remove();
  await admin.database().ref(`slots/${schoolId}`).remove();
  await admin.database().ref(`reservations/${schoolId}`).remove();
  const registrations = await admin.firestore().collection(`schools/${schoolId}/registrations`).get();
  if (!registrations.empty) {
    const batch = admin.firestore().batch();
    registrations.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const lines = [];
  const mark = (line) => {
    lines.push(line);
    console.log(line);
  };

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
      const error = new Error(payload.error.message || `${name} failed`);
      error.code = payload.error.status || payload.error.code || 'UNKNOWN';
      throw error;
    }

    return payload.result;
  }

  async function getDatabaseValue(path) {
    for (const namespace of databaseNamespaces) {
      const response = await fetch(`${databaseBaseUrl}/${path}.json?ns=${namespace}`);
      if (!response.ok) {
        continue;
      }

      const value = await response.json();
      if (value !== null) {
        return { namespace, value };
      }
    }

    return { namespace: null, value: null };
  }

  async function createClientAuth(index) {
    const app = initializeApp({
      apiKey: 'demo-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId: `demo-capacity-app-${index}`
    }, `capacity-client-${index}`);

    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInAnonymously(auth);
    const idToken = await auth.currentUser.getIdToken(true);

    return {
      uid: auth.currentUser.uid,
      idToken
    };
  }

  const clients = await Promise.all(Array.from({ length: 6 }, (_, index) => createClientAuth(index + 1)));
  mark(`INFO created ${clients.length} authenticated clients`);

  const sessionResults = await Promise.allSettled(
    clients.map((client) => callFunction('startRegistrationSession', client.idToken, { schoolId }))
  );

  const fulfilled = sessionResults
    .map((result, index) => ({ result, index }))
    .filter((item) => item.result.status === 'fulfilled');
  const rejected = sessionResults
    .map((result, index) => ({ result, index }))
    .filter((item) => item.result.status === 'rejected');

  mark(`INFO session results success=${fulfilled.length} rejected=${rejected.length}`);

  if (fulfilled.length !== 5 || rejected.length !== 1) {
    console.log('SESSION_RESULT_DETAILS', sessionResults);
    throw new Error(`Expected 5 successful sessions and 1 rejection, got ${fulfilled.length}/${rejected.length}`);
  }

  const rejectedCodes = rejected.map((item) => item.result.reason.code);
  if (!rejectedCodes.includes('RESOURCE_EXHAUSTED')) {
    throw new Error(`Expected RESOURCE_EXHAUSTED rejection, got ${rejectedCodes.join(', ')}`);
  }
  mark('PASS capacity-1 concurrent session issuance capped at total capacity');

  const successfulResults = fulfilled.map((item) => ({
    index: item.index,
    value: item.result.value
  }));
  const successfulSessions = successfulResults.map((result) => result.value.sessionId);
  if (successfulSessions.length !== new Set(successfulSessions).size) {
    throw new Error('Duplicate session IDs detected');
  }
  mark('PASS capacity-2 concurrent sessions issued unique reservation ids');

  const reservationChecks = await Promise.all(
    successfulResults.map((result, index) =>
      callFunction('getReservationSession', clients[result.index].idToken, {
        schoolId,
        sessionId: result.value.sessionId
      })
    )
  );
  if (reservationChecks.some((item) => !item.success)) {
    throw new Error('One or more issued sessions could not be revalidated');
  }
  mark('PASS capacity-3 issued sessions are revalidated by the server');

  const extraClient = await createClientAuth(99);
  try {
    await callFunction('startRegistrationSession', extraClient.idToken, { schoolId });
    throw new Error('Extra client unexpectedly acquired a reservation session');
  } catch (error) {
    if (error.code !== 'RESOURCE_EXHAUSTED') {
      throw error;
    }
  }
  mark('PASS capacity-4 additional client is blocked after capacity is fully reserved');
  process.exit(0);
}

main().catch((error) => {
  console.error('VALIDATION_FAILED');
  console.error(error);
  process.exit(1);
});
