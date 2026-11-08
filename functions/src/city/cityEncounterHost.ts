/**
 * LITE CITY (Pak approved deploy, 2026-11-07): provisions the Research Garden KURAI encounter for the Lite city.
 *
 * Why: wildEncounterHost only captures from an admin-provisioned session (wildEncounterSessions/{uid}); no player
 * callable provisions one, so a Lite city pilot can never meet the Research Garden KURAI on the server. This host does
 * exactly one thing: it puts ONE fixed, server-owned encounter (KURAI in the Research Garden) into the caller's own
 * session, once. Everything after that is the existing contract: the client offers the encounter's affinity item and
 * throws a Buddy Unit through wildEncounterHost (offerToy / capture with its own requestId receipts), the server rolls,
 * spends the Unit and projects ownership (users/{uid}.holobots / travelSquad / blueprints) exactly as for any capture.
 *
 * - Request: {schemaVersion:'city-encounter-1', operation:'provision'}; nothing else is accepted. No amounts, odds or ids
 *   come from the client.
 * - Idempotent: a second call never adds a second encounter, never re-opens an ended (captured) one, never touches an
 *   admin-disabled session, and never rewrites odds already provisioned.
 * - The odds are server data (Pak tunes): affinity 0 → 1 via the one "Pilot Link signal" item; at affinity 1 a Light
 *   Unit's chance is 0.35 + 0.65 = 1 (lib/buddyUnits.ts). Medium/Heavy follow their tier rules.
 * - Reply: the wildEncounterHost refresh presentation plus {encounterId, provisioned, linked}.
 * - Repeatable wild spots (Pak, 2026-11-07): {schemaVersion:'city-encounter-1', operation:'provisionSpot', spotId} puts
 *   one of Unity's 11 wild spots (city/cityWildSpots.ts) into the session the same way; the spot comes back
 *   CITY_SPOT_COOLDOWN_MS after its capture. Reply adds {spotId, holobotId, readyAtMs}. Unknown spot = invalid_request.
 * Rules: wildEncounterSessions is default-denied to clients (firestore.rules catch-all); unchanged.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Firestore, Transaction } from 'firebase-admin/firestore';
import { db } from '../admin';
import { Encounter, HostError, newRollSeed, Session } from '../acquisition/wildEncounterDomain';
import { transactWildEncounter } from '../acquisition/wildEncounterStore';
import { cityWildSpot, currentSpotEncounter, provisionSpot } from './cityWildSpots';

export const CITY_ENCOUNTER_SCHEMA = 'city-encounter-1';
export const CITY_KURAI_ENCOUNTER_ID = 'city_kurai_garden';
export function cityKuraiEncounter(): Encounter {
  return {
    encounterId: CITY_KURAI_ENCOUNTER_ID, holobotId: 'kurai', affinityTier: 0, affinityMax: 1, captureOpen: true,
    chanceByAffinity: [0, 0.65], ended: false,
    items: [
      { itemId: 'city_link_signal', kind: 'affinity_toy', displayName: 'Pilot Link signal', modelKey: 'pilot_link_signal', remaining: 1, useAllowed: true, affinityGain: 1 },
      { itemId: 'city_buddy_unit', kind: 'buddy_unit', displayName: 'Buddy Unit', modelKey: 'buddy_unit', remaining: 1, useAllowed: true, affinityGain: 0 },
    ],
  };
}
export type CityEncounterCommand = { operation: 'provision' } | { operation: 'provisionSpot'; spotId: string };
export function validateCityEncounterCommand(raw: unknown): CityEncounterCommand {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.schemaVersion !== CITY_ENCOUNTER_SCHEMA) throw new HostError('invalid_request');
  const keys = Object.keys(r).sort().join(',');
  if (r.operation === 'provision' && keys === 'operation,schemaVersion') return { operation: 'provision' };
  if (r.operation === 'provisionSpot' && keys === 'operation,schemaVersion,spotId' && typeof r.spotId === 'string' && cityWildSpot(r.spotId)) return { operation: 'provisionSpot', spotId: r.spotId };
  throw new HostError('invalid_request');
}
/** Create time (ms) of the latest captured receipt for `encounterId` in the caller's session, or null. Bounded read. */
export async function lastCaptureAtMs(store: Firestore, tx: Transaction, uid: string, encounterId: string): Promise<number | null> {
  const q = store.collection(`wildEncounterSessions/${uid}/receipts`).where('reply.captureResult.encounterId', '==', encounterId).limit(CITY_RECEIPT_READ_LIMIT);
  let at: number | null = null;
  for (const d of (await tx.get(q)).docs) {
    if ((d.data() as { reply?: { captureResult?: { captured?: unknown } } }).reply?.captureResult?.captured !== true || !d.createTime) continue;
    at = Math.max(at ?? 0, d.createTime.toMillis());
  }
  return at;
}
/** Receipts per encounter read at most (captures + refusals for ONE spot cycle). */
export const CITY_RECEIPT_READ_LIMIT = 50;
/**
 * provisionSpot: the repeatable wild spot's encounter (city/cityWildSpots.ts), idempotent per cycle, back
 * CITY_SPOT_COOLDOWN_MS after its capture. Same reply as `provision` plus {spotId, holobotId, readyAtMs}.
 */
export async function provisionCitySpot(store: Firestore, uid: string, spotId: string, seed: string = newRollSeed(), nowMs: number = Date.now()) {
  const spot = cityWildSpot(spotId);
  if (!spot) throw new HostError('invalid_request');
  const sessionRef = store.doc(`wildEncounterSessions/${uid}`), userRef = store.doc(`users/${uid}`);
  const r = await store.runTransaction(async tx => {
    const session = await tx.get(sessionRef), user = await tx.get(userRef);
    if (!user.exists) throw new HostError('unavailable');
    const s = session.exists ? session.data() as Session : undefined;
    const current = currentSpotEncounter(s, spot.spotId);
    const lastAt = current?.encounter.ended ? await lastCaptureAtMs(store, tx, uid, current.encounter.encounterId) : null;
    const out = provisionSpot(s, spot, lastAt, nowMs, seed);
    if (out === 'unavailable') throw new HostError('unavailable');
    if (out.session && out.create) tx.create(sessionRef, out.session);
    else if (out.session) tx.update(sessionRef, { encounters: out.session.encounters, revision: out.session.revision });
    return out;
  });
  const wild = await transactWildEncounter(store, uid, { operation: 'refresh' });
  return { schemaVersion: CITY_ENCOUNTER_SCHEMA, spotId: spot.spotId, holobotId: spot.holobotId, encounterId: r.encounterId, provisioned: r.provisioned, linked: r.linked, readyAtMs: r.readyAtMs, wild };
}
/** `seed` is pinned outside the transaction so a retried transaction writes one candidate secret. */
export async function provisionCityEncounter(store: Firestore, uid: string, raw: unknown, seed: string = newRollSeed(), nowMs: number = Date.now()) {
  const command = validateCityEncounterCommand(raw);
  if (command.operation === 'provisionSpot') return provisionCitySpot(store, uid, command.spotId, seed, nowMs);
  const sessionRef = store.doc(`wildEncounterSessions/${uid}`), userRef = store.doc(`users/${uid}`);
  const provisioned = await store.runTransaction(async tx => {
    const session = await tx.get(sessionRef), user = await tx.get(userRef);
    if (!user.exists) throw new HostError('unavailable');
    if (!session.exists) {
      const fresh: Session = { enabled: true, rollSeed: seed, revision: 1, rosterRevision: 0, encounters: [cityKuraiEncounter()], entries: [] };
      tx.create(sessionRef, fresh);
      return true;
    }
    const s = session.data() as Session;
    if (s.enabled !== true || !Array.isArray(s.encounters) || !Number.isSafeInteger(s.revision)) throw new HostError('unavailable');
    if (s.encounters.some(e => e?.encounterId === CITY_KURAI_ENCOUNTER_ID)) return false;
    tx.update(sessionRef, { encounters: [...s.encounters, cityKuraiEncounter()], revision: s.revision + 1 });
    return true;
  });
  const wild = await transactWildEncounter(store, uid, { operation: 'refresh' });
  const after = (await sessionRef.get()).data() as Session;
  const encounter = after.encounters.find(e => e.encounterId === CITY_KURAI_ENCOUNTER_ID)!;
  return { schemaVersion: CITY_ENCOUNTER_SCHEMA, encounterId: CITY_KURAI_ENCOUNTER_ID, provisioned, linked: encounter.ended === true, wild };
}
export const cityEncounterHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to meet wild Holobots.');
  try {
    return await provisionCityEncounter(db, uid, request.data);
  } catch (error) {
    if (error instanceof HostError) throw new HttpsError(error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition', error.code, { rejectionCode: error.code });
    throw error;
  }
});
