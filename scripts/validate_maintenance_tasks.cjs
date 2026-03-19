const admin = require('firebase-admin');

async function main() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'maintenance-test-school';
  const functionsBaseUrl = `http://127.0.0.1:15005/${projectId}/us-central1`;

  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18085';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19005';

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId
    });
  }

  const db = admin.firestore();
  const databaseNamespaces = [projectId, `${projectId}-default-rtdb`];
  const dbBaseUrl = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`;

  async function rtdbSet(path, value) {
    await Promise.all(databaseNamespaces.map(async (ns) => {
      await fetch(`${dbBaseUrl}/${path}.json?ns=${ns}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
    }));
  }

  async function rtdbSetForNamespace(ns, path, value) {
    await fetch(`${dbBaseUrl}/${path}.json?ns=${ns}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  }

  async function rtdbDelete(path) {
    await Promise.all(databaseNamespaces.map(async (ns) => {
      await fetch(`${dbBaseUrl}/${path}.json?ns=${ns}`, { method: 'DELETE' });
    }));
  }

  async function rtdbReadAny(path) {
    for (const ns of databaseNamespaces) {
      const response = await fetch(`${dbBaseUrl}/${path}.json?ns=${ns}`);
      const value = await response.json();
      if (value !== null) {
        return { ns, value };
      }
    }
    return { ns: null, value: null };
  }

  await db.doc(`schools/${schoolId}`).set({
    id: schoolId,
    name: 'Maintenance Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 1,
    waitlistCapacity: 0,
    isActive: true,
    queueSettings: {
      enabled: false,
      batchSize: 1,
      batchInterval: 1000
    },
    stats: {
      confirmedCount: 0,
      waitlistedCount: 0
    }
  }, { merge: true });

  await rtdbDelete(`slots/${schoolId}`);
  await rtdbDelete(`reservations/${schoolId}`);

  const oldQueue = await db.collection('alimtalkQueue').where('schoolId', '==', schoolId).get();
  if (!oldQueue.empty) {
    const batch = db.batch();
    oldQueue.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'demo-maintenance-app'
  }, 'maintenance-app');

  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInAnonymously(auth);

  const masterUid = auth.currentUser.uid;
  const masterToken = await auth.currentUser.getIdToken(true);

  await db.doc(`admins/${masterUid}`).set({
    uid: masterUid,
    email: null,
    role: 'MASTER',
    name: 'Maintenance Admin',
    createdAt: Date.now()
  }, { merge: true });

  const lines = [];
  const mark = (line) => {
    lines.push(line);
    console.log(line);
  };

  async function callFunction(name, data, idToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const response = await fetch(`${functionsBaseUrl}/${name}`, {
      method: 'POST',
      headers,
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

  const userApp = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'demo-maintenance-user-app'
  }, 'maintenance-user-app');

  const userAuth = getAuth(userApp);
  connectAuthEmulator(userAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInAnonymously(userAuth);
  const userToken = await userAuth.currentUser.getIdToken(true);

  const seededSession = await callFunction('startRegistrationSession', { schoolId }, userToken);
  const expiredSessionId = seededSession.sessionId;
  const seededReservation = await rtdbReadAny(`reservations/${schoolId}/${expiredSessionId}`);
  if (!seededReservation.ns || !seededReservation.value) {
    throw new Error('Could not locate reservation namespace created by startRegistrationSession');
  }

  const cleanupResult = await callFunction('runMaintenanceTask', {
    task: 'forceExpireReservation',
    schoolId,
    sessionId: expiredSessionId
  }, masterToken);
  if (!cleanupResult.success) {
    throw new Error(`Force-expire maintenance task failed: ${JSON.stringify(cleanupResult)}`);
  }

  try {
    await callFunction('getReservationSession', {
      schoolId,
      sessionId: expiredSessionId
    }, userToken);
    throw new Error('Expired session was still considered valid');
  } catch (error) {
    if (!['DEADLINE_EXCEEDED', 'FAILED_PRECONDITION'].includes(error.code)) {
      throw error;
    }
  }

  const replacementApp = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'demo-maintenance-replacement-app'
  }, 'maintenance-replacement-app');
  const replacementAuth = getAuth(replacementApp);
  connectAuthEmulator(replacementAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInAnonymously(replacementAuth);
  const replacementToken = await replacementAuth.currentUser.getIdToken(true);
  const replacementSession = await callFunction('startRegistrationSession', { schoolId }, replacementToken);
  if (!replacementSession.sessionId) {
    throw new Error('Released slot did not allow a replacement reservation');
  }
  mark('PASS maintenance-1 forceExpireReservation invalidated prior session and freed slot');

  const queueDocRef = db.collection('alimtalkQueue').doc('maintenance-pending-item');
  await queueDocRef.set({
    to: '010-9999-9999',
    templateCode: 'TEST_TEMPLATE',
    templateParams: { studentName: '테스트' },
    schoolId,
    registrationId: 'maintenance-reg',
    priority: 1,
    createdAt: Date.now(),
    retries: 1,
    status: 'pending'
  });
  await queueDocRef.set({
    to: '010-9999-9999',
    templateCode: 'TEST_TEMPLATE',
    templateParams: { studentName: '테스트' },
    schoolId,
    registrationId: 'maintenance-reg',
    priority: 1,
    createdAt: Date.now(),
    retries: 1,
    status: 'pending'
  }, { merge: true });

  const retryResult = await callFunction('runMaintenanceTask', {
    task: 'retryPendingAlimTalkQueue'
  }, masterToken);
  if (!retryResult.success || retryResult.processed < 1) {
    throw new Error(`Retry task did not process pending queue: ${JSON.stringify(retryResult)}`);
  }

  const queueDoc = await queueDocRef.get();
  const queueData = queueDoc.data();
  if (!queueData || !['failed', 'pending', 'sent'].includes(queueData.status)) {
    throw new Error('Retry task did not update queue item status');
  }
  if (queueData.status === 'pending' && queueData.retries <= 1) {
    throw new Error('Retry task left item pending without increasing retries');
  }
  mark(`PASS maintenance-2 retryPendingAlimTalkQueue processed pending item status=${queueData.status}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('VALIDATION_FAILED');
  console.error(error);
  process.exit(1);
});
