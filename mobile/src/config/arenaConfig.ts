import { getHolobotBattleStats, getHolobotFullImageSource } from "@/config/holobots";
import {
  calculateSyncBattleModifiers,
  getUnlockedSyncAbilities,
} from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";
import type { ArenaBattleConfig, ArenaFighter, BattleRewards } from "@/types/arena";

export type ArenaTier = {
  difficulty: NonNullable<ArenaBattleConfig["difficulty"]>;
  entryFeeHolos: number;
  id: string;
  label: string;
  opponentLevel: number;
  opponentPool: readonly [string, string, string];
  rewardLabel: string;
};

export const ARENA_TIERS: ArenaTier[] = [
  {
    id: "rookie",
    label: "Rookie Circuit",
    difficulty: "easy",
    entryFeeHolos: 50,
    opponentLevel: 12,
    opponentPool: ["HARE", "WAKE", "GAMA"],
    rewardLabel: "Low-risk warmup fights",
  },
  {
    id: "challenger",
    label: "Challenger Ring",
    difficulty: "medium",
    entryFeeHolos: 100,
    opponentLevel: 24,
    opponentPool: ["KUMA", "SHADOW", "TSUIN"],
    rewardLabel: "Balanced rewards and pressure",
  },
  {
    id: "elite",
    label: "Elite Gauntlet",
    difficulty: "hard",
    entryFeeHolos: 150,
    opponentLevel: 36,
    opponentPool: ["TORA", "KEN", "KURAI"],
    rewardLabel: "Harder AI and better payouts",
  },
  {
    id: "legend",
    label: "Legend Arena",
    difficulty: "expert",
    entryFeeHolos: 225,
    opponentLevel: 45,
    opponentPool: ["ACE", "WOLF", "ERA"],
    rewardLabel: "High-risk showcase battle",
  },
];

function clampPositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hashString(value: string) {
  return value.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
}

export function getTierOpponentLineup(tier: ArenaTier, selectedHolobotName: string) {
  const normalizedSelectedName = selectedHolobotName.trim().toUpperCase();
  const poolWithoutMirror = tier.opponentPool.filter((name) => name !== normalizedSelectedName);
  const basePool = (poolWithoutMirror.length >= 3 ? poolWithoutMirror : tier.opponentPool) as string[];
  const offset = hashString(`${tier.id}:${normalizedSelectedName}`) % basePool.length;

  return basePool.map((_, index) => basePool[(index + offset) % basePool.length]);
}

export function getTierOpponentPreview(tier: ArenaTier, selectedHolobotName: string) {
  return getTierOpponentLineup(tier, selectedHolobotName)[0] ?? "KUMA";
}

export function buildPlayerFighter(userId: string, holobot: UserHolobot): ArenaFighter {
  const stats = getHolobotBattleStats(
    holobot.name,
    holobot.level || 1,
    holobot.boostedAttributes,
  );
  const syncModifiers = calculateSyncBattleModifiers(holobot);
  const syncAbilityIds = getUnlockedSyncAbilities(holobot);

  return {
    holobotId: `player-${holobot.name.toLowerCase()}`,
    ownerUserId: userId,
    name: holobot.name.toUpperCase(),
    avatar: getHolobotFullImageSource(holobot.name),
    archetype: stats.archetype,
    level: holobot.level || 1,
    maxHP: clampPositive(stats.maxHP, 150),
    currentHP: clampPositive(stats.maxHP, 150),
    attack: clampPositive(Math.floor(stats.attack * syncModifiers.powerDamageMultiplier), 50),
    defense: clampPositive(Math.floor(stats.defense * syncModifiers.guardDefenseMultiplier), 50),
    speed: clampPositive(Math.floor(stats.speed * syncModifiers.tempoSpeedMultiplier), 50),
    intelligence: clampPositive(Math.floor(stats.intelligence * syncModifiers.focusIntelligenceMultiplier), 50),
    specialMove: holobot.rank ? `${holobot.rank} protocol` : "Arena Burst",
    abilityDescription: `${holobot.name.toUpperCase()} enters battle with a mobile-first Arena loadout.`,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: "fresh",
    isInDefenseMode: false,
    comboCounter: 0,
    lastActionTime: Date.now(),
    statusEffects: [],
    staminaEfficiency: syncModifiers.tempoStaminaMultiplier,
    defenseTimingWindow: Math.round(500 * syncModifiers.guardDefenseMultiplier),
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    hand: [],
    totalDamageDealt: 0,
    perfectDefenses: 0,
    combosCompleted: 0,
    syncAbilities: syncAbilityIds,
    syncModifiers,
  };
}

export function buildOpponentFighter(
  tier: ArenaTier,
  selectedHolobotName: string,
  roundIndex = 0,
): ArenaFighter {
  const opponentName =
    getTierOpponentLineup(tier, selectedHolobotName)[roundIndex] ??
    getTierOpponentPreview(tier, selectedHolobotName);
  const stats = getHolobotBattleStats(opponentName, tier.opponentLevel);

  return {
    holobotId: `opponent-${tier.id}-${opponentName.toLowerCase()}`,
    ownerUserId: "arena-ai",
    name: opponentName,
    avatar: getHolobotFullImageSource(opponentName),
    archetype: stats.archetype,
    level: tier.opponentLevel,
    maxHP: clampPositive(Math.floor(stats.maxHP * 1.05), 160),
    currentHP: clampPositive(Math.floor(stats.maxHP * 1.05), 160),
    attack: clampPositive(Math.floor(stats.attack * 1.04), 54),
    defense: clampPositive(Math.floor(stats.defense * 1.04), 54),
    speed: clampPositive(Math.floor(stats.speed * 1.02), 52),
    intelligence: clampPositive(Math.floor(stats.intelligence * 1.03), 52),
    specialMove: `${tier.label} Finisher`,
    abilityDescription: `${opponentName} is piloted by the ${tier.label} AI.`,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: "fresh",
    isInDefenseMode: false,
    comboCounter: 0,
    lastActionTime: Date.now(),
    statusEffects: [],
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    hand: [],
    totalDamageDealt: 0,
    perfectDefenses: 0,
    combosCompleted: 0,
  };
}

export function getArenaBlueprintAmount(tier: ArenaTier) {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  return [5, 10, 15, 20][Math.max(0, tierIndex)] ?? 5;
}

export function getArenaPotentialRewards(tier: ArenaTier, opponentName?: string): BattleRewards {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  const multiplier = 1 + Math.max(0, tierIndex) * 0.45;

  return {
    exp: Math.floor(95 * multiplier),
    syncPoints: Math.floor(35 * multiplier),
    holos: tier.entryFeeHolos * 2,
    blueprintRewards: opponentName
      ? [
          {
            holobotKey: opponentName.toLowerCase(),
            amount: getArenaBlueprintAmount(tier),
          },
        ]
      : undefined,
  };
}
