import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildMissionClaimUpdatesRaw } from "../lib/economy";

/**
 * Server-authoritative daily mission claim: rewards come from the mission
 * table and completion is validated against counters that only other
 * callables increment (settleArenaBattle, purchaseMarketplaceBooster).
 */
export const claimDailyMission = onCall(
  async (request): Promise<{ gachaTickets: number; holosTokens: number; missionId: string }> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to claim missions.");
    }

    const missionId = String((request.data as { missionId?: unknown } | undefined)?.missionId ?? "").trim();
    if (!missionId) {
      throw new HttpsError("invalid-argument", "A mission id is required.");
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const result = buildMissionClaimUpdatesRaw(snapshot.data() ?? {}, missionId);
      if (result.refusal !== null) {
        if (result.refusal === "unknown_mission") {
          throw new HttpsError("invalid-argument", "Unknown mission.");
        }
        if (result.refusal === "not_completed") {
          throw new HttpsError("failed-precondition", "This mission is not completed yet.");
        }
        throw new HttpsError("failed-precondition", "This mission was already claimed today.");
      }

      transaction.set(userRef, result.updates, { merge: true });
      return {
        gachaTickets: result.reward.gachaTickets,
        holosTokens: result.reward.holosTokens,
        missionId,
      };
    });
  },
);
