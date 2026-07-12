import { toHolobotKey } from "@/lib/minting";
import type { UserProfile } from "@/types/profile";

/**
 * Genesis Squad referral + wildcard economy, client mirror of
 * functions/src/lib/referrals.ts (parity-tested). Cross-user referral
 * operations are server-ONLY — rules block cross-user writes, so there is
 * no local fallback for applying codes or claiming the squad. The only
 * builder mirrored here is wildcard assignment, which touches just the
 * owner's document. See mobile/docs/genesis-squad-monetization-plan.md.
 */

export const GENESIS_REFERRALS_REQUIRED = 3;
/** No referral cap: every qualified referral past the squad grants wildcards. */
export const EXTRA_REFERRAL_WILDCARDS = 5;
export const REFERRAL_WELCOME_WILDCARDS = 5;
export const REFERRAL_WELCOME_HOLOS = 200;
export const GENESIS_BOTS = ["KUMA", "SHADOW"] as const;
export const REFERRAL_CODE_LENGTH = 6;

/** Self-verifying code: the server re-derives this from the matched uid. */
export function deriveReferralCode(uid: string): string {
  return uid.slice(0, REFERRAL_CODE_LENGTH).toUpperCase();
}

export type WildcardAssignUpdates = {
  blueprints: Record<string, number>;
  wildcardBlueprints: number;
};

/** Converts wildcard blueprints 1:1 into a chosen Holobot's blueprints. */
export function buildWildcardAssignUpdates(
  profile: Pick<UserProfile, "blueprints" | "wildcardBlueprints">,
  holobotName: string,
  amount: number,
): WildcardAssignUpdates | null {
  const balance = Number(profile.wildcardBlueprints || 0);
  const assign = Math.floor(amount);
  if (assign <= 0 || balance < assign) {
    return null;
  }

  const key = toHolobotKey(holobotName);
  if (!key) {
    return null;
  }

  const blueprints = { ...(profile.blueprints || {}) };
  blueprints[key] = (blueprints[key] || 0) + assign;

  return { blueprints, wildcardBlueprints: balance - assign };
}
