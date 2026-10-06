import { functions, httpsCallable } from "@/config/firebase";
import { toServerActionError } from "@/lib/callables";
import type { BoostableAttribute } from "@/lib/progression";
import type { ActiveQuestRecord, TrainingSessionRecord } from "@/lib/progressionSystems";
import { type SyncStatKey } from "@/lib/syncProgression";
import type { UserHolobot, UserProfile } from "@/types/profile";

/**
 * Server-authoritative quest/training claims, minting, rank-ups, energy
 * refills, and sync-stat upgrades. The legacy client-side fallbacks were
 * removed once the callables baked in production — Firestore rules now
 * freeze the economy fields, so only the server can pay.
 */

type UpdateProfileFn = (updates: Record<string, unknown>) => Promise<void>;

const claimQuestRunCallable = httpsCallable<
  { questRunId: string },
  { rewards: { exp: number; syncPoints: number }; succeeded: boolean }
>(functions, "claimQuestRun");

const claimTrainingSessionCallable = httpsCallable<Record<string, never>, { claimed: boolean }>(
  functions,
  "claimTrainingSession",
);

const upgradeSyncStatCallable = httpsCallable<
  { holobotName: string; stat: SyncStatKey },
  { cost: number }
>(functions, "upgradeSyncStat");

const mintHolobotCallable = httpsCallable<
  { holobotName: string; tierLabel: string },
  { startLevel: number }
>(functions, "mintHolobot");

const upgradeHolobotRankCallable = httpsCallable<
  { holobotName: string; tierLabel: string },
  { startLevel: number }
>(functions, "upgradeHolobotRank");

const useEnergyRefillCallable = httpsCallable<
  Record<string, never>,
  { dailyEnergy: number; energyRefills: number }
>(functions, "useEnergyRefill");

const useRankSkipCallable = httpsCallable<
  { holobotName: string },
  { holobotName: string; nextTierLabel: string }
>(functions, "useRankSkip");

const useExpBoosterCallable = httpsCallable<Record<string, never>, { activeUntil: number }>(
  functions,
  "useExpBooster",
);

export type AttributeBoostReason = "already_processed" | "attribute_not_boostable" | "no_attribute_points";

export type BoostHolobotAttributeResponse = {
  applied: boolean;
  holobot: UserHolobot;
  reason?: AttributeBoostReason;
};

const boostHolobotAttributeCallable = httpsCallable<
  { attribute: BoostableAttribute; holobotName: string; requestId: string },
  BoostHolobotAttributeResponse
>(functions, "boostHolobotAttribute");

const redeemLegendaryBlueprintCallable = httpsCallable<
  { holobotName: string },
  { holobotName: string; outcome: "minted" | "ascended" | "converted"; wildcards?: number }
>(functions, "redeemLegendaryBlueprint");

export async function claimQuestRunAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  quest: ActiveQuestRecord,
): Promise<void> {
  try {
    await claimQuestRunCallable({ questRunId: quest.id });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function claimTrainingSessionAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  _training: TrainingSessionRecord,
): Promise<void> {
  try {
    await claimTrainingSessionCallable({});
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function mintHolobotAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  tierLabel: string,
): Promise<void> {
  try {
    await mintHolobotCallable({ holobotName, tierLabel });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function upgradeHolobotRankAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  tierLabel: string,
): Promise<void> {
  try {
    await upgradeHolobotRankCallable({ holobotName, tierLabel });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function useEnergyRefillAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
): Promise<void> {
  try {
    await useEnergyRefillCallable({});
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function upgradeSyncStatAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  stat: SyncStatKey,
): Promise<void> {
  try {
    await upgradeSyncStatCallable({ holobotName, stat });
  } catch (error) {
    throw toServerActionError(error);
  }
}

/** The 0.1% gacha easter egg: ascend the chosen Holobot to Legendary. */
export async function redeemLegendaryBlueprintAuthoritative(
  holobotName: string,
): Promise<{ outcome: "minted" | "ascended" | "converted"; wildcards?: number }> {
  try {
    const result = await redeemLegendaryBlueprintCallable({ holobotName });
    return { outcome: result.data.outcome, wildcards: result.data.wildcards };
  } catch (error) {
    throw toServerActionError(error);
  }
}

/** Rank Skip item: jump the chosen bot to its next tier, no blueprints. */
export async function useRankSkipAuthoritative(
  holobotName: string,
): Promise<{ nextTierLabel: string }> {
  try {
    const result = await useRankSkipCallable({ holobotName });
    return { nextTierLabel: result.data.nextTierLabel };
  } catch (error) {
    throw toServerActionError(error);
  }
}

/** EXP Booster item: doubled arena EXP for 24 hours. */
export async function useExpBoosterAuthoritative(): Promise<{ activeUntil: number }> {
  try {
    const result = await useExpBoosterCallable({});
    return { activeUntil: result.data.activeUntil };
  } catch (error) {
    throw toServerActionError(error);
  }
}

const ATTRIBUTE_BOOST_REFUSAL_MESSAGES: Record<Exclude<AttributeBoostReason, "already_processed">, string> = {
  attribute_not_boostable: "SPECIAL grows with the Sync Focus stat, not with attribute points.",
  no_attribute_points: "This Holobot has no attribute points available to spend.",
};

/** One id per tap; matches the server's ^[a-zA-Z0-9_-]{1,128}$ request-id rule. */
export function makeAttributeBoostRequestId(): string {
  return `boost_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Spend one attribute point server-side (DECISIONS #53-2): +1 attack /
 * defense / speed or +10 HP. The profile listener picks up the write; the
 * reply's holobot is the authoritative record. Typed refusals throw a readable
 * Error; a replayed request id (already_processed) resolves without spending.
 */
export async function boostHolobotAttributeAuthoritative(
  holobotName: string,
  attribute: BoostableAttribute,
  requestId: string = makeAttributeBoostRequestId(),
): Promise<BoostHolobotAttributeResponse> {
  let response: BoostHolobotAttributeResponse;
  try {
    const result = await boostHolobotAttributeCallable({ attribute, holobotName, requestId });
    response = result.data;
  } catch (error) {
    throw toServerActionError(error);
  }

  if (!response.applied && response.reason && response.reason !== "already_processed") {
    throw new Error(ATTRIBUTE_BOOST_REFUSAL_MESSAGES[response.reason]);
  }
  return response;
}
