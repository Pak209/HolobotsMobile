import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { HOLOBOT_NAMES } from "../lib/economy";
import { buildLegendaryAscensionRaw } from "../lib/mintingEconomy";

/**
 * Redeems one Legendary Blueprint (the 0.1% gacha easter egg): the chosen
 * Holobot is minted at or ascended to Legendary through the same semantics
 * as the direct blueprint paths; an already-Legendary pick converts to
 * wildcard blueprints instead (Genesis duplicate rule).
 */
export const redeemLegendaryBlueprint = onCall(
  async (
    request,
  ): Promise<{ holobotName: string; outcome: "minted" | "ascended" | "converted"; wildcards?: number }> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to use a Legendary Blueprint.");
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

      const result = buildLegendaryAscensionRaw(snapshot.data() ?? {}, holobotName);
      if (result.outcome === "refused") {
        throw new HttpsError("failed-precondition", "No Legendary Blueprint available.");
      }

      transaction.set(userRef, result.updates, { merge: true });
      return {
        holobotName,
        outcome: result.outcome,
        ...(result.outcome === "converted" ? { wildcards: result.wildcards } : {}),
      };
    });
  },
);
