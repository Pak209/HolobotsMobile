/**
 * rival-scaling-1 (owner 2026-11-13, "Scale rivals to you"): a live CPU rival is built at issue time as a same-level Holobot trained
 * like the player, and the CPU rank decides how dangerous it is. Data only: the issued fight pins both fighters' numbers (and the
 * pair's hpScaleLights), so the brain, the core and every rules id are untouched and an older phone build replays a scaled fight
 * exactly like any other issue.
 *
 * Why (Lite practice QA, 2026-11-12): rivals were fixed stat curves (tier WOLF at level 1 + 4t, Arena / wild at a set level) with no
 * boosts, while the player brings attribute boosts, parts and live-move ranks. The fight's HP scale (hpScaleLights: the pair's mean
 * clean lights to KO) then left a trained player's rival about one light of HP: fights ended in 1-3 s and stamina never mattered.
 *
 * The rule, per CPU fighter i (paired with the player's fighter i, or the lead):
 *  1. base = the rival's own #72.80 fight row at the PLAYER's level (the formula a progression combatant of that level gets); a
 *     beast keeps the stats its host built (already scaled to the fighter's level);
 *  2. + the player's training = max(0, the player fighter's final pinned number - its own unboosted fight row at its level) per stat
 *     (attribute boosts, parts, SYNC modifiers, live-move ranks, all as issued), minus `exclude` (the court beast's host already adds
 *     the fighter's parts);
 *  3. then the rank preset (RIVAL_SCALE_PRESETS): max HP x hpPm, attack x atkPm, and the pair's hpScaleLights = lights.
 * Behind HOLOCITY_RIVAL_SCALING (default off). Scope (owner 2026-11-13): town rivals (incl. the onboarding mentor and story Zell, at
 * Rookie), Arena, Guild Court, wild duels (the wild level still sets the EXP) and HoloZone expedition fights. PvP challengers (real
 * players' Holobots) are never scaled. A CPU that comes in hurt keeps its HP fraction.
 * Presets were tuned with scripts/bench-rival-scaling.mjs (the server copy of the Lite practice simulator).
 */
import { HOLOBOT_FIGHT_BASE_STATS_72_80 } from './fightBalance';

export const RIVAL_SCALING_FLAG = 'HOLOCITY_RIVAL_SCALING';
export function rivalScalingEnabled(env: Record<string, string | undefined> = process.env): boolean { return env[RIVAL_SCALING_FLAG] === '1'; }

export type RivalScalePreset = { lights: number; hpPm: number; atkPm: number };
/** By the issued CPU rank (sim/fight/profiles RANKS, case-insensitive). Tune here. */
export const RIVAL_SCALE_PRESETS: Readonly<Record<string, RivalScalePreset>> = Object.freeze({
  rookie: { lights: 22, hpPm: 1000, atkPm: 850 },
  starter: { lights: 23, hpPm: 1000, atkPm: 1000 },
  champion: { lights: 25, hpPm: 1000, atkPm: 1300 },
  rare: { lights: 26, hpPm: 1000, atkPm: 1550 },
  elite: { lights: 27, hpPm: 1000, atkPm: 3700 },
  legendary: { lights: 28, hpPm: 1000, atkPm: 4300 },
});
export function rivalScalePreset(rank: string): RivalScalePreset {
  return RIVAL_SCALE_PRESETS[String(rank).toLowerCase()] ?? RIVAL_SCALE_PRESETS.champion;
}

export type FightStatLine = { maxHealth: number; attack: number; defense: number; speed: number; special: number };

/** A Holobot's unboosted #72.80 fight-row battle stats at `level` (getHolobotBattleStats' formula on the fight rows). Null for a bot
 * with no row (a beast). */
export function fightRowStats(holobotId: string, level: number): FightStatLine | null {
  const row = HOLOBOT_FIGHT_BASE_STATS_72_80[String(holobotId || '').trim().toUpperCase()];
  if (!row) return null;
  const lb = 1 + (Math.max(1, Math.floor(level) || 1) - 1) * 0.05;
  return { maxHealth: Math.floor(row.hp * lb), attack: Math.floor(row.attack * 10 * lb), defense: Math.floor(row.defense * 10 * lb),
    speed: Math.floor(row.speed * 10 * lb), special: Math.floor(row.intelligence * 10 * lb) };
}

const KEYS: (keyof FightStatLine)[] = ['maxHealth', 'attack', 'defense', 'speed', 'special'];

/** The player's training over its own unboosted row (never negative), minus `exclude`. Zeros for a bot with no row. */
export function playerTraining(player: { holobotId: string; level: number } & FightStatLine, exclude: Partial<FightStatLine> = {}): FightStatLine {
  const row = fightRowStats(player.holobotId, player.level);
  const out = { maxHealth: 0, attack: 0, defense: 0, speed: 0, special: 0 };
  if (!row) return out;
  for (const k of KEYS) out[k] = Math.max(0, Math.floor(player[k] - row[k] - Math.max(0, exclude[k] ?? 0)));
  return out;
}

/** One CPU fighter's scaled numbers (rule steps 1-3). `beastBase`: the host-built stats of a fighter with no fight row. */
export function scaledRivalStats(rivalId: string, playerLevel: number, training: FightStatLine, rank: string, beastBase?: FightStatLine): FightStatLine | null {
  const base = fightRowStats(rivalId, playerLevel) ?? beastBase ?? null;
  if (!base) return null;
  const p = rivalScalePreset(rank);
  const s = { ...base };
  for (const k of KEYS) s[k] = base[k] + training[k];
  s.maxHealth = Math.max(1, Math.round(s.maxHealth * p.hpPm / 1000));
  s.attack = Math.max(1, Math.round(s.attack * p.atkPm / 1000));
  return s;
}
