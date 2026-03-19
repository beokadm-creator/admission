const admin = require('firebase-admin');

async function main() {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const {
    getAuth,
    connectAuthEmulator,
    signInAnonymously,
    signInWithCustomToken
  } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'access-control-test-school';
  const queueSchoolId = 'access-control-queue-school';
  const functionsBaseUrl = `http://127.0.0.1:15005/${projectId}/us-central1`;
  const masterUid = 'test-master-uid-acl';

  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18085';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19005';

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}`
    });
  }

  await admin.firestore().doc(`admins/${masterUid}`).set({
    role: 'MASTER',
    email: 'master@test.com'
  });

  await admin.firestore().doc(`schools/${schoolId}`).set({
    id: schoolId,
    name: 'Access Control Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 10,
    waitlistCapacity: 5,
    isActive: true,
    queueSettings: { enabled: false, batchSize: 5, batchInterval: 1000 },
    stats: { confirmedCount: 0, waitlistedCount: 0 }
  }, { merge: true });

  await admin.firestore().doc(`schools/${queueSchoolId}`).set({
    id: queueSchoolId,
    name: 'Queue School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 10,
    waitlistCapacity: 5,
    isActive: true,
    queueSettings: { enabled: true, batchSize: 5, batchInterval: 1000 },
    stats: { confirmedCount: 0, waitlistedCount: 0 }
  }, { merge: true });

  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'demo-acl-test-app'
  }, 'validate-access-controls');

  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  const lines = [];
  const mark = (line) => {
    lines.push(line);
    console.log(line);
  };

  async function callFunction(name, data, idToken = null) {
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

  try {
    try {
      await callFunction('getSystemStats', { schoolId });
      mark('FAIL access-1 unauthenticated getSystemStats was allowed');
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') {
        mark(`PASS access-1 unauthenticated getSystemStats blocked: ${error.code}`);
      } else {
        mark(`FAIL access-1 wrong error code: ${error.code}`);
      }
    }

    await signInAnonymously(auth);
    const anonToken = await auth.currentUser.getIdToken(true);
    mark(`INFO anon uid=${auth.currentUser.uid}`);

    try {
      await callFunction('getSystemStats', { schoolId }, anonToken);
      mark('FAIL access-2 non-MASTER getSystemStats was allowed');
    } catch (error) {
      if (error.code === 'PERMISSION_DENIED') {
        mark(`PASS access-2 non-MASTER getSystemStats blocked: ${error.code}`);
      } else {
        mark(`FAIL access-2 wrong error code: ${error.code} / ${error.message}`);
      }
    }

    try {
      await callFunction('getABTestResults', { schoolId }, anonToken);
      mark('FAIL access-3 non-MASTER getABTestResults was allowed');
    } catch (error) {
      if (error.code === 'PERMISSION_DENIED') {
        mark(`PASS access-3 non-MASTER getABTestResults blocked: ${error.code}`);
      } else {
        mark(`FAIL access-3 wrong error code: ${error.code} / ${error.message}`);
      }
    }

    try {
      await callFunction('registerRegistration', {
        schoolId: queueSchoolId,
        studentName: '테스트학생',
        phone: '010-1234-5678',
        agreedSms: true
      }, anonToken);
      mark('FAIL access-4 registerRegistration on queue-enabled school was allowed');
    } catch (error) {
      if (error.code === 'FAILED_PRECONDITION') {
        mark(`PASS access-4 registerRegistration blocked on queue-enabled school: ${error.code}`);
      } else {
        mark(`FAIL access-4 wrong error code: ${error.code} / ${error.message}`);
      }
    }

    const customToken = await admin.auth().createCustomToken(masterUid);
    await signInWithCustomToken(auth, customToken);
    const masterToken = await auth.currentUser.getIdToken(true);
    mark(`INFO master uid=${auth.currentUser.uid}`);

    try {
      await callFunction('getSystemStats', { schoolId }, masterToken);
      mark('PASS access-5 MASTER getSystemStats allowed');
    } catch (error) {
      mark(`FAIL access-5 MASTER getSystemStats blocked: ${error.code} / ${error.message}`);
    }

    try {
      await callFunction('getABTestResults', { schoolId }, masterToken);
      mark('PASS access-6 MASTER getABTestResults allowed');
    } catch (error) {
      mark(`FAIL access-6 MASTER getABTestResults blocked: ${error.code} / ${error.message}`);
    }

    const failed = lines.filter((line) => line.startsWith('FAIL'));
    if (failed.length > 0) {
      console.error('\nFailed checks:');
      failed.forEach((line) => console.error(' ', line));
      process.exit(1);
    }
  } finally {
    await deleteApp(app).catch(() => {});
  }
}

main().catch((error) => {
  console.error('VALIDATION_FAILED');
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
