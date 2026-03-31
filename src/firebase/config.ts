import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;

if (typeof window !== "undefined" && appCheckDebugToken) {
  (
    globalThis as typeof globalThis & {
      FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
    }
  ).FIREBASE_APPCHECK_DEBUG_TOKEN =
    appCheckDebugToken === "true" ? true : appCheckDebugToken;
}

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const appCheck =
  typeof window !== "undefined" && appCheckSiteKey
    ? initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      })
    : null;

export default app;
