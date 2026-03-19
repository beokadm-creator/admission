const admin = require('firebase-admin');

async function main() {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'auth-queue-test-school';
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
    const appName = `db-${namespace}`;
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
    name: 'Auth Queue Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 2,
    waitlistCapacity: 1,
    isActive: true,
    queueSettings: {
      enabled: true,
      batchSize: 2,
      batchInterval: 1000
    },
    stats: {
      confirmedCount: 0,
      waitlistedCount: 0
    }
  }, { merge: true });

  await Promise.all(dbApps.map(({ app }) => app.database().ref(`queue/${schoolId}`).remove()));
  await Promise.all(dbApps.map(({ app }) => app.database().ref(`slots/${schoolId}`).remove()));
  await Promise.all(dbApps.map(({ app }) => app.database().ref(`reservations/${schoolId}`).remove()));
  await defaultApp.firestore().collection(`schools/${schoolId}/registrations`).get().then(async (snapshot) => {
    const batch = defaultApp.firestore().batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    if (!snapshot.empty) {
      await batch.commit();
    }
  });

  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'demo-app-id'
  }, 'validate-auth-queue');

  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  async function callFunction(name, data, useAuth = true) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (useAuth && auth.currentUser) {
      headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
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

  async function getDatabaseValue(path) {
    for (const { namespace, app } of dbApps) {
      const snapshot = await app.database().ref(path).once('value');
      if (snapshot.exists()) {
        return { namespace, value: snapshot.val() };
      }
    }

    return { namespace: null, value: null };
  }

  async function setDatabaseValue(path, value) {
    await Promise.all(
      dbApps.map(({ app }) => app.database().ref(path).set(value))
    );
  }

  const lines = [];
  const mark = (line) => {
    lines.push(line);
    console.log(line);
  };

  try {
    try {
      await callFunction('joinQueue', { schoolId }, false);
      mark('FAIL auth-1 unauthenticated joinQueue was allowed');
    } catch (error) {
      mark(`PASS auth-1 unauthenticated joinQueue blocked: ${error.code}`);
    }

    await signInAnonymously(auth);
    await auth.currentUser.getIdToken(true);
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      throw new Error('Anonymous auth did not return a uid');
    }
    mark(`INFO auth uid=${uid}`);

    const firstJoin = await callFunction('joinQueue', { schoolId, userId: 'forged-user' });
    mark(`PASS auth-2 authenticated joinQueue succeeded: number=${firstJoin.number}`);

    const secondJoin = await callFunction('joinQueue', { schoolId });
    if (secondJoin.number !== firstJoin.number) {
      throw new Error(`Join without userId returned ${secondJoin.number}, expected ${firstJoin.number}`);
    }
    mark(`PASS auth-3 forged userId ignored, auth uid kept same number=${secondJoin.number}`);

    const thirdJoin = await callFunction('joinQueue', { schoolId, userId: 'forged-user' });
    if (thirdJoin.number !== firstJoin.number) {
      throw new Error(`Repeat join returned ${thirdJoin.number}, expected ${firstJoin.number}`);
    }
    mark(`PASS queue-1 repeat join kept same number=${thirdJoin.number}`);

    try {
      await callFunction('joinQueue', { schoolId });
      mark('FAIL queue-3 fourth join was not rate-limited');
    } catch (error) {
      mark(`PASS queue-3 fourth join rate-limited: ${error.code}`);
    }

    try {
      await callFunction('startRegistrationSession', { schoolId, userId: 'forged-user' });
      mark('FAIL session-1 startRegistrationSession bypassed queue turn');
    } catch (error) {
      mark(`PASS session-1 startRegistrationSession blocked before queue advance: ${error.code}`);
    }

    await setDatabaseValue(`queue/${schoolId}/meta`, {
      currentNumber: firstJoin.number,
      lastAssignedNumber: firstJoin.number,
      lastAdvancedAt: Date.now(),
      updatedAt: Date.now()
    });

    const queueMeta = await getDatabaseValue(`queue/${schoolId}/meta`);
    if (!queueMeta.value || queueMeta.value.currentNumber !== firstJoin.number) {
      throw new Error(`Queue meta update failed: ${JSON.stringify(queueMeta)}`);
    }

    const reservation = await callFunction('startRegistrationSession', { schoolId, userId: 'forged-user' });
    mark(`PASS session-2 startRegistrationSession issued session=${reservation.sessionId}`);

    const reservationRecord = await getDatabaseValue(`reservations/${schoolId}/${reservation.sessionId}`);
    const reservationData = reservationRecord.value;
    if (!reservationData || reservationData.userId !== uid) {
      throw new Error(`Reservation session was not stored under auth uid: ${JSON.stringify(reservationRecord)}`);
    }
    mark('PASS session-3 reservation stored for auth uid');

    const reservationCheck = await callFunction('getReservationSession', {
      schoolId,
      sessionId: reservation.sessionId,
      userId: 'forged-user'
    });
    if (!reservationCheck.success) {
      throw new Error('Reservation lookup did not return success');
    }
    mark('PASS session-4 getReservationSession uses authenticated caller');
  } finally {
    await Promise.allSettled([
      deleteApp(app),
      ...dbApps.map(({ app }) => app.delete())
    ]);
  }
}

main().catch((error) => {
  console.error('VALIDATION_FAILED');
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
