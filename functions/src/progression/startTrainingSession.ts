import { randomInt } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildTrainingStart, PROGRESSION_TIMERS_SCHEMA, TimerError, trainingView } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";

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
    const profile = snapshot.data() ?? {};
    const result = buildTrainingStart(profile, raw, nowMs, roll);
    if (result.updates) tx.update(userRef, result.updates);
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
