import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let auth: any = null;
let db: any = null;

function initFirebaseAdmin() {
  // 🛑 Skip Firebase if env not present
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.log("⚠️ Firebase disabled");
    return;
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }

  auth = getAuth();
  db = getFirestore();
}

// Initialize only if env exists
initFirebaseAdmin();

export { auth, db };