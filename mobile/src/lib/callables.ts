/**
 * Shared policy for callable-first economy paths: which errors mean "the
 * server path was unusable" (fall back to the legacy client-side write)
 * versus "the server said no" (surface to the user).
 */

const FALLBACK_ERROR_CODES = new Set([
  "functions/not-found",
  "functions/unavailable",
  "functions/deadline-exceeded",
  "functions/internal",
]);

export function shouldFallBackToLocal(error: unknown): boolean {
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
