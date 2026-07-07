import { functions, httpsCallable } from "@/config/firebase";
import { db } from "@/config/firebase";
import {
  syncFitnessActivity as syncFitnessActivityLocal,
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

// Errors that mean "the server path was unusable", not "the server said no".
const FALLBACK_ERROR_CODES = new Set([
  "functions/not-found",
  "functions/unavailable",
  "functions/deadline-exceeded",
  "functions/internal",
]);

function shouldFallBack(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (!code) {
    // Plain network failures surface without a functions/* code.
    return true;
  }

  return FALLBACK_ERROR_CODES.has(code);
}

export async function syncFitnessActivityAuthoritative(
  request: SyncFitnessActivityRequest,
): Promise<SyncFitnessActivityResponse> {
  const { uid: _uid, cooldownEndsAt: _cooldownEndsAt, ...payload } = request;

  try {
    const result = await syncFitnessActivityCallable(payload);
    return result.data;
  } catch (error) {
    if (!shouldFallBack(error)) {
      throw error;
    }

    return syncFitnessActivityLocal(db, request);
  }
}
