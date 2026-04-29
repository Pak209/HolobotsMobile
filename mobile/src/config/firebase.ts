import { initializeApp, getApps, getApp } from "firebase/app";
import {
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
import { getFunctions, httpsCallable } from "firebase/functions";
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
