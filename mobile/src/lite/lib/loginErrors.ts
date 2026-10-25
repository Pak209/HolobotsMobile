/**
 * Player text for a failed sign-in / sign-up. Firebase Auth errors carry `auth/*` codes and an English
 * "Firebase: Error (auth/…)." message that must never reach the screen; AuthContext's own messages (plain Errors
 * without a code, e.g. "That email already has a Holobots account…") are already player copy and pass through.
 * PLACEHOLDER copy (Lex).
 */
const AUTH_COPY: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match. Check them and try again.",
  "auth/invalid-login-credentials": "That email and password don't match. Check them and try again.",
  "auth/wrong-password": "That email and password don't match. Check them and try again.",
  "auth/user-not-found": "That email and password don't match. Check them and try again.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use a password with at least 8 characters.",
  "auth/email-already-in-use": "That email is already registered. Sign in instead.",
  "auth/too-many-requests": "Too many attempts. Wait a moment, then try again.",
  "auth/network-request-failed": "Can't connect right now. Check your connection and try again.",
  "auth/user-disabled": "This account can't sign in. Contact support.",
};
export const LOGIN_FALLBACK_ERROR = "Unable to continue right now.";

export function loginErrorText(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code) return AUTH_COPY[code] ?? LOGIN_FALLBACK_ERROR;
  const message = error instanceof Error ? error.message : "";
  if (!message || /firebase|auth\/|internal|functions\//i.test(message)) return LOGIN_FALLBACK_ERROR;
  return message;
}
