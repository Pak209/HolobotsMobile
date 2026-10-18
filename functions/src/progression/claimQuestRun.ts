import {withRankHealingReward} from "../lib/rankHealingReward";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyQuestClaim } from "../lib/progressionEconomy";
import { legacyQuestTimersEnabled, resolveQuestClaim, TimerError } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";

type ClaimQuestResponse = {
  rewards: { exp: number; itemAmount?: number; itemKey?: string; syncPoints: number };
  succeeded: boolean;
};

/**
 * Server-authoritative quest claim. The outcome is rolled HERE, at claim
 * time, with server RNG — the record's stored `succeeded`/`rewards` fields
 * are ignored (the legacy client rolled at start and stored both).
 *
 * hardening-2 (critic S3): the run must come from startQuestRun's server-only users/{uid}.progressionTimers record:
 * elapsed time is checked against its host-clock startedAtMs + the quest duration, and the success roll uses its
 * host-computed holobotPower. A client-written rewardSystem.activeQuests record is accepted ONLY when no server record
 * exists AND HOLOCITY_LEGACY_QUEST_TIMERS=1 (in-flight legacy clients on deploy day; default off).
 */
export async function transactClaimQuestRun(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now(),
  options: { legacyTimers?: boolean } = {}, roll = Math.random()): Promise<ClaimQuestResponse> {
  const questRunId = (raw as { questRunId?: unknown } | undefined)?.questRunId;
  if (typeof questRunId !== "string" || !questRunId.trim()) {
    throw new HttpsError("invalid-argument", "A quest run id is required.");
  }
  const legacyTimers = options.legacyTimers ?? legacyQuestTimersEnabled();
  const userRef = firestore.doc(`users/${uid}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const { record, timerUpdates } = resolveQuestClaim(userData, questRunId, nowMs, legacyTimers);

    const result = applyQuestClaim(userData, record, roll);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown quest.");
    }

    transaction.set(userRef, withRankHealingReward(userData,result.updates), { merge: true });
    // update(), not merge-set: a merge-set would deep-merge the quests map and keep the claimed run.
    if (Object.keys(timerUpdates).length) transaction.update(userRef, timerUpdates);

    return { rewards: result.rewards, succeeded: result.succeeded };
  });
}

export const claimQuestRun = onCall(async (request): Promise<ClaimQuestResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim quests.");
  }
  try {
    return await transactClaimQuestRun(db, uid, request.data);
  } catch (error) {
    throw error instanceof TimerError ? timerHttpsError(error) : error;
  }
});
