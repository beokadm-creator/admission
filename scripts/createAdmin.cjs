const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '../functions/admission-477e5-firebase-adminsdk-fbsvc-7ed4d69c22.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const email = 'aaron@beoksolution.com';
const password = 'password123';
const name = 'Aaron';

async function createAdmin() {
  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log('User already exists:', user.uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        user = await admin.auth().createUser({
          email: email,
          password: password,
          displayName: name,
        });
        console.log('User created:', user.uid);
      } else {
        throw error;
      }
    }

    // Firestore에 관리자 정보 저장 (MASTER 권한)
    await admin.firestore().collection('admins').doc(user.uid).set({
      id: user.uid,
      email: email,
      name: name,
      role: 'MASTER',
      createdAt: Date.now()
    }, { merge: true });

    console.log(`Successfully granted MASTER role to ${email}`);
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();