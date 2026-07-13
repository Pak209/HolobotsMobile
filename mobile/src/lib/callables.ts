/**
 * Shared policy for the server-authoritative economy paths. The legacy
 * client-side fallbacks were removed on 2026-07-12 (rules now freeze the
 * economy fields, so a local write would be denied anyway): availability
 * errors surface as a readable "needs a connection" message instead.
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

/** Availability-class failures become a friendly retry message; server
    refusals pass through untouched. */
export function toServerActionError(error: unknown): unknown {
  if (shouldFallBackToLocal(error)) {
    return new Error("This action needs a connection. Check your network and try again.");
  }
  return error;
}
