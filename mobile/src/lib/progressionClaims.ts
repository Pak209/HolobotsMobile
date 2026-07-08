import { computeLeaderboardScore } from "@/lib/progression";
import {
  claimQuestRun,
  claimTrainingSession,
  normalizeProgressionSystem,
  type ActiveQuestRecord,
  type TrainingSessionRecord,
} from "@/lib/progressionSystems";
import { getSyncRank } from "@/lib/syncProgression";
import type { UserProfile } from "@/types/profile";

/**
 * Pure claim builders extracted from the Quests/Training screens so the
 * legacy client path and the server mirror
 * (`functions/src/lib/progressionEconomy.ts`) can be parity-tested.
 * `progressionServerParity.test.ts` enforces the match.
 */

export function buildQuestClaimUpdates(
  profile: UserProfile,
  quest: ActiveQuestRecord,
): Record<string, unknown> {
  const progression = normalizeProgressionSystem(profile.rewardSystem);
  const claimResult = claimQuestRun(
    profile.holobots,
    profile.inventory,
    profile.syncPoints || 0,
    quest,
  );
  const nextRewardSystem = {
    ...progression,
    activeQuests: progression.activeQuests.filter((entry) => entry.id !== quest.id),
  };
  const earnedSyncPoints = Math.max(0, claimResult.syncPoints - (profile.syncPoints || 0));
  const nextLifetimeSyncPoints = (profile.lifetimeSyncPoints || 0) + earnedSyncPoints;
  const nextSeasonSyncPoints = (profile.seasonSyncPoints || 0) + earnedSyncPoints;

  return {
    holobots: claimResult.holobots,
    inventory: claimResult.inventory,
    lifetimeSyncPoints: nextLifetimeSyncPoints,
    leaderboardScore: computeLeaderboardScore({
      holobots: claimResult.holobots,
      prestigeCount: profile.prestigeCount,
      seasonSyncPoints: nextSeasonSyncPoints,
      wins: profile.stats?.wins,
    }),
    rewardSystem: nextRewardSystem,
    seasonSyncPoints: nextSeasonSyncPoints,
    syncRank: getSyncRank(nextLifetimeSyncPoints),
    syncPoints: claimResult.syncPoints,
  };
}

export function buildTrainingClaimUpdates(
  profile: UserProfile,
  training: TrainingSessionRecord,
): Record<string, unknown> {
  const progression = normalizeProgressionSystem(profile.rewardSystem);

  return {
    holobots: claimTrainingSession(profile.holobots, training),
    rewardSystem: {
      ...progression,
      activeTraining: null,
    },
  };
}
