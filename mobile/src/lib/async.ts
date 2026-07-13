/**
 * Deadline wrapper for network awaits that must never wedge a spinner.
 * Firebase Auth/Firestore promises can stall indefinitely on flaky mobile
 * networks (the 2026-07-08 bake's signup and workout-claim hangs) — every
 * user-facing await in those flows goes through here so the UI always gets
 * either a result or a readable error. The underlying operation is NOT
 * cancelled (Firebase offers no cancellation); retries are safe because the
 * flows are idempotent (auth by account state, fitness sync by activityId).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const AUTH_TIMEOUT_MS = 15_000;
export const FIRESTORE_TIMEOUT_MS = 12_000;
export const CALLABLE_TIMEOUT_MS = 15_000;
