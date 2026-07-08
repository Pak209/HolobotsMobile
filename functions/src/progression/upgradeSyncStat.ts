import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildSyncStatUpgrade,
  isSyncUpgradeRefusal,
  SYNC_STAT_KEYS,
  type SyncStatKey,
} from "../lib/progressionEconomy";

const REFUSAL_MESSAGES: Record<string, string> = {
  "insufficient-points": "Not enough Sync Points.",
  "stat-maxed": "This Sync Stat is already maxed.",
  "total-cap": "This Holobot has reached the total Sync cap.",
  "unknown-holobot": "Holobot not found.",
};

/** Server-authoritative sync-stat upgrade (cost table + caps enforced). */
export const upgradeSyncStat = onCall(async (request): Promise<{ cost: number }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to upgrade Sync Stats.");
  }

  const data = (request.data ?? {}) as { holobotName?: unknown; stat?: unknown };
  const holobotName = typeof data.holobotName === "string" ? data.holobotName : "";
  const stat = data.stat;

  if (!holobotName.trim() || !SYNC_STAT_KEYS.includes(stat as SyncStatKey)) {
    throw new HttpsError("invalid-argument", "A holobot name and a valid sync stat are required.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const result = buildSyncStatUpgrade(snapshot.data() ?? {}, holobotName, stat as SyncStatKey);

    if (isSyncUpgradeRefusal(result)) {
      throw new HttpsError("failed-precondition", REFUSAL_MESSAGES[result.reason]);
    }

    transaction.set(userRef, result.updates, { merge: true });

    return { cost: result.cost };
  });
});
