/**
 * Repeatable HoloCity wild spots (Pak, 2026-11-07): Unity's 11 wild Holobot spots
 * (HolobotsUnity Assets/HoloCity/Data/WildHolobotTable_HoloCity.asset, rows at 77c0c020d) as server-owned city
 * encounters. cityEncounterHost `provisionSpot{spotId}` puts the spot's encounter into the caller's own
 * wildEncounterSessions/{uid} on demand; everything after that is the existing wildEncounterHost capture flow
 * (offerToy / capture, requestId receipts, ownership projection). Nothing here rolls, spends or grants.
 *
 * Cycles: a spot's encounter id is `city_spot_<spotId>_<cycle>`. While the current cycle is not ended, provisioning
 * is a no-op. Once it has ended (captured / linked), the spot comes back CITY_SPOT_COOLDOWN_MS after that capture's
 * receipt (its Firestore create time): the next provision replaces the ended encounter with cycle + 1, so the
 * session keeps one encounter per spot. A capture of a Holobot the pilot already owns pays blueprints, exactly as
 * any capture does (captureOwnership.projectCapture).
 *
 * The Research Garden KURAI (city_kurai_garden, `provision`) is separate and stays once-only.
 *
 * Pure module: no firebase imports.
 */
import type { Encounter, Session } from '../acquisition/wildEncounterDomain';
import { cityDistrictAt, CityDistrictId } from '../lib/cityDistricts';

/** A spot comes back this long after its capture (one constant; producer default, Pak tunes). */
export const CITY_SPOT_COOLDOWN_MS = 30 * 60 * 1000;
/** Odds (server data): affinity 0 → 1 via the Pilot Link signal; at affinity 1 a Light Unit's chance is 0.35 + 0.35. */
export const CITY_SPOT_CHANCE_BY_AFFINITY: readonly number[] = [0, 0.35];

export type CityWildSpot = { spotId: string; holobotId: string; unityDistrict: string; x: number; z: number; districtId: CityDistrictId };
const row = (spotId: string, holobotId: string, unityDistrict: string, x: number, z: number): CityWildSpot => ({ spotId, holobotId, unityDistrict, x, z, districtId: cityDistrictAt(x, z) });

/** The Unity table's rows, in table order (rowId, holobotId, district label, position x / z). */
export const CITY_WILD_SPOTS: readonly CityWildSpot[] = Object.freeze([
  row('hare_harbor', 'hare', 'harbor', 12, -150),
  row('tora_plaza', 'tora', 'plaza', 0, 22),
  row('era_market', 'era', 'market', 91.3, -60),
  row('ken_gardens', 'ken', 'gardens', 126, 80),
  row('kuma_transit', 'kuma', 'transit hall', 6, 100),
  row('kurai_missionboard', 'kurai', 'mission board', -61.8, -83.8),
  row('shadow_plazaedge', 'shadow', 'plaza edge', -57.1, 25),
  row('tsuin_arenagate', 'tsuin', 'arena gate', -109.8, 74.2),
  row('wolf_workshop', 'wolf', 'workshop', -124, 0),
  row('wake_quay', 'wake', 'harbor quay', -12, -160),
  row('gama_courtside', 'gama', 'holoball court', -72, -138),
]);

export function cityWildSpot(spotId: string): CityWildSpot | undefined {
  return CITY_WILD_SPOTS.find((s) => s.spotId === spotId);
}

export const CITY_SPOT_PREFIX = 'city_spot_';
export const spotEncounterId = (spotId: string, cycle: number) => `${CITY_SPOT_PREFIX}${spotId}_${cycle}`;
/** The cycle of `encounterId` if it is one of `spotId`'s encounters, else null. */
export function spotCycleOf(spotId: string, encounterId: string): number | null {
  const prefix = `${CITY_SPOT_PREFIX}${spotId}_`;
  if (!encounterId.startsWith(prefix)) return null;
  const rest = encounterId.slice(prefix.length);
  return /^[1-9][0-9]{0,8}$/.test(rest) ? Number(rest) : null;
}

export function citySpotEncounter(spot: CityWildSpot, cycle: number): Encounter {
  return {
    encounterId: spotEncounterId(spot.spotId, cycle), holobotId: spot.holobotId, affinityTier: 0, affinityMax: 1, captureOpen: true,
    chanceByAffinity: [...CITY_SPOT_CHANCE_BY_AFFINITY], ended: false,
    items: [
      { itemId: 'city_link_signal', kind: 'affinity_toy', displayName: 'Pilot Link signal', modelKey: 'pilot_link_signal', remaining: 1, useAllowed: true, affinityGain: 1 },
      { itemId: 'city_buddy_unit', kind: 'buddy_unit', displayName: 'Buddy Unit', modelKey: 'buddy_unit', remaining: 1, useAllowed: true, affinityGain: 0 },
    ],
  };
}

/** The spot's encounter currently in the session (at most one is kept), or null. */
export function currentSpotEncounter(session: Pick<Session, 'encounters'> | undefined, spotId: string): { encounter: Encounter; cycle: number } | null {
  for (const e of session?.encounters ?? []) {
    const cycle = e && typeof e.encounterId === 'string' ? spotCycleOf(spotId, e.encounterId) : null;
    if (cycle !== null) return { encounter: e, cycle };
  }
  return null;
}

export type SpotProvision = {
  /** The session to write (null = nothing changes); `create` = the session doc does not exist yet. */
  session: Session | null; create: boolean;
  encounterId: string; provisioned: boolean;
  /** The current cycle ended (captured / linked) and is still cooling down. */
  linked: boolean; readyAtMs: number | null;
};

/**
 * `lastCaptureAtMs`: the create time of the captured receipt for the CURRENT cycle's encounter (the store reads it
 * only when that encounter has ended); null when none was found. An ended encounter without a capture receipt is
 * inconsistent data: `unavailable` (the caller throws).
 */
export function provisionSpot(session: Session | undefined, spot: CityWildSpot, lastCaptureAtMs: number | null, nowMs: number, seed: string): SpotProvision | 'unavailable' {
  if (!session) {
    const encounter = citySpotEncounter(spot, 1);
    return { session: { enabled: true, rollSeed: seed, revision: 1, rosterRevision: 0, encounters: [encounter], entries: [] }, create: true, encounterId: encounter.encounterId, provisioned: true, linked: false, readyAtMs: null };
  }
  if (session.enabled !== true || !Array.isArray(session.encounters) || !Number.isSafeInteger(session.revision)) return 'unavailable';
  const current = currentSpotEncounter(session, spot.spotId);
  if (current && !current.encounter.ended) return { session: null, create: false, encounterId: current.encounter.encounterId, provisioned: false, linked: false, readyAtMs: null };
  if (current) {
    if (lastCaptureAtMs === null) return 'unavailable';
    const readyAtMs = lastCaptureAtMs + CITY_SPOT_COOLDOWN_MS;
    if (nowMs < readyAtMs) return { session: null, create: false, encounterId: current.encounter.encounterId, provisioned: false, linked: true, readyAtMs };
  }
  const encounter = citySpotEncounter(spot, current ? current.cycle + 1 : 1);
  const encounters = session.encounters.filter((e) => e !== current?.encounter);
  return { session: { ...session, encounters: [...encounters, encounter], revision: session.revision + 1 }, create: false, encounterId: encounter.encounterId, provisioned: true, linked: false, readyAtMs: null };
}
