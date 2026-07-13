import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildExpBoosterActivationRaw } from "../lib/mintingEconomy";

/** Consumes one EXP Booster: doubled arena EXP for 24 hours. The window
    timestamp is server-set and rules-frozen. */
export const useExpBooster = onCall(async (request): Promise<{ activeUntil: number }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use an EXP Booster.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const result = buildExpBoosterActivationRaw(snapshot.data() ?? {});
    if (result.refusal !== null) {
      throw new HttpsError(
        "failed-precondition",
        result.refusal === "no_item" ? "No EXP Boosters available." : "An EXP Booster is already active.",
      );
    }

    transaction.set(userRef, result.updates, { merge: true });
    return { activeUntil: result.activeUntil };
  });
});
