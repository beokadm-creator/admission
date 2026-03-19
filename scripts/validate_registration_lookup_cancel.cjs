const admin = require('firebase-admin');

async function main() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');

  const projectId = 'admission-477e5';
  const schoolId = 'registration-test-school';
  const functionsBaseUrl = `http://127.0.0.1:15005/${projectId}/us-central1`;

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
    name: 'Registration Test School',
    openDateTime: new Date(Date.now() - 60_000).toISOString(),
    maxCapacity: 2,
    waitlistCapacity: 1,
    isActive: true,
    queueSettings: {
      enabled: false,
      batchSize: 2,
      batchInterval: 1000
    },
    stats: {
      confirmedCount: 0,
      waitlistedCount: 0
    }
  }, { merge: true });

  await admin.database().ref(`slots/${schoolId}`).remove();
  await admin.database().ref(`reservations/${schoolId}`).remove();
  const existingRegs = await admin.firestore().collection(`schools/${schoolId}/registrations`).get();
  if (!existingRegs.empty) {
    const batch = admin.firestore().batch();
    existingRegs.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const lines = [];
  const mark = (line) => {
    lines.push(line);
    console.log(line);
  };

  async function createClient(index) {
    const app = initializeApp({
      apiKey: 'demo-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId: `demo-registration-app-${index}`
    }, `registration-client-${index}`);

    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInAnonymously(auth);
    return {
      uid: auth.currentUser.uid,
      idToken: await auth.currentUser.getIdToken(true)
    };
  }

  async function callFunction(name, data, idToken) {
    const headers = {
      'Content-Type': 'application/json'
    };
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

  const client1 = await createClient(1);
  const client2 = await createClient(2);
  const client3 = await createClient(3);

  const session1 = await callFunction('startRegistrationSession', { schoolId }, client1.idToken);
  const confirm1 = await callFunction('confirmReservation', {
    schoolId,
    sessionId: session1.sessionId,
    formData: {
      studentName: '홍길동',
      phone: '010-1234-5678',
      email: 'hong@example.com',
      schoolName: '테스트고',
      grade: '3',
      address: '서울시',
      agreedSms: true,
      injectedField: 'SHOULD_NOT_BE_SAVED'
    }
  }, client1.idToken);
  mark(`PASS register-1 first confirmation succeeded status=${confirm1.status}`);

  const regDoc1 = await admin.firestore().doc(`schools/${schoolId}/registrations/${confirm1.registrationId}`).get();
  const regData1 = regDoc1.data();
  if (!regData1) {
    throw new Error('First registration document was not created');
  }
  if (regData1.injectedField !== undefined) {
    throw new Error('Unexpected injected field was persisted');
  }
  mark('PASS register-2 formData whitelist blocked unexpected fields');

  const session2 = await callFunction('startRegistrationSession', { schoolId }, client2.idToken);
  try {
    await callFunction('confirmReservation', {
      schoolId,
      sessionId: session2.sessionId,
      formData: {
        studentName: '김영희',
        phone: '010-1234-5678',
        agreedSms: true
      }
    }, client2.idToken);
    throw new Error('Duplicate phone registration was unexpectedly allowed');
  } catch (error) {
    if (error.code !== 'ALREADY_EXISTS') {
      throw error;
    }
  }
  mark('PASS register-3 duplicate phone registration blocked');

  const session3 = await callFunction('startRegistrationSession', { schoolId }, client3.idToken);
  try {
    await callFunction('confirmReservation', {
      schoolId,
      sessionId: session3.sessionId,
      formData: {
        studentName: '박철수',
        phone: '01012345678',
        agreedSms: true
      }
    }, client3.idToken);
    throw new Error('Invalid phone format was unexpectedly allowed');
  } catch (error) {
    if (error.code !== 'INVALID_ARGUMENT') {
      throw error;
    }
  }
  mark('PASS register-4 invalid phone format blocked');

  const lookup = await callFunction('lookupRegistration', {
    schoolId,
    studentName: '홍길동',
    phoneLast4: '5678'
  });
  if (!lookup.success || lookup.registration.id !== confirm1.registrationId) {
    throw new Error('Lookup did not return the expected registration');
  }
  mark('PASS lookup-1 public lookup returns masked registration match');

  const cancel = await callFunction('cancelRegistration', {
    schoolId,
    registrationId: confirm1.registrationId,
    studentName: '홍길동',
    phoneLast4: '5678'
  });
  if (!cancel.success) {
    throw new Error('Cancel did not return success');
  }
  mark('PASS cancel-1 public cancel succeeded');

  const canceledDoc = await admin.firestore().doc(`schools/${schoolId}/registrations/${confirm1.registrationId}`).get();
  if (canceledDoc.data()?.status !== 'canceled') {
    throw new Error('Registration status was not updated to canceled');
  }
  mark('PASS cancel-2 registration status updated to canceled');

  const client4 = await createClient(4);
  const replacementSession = await callFunction('startRegistrationSession', { schoolId }, client4.idToken);
  if (!replacementSession.sessionId) {
    throw new Error('Freed slot did not allow a new session');
  }
  mark('PASS cancel-3 freed slot allows a new reservation session');

  process.exit(0);
}

main().catch((error) => {
  console.error('VALIDATION_FAILED');
  console.error(error);
  process.exit(1);
});
