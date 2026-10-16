import { initializeApp, getApps } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getReactNativePersistence } from "@firebase/auth/dist/rn/index";
import {
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAJblChg4w8fC1pWkwNn_Bp1PmUTlHlPb8",
  authDomain: "holobots-24046.firebaseapp.com",
  projectId: "holobots-24046",
  storageBucket: "holobots-24046.firebasestorage.app",
  messagingSenderId: "276314676160",
  appId: "1:276314676160:web:4c564acf635324c0384625",
};

export const FIREBASE_FUNCTIONS_REGION = "us-central1";

// Offline preview imports shared modules but must never initialize the production project.
const offlinePreview = __DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1";
const existingApp = getApps().find(candidate => candidate.name === (offlinePreview ? "holocity-offline" : "[DEFAULT]"));
const app = existingApp ?? (offlinePreview
  ? initializeApp(
    { apiKey: "offline-preview", projectId: "demo-holocity-offline", appId: "offline-preview" }, "holocity-offline")
  : initializeApp(firebaseConfig));
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as any,
    });
  } catch {
    return getAuth(app);
  }
})();
export const db = getFirestore(app);
export const functions = getFunctions(app, FIREBASE_FUNCTIONS_REGION);
if (offlinePreview && !existingApp) {
  // A closed local port fails accidental calls closed; this preview has no backend.
  connectAuthEmulator(auth, "http://127.0.0.1:9", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 9);
  connectFunctionsEmulator(functions, "127.0.0.1", 9);
}

export {
  collection,
  createUserWithEmailAndPassword,
  deleteDoc,
  deleteUser,
  doc,
  getDoc,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
};

export type { User };
export type { Unsubscribe };
export { httpsCallable };
