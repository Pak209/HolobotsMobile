import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { deriveReferralCode, REFERRAL_APPLY_WINDOW_MS } from "../lib/referrals";

/**
 * Links a new account to its referrer. Write-once, new accounts only.
 * The referral only QUALIFIES (and pays out) when the invited player
 * completes their first real sync workout — see syncFitnessActivity.
 */
export const applyReferralCode = onCall(async (request): Promise<{ referrerUsername: string }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to enter a referral code.");
  }

  const code = String((request.data as { code?: unknown } | undefined)?.code ?? "")
    .trim()
    .toUpperCase();
  if (!code) {
    throw new HttpsError("invalid-argument", "A referral code is required.");
  }
  if (code === deriveReferralCode(uid)) {
    throw new HttpsError("failed-precondition", "You cannot refer yourself.");
  }

  const userRecord = await getAuth().getUser(uid);
  const createdAt = Date.parse(userRecord.metadata.creationTime ?? "");
  if (Number.isFinite(createdAt) && Date.now() - createdAt > REFERRAL_APPLY_WINDOW_MS) {
    throw new HttpsError("failed-precondition", "Referral codes can only be entered within the first week.");
  }

  // Resolve the code: referrers publish their (uid-derived) code onto their
  // own profile when they open the invite screen, so we can query it — and
  // then verify the match by re-deriving from the matched uid.
  const matches = await db.collection("users").where("referralCode", "==", code).limit(2).get();
  const referrerDoc = matches.docs.find((candidate) => deriveReferralCode(candidate.id) === code);
  if (!referrerDoc) {
    throw new HttpsError("not-found", "That code was not found. Ask your friend to open their invite screen once.");
  }

  const referrerRef = referrerDoc.ref;
  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }
    const userData = snapshot.data() ?? {};
    if (userData.referredBy) {
      throw new HttpsError("failed-precondition", "A referral code was already applied to this account.");
    }

    transaction.set(userRef, { referredBy: referrerRef.id }, { merge: true });
    transaction.set(
      referrerRef,
      { referrals: { pending: FieldValue.increment(1) } },
      { merge: true },
    );

    return { referrerUsername: String(referrerDoc.data().username || "a pilot") };
  });
});
