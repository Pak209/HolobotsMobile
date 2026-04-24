import type { SyncRank, SyncStats, UserHolobot, UserProfile } from "@/types/profile";

export const MAX_SYNC_STAT = 50;
export const MAX_TOTAL_SYNC_INVESTMENT = 120;

export type SyncStatKey = keyof SyncStats;
export type SyncStat = SyncStatKey;

export type SyncBattleModifiers = {
  bondExpRewardMultiplier: number;
  focusIntelligenceMultiplier: number;
  focusSpecialMeterMultiplier: number;
  guardDefenseMultiplier: number;
  powerDamageMultiplier: number;
  tempoSpeedMultiplier: number;
  tempoStaminaMultiplier: number;
};

export type SyncAbility = {
  description: string;
  effectType:
    | "damage_bonus"
    | "block_bonus"
    | "meter_gain"
    | "stamina_gain"
    | "stamina_discount"
    | "counter_bonus"
    | "survive_lethal"
    | "dodge_bonus"
    | "hp_restore"
    | "finisher_resist"
    | "combo_bonus"
    | "exp_bonus"
    | "enemy_meter_debuff";
  holobot: string;
  id: string;
  name: string;
  oncePerBattle?: boolean;
  primaryRequired: number;
  primaryStat: SyncStat;
  secondaryRequired?: number;
  secondaryStat?: SyncStat;
  tier: 1 | 2 | 3;
  value: number;
};

const DEFAULT_SYNC_STATS: Required<SyncStats> = {
  bond: 0,
  focus: 0,
  guard: 0,
  power: 0,
  tempo: 0,
};

const SYNC_RANK_THRESHOLDS: Array<{ min: number; rank: SyncRank }> = [
  { min: 50000, rank: "Legend" },
  { min: 25000, rank: "Champion" },
  { min: 12000, rank: "Strider" },
  { min: 5000, rank: "Pilot" },
  { min: 1000, rank: "Walker" },
  { min: 0, rank: "Rookie" },
];

export const SYNC_ABILITIES: SyncAbility[] = [
  { id: "ace_combo_ignition", holobot: "ACE", name: "Combo Ignition", tier: 1, primaryStat: "power", primaryRequired: 10, description: "Consecutive hits gain +3% damage, stacking up to 5 times.", effectType: "combo_bonus", value: 0.03 },
  { id: "ace_rocket_tempo", holobot: "ACE", name: "Rocket Tempo", tier: 2, primaryStat: "tempo", primaryRequired: 25, description: "After stamina fully recovers, next Strike costs 1 less stamina.", effectType: "stamina_discount", value: 1, oncePerBattle: true },
  { id: "ace_knockout_rhythm", holobot: "ACE", name: "Knockout Rhythm", tier: 3, primaryStat: "power", primaryRequired: 40, secondaryStat: "focus", secondaryRequired: 20, description: "Finisher deals +15% damage if used after a Combo card.", effectType: "damage_bonus", value: 0.15 },
  { id: "kuma_iron_fur_protocol", holobot: "KUMA", name: "Iron Fur Protocol", tier: 1, primaryStat: "guard", primaryRequired: 10, description: "First Block each battle reduces damage by an extra 20%.", effectType: "block_bonus", value: 0.2, oncePerBattle: true },
  { id: "kuma_bearwall_sync", holobot: "KUMA", name: "Bearwall Sync", tier: 2, primaryStat: "guard", primaryRequired: 25, description: "Perfect Blocks grant +8 Special Meter.", effectType: "meter_gain", value: 8 },
  { id: "kuma_guardian_core", holobot: "KUMA", name: "Guardian Core", tier: 3, primaryStat: "guard", primaryRequired: 40, secondaryStat: "bond", secondaryRequired: 20, description: "Once per battle, survive lethal damage with 1 HP.", effectType: "survive_lethal", value: 1, oncePerBattle: true },
  { id: "shadow_ghost_step", holobot: "SHADOW", name: "Ghost Step", tier: 1, primaryStat: "tempo", primaryRequired: 10, description: "First incoming Strike each battle has increased miss/dodge chance.", effectType: "dodge_bonus", value: 0.12, oncePerBattle: true },
  { id: "shadow_silent_counter", holobot: "SHADOW", name: "Silent Counter", tier: 2, primaryStat: "focus", primaryRequired: 25, description: "After a successful defense, next Strike gains +10% crit chance.", effectType: "counter_bonus", value: 0.1 },
  { id: "shadow_vanish_protocol", holobot: "SHADOW", name: "Vanish Protocol", tier: 3, primaryStat: "tempo", primaryRequired: 40, secondaryStat: "focus", secondaryRequired: 20, description: "Once per battle, avoid lethal damage if stamina is above 50%.", effectType: "survive_lethal", value: 1, oncePerBattle: true },
  { id: "era_chrono_read", holobot: "ERA", name: "Chrono Read", tier: 1, primaryStat: "focus", primaryRequired: 10, description: "Start battle with +10 Special Meter.", effectType: "meter_gain", value: 10, oncePerBattle: true },
  { id: "era_time_slip", holobot: "ERA", name: "Time Slip", tier: 2, primaryStat: "tempo", primaryRequired: 25, description: "Once per battle, recover +2 stamina after dropping to exhausted.", effectType: "stamina_gain", value: 2, oncePerBattle: true },
  { id: "era_rewind_pulse", holobot: "ERA", name: "Rewind Pulse", tier: 3, primaryStat: "focus", primaryRequired: 40, secondaryStat: "bond", secondaryRequired: 20, description: "Once per battle, restore 10% max HP after taking a heavy Combo or Finisher.", effectType: "hp_restore", value: 0.1, oncePerBattle: true },
  { id: "hare_guarded_stance", holobot: "HARE", name: "Guarded Stance", tier: 1, primaryStat: "guard", primaryRequired: 10, description: "Entering Defense grants +1 extra stamina once per battle.", effectType: "stamina_gain", value: 1, oncePerBattle: true },
  { id: "hare_counter_claw", holobot: "HARE", name: "Counter Claw", tier: 2, primaryStat: "guard", primaryRequired: 25, description: "Counter damage bonus increases by +15%.", effectType: "counter_bonus", value: 0.15 },
  { id: "hare_last_hop_reflex", holobot: "HARE", name: "Last-Hop Reflex", tier: 3, primaryStat: "guard", primaryRequired: 40, secondaryStat: "tempo", secondaryRequired: 20, description: "When below 30% HP, Defense cards gain a higher perfect-defense chance.", effectType: "dodge_bonus", value: 0.1 },
  { id: "tora_predator_mark", holobot: "TORA", name: "Predator Mark", tier: 1, primaryStat: "power", primaryRequired: 10, description: "First successful Strike applies Mark; next hit deals +8% damage.", effectType: "damage_bonus", value: 0.08, oncePerBattle: true },
  { id: "tora_stalk_pattern", holobot: "TORA", name: "Stalk Pattern", tier: 2, primaryStat: "tempo", primaryRequired: 25, description: "After recovering stamina, next Strike gains +1 Special Meter.", effectType: "meter_gain", value: 1 },
  { id: "tora_pounce_protocol", holobot: "TORA", name: "Pounce Protocol", tier: 3, primaryStat: "power", primaryRequired: 40, secondaryStat: "tempo", secondaryRequired: 20, description: "First Combo against a gassed or exhausted enemy deals +20% damage.", effectType: "damage_bonus", value: 0.2, oncePerBattle: true },
  { id: "wake_flow_state", holobot: "WAKE", name: "Flow State", tier: 1, primaryStat: "tempo", primaryRequired: 10, description: "Stamina recovery is slightly faster while above 50% HP.", effectType: "stamina_gain", value: 0.08 },
  { id: "wake_torrent_shift", holobot: "WAKE", name: "Torrent Shift", tier: 2, primaryStat: "tempo", primaryRequired: 25, description: "After playing a Defense card, next Strike gains +5 Special Meter on hit.", effectType: "meter_gain", value: 5 },
  { id: "wake_riptide_loop", holobot: "WAKE", name: "Riptide Loop", tier: 3, primaryStat: "tempo", primaryRequired: 40, secondaryStat: "bond", secondaryRequired: 20, description: "Once per battle, completing a Combo restores +3 stamina.", effectType: "stamina_gain", value: 3, oncePerBattle: true },
  { id: "gama_spring_guard", holobot: "GAMA", name: "Spring Guard", tier: 1, primaryStat: "guard", primaryRequired: 10, description: "Blocking while fresh grants +1 extra Special Meter.", effectType: "meter_gain", value: 1 },
  { id: "gama_heavy_leap", holobot: "GAMA", name: "Heavy Leap", tier: 2, primaryStat: "power", primaryRequired: 25, description: "First Combo after a Defense card deals +10% damage.", effectType: "damage_bonus", value: 0.1, oncePerBattle: true },
  { id: "gama_amphibian_anchor", holobot: "GAMA", name: "Amphibian Anchor", tier: 3, primaryStat: "guard", primaryRequired: 40, secondaryStat: "power", secondaryRequired: 20, description: "Once per battle, reduce incoming Combo damage by 35%.", effectType: "block_bonus", value: 0.35, oncePerBattle: true },
  { id: "ken_blade_focus", holobot: "KEN", name: "Blade Focus", tier: 1, primaryStat: "focus", primaryRequired: 10, description: "Strike cards gain +3% damage when Special Meter is above 50.", effectType: "damage_bonus", value: 0.03 },
  { id: "ken_clean_cut", holobot: "KEN", name: "Clean Cut", tier: 2, primaryStat: "power", primaryRequired: 25, description: "First hit after a Perfect Defense deals +12% damage.", effectType: "damage_bonus", value: 0.12 },
  { id: "ken_blade_storm", holobot: "KEN", name: "Blade Storm", tier: 3, primaryStat: "focus", primaryRequired: 40, secondaryStat: "tempo", secondaryRequired: 20, description: "Combo cards generate +50% more Special Meter.", effectType: "meter_gain", value: 0.5 },
  { id: "kurai_dark_veil", holobot: "KURAI", name: "Dark Veil", tier: 1, primaryStat: "guard", primaryRequired: 10, description: "First incoming hit each battle deals 10% less damage.", effectType: "block_bonus", value: 0.1, oncePerBattle: true },
  { id: "kurai_pressure_field", holobot: "KURAI", name: "Pressure Field", tier: 2, primaryStat: "focus", primaryRequired: 25, description: "After KURAI Blocks, enemy gains reduced Special Meter on next action.", effectType: "enemy_meter_debuff", value: 1 },
  { id: "kurai_void_shell", holobot: "KURAI", name: "Void Shell", tier: 3, primaryStat: "guard", primaryRequired: 40, secondaryStat: "focus", secondaryRequired: 20, description: "Once per battle, reduce Finisher damage by 40%.", effectType: "finisher_resist", value: 0.4, oncePerBattle: true },
  { id: "tsuin_twin_strike", holobot: "TSUIN", name: "Twin Strike", tier: 1, primaryStat: "tempo", primaryRequired: 10, description: "Every third successful Strike grants +1 Combo Counter.", effectType: "combo_bonus", value: 1 },
  { id: "tsuin_linked_rhythm", holobot: "TSUIN", name: "Linked Rhythm", tier: 2, primaryStat: "tempo", primaryRequired: 25, description: "Combo cards cost 1 less stamina once per battle.", effectType: "stamina_discount", value: 1, oncePerBattle: true },
  { id: "tsuin_mirror_chain", holobot: "TSUIN", name: "Mirror Chain", tier: 3, primaryStat: "tempo", primaryRequired: 40, secondaryStat: "power", secondaryRequired: 20, description: "If TSUIN lands two hits in a row, next Combo gains +15% damage.", effectType: "damage_bonus", value: 0.15 },
  { id: "wolf_lunar_howl", holobot: "WOLF", name: "Lunar Howl", tier: 1, primaryStat: "bond", primaryRequired: 10, description: "Start battle with +5 Special Meter and gain +5% EXP after battle.", effectType: "exp_bonus", value: 0.05 },
  { id: "wolf_pack_instinct", holobot: "WOLF", name: "Pack Instinct", tier: 2, primaryStat: "power", primaryRequired: 25, description: "Damage increases by +5% when WOLF is below 50% HP.", effectType: "damage_bonus", value: 0.05 },
  { id: "wolf_alpha_surge", holobot: "WOLF", name: "Alpha Surge", tier: 3, primaryStat: "bond", primaryRequired: 40, secondaryStat: "focus", secondaryRequired: 20, description: "Once per battle, after dropping below 30% HP, gain +15 Special Meter and +1 stamina.", effectType: "meter_gain", value: 15, oncePerBattle: true },
];

export function getSyncRank(lifetimeSyncPoints: number): SyncRank {
  const safeLifetime = Math.max(0, Math.floor(lifetimeSyncPoints || 0));
  return SYNC_RANK_THRESHOLDS.find((entry) => safeLifetime >= entry.min)?.rank || "Rookie";
}

export function normalizeSyncStats(syncStats?: SyncStats): Required<SyncStats> {
  return {
    bond: Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(syncStats?.bond || 0))),
    focus: Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(syncStats?.focus || 0))),
    guard: Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(syncStats?.guard || 0))),
    power: Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(syncStats?.power || 0))),
    tempo: Math.max(0, Math.min(MAX_SYNC_STAT, Math.floor(syncStats?.tempo || 0))),
  };
}

export function getSyncStatUpgradeCost(currentValue: number): number {
  const safeValue = Math.max(0, Math.floor(currentValue || 0));

  if (safeValue < 10) return 25;
  if (safeValue < 20) return 50;
  if (safeValue < 30) return 100;
  if (safeValue < 40) return 175;
  return 275;
}

export function getTotalSyncInvestment(syncStats?: SyncStats): number {
  const normalized = normalizeSyncStats(syncStats);
  return normalized.power + normalized.guard + normalized.tempo + normalized.focus + normalized.bond;
}

export function getUnlockedSyncAbilities(holobot: Pick<UserHolobot, "name" | "syncStats">) {
  const name = holobot.name.trim().toUpperCase();
  const stats = normalizeSyncStats(holobot.syncStats);

  return SYNC_ABILITIES.filter((ability) => ability.holobot === name)
    .filter(
      (ability) =>
        stats[ability.primaryStat] >= ability.primaryRequired &&
        (!ability.secondaryStat || stats[ability.secondaryStat] >= (ability.secondaryRequired || 0)),
    )
    .map((ability) => ability.id);
}

export function getSyncAbilityDefinitions(holobotName: string) {
  return SYNC_ABILITIES.filter((ability) => ability.holobot === holobotName.trim().toUpperCase());
}

export function calculateSyncBattleModifiers(holobot: Pick<UserHolobot, "syncStats">): SyncBattleModifiers {
  const stats = normalizeSyncStats(holobot.syncStats);

  return {
    bondExpRewardMultiplier: 1 + stats.bond * 0.003,
    focusIntelligenceMultiplier: 1 + stats.focus * 0.002,
    focusSpecialMeterMultiplier: 1 + stats.focus * 0.002,
    guardDefenseMultiplier: 1 + stats.guard * 0.0015,
    powerDamageMultiplier: 1 + stats.power * 0.002,
    tempoSpeedMultiplier: 1 + stats.tempo * 0.002,
    tempoStaminaMultiplier: 1 + stats.tempo * 0.002,
  };
}

export function canUpgradeSyncStat(
  profile: Pick<UserProfile, "syncPoints">,
  holobot: Pick<UserHolobot, "syncStats">,
  stat: SyncStatKey,
) {
  const stats = normalizeSyncStats(holobot.syncStats);
  const currentValue = stats[stat];
  const totalInvestment = getTotalSyncInvestment(stats);
  const cost = getSyncStatUpgradeCost(currentValue);
  const availableSyncPoints = Math.max(0, Math.floor(profile.syncPoints || 0));

  if (currentValue >= MAX_SYNC_STAT) {
    return { canUpgrade: false, cost, reason: "This Sync Stat is already maxed." };
  }

  if (totalInvestment >= MAX_TOTAL_SYNC_INVESTMENT) {
    return { canUpgrade: false, cost, reason: "This Holobot has reached the total Sync cap." };
  }

  if (availableSyncPoints < cost) {
    return { canUpgrade: false, cost, reason: `You need ${cost} Sync Points for the next upgrade.` };
  }

  return { canUpgrade: true, cost };
}

export function upgradeSyncStat(
  profile: UserProfile,
  holobotName: string,
  stat: SyncStatKey,
) {
  const targetHolobot = profile.holobots.find(
    (holobot) => holobot.name.trim().toUpperCase() === holobotName.trim().toUpperCase(),
  );

  if (!targetHolobot) {
    throw new Error("Holobot not found.");
  }

  const check = canUpgradeSyncStat(profile, targetHolobot, stat);
  if (!check.canUpgrade) {
    throw new Error(check.reason || "Unable to upgrade this Sync Stat.");
  }

  const nextHolobots = profile.holobots.map((holobot) => {
    if (holobot.name.trim().toUpperCase() !== holobotName.trim().toUpperCase()) {
      return holobot;
    }

    const nextStats = normalizeSyncStats(holobot.syncStats);
    nextStats[stat] += 1;
    const nextSyncLevel = getTotalSyncInvestment(nextStats);

    return {
      ...holobot,
      lifetimeSPInvested: Math.max(0, holobot.lifetimeSPInvested || 0) + check.cost,
      syncAbilityUnlocks: getUnlockedSyncAbilities({
        name: holobot.name,
        syncStats: nextStats,
      }),
      syncLevel: nextSyncLevel,
      syncStats: nextStats,
    };
  });

  const nextLifetimeSyncPoints = Math.max(0, profile.lifetimeSyncPoints || 0);

  return {
    cost: check.cost,
    holobot: nextHolobots.find((holobot) => holobot.name.trim().toUpperCase() === holobotName.trim().toUpperCase())!,
    profile: {
      ...profile,
      holobots: nextHolobots,
      syncPoints: Math.max(0, (profile.syncPoints || 0) - check.cost),
      syncRank: getSyncRank(nextLifetimeSyncPoints),
    },
  };
}

export function getSyncStatLabel(stat: SyncStatKey) {
  switch (stat) {
    case "power":
      return "Power";
    case "guard":
      return "Guard";
    case "tempo":
      return "Tempo";
    case "focus":
      return "Focus";
    case "bond":
      return "Bond";
  }
}

export function getDefaultSyncStats() {
  return { ...DEFAULT_SYNC_STATS };
}
