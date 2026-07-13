import { functions, httpsCallable } from "@/config/firebase";
import { shouldFallBackToLocal } from "@/lib/callables";
import type { UserProfile } from "@/types/profile";

/**
 * Growth callables. applyReferralCode and claimGenesisSquad are
 * server-ONLY — they touch another user's document (rules forbid that from
 * the client) or mint entitlements, so there is deliberately no local
 * fallback: offline they fail with a readable message instead of forking
 * state. Wildcard assignment only edits the owner's document, so it keeps
 * the usual callable-first/local-fallback shape.
 */

type UpdateProfileFn = (updates: Record<string, unknown>) => Promise<void>;

const applyReferralCodeCallable = httpsCallable<
  { code: string },
  { referrerUsername: string }
>(functions, "applyReferralCode");

const claimGenesisSquadCallable = httpsCallable<
  Record<string, never>,
  { granted: string[]; converted: Array<{ name: string; blueprints: number }> }
>(functions, "claimGenesisSquad");

const assignWildcardBlueprintsCallable = httpsCallable<
  { holobotName: string; amount: number },
  { holobotName: string; amount: number; remaining: number }
>(functions, "assignWildcardBlueprints");

export async function applyReferralCodeAuthoritative(
  code: string,
): Promise<{ referrerUsername: string }> {
  try {
    const result = await applyReferralCodeCallable({ code: code.trim().toUpperCase() });
    return result.data;
  } catch (error) {
    if (shouldFallBackToLocal(error)) {
      throw new Error("Referral codes need a connection. Try again when you're online.");
    }
    throw error;
  }
}

export async function claimGenesisSquadAuthoritative(): Promise<{
  granted: string[];
  converted: Array<{ name: string; blueprints: number }>;
}> {
  try {
    const result = await claimGenesisSquadCallable({});
    return result.data;
  } catch (error) {
    if (shouldFallBackToLocal(error)) {
      throw new Error("Claiming the Genesis Squad needs a connection. Try again when you're online.");
    }
    throw error;
  }
}

export async function assignWildcardBlueprintsAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  amount: number,
): Promise<{ remaining: number }> {
  try {
    const result = await assignWildcardBlueprintsCallable({ holobotName, amount });
    return { remaining: result.data.remaining };
  } catch (error) {
    if (shouldFallBackToLocal(error)) {
      throw new Error("Assigning wildcards needs a connection. Try again when you're online.");
    }
    throw error;
  }
}
