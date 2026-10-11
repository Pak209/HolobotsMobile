/**
 * DRAFT, INERT: Error Beast populations for the two locked future zones on the Unity dashboard, `tide_hollow`
 * ("Tide Hollow") and `sky_reach` ("Sky Reach"), both NOT YET AVAILABLE with no scene (HolobotsUnity
 * Assets/HoloCity/Resources/Dashboard/dashboard-preview.json, MOCK labels). PR #67 recorded them as null rows; these are
 * the PRODUCER DEFAULTS (chair / producer lane, 2026-10-11), recorded as data so Pak has numbers to tune. Pak tunes them;
 * nothing here is approved and nothing here is served.
 *
 * Inert by construction, and pinned by functions/scripts/test-holozone-population-drafts.mjs:
 *   - neither zone is in HOLOZONE_ZONE_TIERS (lib/holoZoneRuns.ts), so an issue for either is `unknown_zone`;
 *   - neither zone is in HOLOZONE_POPULATION_TABLE (lib/holoZonePopulation.ts), so no reply carries these rows;
 *   - no runtime module imports this file: only the tests do.
 *
 * Same types as the live table; `draftZonePopulation` derives the holozone-run-2 `population` through the live builder
 * (`populationFromRow`), so a draft has exactly the shape the zone would serve once live. Producer ceiling rule (the
 * Neon Forest rule, 3 + 22 = 25): spawnCount + the sum of timer maxRespawns == MAX_PERFORMANCE_EVENTS (25), so a roster
 * never promises more kills than the settle credits. Beast ids are the four Unity BeastSnapshot ids (`scrapling`,
 * `nullstalker`, `cacheback`, `wyrm`); `root_nexus` stays the Neon Forest's boss. `boss: null` = no boss is named for the
 * zone yet.
 *
 * How a zone goes live (never by importing this module): a separate, scoped PR adds the zone's HOLOZONE_ZONE_TIERS entry
 * AND its HOLOZONE_POPULATION_TABLE row together (the row moved from here, with Pak's tuning), with proof: the coverage
 * test, pinned v1 / v2 replies, and the zone's playable scene.
 *
 * Mirror: Documentation/DRAFTS/2026-10-10-future-zone-populations.json (the test pins that the two agree).
 * Pure module: no firebase imports.
 */
import { HoloZonePopulation, HoloZonePopulationRow, populationFromRow } from "./holoZonePopulation";

/** Zone → tier → roster, producer defaults (2026-10-11). Inert: see the header. */
export const HOLOZONE_POPULATION_DRAFTS: Readonly<Record<string, Readonly<Record<number, HoloZonePopulationRow>>>> = Object.freeze({
  // 5 bodies + 14 + 6 returns = 25.
  tide_hollow: Object.freeze({
    1: {
      beasts: [
        { beastId: "cacheback", count: 3, respawn: { kind: "timer" as const, delaySeconds: 8, maxRespawns: 14 } },
        { beastId: "nullstalker", count: 2, respawn: { kind: "timer" as const, delaySeconds: 12, maxRespawns: 6 } },
      ],
      boss: null,
    },
  }),
  // 5 bodies + 12 + 8 returns = 25.
  sky_reach: Object.freeze({
    2: {
      beasts: [
        { beastId: "nullstalker", count: 3, respawn: { kind: "timer" as const, delaySeconds: 8, maxRespawns: 12 } },
        { beastId: "wyrm", count: 2, respawn: { kind: "timer" as const, delaySeconds: 15, maxRespawns: 8 } },
      ],
      boss: null,
    },
  }),
});

/** The draft population for a zone at a tier (the holozone-run-2 shape), a fresh copy each call, or null when no draft row. */
export function draftZonePopulation(zoneId: string, tier: number): HoloZonePopulation | null {
  if (!Object.prototype.hasOwnProperty.call(HOLOZONE_POPULATION_DRAFTS, zoneId)) return null;
  const rows = HOLOZONE_POPULATION_DRAFTS[zoneId];
  if (!Object.prototype.hasOwnProperty.call(rows, tier)) return null;
  return populationFromRow(zoneId, tier, rows[tier]);
}
