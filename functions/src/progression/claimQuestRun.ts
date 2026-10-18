import {withRankHealingReward} from "../lib/rankHealingReward";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyQuestClaim, getQuestEconomy } from "../lib/progressionEconomy";
import { legacyQuestTimersEnabled, resolveQuestClaim, settleQuestClaim, TimerError } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";

type ClaimQuestResponse = {
  rewards: { exp: number; itemAmount?: number; itemKey?: string; syncPoints: number };
  succeeded: boolean;
  /** training-reward-replay-proof-1: present (true) when this run was already paid; the stored receipt, nothing paid. */
  alreadyProcessed?: true;
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
 *
 * training-reward-replay-proof-1: every paid claim is recorded in the server-only progressionTimers.claimed ledger and
 * the ledger is read first, so a run pays exactly once (a restored / resurrected / second-device copy, a retry or a
 * reinstall replays the stored receipt with alreadyProcessed: true and pays nothing).
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
    const resolved = resolveQuestClaim(userData, questRunId, nowMs, legacyTimers);
    if (resolved.source === "replay") {
      // Already paid: prune the stale display copy, pay nothing, replay the receipt (rewards are the table's).
      if (Object.keys(resolved.displayUpdates).length) transaction.update(userRef, resolved.displayUpdates);
      return { rewards: getQuestEconomy(resolved.prior.subject)!.rewards, succeeded: resolved.prior.succeeded === true, alreadyProcessed: true };
    }

    const result = applyQuestClaim(userData, resolved.record, roll);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown quest.");
    }

    transaction.set(userRef, withRankHealingReward(userData,result.updates), { merge: true });
    // update(), not merge-set: a merge-set would deep-merge the quests map and keep the claimed run.
    transaction.update(userRef, settleQuestClaim(resolved, result.succeeded, nowMs));

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
