import { functions, httpsCallable } from "@/config/firebase";
import { shouldFallBackToLocal } from "@/lib/callables";
import {
  buildMintUpdates,
  buildRankUpgradeUpdates,
  isMintRefusal,
  isRankUpgradeRefusal,
} from "@/lib/minting";
import { buildQuestClaimUpdates, buildTrainingClaimUpdates } from "@/lib/progressionClaims";
import type { ActiveQuestRecord, TrainingSessionRecord } from "@/lib/progressionSystems";
import { upgradeSyncStat, type SyncStatKey } from "@/lib/syncProgression";
import type { UserProfile } from "@/types/profile";

/**
 * Callable-first quest/training claims and sync-stat upgrades with the
 * legacy client-side write as an availability-only fallback. Note the
 * server rolls quest outcomes at claim time; the fallback uses the
 * outcome stored at start (legacy behavior).
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

export async function claimQuestRunAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  quest: ActiveQuestRecord,
): Promise<void> {
  try {
    await claimQuestRunCallable({ questRunId: quest.id });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  await updateProfile(buildQuestClaimUpdates(profile, quest));
}

export async function claimTrainingSessionAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  training: TrainingSessionRecord,
): Promise<void> {
  try {
    await claimTrainingSessionCallable({});
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  await updateProfile(buildTrainingClaimUpdates(profile, training));
}

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

export async function mintHolobotAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  holobotName: string,
  tierLabel: string,
): Promise<void> {
  try {
    await mintHolobotCallable({ holobotName, tierLabel });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildMintUpdates(profile, holobotName, tierLabel);
  if (isMintRefusal(result)) {
    throw new Error("This Holobot cannot be minted right now.");
  }
  await updateProfile(result.updates);
}

export async function upgradeHolobotRankAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  holobotName: string,
  tierLabel: string,
): Promise<void> {
  try {
    await upgradeHolobotRankCallable({ holobotName, tierLabel });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildRankUpgradeUpdates(profile, holobotName, tierLabel);
  if (isRankUpgradeRefusal(result)) {
    throw new Error("This Holobot cannot be upgraded right now.");
  }
  await updateProfile(result.updates);
}

export async function useEnergyRefillAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
): Promise<void> {
  try {
    await useEnergyRefillCallable({});
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  if ((profile.energy_refills || 0) <= 0) {
    throw new Error("No Energy Refills available.");
  }
  await updateProfile({
    dailyEnergy: profile.maxDailyEnergy || 100,
    energy_refills: Math.max(0, (profile.energy_refills || 0) - 1),
  });
}

export async function upgradeSyncStatAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  holobotName: string,
  stat: SyncStatKey,
): Promise<void> {
  try {
    await upgradeSyncStatCallable({ holobotName, stat });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = upgradeSyncStat(profile, holobotName, stat);
  await updateProfile({
    holobots: result.profile.holobots,
    syncPoints: result.profile.syncPoints,
  });
}
