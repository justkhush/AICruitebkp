import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBCfWop3tnQx0ATaYLBiSVUtyjrdjblde0",
  authDomain: "aicrute.firebaseapp.com",
  projectId: "aicrute",
  storageBucket: "aicrute.firebasestorage.app",
  messagingSenderId: "484892821855",
  appId: "1:484892821855:web:b00e20eb067f8b7b7b0eea",
  measurementId: "G-DKWR70RKVM"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);