/**
 * Server-side quest/training claims and sync-stat upgrades.
 *
 * Mirror of the mobile app's pure modules:
 *   - quest/training tables + claim math: `mobile/src/lib/progressionSystems.ts`
 *     and the claim builders in `mobile/src/lib/progressionClaims.ts`
 *   - sync-stat costs/caps/ability unlocks: `mobile/src/lib/syncProgression.ts`
 *
 * `mobile/src/lib/__tests__/progressionServerParity.test.ts` imports this
 * file and fails if the two sides drift.
 *
 * Server-only hardening (deliberate differences from the client path):
 *   - quest SUCCESS IS ROLLED AT CLAIM TIME with server RNG (the legacy
 *     client rolled at start and stored the outcome — trivially forgeable);
 *   - quest rewards come from the definition table, never from the stored
 *     record (inflated stored rewards are ignored);
 *   - the stored holobotPower is clamped before the success roll;
 *   - training stat boosts are clamped to the course's legal range and
 *     restricted to the course's stat(s); training EXP comes from the table.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */

import { applyHolobotExperience, computeLeaderboardScore, getSyncRank, normalizeUserHolobot } from "./progression";

// ---------------------------------------------------------------------------
// Tables (mirrors of QUEST_DEFINITIONS / TRAINING_COURSES economy fields)
// ---------------------------------------------------------------------------

export type QuestId =
  | "forest_patrol"
  | "cave_exploration"
  | "factory_raid"
  | "desert_expedition"
  | "abandoned_fortress";

export type QuestRewardItemKey = "common" | "rare" | "legendary";

export type QuestEconomy = {
  durationMinutes: number;
  energyCost: number;
  id: QuestId;
  recommendedPower: number;
  rewards: { exp: number; itemAmount?: number; itemKey?: QuestRewardItemKey; syncPoints: number };
};

export const QUEST_ECONOMY: QuestEconomy[] = [
  { durationMinutes: 15, energyCost: 10, id: "forest_patrol", recommendedPower: 800, rewards: { exp: 50, syncPoints: 15 } },
  { durationMinutes: 30, energyCost: 15, id: "cave_exploration", recommendedPower: 1500, rewards: { exp: 120, itemAmount: 1, itemKey: "common", syncPoints: 30 } },
  { durationMinutes: 60, energyCost: 20, id: "factory_raid", recommendedPower: 2500, rewards: { exp: 250, itemAmount: 2, itemKey: "rare", syncPoints: 60 } },
  { durationMinutes: 120, energyCost: 25, id: "desert_expedition", recommendedPower: 4000, rewards: { exp: 500, itemAmount: 2, itemKey: "legendary", syncPoints: 100 } },
  { durationMinutes: 240, energyCost: 30, id: "abandoned_fortress", recommendedPower: 6500, rewards: { exp: 1000, itemAmount: 3, itemKey: "legendary", syncPoints: 200 } },
];

export function getQuestEconomy(questId: string): QuestEconomy | null {
  return QUEST_ECONOMY.find((quest) => quest.id === questId) ?? null;
}

export type TrainingCourseId = "attack" | "defense" | "health" | "speed" | "special" | "balanced";

export type TrainingCourseEconomy = {
  durationMinutes: number;
  energyCost: number;
  expReward: number;
  id: TrainingCourseId;
  maxBoost: number;
  minBoost: number;
  /** boostedAttributes keys this course may touch. */
  statKeys: readonly string[];
};

const SINGLE_STAT_KEYS: Record<Exclude<TrainingCourseId, "balanced">, string> = {
  attack: "attack",
  defense: "defense",
  health: "health",
  special: "special",
  speed: "speed",
};

export const TRAINING_ECONOMY: TrainingCourseEconomy[] = [
  { durationMinutes: 30, energyCost: 10, expReward: 70, id: "attack", maxBoost: 18, minBoost: 10, statKeys: ["attack"] },
  { durationMinutes: 30, energyCost: 10, expReward: 70, id: "defense", maxBoost: 18, minBoost: 10, statKeys: ["defense"] },
  { durationMinutes: 30, energyCost: 10, expReward: 70, id: "health", maxBoost: 18, minBoost: 10, statKeys: ["health"] },
  { durationMinutes: 30, energyCost: 10, expReward: 70, id: "speed", maxBoost: 18, minBoost: 10, statKeys: ["speed"] },
  { durationMinutes: 30, energyCost: 10, expReward: 70, id: "special", maxBoost: 18, minBoost: 10, statKeys: ["special"] },
  { durationMinutes: 60, energyCost: 20, expReward: 140, id: "balanced", maxBoost: 8, minBoost: 5, statKeys: ["attack", "defense", "health", "special", "speed"] },
];

export function getTrainingCourseEconomy(courseId: string): TrainingCourseEconomy | null {
  return TRAINING_ECONOMY.find((course) => course.id === courseId) ?? null;
}

// ---------------------------------------------------------------------------
// Quest claim
// ---------------------------------------------------------------------------

export const MAX_CLAIMED_HOLOBOT_POWER = 50000;

/** Mirror of the client's start-time chance formula, evaluated at claim time. */
export function getQuestSuccessChance(holobotPower: number, recommendedPower: number): number {
  const power = Math.min(MAX_CLAIMED_HOLOBOT_POWER, Math.max(0, Number(holobotPower) || 0));
  return Math.max(0.45, Math.min(0.95, power / Math.max(1, recommendedPower)));
}

export type StoredQuestRecord = {
  endsAt?: unknown;
  holobotName?: unknown;
  holobotPower?: unknown;
  id?: unknown;
  questId?: unknown;
};

export type QuestClaimResult = {
  rewards: QuestEconomy["rewards"];
  succeeded: boolean;
  updates: Record<string, unknown>;
};

function upperName(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

/**
 * Applies a quest claim. Success is decided by `roll` (caller supplies
 * server RNG); rewards always come from the quest table.
 */
export function applyQuestClaim(
  userData: Record<string, unknown>,
  record: StoredQuestRecord,
  roll: number,
): QuestClaimResult | null {
  const quest = getQuestEconomy(typeof record.questId === "string" ? record.questId : "");
  if (!quest) {
    return null;
  }

  const succeeded = roll <= getQuestSuccessChance(Number(record.holobotPower || 0), quest.recommendedPower);
  const targetName = upperName(record.holobotName);
  const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];

  const nextHolobots = currentHolobots.map((rawHolobot) => {
    const name = upperName((rawHolobot as { name?: unknown })?.name);
    if (name !== targetName || !succeeded) {
      return rawHolobot;
    }
    return applyHolobotExperience(normalizeUserHolobot(rawHolobot), quest.rewards.exp);
  });

  const nextInventory = { ...((userData.inventory as Record<string, number>) || {}) };
  if (succeeded && quest.rewards.itemKey && quest.rewards.itemAmount) {
    nextInventory[quest.rewards.itemKey] =
      (nextInventory[quest.rewards.itemKey] || 0) + quest.rewards.itemAmount;
  }

  const earnedSyncPoints = succeeded ? quest.rewards.syncPoints : 0;
  const nextSyncPoints = Number(userData.syncPoints || 0) + earnedSyncPoints;
  const nextLifetimeSyncPoints = Number(userData.lifetimeSyncPoints || 0) + earnedSyncPoints;
  const nextSeasonSyncPoints = Number(userData.seasonSyncPoints || 0) + earnedSyncPoints;

  const rawRewardSystem =
    userData.rewardSystem && typeof userData.rewardSystem === "object"
      ? (userData.rewardSystem as Record<string, unknown>)
      : {};
  const activeQuests = Array.isArray(rawRewardSystem.activeQuests) ? rawRewardSystem.activeQuests : [];

  return {
    rewards: quest.rewards,
    succeeded,
    updates: {
      holobots: nextHolobots,
      inventory: nextInventory,
      leaderboardScore: computeLeaderboardScore({
        holobots: nextHolobots,
        prestigeCount: Number(userData.prestigeCount || 0),
        seasonSyncPoints: nextSeasonSyncPoints,
        wins: Number(userData.wins || 0),
      }),
      lifetimeSyncPoints: nextLifetimeSyncPoints,
      rewardSystem: {
        ...rawRewardSystem,
        activeQuests: activeQuests.filter(
          (entry) => (entry as { id?: unknown })?.id !== record.id,
        ),
      },
      seasonSyncPoints: nextSeasonSyncPoints,
      syncPoints: nextSyncPoints,
      syncRank: getSyncRank(nextLifetimeSyncPoints),
    },
  };
}

// ---------------------------------------------------------------------------
// Training claim
// ---------------------------------------------------------------------------

export type StoredTrainingRecord = {
  courseId?: unknown;
  endsAt?: unknown;
  expReward?: unknown;
  holobotName?: unknown;
  statBoosts?: unknown;
};

/**
 * Clamps stored training boosts to the course's legal shape: only the
 * course's stat keys survive, each bounded to [0, maxBoost].
 */
export function clampTrainingBoosts(
  course: TrainingCourseEconomy,
  statBoosts: unknown,
): Record<string, number> {
  const raw = (statBoosts && typeof statBoosts === "object" ? statBoosts : {}) as Record<string, unknown>;
  const clamped: Record<string, number> = {};

  for (const key of course.statKeys) {
    const value = Math.floor(Number(raw[key] || 0));
    clamped[key] = Math.min(course.maxBoost, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  return clamped;
}

export function applyTrainingClaim(
  userData: Record<string, unknown>,
  record: StoredTrainingRecord,
): { updates: Record<string, unknown> } | null {
  const course = getTrainingCourseEconomy(typeof record.courseId === "string" ? record.courseId : "");
  if (!course) {
    return null;
  }

  const boosts = clampTrainingBoosts(course, record.statBoosts);
  const targetName = upperName(record.holobotName);
  const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];

  const nextHolobots = currentHolobots.map((rawHolobot) => {
    const name = upperName((rawHolobot as { name?: unknown })?.name);
    if (name !== targetName) {
      return rawHolobot;
    }

    const normalized = normalizeUserHolobot(rawHolobot);
    const currentBoosts = (normalized.boostedAttributes || {}) as Record<string, number>;
    const nextBoosts = {
      ...currentBoosts,
      attack: Number(currentBoosts.attack || 0) + (boosts.attack || 0),
      defense: Number(currentBoosts.defense || 0) + (boosts.defense || 0),
      health: Number(currentBoosts.health || 0) + (boosts.health || 0),
      special: Number(currentBoosts.special || 0) + (boosts.special || 0),
      speed: Number(currentBoosts.speed || 0) + (boosts.speed || 0),
    };

    return applyHolobotExperience({ ...normalized, boostedAttributes: nextBoosts }, course.expReward);
  });

  const rawRewardSystem =
    userData.rewardSystem && typeof userData.rewardSystem === "object"
      ? (userData.rewardSystem as Record<string, unknown>)
      : {};

  return {
    updates: {
      holobots: nextHolobots,
      rewardSystem: {
        ...rawRewardSystem,
        activeTraining: null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Sync-stat upgrades (mirror of syncProgression.ts)
// ---------------------------------------------------------------------------

export const MAX_SYNC_STAT = 50;
export const MAX_TOTAL_SYNC_INVESTMENT = 120;

export type SyncStatKey = "bond" | "focus" | "guard" | "power" | "tempo";

export const SYNC_STAT_KEYS: SyncStatKey[] = ["bond", "focus", "guard", "power", "tempo"];

export function getSyncStatUpgradeCost(currentValue: number): number {
  const safeValue = Math.max(0, Math.floor(currentValue || 0));

  if (safeValue < 10) return 25;
  if (safeValue < 20) return 50;
  if (safeValue < 30) return 100;
  if (safeValue < 40) return 175;
  return 275;
}

export function normalizeSyncStats(syncStats: unknown): Record<SyncStatKey, number> {
  const raw = (syncStats && typeof syncStats === "object" ? syncStats : {}) as Record<string, unknown>;
  const clamp = (value: unknown) =>
    Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(Number(value) || 0)));

  return {
    bond: clamp(raw.bond),
    focus: clamp(raw.focus),
    guard: clamp(raw.guard),
    power: clamp(raw.power),
    tempo: clamp(raw.tempo),
  };
}

type AbilityRequirement = {
  holobot: string;
  id: string;
  primaryRequired: number;
  primaryStat: SyncStatKey;
  secondaryRequired?: number;
  secondaryStat?: SyncStatKey;
};

/** Mirror of SYNC_ABILITIES requirements (client keeps names/descriptions). */
export const SYNC_ABILITY_REQUIREMENTS: AbilityRequirement[] = [
  { holobot: "ACE", id: "ace_combo_ignition", primaryRequired: 10, primaryStat: "power" },
  { holobot: "ACE", id: "ace_rocket_tempo", primaryRequired: 25, primaryStat: "tempo" },
  { holobot: "ACE", id: "ace_knockout_rhythm", primaryRequired: 40, primaryStat: "power", secondaryRequired: 20, secondaryStat: "focus" },
  { holobot: "KUMA", id: "kuma_iron_fur_protocol", primaryRequired: 10, primaryStat: "guard" },
  { holobot: "KUMA", id: "kuma_bearwall_sync", primaryRequired: 25, primaryStat: "guard" },
  { holobot: "KUMA", id: "kuma_guardian_core", primaryRequired: 40, primaryStat: "guard", secondaryRequired: 20, secondaryStat: "bond" },
  { holobot: "SHADOW", id: "shadow_ghost_step", primaryRequired: 10, primaryStat: "tempo" },
  { holobot: "SHADOW", id: "shadow_silent_counter", primaryRequired: 25, primaryStat: "focus" },
  { holobot: "SHADOW", id: "shadow_vanish_protocol", primaryRequired: 40, primaryStat: "tempo", secondaryRequired: 20, secondaryStat: "focus" },
  { holobot: "ERA", id: "era_chrono_read", primaryRequired: 10, primaryStat: "focus" },
  { holobot: "ERA", id: "era_time_slip", primaryRequired: 25, primaryStat: "tempo" },
  { holobot: "ERA", id: "era_rewind_pulse", primaryRequired: 40, primaryStat: "focus", secondaryRequired: 20, secondaryStat: "bond" },
  { holobot: "HARE", id: "hare_guarded_stance", primaryRequired: 10, primaryStat: "guard" },
  { holobot: "HARE", id: "hare_counter_claw", primaryRequired: 25, primaryStat: "guard" },
  { holobot: "HARE", id: "hare_last_hop_reflex", primaryRequired: 40, primaryStat: "guard", secondaryRequired: 20, secondaryStat: "tempo" },
  { holobot: "TORA", id: "tora_predator_mark", primaryRequired: 10, primaryStat: "power" },
  { holobot: "TORA", id: "tora_stalk_pattern", primaryRequired: 25, primaryStat: "tempo" },
  { holobot: "TORA", id: "tora_pounce_protocol", primaryRequired: 40, primaryStat: "power", secondaryRequired: 20, secondaryStat: "tempo" },
  { holobot: "WAKE", id: "wake_flow_state", primaryRequired: 10, primaryStat: "tempo" },
  { holobot: "WAKE", id: "wake_torrent_shift", primaryRequired: 25, primaryStat: "tempo" },
  { holobot: "WAKE", id: "wake_riptide_loop", primaryRequired: 40, primaryStat: "tempo", secondaryRequired: 20, secondaryStat: "bond" },
  { holobot: "GAMA", id: "gama_spring_guard", primaryRequired: 10, primaryStat: "guard" },
  { holobot: "GAMA", id: "gama_heavy_leap", primaryRequired: 25, primaryStat: "power" },
  { holobot: "GAMA", id: "gama_amphibian_anchor", primaryRequired: 40, primaryStat: "guard", secondaryRequired: 20, secondaryStat: "power" },
  { holobot: "KEN", id: "ken_blade_focus", primaryRequired: 10, primaryStat: "focus" },
  { holobot: "KEN", id: "ken_clean_cut", primaryRequired: 25, primaryStat: "power" },
  { holobot: "KEN", id: "ken_blade_storm", primaryRequired: 40, primaryStat: "focus", secondaryRequired: 20, secondaryStat: "tempo" },
  { holobot: "KURAI", id: "kurai_dark_veil", primaryRequired: 10, primaryStat: "guard" },
  { holobot: "KURAI", id: "kurai_pressure_field", primaryRequired: 25, primaryStat: "focus" },
  { holobot: "KURAI", id: "kurai_void_shell", primaryRequired: 40, primaryStat: "guard", secondaryRequired: 20, secondaryStat: "focus" },
  { holobot: "TSUIN", id: "tsuin_twin_strike", primaryRequired: 10, primaryStat: "tempo" },
  { holobot: "TSUIN", id: "tsuin_linked_rhythm", primaryRequired: 25, primaryStat: "tempo" },
  { holobot: "TSUIN", id: "tsuin_mirror_chain", primaryRequired: 40, primaryStat: "tempo", secondaryRequired: 20, secondaryStat: "power" },
  { holobot: "WOLF", id: "wolf_lunar_howl", primaryRequired: 10, primaryStat: "bond" },
  { holobot: "WOLF", id: "wolf_pack_instinct", primaryRequired: 25, primaryStat: "power" },
  { holobot: "WOLF", id: "wolf_alpha_surge", primaryRequired: 40, primaryStat: "bond", secondaryRequired: 20, secondaryStat: "focus" },
];

export function getUnlockedSyncAbilityIds(
  holobotName: string,
  syncStats: Record<SyncStatKey, number>,
): string[] {
  const name = holobotName.trim().toUpperCase();

  return SYNC_ABILITY_REQUIREMENTS.filter((ability) => ability.holobot === name)
    .filter(
      (ability) =>
        syncStats[ability.primaryStat] >= ability.primaryRequired &&
        (!ability.secondaryStat || syncStats[ability.secondaryStat] >= (ability.secondaryRequired || 0)),
    )
    .map((ability) => ability.id);
}

export type SyncUpgradeResult = {
  cost: number;
  updates: Record<string, unknown>;
};

export type SyncUpgradeRefusal = {
  reason: "insufficient-points" | "stat-maxed" | "total-cap" | "unknown-holobot";
};

/**
 * Mirror of syncProgression.upgradeSyncStat, emitting the exact fields the
 * client persists (holobots + syncPoints).
 */
export function buildSyncStatUpgrade(
  userData: Record<string, unknown>,
  holobotName: string,
  stat: SyncStatKey,
): SyncUpgradeResult | SyncUpgradeRefusal {
  const targetName = holobotName.trim().toUpperCase();
  const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const targetIndex = currentHolobots.findIndex(
    (rawHolobot) => upperName((rawHolobot as { name?: unknown })?.name).trim() === targetName,
  );

  if (targetIndex < 0) {
    return { reason: "unknown-holobot" };
  }

  const target = currentHolobots[targetIndex] as Record<string, unknown>;
  const stats = normalizeSyncStats(target.syncStats);
  const totalInvestment = stats.bond + stats.focus + stats.guard + stats.power + stats.tempo;
  const cost = getSyncStatUpgradeCost(stats[stat]);
  const availableSyncPoints = Math.max(0, Math.floor(Number(userData.syncPoints || 0)));

  if (stats[stat] >= MAX_SYNC_STAT) {
    return { reason: "stat-maxed" };
  }
  if (totalInvestment >= MAX_TOTAL_SYNC_INVESTMENT) {
    return { reason: "total-cap" };
  }
  if (availableSyncPoints < cost) {
    return { reason: "insufficient-points" };
  }

  const nextStats = { ...stats, [stat]: stats[stat] + 1 };
  const nextSyncLevel = nextStats.bond + nextStats.focus + nextStats.guard + nextStats.power + nextStats.tempo;

  const nextHolobots = currentHolobots.map((rawHolobot, index) => {
    if (index !== targetIndex) {
      return rawHolobot;
    }

    return {
      ...(rawHolobot as Record<string, unknown>),
      lifetimeSPInvested: Math.max(0, Number((rawHolobot as { lifetimeSPInvested?: unknown }).lifetimeSPInvested || 0)) + cost,
      syncAbilityUnlocks: getUnlockedSyncAbilityIds(targetName, nextStats),
      syncLevel: nextSyncLevel,
      syncStats: nextStats,
    };
  });

  return {
    cost,
    updates: {
      holobots: nextHolobots,
      syncPoints: Math.max(0, Number(userData.syncPoints || 0) - cost),
    },
  };
}

export function isSyncUpgradeRefusal(
  result: SyncUpgradeResult | SyncUpgradeRefusal,
): result is SyncUpgradeRefusal {
  return (result as SyncUpgradeRefusal).reason !== undefined;
}
