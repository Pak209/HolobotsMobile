// Repeatable HoloCity wild spots (city/cityWildSpots.ts + cityEncounterHost provisionSpot): the Unity table, cycles,
// cooldown, idempotency, KURAI garden unchanged, and the real wildEncounterHost capture flow end to end (in-memory
// Firestore double), including a Mission Board capture posting completed by that capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const W = require('../lib/city/cityWildSpots.js');
const H = require('../lib/city/cityEncounterHost.js');
const Store = require('../lib/acquisition/wildEncounterStore.js');
const MB = require('../lib/missionBoard/missionBoardStore.js');
const M = require('../lib/lib/missionBoard.js');
const Q = require('../lib/lib/introQuests.js');

const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);
const UID = 'spot_pilot';
const SEED = 'ab'.repeat(32);
const user = (extra = {}) => ({ holosTokens: 0, gachaTickets: 0, buddyUnits: { light: 0, medium: 0, heavy: 5 }, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 100 }], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, ...extra });
const spotCmd = (spotId) => ({ schemaVersion: 'city-encounter-1', operation: 'provisionSpot', spotId });
const provision = (db, spotId) => H.provisionCityEncounter(db, UID, spotCmd(spotId), SEED, db.clock.now);
async function capture(db, encounterId, requestId) {
  return Store.transactWildEncounter(db, UID, { operation: 'capture', intent: { schemaVersion: 'acquisition-2', requestId, encounterId, toyId: 'buddy_heavy', observedHealth01: 1 } });
}

test('the Unity table: 11 spots in order, real Holobots, shared-plan districts, valid encounter ids', () => {
  assert.deepEqual(W.CITY_WILD_SPOTS.map(s => s.spotId), ['hare_harbor', 'tora_plaza', 'era_market', 'ken_gardens', 'kuma_transit', 'kurai_missionboard', 'shadow_plazaedge', 'tsuin_arenagate', 'wolf_workshop', 'wake_quay', 'gama_courtside']);
  assert.deepEqual(W.CITY_WILD_SPOTS.map(s => s.holobotId), ['hare', 'tora', 'era', 'ken', 'kuma', 'kurai', 'shadow', 'tsuin', 'wolf', 'wake', 'gama']);
  assert.ok(W.CITY_WILD_SPOTS.every(s => /^D(0[1-9]|10)$/.test(s.districtId)));
  assert.equal(W.spotEncounterId('wake_quay', 3), 'city_spot_wake_quay_3');
  assert.equal(W.spotCycleOf('wake_quay', 'city_spot_wake_quay_3'), 3);
  for (const bad of ['city_spot_wake_quay_0', 'city_spot_wake_quay_', 'city_spot_wake_quay_3x', 'city_spot_hare_harbor_1', 'city_kurai_garden']) assert.equal(W.spotCycleOf('wake_quay', bad), null, bad);
  const e = W.citySpotEncounter(W.cityWildSpot('tora_plaza'), 1);
  assert.equal(e.holobotId, 'tora'); assert.deepEqual(e.chanceByAffinity, [0, 0.35]); assert.equal(e.ended, false);
  assert.equal(W.CITY_SPOT_COOLDOWN_MS, 30 * 60 * 1000);
});

test('provisionSpot (pure): create → no-op while open → cooling after capture → next cycle; malformed fails closed', () => {
  const spot = W.cityWildSpot('wolf_workshop');
  const a = W.provisionSpot(undefined, spot, null, T0, SEED);
  assert.equal(a.create, true); assert.equal(a.encounterId, 'city_spot_wolf_workshop_1'); assert.equal(a.session.rollSeed, SEED);
  const open = W.provisionSpot(a.session, spot, null, T0 + 1, SEED);
  assert.deepEqual([open.session, open.provisioned, open.linked], [null, false, false]);
  const ended = { ...a.session, encounters: [{ ...a.session.encounters[0], ended: true }] };
  assert.equal(W.provisionSpot(ended, spot, null, T0 + 2, SEED), 'unavailable', 'ended without a capture receipt');
  const cooling = W.provisionSpot(ended, spot, T0 + 100, T0 + 100 + W.CITY_SPOT_COOLDOWN_MS - 1, SEED);
  assert.deepEqual([cooling.session, cooling.linked, cooling.readyAtMs], [null, true, T0 + 100 + W.CITY_SPOT_COOLDOWN_MS]);
  const back = W.provisionSpot(ended, spot, T0 + 100, T0 + 100 + W.CITY_SPOT_COOLDOWN_MS, SEED);
  assert.equal(back.provisioned, true); assert.equal(back.encounterId, 'city_spot_wolf_workshop_2');
  assert.deepEqual(back.session.encounters.map(e => e.encounterId), ['city_spot_wolf_workshop_2'], 'one encounter per spot');
  assert.equal(back.session.revision, a.session.revision + 1);
  assert.equal(W.provisionSpot({ ...a.session, enabled: false }, spot, null, T0, SEED), 'unavailable');
});

test('provisionSpot through cityEncounterHost + the real capture flow: idempotent, cooldown after the capture, then it comes back', async () => {
  const db = fakeDb({ now: T0 });
  db.put(`users/${UID}`, user());
  const first = await provision(db, 'wolf_workshop');
  assert.deepEqual([first.schemaVersion, first.spotId, first.holobotId, first.encounterId, first.provisioned, first.linked, first.readyAtMs], ['city-encounter-1', 'wolf_workshop', 'wolf', 'city_spot_wolf_workshop_1', true, false, null]);
  assert.ok(first.wild.encounters.some(e => e.encounterId === 'city_spot_wolf_workshop_1'));
  const again = await provision(db, 'wolf_workshop');
  assert.equal(again.provisioned, false); assert.equal(db.read(`wildEncounterSessions/${UID}`).revision, 1, 'no write while open');
  // A second spot joins the same session; the Research Garden KURAI still provisions once-only as before.
  assert.equal((await provision(db, 'tora_plaza')).encounterId, 'city_spot_tora_plaza_1');
  const k1 = await H.provisionCityEncounter(db, UID, { schemaVersion: 'city-encounter-1', operation: 'provision' }, SEED);
  assert.equal(k1.encounterId, 'city_kurai_garden'); assert.equal(k1.provisioned, true);
  assert.equal((await H.provisionCityEncounter(db, UID, { schemaVersion: 'city-encounter-1', operation: 'provision' }, SEED)).provisioned, false);
  // Capture through wildEncounterHost's store: the existing rules spend the Unit and project ownership.
  db.clock.now = T0 + 1000;
  const cap = await capture(db, 'city_spot_wolf_workshop_1', 'cap_1');
  assert.equal(cap.captureResult.captured, true); assert.equal(cap.captureResult.holobotId, 'wolf');
  assert.equal(db.read(`users/${UID}`).buddyUnits.heavy, 4);
  db.clock.now = T0 + 1000 + W.CITY_SPOT_COOLDOWN_MS - 1;
  const cooling = await provision(db, 'wolf_workshop');
  assert.deepEqual([cooling.provisioned, cooling.linked, cooling.readyAtMs], [false, true, T0 + 1000 + W.CITY_SPOT_COOLDOWN_MS]);
  db.clock.now = T0 + 1000 + W.CITY_SPOT_COOLDOWN_MS;
  const back = await provision(db, 'wolf_workshop');
  assert.deepEqual([back.provisioned, back.encounterId, back.linked], [true, 'city_spot_wolf_workshop_2', false]);
  const session = db.read(`wildEncounterSessions/${UID}`);
  assert.deepEqual(session.encounters.map(e => e.encounterId).sort(), ['city_kurai_garden', 'city_spot_tora_plaza_1', 'city_spot_wolf_workshop_2']);
  // Capturing an owned Holobot again follows the existing ownership rule (blueprints), not a fork.
  db.clock.now += 10;
  const again2 = await capture(db, 'city_spot_wolf_workshop_2', 'cap_2');
  assert.equal(again2.captureResult.captured, true); assert.equal(again2.captureResult.ownershipOutcome, 'blueprints');
});

test('provisionSpot refusals: unknown spot / extra keys = invalid_request; no profile or a disabled session = unavailable', async () => {
  const db = fakeDb({ now: T0 });
  for (const bad of [spotCmd('nowhere'), { ...spotCmd('wake_quay'), extra: 1 }, { schemaVersion: 'city-encounter-1', operation: 'provisionSpot' }, { schemaVersion: 'city-encounter-1', operation: 'provision', spotId: 'wake_quay' }]) {
    await assert.rejects(H.provisionCityEncounter(db, UID, bad, SEED), e => e.code === 'invalid_request', JSON.stringify(bad));
  }
  await assert.rejects(provision(db, 'wake_quay'), e => e.code === 'unavailable');
  db.put(`users/${UID}`, user());
  db.put(`wildEncounterSessions/${UID}`, { enabled: false, revision: 1, rosterRevision: 0, encounters: [], entries: [] });
  await assert.rejects(provision(db, 'wake_quay'), e => e.code === 'unavailable');
});

test('a Mission Board capture posting at a spot completes from that spot\'s real capture receipt', async () => {
  const db = fakeDb({ now: T0 });
  db.put(`users/${UID}`, user());
  await MB.transactMissionBoard(db, UID, { operation: 'status' }, T0, SEED);
  const board = db.read(`missionBoards/${UID}`);
  let serial = 40, p;
  do p = M.generatePosting(UID, SEED, serial++, [], { citizens: [], captureTargets: ['kuma_transit'] }, T0); while (p.kind !== 'capture');
  assert.equal(p.target, 'kuma_transit'); assert.equal(p.holobotId, 'kuma'); assert.equal(p.districtId, 'D07');
  board.slots[0] = { posting: { ...p, serial: 0 }, refillAtMs: null };
  db.put(`missionBoards/${UID}`, board);
  db.clock.now = T0 + 100;
  await provision(db, 'kuma_transit');
  await assert.rejects(MB.transactMissionBoard(db, UID, { operation: 'claim', postingId: p.postingId, requestId: 'mb1' }, T0 + 150, SEED), e => e.code === 'not_complete');
  db.clock.now = T0 + 200;
  assert.equal((await capture(db, 'city_spot_kuma_transit_1', 'kc1')).captureResult.captured, true);
  const r = await MB.transactMissionBoard(db, UID, { operation: 'claim', postingId: p.postingId, requestId: 'mb1' }, T0 + 300, SEED);
  assert.equal(r.kind, 'capture'); assert.equal(r.granted.holos, 100);
  assert.ok(Q.INTRO_QUEST_STEPS.length > 0);
});
