import {withRankHealingReward} from "../lib/rankHealingReward";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyTrainingClaim } from "../lib/progressionEconomy";
import { legacyQuestTimersEnabled, resolveTrainingClaim, settleTrainingClaim, TimerError } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";

/**
 * Server-authoritative training claim. Stored stat boosts are clamped to
 * the course's legal range and restricted to the course's stat(s); the EXP
 * reward comes from the course table, not the stored record.
 *
 * hardening-2 (critic S3): the session must come from startTrainingSession's server-only
 * users/{uid}.progressionTimers.training record (host-clock elapsed time, host-rolled boosts). The client-written
 * rewardSystem.activeTraining is accepted ONLY when no server record exists AND HOLOCITY_LEGACY_QUEST_TIMERS=1.
 *
 * training-reward-replay-proof-1: every paid claim is recorded in the server-only progressionTimers.claimed ledger and
 * read first, so a session pays exactly once; a replay returns { claimed: true, alreadyProcessed: true } and pays nothing.
 */
type ClaimTrainingResponse = { claimed: boolean; alreadyProcessed?: true };

export async function transactClaimTrainingSession(firestore: Firestore, uid: string, nowMs = Date.now(),
  options: { legacyTimers?: boolean } = {}): Promise<ClaimTrainingResponse> {
  const legacyTimers = options.legacyTimers ?? legacyQuestTimersEnabled();
  const userRef = firestore.doc(`users/${uid}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const resolved = resolveTrainingClaim(userData, nowMs, legacyTimers);
    if (resolved.source === "replay") {
      // Already paid: prune the stale display copy, pay nothing.
      if (Object.keys(resolved.displayUpdates).length) transaction.update(userRef, resolved.displayUpdates);
      return { claimed: true, alreadyProcessed: true };
    }

    const result = applyTrainingClaim(userData, resolved.record);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown training course.");
    }

    transaction.set(userRef, withRankHealingReward(userData,result.updates), { merge: true });
    transaction.update(userRef, settleTrainingClaim(resolved, nowMs));

    return { claimed: true };
  });
}

export const claimTrainingSession = onCall(async (request): Promise<ClaimTrainingResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim training.");
  }
  try {
    return await transactClaimTrainingSession(db, uid);
  } catch (error) {
    throw error instanceof TimerError ? timerHttpsError(error) : error;
  }
});
