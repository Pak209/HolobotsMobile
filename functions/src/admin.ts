/**
 * Firebase Admin SDK singletons. Import `db` / `auth` from here rather than
 * initializing per-module — `initializeApp()` must run exactly once per
 * functions instance.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();

export const db = getFirestore();
export const auth = getAuth();
