import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAJblChg4w8fC1pWkwNn_Bp1PmUTlHlPb8",
  authDomain: "holobots-24046.firebaseapp.com",
  projectId: "holobots-24046",
  storageBucket: "holobots-24046.firebasestorage.app",
  messagingSenderId: "276314676160",
  appId: "1:276314676160:web:4c564acf635324c0384625",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

export {
  collection,
  doc,
  getDoc,
  onAuthStateChanged,
  onSnapshot,
  query,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
};

export type { User };
export type { Unsubscribe };
export { httpsCallable };
