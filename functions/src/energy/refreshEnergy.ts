import { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { readRefreshEnergyRequest } from "../lib/energyRegen";
import { regenInTransaction } from "./energyRegenStore";

/**
 * energy-quest-server-1: the daily energy regen, on the host (lib/energyRegen.ts has the time-zone design).
 * Request `{}` or `{timeZone: <IANA>}` (the device's zone, a proposal: the first one is stored, a change is
 * rate-limited). Applies the daily reset at the account's local midnight, the 15-minute trickle and today's step
 * bonus, all on the host clock, and writes dailyEnergy / lastEnergyRefresh / stepEnergyDate / stepEnergyGrantedToday
 * (server-only in firestore.rules). Idempotent: a pass with nothing due writes nothing (changed: false).
 * Reply: lib/energyRegen EnergyRegenOutcome.reply (schemaVersion 'energy-regen-1').
 * Refusals (details.rejectionCode): invalid_request, unavailable.
 */
export async function transactRefreshEnergy(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now()) {
  const request = readRefreshEnergyRequest(raw);
  if (!request) throw new HttpsError("invalid-argument", "Bad energy refresh request.", { rejectionCode: "invalid_request" });
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "User profile not found.", { rejectionCode: "unavailable" });
    const regen = await regenInTransaction(firestore, tx, uid, snapshot.data() ?? {}, nowMs, request.timeZone);
    if (regen.updates) tx.update(userRef, regen.updates);
    return regen.outcome.reply;
  });
}

export const refreshEnergy = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in to refresh energy.");
  return transactRefreshEnergy(db, uid, request.data);
});
