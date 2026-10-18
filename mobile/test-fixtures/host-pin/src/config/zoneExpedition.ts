import { HEALING_ITEMS } from '../lib/repairItems';

export type ZoneExpeditionTuning = {
  version: string;
  energyCapacity: number;
  energyPackUnits: number;
  energyPackPrice: number;
  sectorEnergyCost: number;
  fightEnergyCost: number;
  extractionChargePrice: number;
  bandLevels: [number, number, number];
  cacheFragments: number;
  bulkySalvageUnits: number;
  rareBlueprintChanceBasisPoints: number;
};

/** W17 proposed tuning, awaiting producer review and separate activation approval.
 * Selecting this table is explicit; merely shipping this module enables nothing.
 * No initial energy grant, real-time countdown, guardian or cosmetic data is added.
 */
export const ZONE_EXPEDITION_DEFAULT_SELECTOR = 'defaults-v1';
export const ZONE_EXPEDITION_DEFAULTS = Object.freeze({
  version: 'zone-config-proposed-1',
  energyCapacity: 100,
  energyPackUnits: 50,
  energyPackPrice: 100,
  sectorEnergyCost: 5,
  fightEnergyCost: 10,
  extractionChargePrice: 100,
  bandLevels: Object.freeze([1, 11, 21] as const),
  cacheFragments: 1,
  bulkySalvageUnits: 1,
  rareBlueprintChanceBasisPoints: 1000,
});

/** Existing #61 rules, expressed as reviewable data; no new economy rewards. */
export const ZONE_EXPEDITION_RULES = Object.freeze({
  initialEnergy: 0,
  rollover: Object.freeze({ timeZone: 'UTC', hour: 0, minute: 0, second: 0, existingRuns: 'keep-issued-layout' }),
  protectedSlot: Object.freeze({ count: 1, unit: 'one-existing-haul-stack', onWipe: 'keep-protected-only', ownedAndBankedAtRisk: false }),
  extraction: Object.freeze({ channelMs: 8000, carriedCharges: 1, normalExit: 'beacon', emergencyKeeps: 'small-blueprints',
    emergencyDrops: 'bulky-salvage', unresolvedFight: 'refuse-encounter_pending', chargeConsumedOnRefusal: false }),
  healing: Object.freeze({ location: 'safe-room', stock: 'carried-repair-kit', freeHeal: false }),
  /** zone-run-4 companion utility points (2026-10-17 proposal). The daily layout places the utility; this table says
   * what it does. One use per run+sector; a spent use starts one run-wide host-clock cooldown. cooldownMs is a
   * PROPOSED value awaiting Pak's tuning, like the rest of this table. */
  utility: Object.freeze({
    cooldownMs: 30000,
    oneShot: 'per-run-sector',
    effects: Object.freeze({ ace: 'route', shadow: 'cache', kuma: 'clear' } as const),
    route: 'deeper-band-gate-neighbor-without-sector-clear',
    cache: 'one-unbanked-haul-row-from-private-seed',
    clear: 'sector-encounter-cleared-no-loot',
    noEffect: 'not-spent-no-cooldown',
  }),
  /** zone-run-4 layout preview copy (Holocity #53). PLACEHOLDER strings for Lex/Pak; presentation text only, never a
   * ruling. dangerLabels[i] names band i+1 (the band whose WOLF level is bandLevels[i]); glimpse is keyed by the
   * sector's host role in the daily layout table. */
  layoutCopy: Object.freeze({
    dangerLabels: Object.freeze(['Rookie', 'Veteran', 'Elite'] as const),
    glimpse: Object.freeze({
      entry: 'The portal clearing. The beacon hums behind you.',
      gate: 'A safe room. Beacon online, repairs possible.',
      cache: 'Something glints past the threat.',
      rareDiscovery: 'A rare signal pulses past the threat.',
      guardian: 'A heavy signature waits here.',
      ace: 'A high ledge. ACE could boost across.',
      shadow: 'A sealed hatch. SHADOW could slip inside.',
      kuma: 'A boulder blocks the way. KUMA could move it.',
    }),
  }),
});

/** Reuse the existing catalog amounts; this table cannot silently reprice healing. */
export const ZONE_EXPEDITION_HEALING_ITEMS = Object.freeze(HEALING_ITEMS.map(item => Object.freeze({
  itemId: item.id, holos: item.price, healFraction: item.fraction,
  carriedInExpedition: item.id === 'item.repair_kit',
})));

/** Fresh mutable copy for issue-time pinning; callers cannot alter shared defaults. */
export function loadZoneExpeditionDefaults(): ZoneExpeditionTuning {
  return { ...ZONE_EXPEDITION_DEFAULTS, bandLevels: [...ZONE_EXPEDITION_DEFAULTS.bandLevels] };
}
