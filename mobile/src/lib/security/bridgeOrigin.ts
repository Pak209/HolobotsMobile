/**
 * Trusted-origin gating for the WebView auth bridge.
 *
 * Kept in a dependency-free module (no Firebase imports) so it is unit-testable
 * in a plain Node/vitest environment and reusable anywhere.
 */

// Only these hosts may receive the injected Firebase custom token. The token is
// a session-grade credential; injecting it into any other origin (or following
// a redirect off these hosts) would hand account access to a third party.
// Update this list if the trusted web surface changes.
export const ALLOWED_BRIDGE_HOSTS = ["holobots.fun"];

/**
 * True only when `url` is https and its host is an allowed bridge host (exact
 * match or a subdomain of one). Anything else — http, other domains, malformed
 * URLs, or look-alikes like "holobots.fun.evil.com" — returns false.
 */
export function isAllowedBridgeOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return ALLOWED_BRIDGE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}
