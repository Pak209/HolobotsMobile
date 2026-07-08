import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildRankUpgradeUpdates, isRefusal } from "../lib/mintingEconomy";

const REFUSAL_MESSAGES: Record<string, string> = {
  "insufficient-blueprints": "Not enough blueprints.",
  "not-owned": "You do not own that Holobot.",
  "tier-already-reached": "That Holobot is already at this rank or higher.",
  "unknown-tier": "Unknown rank tier.",
};

/** Server-authoritative blueprint rank upgrade. */
export const upgradeHolobotRank = onCall(async (request): Promise<{ startLevel: number }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to upgrade Holobots.");
  }

  const data = (request.data ?? {}) as { holobotName?: unknown; tierLabel?: unknown };
  const holobotName = typeof data.holobotName === "string" ? data.holobotName.trim() : "";
  const tierLabel = typeof data.tierLabel === "string" ? data.tierLabel : "";

  if (!holobotName || !tierLabel) {
    throw new HttpsError("invalid-argument", "A holobot name and rank tier are required.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const result = buildRankUpgradeUpdates(snapshot.data() ?? {}, holobotName, tierLabel);
    if (isRefusal(result)) {
      throw new HttpsError("failed-precondition", REFUSAL_MESSAGES[result.reason]);
    }

    transaction.set(userRef, result.updates, { merge: true });
    return { startLevel: result.tierStartLevel };
  });
});
