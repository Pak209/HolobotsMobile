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
  /** zone-run-5 signatures (Holocity HANDOFFS/2026-10-23-holozones-signatures.md; DECISIONS #72.75). Host-only rule keys:
   * none of this table is on the wire. One pool per KIND built at issue from the pinned squad (duplicate holders add
   * insurance, never charges). Pilot = forecast + slipstream; the other catalog kinds are designed but not built
   * (`enabled`), so a request for them is refused signature_unknown. Behind the HOLOCITY_ZONE_SIGNATURES flag (default
   * off): with it off nothing below is read and zone-run-5 requests are refused invalid_request. Values PROPOSED. */
  signatures: Object.freeze({
    catalog: Object.freeze({ wolf: 'forecast', era: 'forecast', tsuin: 'forecast', ace: 'slipstream', hare: 'slipstream', shadow: 'slipstream',
      kurai: 'snare', wake: 'snare', tora: 'snare', ken: 'aegis', kuma: 'aegis', gama: 'lockbox' } as const),
    enabled: Object.freeze(['forecast', 'slipstream'] as const),
    charges: Object.freeze({ forecast: 2, slipstream: 1, snare: 2, aegis: 2, lockbox: 1 }),
    /** Same 30 s anti-spam window as utility (PROPOSED); its own anchor so a utility use never blocks a signature. */
    cooldownMs: 30000,
    forecast: Object.freeze({
      openingIntents: 3,
      /** Fixed explicit plan the projection replays (never the player's plan; no per-intent queries). */
      referencePlan: Object.freeze(['strike', 'strike', 'defend'] as const),
      /** Remaining squad HP / squad HP now, reference plan won: >= clean = clean, >= bruised = bruised, else heavy. Lost = wipe_risk. */
      bands: Object.freeze({ clean: 0.85, bruised: 0.6 }),
    }),
    snare: Object.freeze({ holdActions: 1 }),
    aegis: Object.freeze({ absorbHits: 1 }),
    lockbox: Object.freeze({ extraSlots: 1 }),
    /** Where each kind can never act. slipstream: safe rooms, band 3 (no deeper gate), the guardian. snare: the guardian.
     * forecast: a safe sector is never a target. */
    blockedAt: Object.freeze({ slipstream: 'safe|band3|guardian', snare: 'guardian', forecast: 'safe-target' }),
    /** DECISIONS #72.75 (2): ACE / SHADOW / KUMA keep their utility point AND get their signature. Per-point choice: at a
     * sector that carries a utility point, the point and Slipstream are alternatives; the first one the host accepts
     * there is the choice and the other answers effect "none" there (not spent, no cooldown). */
    starterChoice: 'per-point-first-accepted',
  }),
  /** zone-run-4 layout preview copy (Holocity #53); presentation text only, never a ruling. dangerLabels[i] names
   * band i+1 (the band whose WOLF level is bandLevels[i]): PLACE names per Pak DECISIONS #71.3 (2026-10-17), sent
   * verbatim (Unity shows them as-is with the level range beside them). glimpse lines are City-authored (DECISIONS
   * #72.8 P3/P4), keyed by the sector's host role in the daily layout table: entry / gate / cache / rareDiscovery /
   * guardian are Lex packet 2 text (cache and rareDiscovery share one line on purpose: no rare-loot spoiler; the
   * guardian is not named). ace / shadow / kuma are Lex packet 2 too, in the gate / cache / encounter wording of
   * DECISIONS #71.4 (Pak ruled mismatch (i) in #72.10, 2026-10-18): copy only; utility.effects is unchanged. */
  layoutCopy: Object.freeze({
    dangerLabels: Object.freeze(['ROOKIE', 'DEEPWOOD', 'THE CORE'] as const),
    glimpse: Object.freeze({
      entry: 'The beacon hums in the portal clearing.',
      gate: 'A safe room with a beacon. Bring kits for repairs.',
      cache: 'A threat waits along this route.',
      rareDiscovery: 'A threat waits along this route.',
      guardian: 'A heavy signature waits ahead.',
      ace: 'A sealed gate. ACE can open it.',
      shadow: 'A sealed cache. SHADOW can crack it.',
      kuma: 'An encounter ahead. KUMA can clear it.',
    }),
  }),
});

/** HOLOCITY_ZONE_SIGNATURES=pilot-1 turns the zone-run-5 signature pilot on. Anything else (including unset) = off. */
export const ZONE_SIGNATURES_FLAG = 'HOLOCITY_ZONE_SIGNATURES';
export const ZONE_SIGNATURES_ON = 'pilot-1';
export function zoneSignaturesEnabled(): boolean { return process.env[ZONE_SIGNATURES_FLAG] === ZONE_SIGNATURES_ON; }

/** Reuse the existing catalog amounts; this table cannot silently reprice healing. */
export const ZONE_EXPEDITION_HEALING_ITEMS = Object.freeze(HEALING_ITEMS.map(item => Object.freeze({
  itemId: item.id, holos: item.price, healFraction: item.fraction,
  carriedInExpedition: item.id === 'item.repair_kit',
})));

/** Fresh mutable copy for issue-time pinning; callers cannot alter shared defaults. */
export function loadZoneExpeditionDefaults(): ZoneExpeditionTuning {
  return { ...ZONE_EXPEDITION_DEFAULTS, bandLevels: [...ZONE_EXPEDITION_DEFAULTS.bandLevels] };
}
