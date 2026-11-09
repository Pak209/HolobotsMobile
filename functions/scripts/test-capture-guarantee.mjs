// The harbor Hare cannot refuse while capture_buddy is the pilot's current intro step (Pak, 2026-11-08). In-memory Firestore double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const W = require('../lib/acquisition/wildEncounterStore.js');
const Q = require('../lib/lib/introQuests.js');
const U = require('../lib/lib/buddyUnits.js');
const UID = 'pilot_guarantee', ENC = { hare: 'harbor_hare_001', wolf: 'city_spot_wolf_workshop_1' };
const SEEDS = Array.from({ length: 80 }, (_, i) => (i + 1).toString(16).padStart(2, '0').repeat(32));
const LIGHT = U.BUDDY_UNIT_TIERS.find(t => t.id === 'buddy_light');
const chain = n => ({ schemaVersion: Q.INTRO_QUEST_SCHEMA, currentIndex: n, stepStartedAtMs: 1, rivalWinsAtStepStart: 0,
  claims: Object.fromEntries(Q.INTRO_QUEST_STEPS.slice(0, n).map((s, i) => [s.stepId, { requestId: `q${i}`, claimedAtMs: 1, reward: { ...s.reward } }])) });
const encounter = (holobotId, encounterId) => ({ encounterId, holobotId, affinityTier: 0, affinityMax: 1, captureOpen: true, chanceByAffinity: [0, 0.1], ended: false,
  items: [{ itemId: 'unit', kind: 'buddy_unit', displayName: 'Unit', modelKey: 'unit', remaining: 1, useAllowed: true, affinityGain: 0 }] });
function world(seed, intro, light = 2) {
  const db = fakeDb();
  db.put(`users/${UID}`, { holobots: [], holosTokens: 0, buddyUnits: { light, medium: 0, heavy: 0 } });
  db.put(`wildEncounterSessions/${UID}`, { enabled: true, rollSeed: seed, revision: 1, rosterRevision: 1, entries: [], encounters: [encounter('hare', ENC.hare), encounter('wolf', ENC.wolf)] });
  if (intro !== undefined) db.put(`introQuests/${UID}`, intro);
  return db;
}
const throwAt = (db, encounterId, requestId = 'throw_1') => W.transactWildEncounter(db, UID, { operation: 'capture', intent: { schemaVersion: 'acquisition-2', requestId, encounterId, toyId: 'buddy_light', observedHealth01: 0.5 } });
const CAPTURE_INDEX = Q.INTRO_QUEST_STEPS.findIndex(s => s.stepId === 'capture_buddy');
/** Every seed must follow the ordinary roll, and at least one must refuse, or the check proves nothing. */
async function assertNormalRolls(intro, encounterId) {
  const chance = U.captureChance01(LIGHT, [0, 0.1], 0);
  let refused = 0;
  for (const seed of SEEDS) {
    const r = (await throwAt(world(seed, intro), encounterId)).captureResult;
    assert.equal(r.captured, U.captureRoll01(seed, encounterId, 'throw_1') < chance); assert.equal(r.captureChance01, chance);
    if (!r.captured) refused++;
  }
  assert.ok(refused > 0, 'some seeds must refuse');
}

test('capture_buddy current: the Hare is captured across every seed and the Unit is spent as usual', async () => {
  for (const seed of SEEDS) {
    const db = world(seed, chain(CAPTURE_INDEX));
    const r = (await throwAt(db, ENC.hare)).captureResult;
    assert.equal(r.captured, true); assert.equal(r.outcome, 'captured'); assert.equal(r.buddyUnitsSpent, 1); assert.equal(r.captureChance01, 1);
    assert.equal(db.read(`users/${UID}`).buddyUnits.light, 1);
    assert.deepEqual(db.read(`wildEncounterSessions/${UID}`).entries.find(e => e.holobotId === 'hare').source, 'capture');
  }
});

test('capture_buddy already claimed: the Hare rolls normally', () => assertNormalRolls(chain(CAPTURE_INDEX + 1), ENC.hare));
test('capture_buddy not reached yet, or no intro doc: the Hare rolls normally', async () => { await assertNormalRolls(chain(CAPTURE_INDEX - 1), ENC.hare); await assertNormalRolls(undefined, ENC.hare); });
test('a different Holobot during the step rolls normally', () => assertNormalRolls(chain(CAPTURE_INDEX), ENC.wolf));

test('a malformed intro doc neither guarantees nor blocks a capture', async () => {
  const bad = { ...chain(CAPTURE_INDEX), currentIndex: 2 };
  assert.equal(Q.guaranteedCaptureHolobot(bad), null);
  await assertNormalRolls(bad, ENC.hare);
});

test('no Unit of that tier is still no_buddy_units; the guarantee spends nothing it does not have', async () => {
  const db = world(SEEDS[0], chain(CAPTURE_INDEX), 0);
  assert.equal((await throwAt(db, ENC.hare)).captureResult.outcome, 'no_buddy_units');
  assert.equal(db.read(`users/${UID}`).buddyUnits.light, 0);
});

test('a retried requestId replays its ruling and spends once', async () => {
  const db = world(SEEDS[1], chain(CAPTURE_INDEX));
  const first = (await throwAt(db, ENC.hare)).captureResult, again = (await throwAt(db, ENC.hare)).captureResult;
  assert.deepEqual(again, first); assert.equal(db.read(`users/${UID}`).buddyUnits.light, 1);
});
