import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { HOLOBOT_NAMES } from "../lib/economy";
import { buildRankSkipRaw } from "../lib/mintingEconomy";

const REFUSAL_MESSAGES = {
  no_item: "No Rank Skips available.",
  not_owned: "You do not own that Holobot.",
  already_legendary: "That Holobot is already at the top rank.",
} as const;

/** Consumes one Rank Skip: the chosen bot jumps to its NEXT tier with the
    exact rank-up semantics, minus the blueprint cost. */
export const useRankSkip = onCall(
  async (request): Promise<{ holobotName: string; nextTierLabel: string }> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to use a Rank Skip.");
    }

    const holobotName = String((request.data as { holobotName?: unknown } | undefined)?.holobotName ?? "")
      .trim()
      .toUpperCase();
    if (!(HOLOBOT_NAMES as readonly string[]).includes(holobotName)) {
      throw new HttpsError("invalid-argument", "Unknown Holobot.");
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const result = buildRankSkipRaw(snapshot.data() ?? {}, holobotName);
      if (result.refusal !== null) {
        throw new HttpsError("failed-precondition", REFUSAL_MESSAGES[result.refusal]);
      }

      transaction.set(userRef, result.updates, { merge: true });
      return { holobotName, nextTierLabel: result.nextTierLabel };
    });
  },
);
