import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

import { auth, db } from "../admin";

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

  const userDocRef = db.doc(`users/${uid}`);

  await clearUserPresence(uid);

  try {
    await db.recursiveDelete(userDocRef);
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
