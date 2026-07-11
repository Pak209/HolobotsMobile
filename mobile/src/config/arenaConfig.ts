import { getAbility } from "@/features/arena/abilities";
import { getSignatureFinisher } from "@/features/arena/moveKits";
import { getHolobotBattleStats, getHolobotFullImageSource } from "@/config/holobots";
import {
  ARENA_TIERS,
  getArenaBaseRewards,
  getArenaBlueprintAmount,
  type ArenaTier,
} from "@/lib/arenaEconomy";
import {
  calculateSyncBattleModifiers,
  getUnlockedSyncAbilities,
} from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";
import type { ArenaFighter, BattleRewards } from "@/types/arena";

export { ARENA_TIERS, getArenaBlueprintAmount };
export type { ArenaTier };

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
    signatureFinisher: getSignatureFinisher(holobot.name),
    ability: getAbility(holobot.name),
    abilityDescription: `${holobot.name.toUpperCase()} enters battle with a mobile-first Arena loadout.`,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: "fresh",
    isInDefenseMode: false,
    defenseCooldownUntil: 0,
    comboCounter: 0,
    lastActionTime: Date.now(),
    statusEffects: [],
    staminaEfficiency: syncModifiers.tempoStaminaMultiplier,
    defenseTimingWindow: Math.round(500 * syncModifiers.guardDefenseMultiplier),
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
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
    signatureFinisher: getSignatureFinisher(opponentName),
    ability: getAbility(opponentName),
    abilityDescription: `${opponentName} is piloted by the ${tier.label} AI.`,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: "fresh",
    isInDefenseMode: false,
    defenseCooldownUntil: 0,
    comboCounter: 0,
    lastActionTime: Date.now(),
    statusEffects: [],
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    totalDamageDealt: 0,
    perfectDefenses: 0,
    combosCompleted: 0,
  };
}

export function getArenaPotentialRewards(tier: ArenaTier, opponentName?: string): BattleRewards {
  const base = getArenaBaseRewards(tier);

  return {
    exp: base.exp,
    syncPoints: base.syncPoints,
    holos: base.holos,
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
