import { functions, httpsCallable } from "@/config/firebase";
import { CALLABLE_TIMEOUT_MS, withTimeout } from "@/lib/async";
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
    const result = await withTimeout(
      clearWorkoutCooldownCallable({ date }),
      CALLABLE_TIMEOUT_MS,
      "Quick Refill timed out. Check your connection and try again.",
    );
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
    // Deadline (bake bug 2): a stalled callable froze the claim button
    // forever. Timing out surfaces the retry path — the sync is idempotent
    // by activityId, so retrying a timed-out-but-landed sync double-pays
    // nothing.
    const result = await withTimeout(
      syncFitnessActivityCallable(payload),
      CALLABLE_TIMEOUT_MS,
      "Workout sync timed out. Check your connection and tap COLLECT to retry.",
    );
    return result.data;
  } catch (error) {
    throw toServerActionError(error);
  }
}
