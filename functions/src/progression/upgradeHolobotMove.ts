import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildMoveUpgradeUpdatesRaw } from "../lib/moveProgression";

type UpgradeMoveResponse = {
  cost: number;
  nextRank: number;
  syncPoints: number;
};

/** Server-authoritative Sync Point move-rank upgrade for one Holobot. */
export const upgradeHolobotMove = onCall(async (request): Promise<UpgradeMoveResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to upgrade moves.");
  }

  const data = (request.data ?? {}) as {
    branchId?: unknown;
    expectedRank?: unknown;
    holobotName?: unknown;
    moveTemplateId?: unknown;
  };
  const holobotName = typeof data.holobotName === "string" ? data.holobotName : "";
  const moveTemplateId = typeof data.moveTemplateId === "string" ? data.moveTemplateId : "";
  const expectedRank = Number(data.expectedRank);
  const branchId = typeof data.branchId === "string" ? data.branchId : undefined;

  if (!holobotName.trim() || !moveTemplateId.trim() || !Number.isInteger(expectedRank)) {
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
      const result = buildMoveUpgradeUpdatesRaw(
        snapshot.data() ?? {},
        holobotName,
        moveTemplateId,
        expectedRank,
        branchId,
      );
      transaction.set(userRef, result.updates, { merge: true });
      return {
        cost: result.cost,
        nextRank: result.nextRank,
        syncPoints: Number(result.updates.syncPoints),
      };
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Move upgrade rejected.",
      );
    }
  });
});
