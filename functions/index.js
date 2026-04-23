const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

async function clearUserPresence(uid) {
  await db.doc(`users/${uid}`).set(
    {
      pvpPresence: null,
    },
    { merge: true },
  ).catch(() => undefined);
}

exports.deleteUserAccount = onCall(async (request) => {
  const uid = request.auth?.uid;

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
});
