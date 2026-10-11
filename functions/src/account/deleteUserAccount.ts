import { Firestore } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

import { auth, db } from "../admin";
import { removePresence } from "../presence/presenceStore";

/**
 * Every Firestore tree keyed by the pilot's uid. users/{uid} covers its own
 * subcollections; the server-only trees live outside it (DECISIONS #43
 * rival battles + open-battle ledger, #40 wild sessions + receipts, #46 intro
 * quest state, #47 Buddy Unit purchase receipts, #53 amendment 1 HoloZone runs).
 */
export async function deleteUserData(firestore: Firestore, uid: string): Promise<void> {
  for (const path of [`users/${uid}`, `rivalBattles/${uid}`, `wildEncounterSessions/${uid}`, `introQuests/${uid}`, `vendorPurchases/${uid}`, `wardrobes/${uid}`, `holoZoneRuns/${uid}`, `itemInventories/${uid}`]) {
    await firestore.recursiveDelete(firestore.doc(path));
  }
  // Profile is gone first: a racing heartbeat must re-read the absent profile and cannot resurrect the row.
  await removePresence(firestore, uid);
}

async function clearUserPresence(uid: string): Promise<void> {
  await db.doc(`users/${uid}`).set(
    {
      pvpPresence: null,
    },
    { merge: true },
  ).catch(() => undefined);
}

async function handleDeleteUserAccount(request: CallableRequest): Promise<{ success: boolean }> {
  let uid = request.auth?.uid;

  if (!uid) {
    const idToken = typeof request.data?.idToken === "string" ? request.data.idToken : "";
    if (!idToken) {
      throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
    }

    try {
      const decoded = await auth.verifyIdToken(idToken);
      uid = decoded.uid;
    } catch (error) {
      throw new HttpsError("unauthenticated", "Your session could not be verified. Please sign in again.");
    }
  }

  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
  }

  await clearUserPresence(uid);

  try {
    await deleteUserData(db, uid);
  } catch (error) {
    throw new HttpsError("internal", "Failed to remove Firestore profile data.");
  }

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    throw new HttpsError("internal", "Failed to remove the Firebase Authentication account.");
  }

  return { success: true };
}

export const deleteUserAccountV2 = onCall(
  { region: "us-central1", invoker: "public" },
  handleDeleteUserAccount,
);
