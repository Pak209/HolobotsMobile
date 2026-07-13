import { functions, httpsCallable } from "@/config/firebase";
import { toServerActionError } from "@/lib/callables";
import {
  type SyncFitnessActivityRequest,
  type SyncFitnessActivityResponse,
} from "@/lib/fitnessSync";

/**
 * Server-authoritative fitness sync. The server clamps claimed rewards,
 * enforces the daily session cap, and computes the cooldown. The legacy
 * client-side transaction fallback was removed on 2026-07-12 together with
 * the rules freeze on economy fields (SECURITY_AUDIT.md C1/C3): offline
 * syncs now surface a retry message instead of forking state.
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
  _uid: string,
  date: string,
): Promise<{ cooldownEndsAt: string | null; sessionsCompleted: number }> {
  try {
    const result = await clearWorkoutCooldownCallable({ date });
    return result.data;
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function syncFitnessActivityAuthoritative(
  request: SyncFitnessActivityRequest,
): Promise<SyncFitnessActivityResponse> {
  const { uid: _uid, cooldownEndsAt: _cooldownEndsAt, ...payload } = request;

  try {
    const result = await syncFitnessActivityCallable(payload);
    return result.data;
  } catch (error) {
    throw toServerActionError(error);
  }
}
