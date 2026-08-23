import { isAllowedBridgeOrigin } from "@/lib/security/bridgeOrigin";

/**
 * Story Mode (slice 0) configuration. See docs/STORY_BRIDGE_CONTRACT.md.
 *
 * Dependency-free on purpose (no react-native imports) so the bridge core and
 * its vitest suite can import these constants in a plain Node environment.
 */

/** Version we send (STORY_STATE) — Round D bumped to 2 (HELLO map descriptor + PLAYER_POS). */
export const STORY_PROTOCOL_VERSION = 2;
/** Versions we accept on BRIDGE_HELLO so a v1 overworld still connects (degraded: no minimap). */
export const STORY_SUPPORTED_PROTOCOL_VERSIONS = [1, 2] as const;
export const STORY_ZONE_DEFAULT = "Hangar District";
export const STORY_MAP_ID = "hangar-town";
/** Round E: the web overworld grew to a 56×40 town; used only to validate SAVE_CHECKPOINT bounds. */
export const STORY_MAP_SIZE = { height: 40, width: 56 } as const;

/**
 * Where the Pixi overworld is loaded from. Slice 0 uses a local Vite dev server.
 * For on-device testing set EXPO_PUBLIC_OVERWORLD_URL to your LAN IP, e.g.
 * `EXPO_PUBLIC_OVERWORLD_URL=http://192.168.1.23:5173/overworld.html npx expo start`.
 * Production hosting will be a versioned https path on an allowed bridge host
 * (contract §A.5) — that host must be added to ALLOWED_BRIDGE_HOSTS, not here.
 */
export const STORY_OVERWORLD_URL =
  process.env.EXPO_PUBLIC_OVERWORLD_URL ?? "http://localhost:5173/overworld.html";

/** The ONLY flags the WebView may author (contract §C SET_STORY_FLAG). */
export const CLIENT_WRITABLE_STORY_FLAGS = ["ui.dpad_seen"] as const;
/** Buildings the overworld may ask native to open in slice 0. */
export const STORY_BUILDING_IDS = ["gacha"] as const;
/** NPCs the overworld may talk to in slice 0. */
export const STORY_NPC_IDS = ["guide"] as const;
/** Native-authored progression flag set when the Guide dialogue is dismissed. */
export const STORY_FLAG_GUIDE_MET = "npc.guide.met";

function isDevBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

/**
 * `scheme://host[:port]` (lower-cased) for http(s) URLs, else null. Regex-based
 * rather than `new URL()` so it behaves identically in Node tests and RN.
 */
export function getHttpOrigin(url: string): string | null {
  const match = /^(https?):\/\/([^/?#\s]+)/i.exec(url.trim());
  if (!match) {
    return null;
  }
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}`;
}

/**
 * Overworld load gate. Production: the same https allowlist as the auth bridge.
 * Dev builds only: additionally the exact origin of STORY_OVERWORLD_URL so a
 * local Vite server can be loaded. Nothing else, ever (no file://, no about:).
 */
export function isAllowedOverworldOrigin(
  url: string,
  options: { dev?: boolean; devUrl?: string } = {},
): boolean {
  if (isAllowedBridgeOrigin(url)) {
    return true;
  }

  const dev = options.dev ?? isDevBuild();
  if (!dev) {
    return false;
  }

  const devOrigin = getHttpOrigin(options.devUrl ?? STORY_OVERWORLD_URL);
  const origin = getHttpOrigin(url);
  return devOrigin !== null && origin !== null && devOrigin === origin;
}
