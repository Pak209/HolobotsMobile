import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyTrainingClaim, type StoredTrainingRecord } from "../lib/progressionEconomy";

/**
 * Server-authoritative training claim. Stored stat boosts are clamped to
 * the course's legal range and restricted to the course's stat(s); the EXP
 * reward comes from the course table, not the stored record.
 */
export const claimTrainingSession = onCall(async (request): Promise<{ claimed: boolean }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim training.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const rewardSystem =
      userData.rewardSystem && typeof userData.rewardSystem === "object"
        ? (userData.rewardSystem as Record<string, unknown>)
        : {};
    const record = rewardSystem.activeTraining as StoredTrainingRecord | null | undefined;

    if (!record || typeof record !== "object") {
      throw new HttpsError("failed-precondition", "No training session is active.");
    }

    const endsAtMs = new Date(String(record.endsAt || "")).getTime();
    if (!Number.isFinite(endsAtMs) || endsAtMs > Date.now()) {
      throw new HttpsError("failed-precondition", "That training session is not complete yet.");
    }

    const result = applyTrainingClaim(userData, record);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown training course.");
    }

    transaction.set(userRef, result.updates, { merge: true });

    return { claimed: true };
  });
});
