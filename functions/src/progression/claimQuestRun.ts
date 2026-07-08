import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyQuestClaim, type StoredQuestRecord } from "../lib/progressionEconomy";

type ClaimQuestResponse = {
  rewards: { exp: number; itemAmount?: number; itemKey?: string; syncPoints: number };
  succeeded: boolean;
};

/**
 * Server-authoritative quest claim. The outcome is rolled HERE, at claim
 * time, with server RNG — the record's stored `succeeded`/`rewards` fields
 * are ignored (the legacy client rolled at start and stored both).
 */
export const claimQuestRun = onCall(async (request): Promise<ClaimQuestResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim quests.");
  }

  const questRunId = (request.data as { questRunId?: unknown } | undefined)?.questRunId;
  if (typeof questRunId !== "string" || !questRunId.trim()) {
    throw new HttpsError("invalid-argument", "A quest run id is required.");
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
    const activeQuests = Array.isArray(rewardSystem.activeQuests) ? rewardSystem.activeQuests : [];
    const record = activeQuests.find(
      (entry) => (entry as { id?: unknown })?.id === questRunId,
    ) as StoredQuestRecord | undefined;

    if (!record) {
      throw new HttpsError("failed-precondition", "That quest run is not active.");
    }

    const endsAtMs = new Date(String(record.endsAt || "")).getTime();
    if (!Number.isFinite(endsAtMs) || endsAtMs > Date.now()) {
      throw new HttpsError("failed-precondition", "That quest is not complete yet.");
    }

    const result = applyQuestClaim(userData, record, Math.random());
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown quest.");
    }

    transaction.set(userRef, result.updates, { merge: true });

    return { rewards: result.rewards, succeeded: result.succeeded };
  });
});
