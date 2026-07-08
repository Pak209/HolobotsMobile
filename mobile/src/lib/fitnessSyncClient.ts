import { functions, httpsCallable } from "@/config/firebase";
import { db } from "@/config/firebase";
import { shouldFallBackToLocal } from "@/lib/callables";
import {
  syncFitnessActivity as syncFitnessActivityLocal,
  unlockDailyWorkoutRefill,
  type SyncFitnessActivityRequest,
  type SyncFitnessActivityResponse,
} from "@/lib/fitnessSync";

/**
 * Server-authoritative fitness sync with an availability fallback.
 *
 * The callable is the intended path: the server clamps claimed rewards,
 * enforces the daily session cap, and computes the cooldown. The legacy
 * client-side transaction remains as a fallback for availability only —
 * device offline, or the function not yet deployed. It adds no new attack
 * surface while Firestore rules still permit owner economy writes; once the
 * callable has baked in production, the fallback (and then the rules
 * permissions) are scheduled for removal — see SECURITY_AUDIT.md C1.
 */

type CallablePayload = Omit<SyncFitnessActivityRequest, "uid" | "cooldownEndsAt">;

const syncFitnessActivityCallable = httpsCallable<CallablePayload, SyncFitnessActivityResponse>(
  functions,
  "syncFitnessActivity",
);

const clearWorkoutCooldownCallable = httpsCallable<
  { date: string },
  { cooldownEndsAt: null; sessionsCompleted: number }
>(functions, "clearWorkoutCooldown");

/** Quick Refill: server clears the cooldown (refusing past the daily cap). */
export async function clearWorkoutCooldownAuthoritative(
  uid: string,
  date: string,
): Promise<{ cooldownEndsAt: string | null; sessionsCompleted: number }> {
  try {
    const result = await clearWorkoutCooldownCallable({ date });
    return result.data;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  return unlockDailyWorkoutRefill(db, uid, date);
}

export async function syncFitnessActivityAuthoritative(
  request: SyncFitnessActivityRequest,
): Promise<SyncFitnessActivityResponse> {
  const { uid: _uid, cooldownEndsAt: _cooldownEndsAt, ...payload } = request;

  try {
    const result = await syncFitnessActivityCallable(payload);
    return result.data;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }

    return syncFitnessActivityLocal(db, request);
  }
}
