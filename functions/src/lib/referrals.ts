import { calculateExperience, getHolobotRank } from "./progression";
import { toHolobotKey } from "./mintingEconomy";

/**
 * Genesis Squad referral + wildcard economy (server-authoritative — the
 * cross-user writes here have no client fallback by design). Constants and
 * builders for:
 *   - referral codes (uid-derived, self-verifying)
 *   - the qualification reward (invited player's first real workout)
 *   - the Genesis Squad grant (KUMA + SHADOW, celebration pack, badge)
 *   - wildcard blueprint assignment
 * See mobile/docs/genesis-squad-monetization-plan.md.
 */

export const GENESIS_REFERRALS_REQUIRED = 3;
/** No referral cap: every qualified referral past the squad grants wildcards. */
export const EXTRA_REFERRAL_WILDCARDS = 5;
export const REFERRAL_WELCOME_WILDCARDS = 5;
export const REFERRAL_WELCOME_HOLOS = 200;
export const GENESIS_PACK_HOLOS = 500;
export const GENESIS_PACK_SYNC_POINTS = 50;
/** Compensation when a claimed bot is already owned: one Rare rank step. */
export const GENESIS_DUPLICATE_BLUEPRINTS = 20;
export const GENESIS_BOTS = ["KUMA", "SHADOW"] as const;
export const REFERRAL_CODE_LENGTH = 6;
/** Codes may be applied within this window of account creation. */
export const REFERRAL_APPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Self-verifying code: derived from the uid, so a matched doc can be checked. */
export function deriveReferralCode(uid: string): string {
  return uid.slice(0, REFERRAL_CODE_LENGTH).toUpperCase();
}

type RawUser = Record<string, unknown>;

function ownsHolobot(userData: RawUser, name: string): boolean {
  const holobots = Array.isArray(userData.holobots)
    ? (userData.holobots as Array<Record<string, unknown>>)
    : [];
  return holobots.some(
    (holobot) => String(holobot.name || "").trim().toUpperCase() === name.toUpperCase(),
  );
}

function mintedHolobotRecord(name: string): Record<string, unknown> {
  return {
    name,
    level: 1,
    experience: 0,
    nextLevelExp: calculateExperience(2),
    rank: getHolobotRank(1),
    attributePoints: 10,
    boostedAttributes: {},
  };
}

export type GenesisGrantResult = {
  granted: string[];
  converted: Array<{ name: string; blueprints: number }>;
  updates: RawUser;
};

/**
 * The one Genesis Squad grant used by every path (referral claim now,
 * purchase redemption in Phase 2): mints the missing Genesis bots, converts
 * already-owned ones to blueprints, adds the celebration pack, and stamps
 * the permanent badge + entitlement.
 */
export function buildGenesisSquadGrantRaw(userData: RawUser, source: string): GenesisGrantResult | null {
  if (userData.genesisSquadClaimed) {
    return null;
  }

  const holobots = Array.isArray(userData.holobots)
    ? [...(userData.holobots as Array<Record<string, unknown>>)]
    : [];
  const blueprints = { ...((userData.blueprints as Record<string, number>) || {}) };
  const granted: string[] = [];
  const converted: Array<{ name: string; blueprints: number }> = [];

  for (const name of GENESIS_BOTS) {
    if (ownsHolobot(userData, name)) {
      const key = toHolobotKey(name);
      blueprints[key] = (blueprints[key] || 0) + GENESIS_DUPLICATE_BLUEPRINTS;
      converted.push({ name, blueprints: GENESIS_DUPLICATE_BLUEPRINTS });
    } else {
      holobots.push(mintedHolobotRecord(name));
      granted.push(name);
    }
  }

  return {
    granted,
    converted,
    updates: {
      holobots,
      blueprints,
      holosTokens: Number(userData.holosTokens || 0) + GENESIS_PACK_HOLOS,
      syncPoints: Number(userData.syncPoints || 0) + GENESIS_PACK_SYNC_POINTS,
      genesisSquadClaimed: source,
      genesisBadge: true,
    },
  };
}

export type WildcardAssignResult = {
  updates: { blueprints: Record<string, number>; wildcardBlueprints: number };
};

/** Converts wildcard blueprints 1:1 into a chosen Holobot's blueprints. */
export function buildWildcardAssignRaw(
  userData: RawUser,
  holobotName: string,
  amount: number,
): WildcardAssignResult | null {
  const balance = Number(userData.wildcardBlueprints || 0);
  const assign = Math.floor(amount);
  if (assign <= 0 || balance < assign) {
    return null;
  }

  const key = toHolobotKey(holobotName);
  if (!key) {
    return null;
  }

  const blueprints = { ...((userData.blueprints as Record<string, number>) || {}) };
  blueprints[key] = (blueprints[key] || 0) + assign;

  return {
    updates: { blueprints, wildcardBlueprints: balance - assign },
  };
}
