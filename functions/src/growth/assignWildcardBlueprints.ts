import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { HOLOBOT_NAMES } from "../lib/economy";
import { buildWildcardAssignRaw } from "../lib/referrals";

/** Converts wildcard blueprints 1:1 into a chosen Holobot's blueprints. */
export const assignWildcardBlueprints = onCall(
  async (request): Promise<{ holobotName: string; amount: number; remaining: number }> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to assign blueprints.");
    }

    const data = (request.data ?? {}) as { holobotName?: unknown; amount?: unknown };
    const holobotName = String(data.holobotName ?? "").trim().toUpperCase();
    const amount = Math.floor(Number(data.amount));

    if (!(HOLOBOT_NAMES as readonly string[]).includes(holobotName)) {
      throw new HttpsError("invalid-argument", "Unknown Holobot.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("invalid-argument", "A positive amount is required.");
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const result = buildWildcardAssignRaw(snapshot.data() ?? {}, holobotName, amount);
      if (!result) {
        throw new HttpsError("failed-precondition", "Not enough wildcard blueprints.");
      }

      transaction.set(userRef, result.updates, { merge: true });
      return { holobotName, amount, remaining: result.updates.wildcardBlueprints };
    });
  },
);
