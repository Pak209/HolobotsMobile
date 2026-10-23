import { Firestore, Timestamp, Transaction } from "firebase-admin/firestore";

import { computeHostEnergyRegen, dayKeyInZone, resolveEnergyTimeZone, type EnergyRegenOutcome } from "../lib/energyRegen";

type Data = Record<string, unknown>;

/** The regen outcome's updates as Firestore fields (Timestamps for the times). */
export function energyRegenFirestoreUpdates(updates: NonNullable<EnergyRegenOutcome["updates"]>): Data {
  const out: Data = {
    dailyEnergy: updates.dailyEnergy,
    lastEnergyRefresh: Timestamp.fromMillis(updates.lastEnergyRefreshMs),
    stepEnergyDate: updates.stepEnergyDate,
    stepEnergyGrantedToday: updates.stepEnergyGrantedToday,
    energyDayKey: updates.energyDayKey,
    energyDayStartedAt: Timestamp.fromMillis(updates.energyDayStartedAtMs),
  };
  if (updates.energyTimeZone !== undefined) out.energyTimeZone = updates.energyTimeZone;
  if (updates.energyTimeZoneChangedAtMs !== undefined) out.energyTimeZoneChangedAt = Timestamp.fromMillis(updates.energyTimeZoneChangedAtMs);
  return out;
}

/**
 * Regen inside a caller's transaction (reads only; the caller writes). Reads today's steps from the server-only
 * users/{uid}/fitness_daily/{todayKey}, todayKey = the host's today in the account's (resolved) zone.
 * Returns the outcome, the Firestore-shaped updates (null = nothing to write) and the profile as it reads after regen.
 */
export async function regenInTransaction(firestore: Firestore, tx: Transaction, uid: string, profile: Data, nowMs: number, requestedZone?: unknown) {
  const zone = resolveEnergyTimeZone(profile, requestedZone, nowMs).zone;
  const todayKey = dayKeyInZone(nowMs, zone);
  const daily = await tx.get(firestore.doc(`users/${uid}/fitness_daily/${todayKey}`));
  const steps = daily.exists ? Number(daily.data()?.stepsTotal ?? 0) : 0;
  const outcome = computeHostEnergyRegen(profile, nowMs, Number.isFinite(steps) ? steps : 0, requestedZone);
  const updates = outcome.updates ? energyRegenFirestoreUpdates(outcome.updates) : null;
  return { outcome, updates, profile: updates ? { ...profile, ...updates } : profile };
}
