import {withRankHealingReward} from "../lib/rankHealingReward";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { applyTrainingClaim } from "../lib/progressionEconomy";
import { legacyQuestTimersEnabled, resolveTrainingClaim, TimerError } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";

/**
 * Server-authoritative training claim. Stored stat boosts are clamped to
 * the course's legal range and restricted to the course's stat(s); the EXP
 * reward comes from the course table, not the stored record.
 *
 * hardening-2 (critic S3): the session must come from startTrainingSession's server-only
 * users/{uid}.progressionTimers.training record (host-clock elapsed time, host-rolled boosts). The client-written
 * rewardSystem.activeTraining is accepted ONLY when no server record exists AND HOLOCITY_LEGACY_QUEST_TIMERS=1.
 */
export async function transactClaimTrainingSession(firestore: Firestore, uid: string, nowMs = Date.now(),
  options: { legacyTimers?: boolean } = {}): Promise<{ claimed: boolean }> {
  const legacyTimers = options.legacyTimers ?? legacyQuestTimersEnabled();
  const userRef = firestore.doc(`users/${uid}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const { record, timerUpdates } = resolveTrainingClaim(userData, nowMs, legacyTimers);

    const result = applyTrainingClaim(userData, record);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown training course.");
    }

    transaction.set(userRef, withRankHealingReward(userData,result.updates), { merge: true });
    if (Object.keys(timerUpdates).length) transaction.update(userRef, timerUpdates);

    return { claimed: true };
  });
}

export const claimTrainingSession = onCall(async (request): Promise<{ claimed: boolean }> => {
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
