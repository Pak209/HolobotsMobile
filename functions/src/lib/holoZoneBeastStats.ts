/**
 * DECISIONS #56 (Pak 2026-10-11): Error Beasts get level, stats, stamina and a rank tier so a player can judge whether
 * to fight or run. Host data (CLAUDE.md rule 1 on the Unity side): Unity SHOWS these on the beast card and its practice
 * sim reads them; it never invents them. Served on the holozone-run-2 `population` reply as an optional `stats` block
 * per beast / boss entry, ONLY while HOLOZONE_BEAST_STATS_ENABLED is true — with the flag off (the default in this PR)
 * every reply is byte-identical to today's holozone-run-2.
 *
 * Producer defaults (2026-10-11, cpu-parity-1): scaled from Unity's current encounter-payload beast numbers; Pak tunes.
 * `rank` uses the Holobot rank names (getHolobotRank) so the CPU aggression table keys beasts and bots the same way.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-holozone-beast-stats.mjs).
 */
import { getHolobotRank } from "./progression";

/** Flip to serve the stats (Pak's approval + deploy). Off = byte-identical holozone-run-2 replies. */
export const HOLOZONE_BEAST_STATS_ENABLED = false;

export type HoloZoneBeastStats = {
  level: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  maxStamina: number;
  /** Stamina per second. */
  staminaRegen: number;
  /** Rank tier label (Rookie … Legendary), derived from level by getHolobotRank. */
  rank: string;
};

type StatsRow = Omit<HoloZoneBeastStats, "rank">;

/** zoneId → tier → beast/boss id → stats. Server data (Pak tunes). */
export const HOLOZONE_BEAST_STATS_TABLE: Readonly<Record<string, Readonly<Record<number, Readonly<Record<string, StatsRow>>>>>> = Object.freeze({
  neonforest: Object.freeze({
    0: Object.freeze({
      scrapling: { level: 3, maxHealth: 120, attack: 18, defense: 8, speed: 12, maxStamina: 60, staminaRegen: 10 },
      root_nexus: { level: 12, maxHealth: 900, attack: 44, defense: 30, speed: 8, maxStamina: 120, staminaRegen: 12 },
    }),
  }),
});

export function holoZoneBeastStats(zoneId: string, tier: number, beastId: string): HoloZoneBeastStats | null {
  if (!Object.prototype.hasOwnProperty.call(HOLOZONE_BEAST_STATS_TABLE, zoneId)) return null;
  const tiers = HOLOZONE_BEAST_STATS_TABLE[zoneId];
  if (!Object.prototype.hasOwnProperty.call(tiers, tier)) return null;
  const rows = tiers[tier];
  if (!Object.prototype.hasOwnProperty.call(rows, beastId)) return null;
  const r = rows[beastId];
  return { level: r.level, maxHealth: r.maxHealth, attack: r.attack, defense: r.defense, speed: r.speed, maxStamina: r.maxStamina, staminaRegen: r.staminaRegen, rank: getHolobotRank(r.level) };
}

export function validBeastStats(s: HoloZoneBeastStats): boolean {
  const pos = (n: number) => Number.isFinite(n) && n > 0;
  const nonneg = (n: number) => Number.isFinite(n) && n >= 0;
  return Number.isSafeInteger(s.level) && s.level >= 1 && pos(s.maxHealth) && nonneg(s.attack) && nonneg(s.defense) && nonneg(s.speed)
    && pos(s.maxStamina) && nonneg(s.staminaRegen) && typeof s.rank === "string" && s.rank.length > 0;
}
