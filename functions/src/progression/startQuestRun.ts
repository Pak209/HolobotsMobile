import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildQuestStart, PROGRESSION_TIMERS_SCHEMA, questRunView, TimerError } from "../lib/progressionTimers";
import { timerHttpsError } from "./progressionTimerErrors";
import { regenInTransaction } from "../energy/energyRegenStore";

/**
 * hardening-2 (critic S3): server-side quest start. Request {questId, holobotName, requestId}; validates the quest, the
 * owned holobot, the 3 slots and stored dailyEnergy, debits the energy, and records the run in the server-only
 * users/{uid}.progressionTimers with the host clock and the host-computed holobotPower. Also appends the display copy
 * to rewardSystem.activeQuests (id = questRun.id), which claimQuestRun({questRunId}) takes.
 * Reply {schemaVersion:'progression-timers-1', alreadyProcessed, questRun, dailyEnergy}.
 */
export async function transactStartQuestRun(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now()) {
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new TimerError("unavailable");
    // energy-quest-server-1: regen (host clock, account zone) before the energy check, written with the start.
    const regen = await regenInTransaction(firestore, tx, uid, snapshot.data() ?? {}, nowMs);
    const profile = regen.profile;
    const result = buildQuestStart(profile, raw, nowMs);
    if (result.updates || regen.updates) tx.update(userRef, { ...(regen.updates ?? {}), ...(result.updates ?? {}) });
    const dailyEnergy = result.updates ? result.updates.dailyEnergy : profile.dailyEnergy ?? 0;
    return { schemaVersion: PROGRESSION_TIMERS_SCHEMA, alreadyProcessed: result.alreadyProcessed, questRun: questRunView(result.run), dailyEnergy };
  });
}

export const startQuestRun = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in to start quests.");
  try {
    return await transactStartQuestRun(db, uid, request.data);
  } catch (error) {
    throw timerHttpsError(error);
  }
});
