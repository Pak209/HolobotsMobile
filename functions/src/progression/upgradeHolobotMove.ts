import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { LiveMoveUpgradeRequest, transactMoveUpgrade } from "../lib/liveMoveRanks";

/**
 * Server-authoritative Sync Point move-rank upgrade for one Holobot (lib/liveMoveRanks.transactMoveUpgrade):
 * - live-move-ranks-1: { holobotName, liveMoveSlot: 'jab'|'heavy'|'guard'|'dash'|'special', expectedRank } buys the next rank of a
 *   live move (lazy one-time migration + refund first); { holobotName, migrate: true } migrates only.
 * - legacy: { holobotName, moveTemplateId, expectedRank, branchId? } -> { cost, nextRank, syncPoints }, unchanged, refused for a
 *   Holobot already on live moves.
 */
export const upgradeHolobotMove = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to upgrade moves.");
  }

  const data = (request.data ?? {}) as LiveMoveUpgradeRequest;
  const holobotName = typeof data.holobotName === "string" ? data.holobotName : "";
  const liveForm = data.liveMoveSlot !== undefined || data.migrate === true;
  if (!holobotName.trim() || (!liveForm && (typeof data.moveTemplateId !== "string" || !data.moveTemplateId.trim() || !Number.isInteger(Number(data.expectedRank))))) {
    throw new HttpsError(
      "invalid-argument",
      "A holobot name, move id, and current rank are required.",
    );
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    try {
      const result = transactMoveUpgrade(snapshot.data() ?? {}, data);
      if (result.updates) transaction.set(userRef, result.updates, { merge: true });
      return result.response;
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Move upgrade rejected.",
      );
    }
  });
});
