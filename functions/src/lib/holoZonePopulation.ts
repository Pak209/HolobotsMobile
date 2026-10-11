/**
 * DECISIONS #54 (PLAYABLE FIRST, plan §P1 item 2) + #53 amendment 1: the Error Beast POPULATION of a HoloZone run —
 * the beast roster, how many bodies each beast fields, and the respawn rule — served by holoZoneHost on the issue
 * reply (wire "holozone-run-2", additive over holozone-run-1) BY ZONE AND TIER, instead of Unity's StreamingAssets
 * sample. Unity places the bodies and plays the returns; it never decides a kill, a reward or whether a run succeeds —
 * the settle still rules on the counted kills (clamped to MAX_PERFORMANCE_EVENTS) and the boss flag.
 *
 * Data, not code: Pak tunes the table. Producer defaults (2026-10-10): the Neon Forest at tier 0 fields three
 * Scraplings that return 8 s after a defeat, 22 returns in all, so the most Scrapling kills a run can be credited for
 * (3 + 22 = 25) is exactly the host's credited-kill ceiling; the Root Nexus is the one boss and never returns.
 * (Unity's local fallback, HolobotsUnity 4fefbdfc6 `LocalScraplingPopulation`, is the same rule on one placed body:
 * 8 s, up to 24 returns.)
 *
 * Beast ids are the lowercase stable ids Unity's `BeastSnapshot.beastId` already carries (`scrapling`, `nullstalker`,
 * `cacheback`, `wyrm`); the boss id `root_nexus` names the Root Nexus (RootNexusDirector). Beast STATS (health, attack,
 * break threshold) are NOT served here — they stay on Unity's encounter payload until Pak schedules them.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-holozone-population.mjs).
 */
import { MAX_PERFORMANCE_EVENTS } from "./battleSettlement";
import { HOLOZONE_ZONE_TIERS } from "./holoZoneRuns";

/** A beast's return rule after a defeat. `none` = one life per body. */
export type HoloZoneRespawnRule =
  | { kind: "timer"; /** Seconds after a defeat before the body returns. */ delaySeconds: number; /** Returns in all for this entry over the run (every body together). */ maxRespawns: number }
  | { kind: "none" };

export type HoloZoneBeastSpawn = {
  /** Lowercase stable beast id (Unity BeastSnapshot.beastId). */
  beastId: string;
  /** Bodies fielded at zone entry (>= 1). */
  count: number;
  respawn: HoloZoneRespawnRule;
};

export type HoloZoneBossSpawn = {
  /** Lowercase stable boss id. */
  bossId: string;
  /** Bodies fielded at zone entry (>= 1). */
  count: number;
  respawn: HoloZoneRespawnRule;
};

/** The population as Unity sees it (issue reply `population`, status reply `population` for the open run). */
export type HoloZonePopulation = {
  zoneId: string;
  tier: number;
  beasts: HoloZoneBeastSpawn[];
  /** null = the zone has no boss at this tier. */
  boss: HoloZoneBossSpawn | null;
  /** Bodies fielded at zone entry: the sum of every beast's `count` (the boss not included). */
  spawnCount: number;
  /** The host credits at most this many kills on settle (MAX_PERFORMANCE_EVENTS); the roster never promises more. */
  maxKillsCredited: number;
};

/** The table rows are the roster per (zoneId, tier); spawnCount / maxKillsCredited / zoneId / tier are derived. */
export type HoloZonePopulationRow = { beasts: readonly HoloZoneBeastSpawn[]; boss: HoloZoneBossSpawn | null };

export const HOLOZONE_BEAST_ID = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Zone → tier → roster. Server data (Pak tunes). A zone in HOLOZONE_ZONE_TIERS must have a row for its tier
 * (test-holozone-population.mjs pins it); a (zone, tier) with no row serves `population: null` and the run still issues.
 */
export const HOLOZONE_POPULATION_TABLE: Readonly<Record<string, Readonly<Record<number, HoloZonePopulationRow>>>> = Object.freeze({
  neonforest: Object.freeze({
    0: {
      beasts: [{ beastId: "scrapling", count: 3, respawn: { kind: "timer" as const, delaySeconds: 8, maxRespawns: 22 } }],
      boss: { bossId: "root_nexus", count: 1, respawn: { kind: "none" as const } },
    },
  }),
  // Phase 2 zones go here when they ship (lowercase stable zone id → tier → roster), next to their HOLOZONE_ZONE_TIERS entry.
});

function cloneRule(r: HoloZoneRespawnRule): HoloZoneRespawnRule {
  return r.kind === "timer" ? { kind: "timer", delaySeconds: r.delaySeconds, maxRespawns: r.maxRespawns } : { kind: "none" };
}

/**
 * The holozone-run-2 `population` for one roster row: fresh copies, `spawnCount` / `maxKillsCredited` derived. The one
 * builder: the lookup below serves it, and the inert future-zone drafts (tests only, never imported at runtime) derive
 * through it, so a draft row has exactly the shape the live row would serve.
 */
export function populationFromRow(zoneId: string, tier: number, row: HoloZonePopulationRow): HoloZonePopulation {
  const beasts = row.beasts.map((b) => ({ beastId: b.beastId, count: b.count, respawn: cloneRule(b.respawn) }));
  return {
    zoneId,
    tier,
    beasts,
    boss: row.boss ? { bossId: row.boss.bossId, count: row.boss.count, respawn: cloneRule(row.boss.respawn) } : null,
    spawnCount: beasts.reduce((n, b) => n + b.count, 0),
    maxKillsCredited: MAX_PERFORMANCE_EVENTS,
  };
}

/** The population for a zone at a tier, a fresh copy each call, or null when the table has no row. */
export function holoZonePopulation(zoneId: string, tier: number): HoloZonePopulation | null {
  if (!Object.prototype.hasOwnProperty.call(HOLOZONE_POPULATION_TABLE, zoneId)) return null;
  const rows = HOLOZONE_POPULATION_TABLE[zoneId];
  if (!Object.prototype.hasOwnProperty.call(rows, tier)) return null;
  return populationFromRow(zoneId, tier, rows[tier]);
}

/** Every zone in the tier table has a population row for its tier (the data-integrity rule the test pins). */
export function holoZonePopulationCoverage(): { zoneId: string; tier: number; covered: boolean }[] {
  return Object.entries(HOLOZONE_ZONE_TIERS).map(([zoneId, tier]) => ({ zoneId, tier, covered: holoZonePopulation(zoneId, tier) !== null }));
}

/** Shape rules for a row (ids, counts, delays): true when every entry is well-formed. */
export function validHoloZonePopulationRow(row: HoloZonePopulationRow): boolean {
  const okRule = (r: HoloZoneRespawnRule) =>
    r.kind === "none" || (r.kind === "timer" && Number.isFinite(r.delaySeconds) && r.delaySeconds >= 0 && Number.isSafeInteger(r.maxRespawns) && r.maxRespawns >= 0);
  const okCount = (n: number) => Number.isSafeInteger(n) && n >= 1;
  const ids = row.beasts.map((b) => b.beastId);
  return row.beasts.length >= 1 && new Set(ids).size === ids.length && row.beasts.every((b) => HOLOZONE_BEAST_ID.test(b.beastId) && okCount(b.count) && okRule(b.respawn))
    && (row.boss === null || (HOLOZONE_BEAST_ID.test(row.boss.bossId) && okCount(row.boss.count) && okRule(row.boss.respawn)));
}
