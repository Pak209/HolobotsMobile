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
 * Rules: wildEncounterSessions is default-denied to clients (firestore.rules catch-all); unchanged.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Firestore } from 'firebase-admin/firestore';
import { db } from '../admin';
import { Encounter, HostError, newRollSeed, Session } from '../acquisition/wildEncounterDomain';
import { transactWildEncounter } from '../acquisition/wildEncounterStore';

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
export function validateCityEncounterCommand(raw: unknown): void {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'operation,schemaVersion'
    || r.schemaVersion !== CITY_ENCOUNTER_SCHEMA || r.operation !== 'provision') throw new HostError('invalid_request');
}
/** `seed` is pinned outside the transaction so a retried transaction writes one candidate secret. */
export async function provisionCityEncounter(store: Firestore, uid: string, raw: unknown, seed: string = newRollSeed()) {
  validateCityEncounterCommand(raw);
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
