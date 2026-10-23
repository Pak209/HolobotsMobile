import { randomInt } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildTrainingStart, PROGRESSION_TIMERS_SCHEMA, TimerError, trainingView } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";
import { regenInTransaction } from "../energy/energyRegenStore";

/**
 * hardening-2 (critic S3): server-side training start. Request {courseId, holobotName, requestId}; one active session,
 * owned holobot, stored dailyEnergy debited, stat boost rolled with host RNG; recorded in the server-only
 * users/{uid}.progressionTimers.training with the host clock, and mirrored to rewardSystem.activeTraining for display.
 * Reply {schemaVersion:'progression-timers-1', alreadyProcessed, training, dailyEnergy}.
 */
export async function transactStartTrainingSession(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now(), roll = randomInt(0, 0x100000000) / 0x100000000) {
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new TimerError("unavailable");
    // energy-quest-server-1: regen (host clock, account zone) before the energy check, written with the start.
    const regen = await regenInTransaction(firestore, tx, uid, snapshot.data() ?? {}, nowMs);
    const profile = regen.profile;
    const result = buildTrainingStart(profile, raw, nowMs, roll);
    if (result.updates || regen.updates) tx.update(userRef, { ...(regen.updates ?? {}), ...(result.updates ?? {}) });
    const dailyEnergy = result.updates ? result.updates.dailyEnergy : profile.dailyEnergy ?? 0;
    return { schemaVersion: PROGRESSION_TIMERS_SCHEMA, alreadyProcessed: result.alreadyProcessed, training: trainingView(result.run), dailyEnergy };
  });
}

export const startTrainingSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in to start training.");
  try {
    return await transactStartTrainingSession(db, uid, request.data);
  } catch (error) {
    throw timerHttpsError(error);
  }
});
