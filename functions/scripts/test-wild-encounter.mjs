// acquisition-2 domain tests (DECISIONS #44: Buddy Unit tiers, refusals consume, seeded roll).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { execute, validateCommand, replayReceipt, emptySnapshot } = require('../lib/acquisition/wildEncounterDomain.js');
const B = require('../lib/lib/buddyUnits.js');
const SEED = 'ab'.repeat(32);
const inv = (light = 0, medium = 0, heavy = 0) => ({ light, medium, heavy });
const seed = () => ({ enabled:true, rollSeed:SEED, revision:1, rosterRevision:1, entries:[], encounters:[{ encounterId:'hare_001',holobotId:'hare',affinityTier:0,affinityMax:1,captureOpen:true,chanceByAffinity:[0.3,0.65],ended:false,items:[{itemId:'carrot',kind:'affinity_toy',displayName:'Toy',modelKey:'toy',remaining:1,useAllowed:true,affinityGain:1},{itemId:'unit',kind:'buddy_unit',displayName:'Unit',modelKey:'unit',remaining:1,useAllowed:true,affinityGain:0}]}] });
const capture = (requestId = 'request1', toyId = 'buddy_light', health = 0) => ({ operation:'capture',intent:{schemaVersion:'acquisition-2',requestId,encounterId:'hare_001',toyId,observedHealth01:health} });
const toy = (requestId = 'toy1') => ({ operation:'offerToy',intent:{schemaVersion:'capture-world-1',requestId,encounterId:'hare_001',itemId:'carrot'} });
/** First `${prefix}_k` whose seeded roll satisfies `pred` (the session secret is known in tests). */
const rid = (prefix, pred, encounterId = 'hare_001', seedHex = SEED) => { for (let k = 0; ; k++) { const id = `${prefix}_${k}`; if (pred(B.captureRoll01(seedHex, encounterId, id))) return id; } };
const LOW = r => r < 0.05, HIGH = r => r >= 0.95;

test('unprovisioned and disabled sessions fail closed; the #40 refund flag is ignored', () => {
  assert.throws(() => execute(undefined, { operation:'refresh' }, inv(1)), /unavailable/);
  const s = seed(); s.enabled = false; assert.throws(() => execute(s, { operation:'refresh' }, inv(1)), /unavailable/);
  for (const flag of [undefined, true, false]) { const t = seed(); t.returnRefusedUnit = flag; assert.equal(execute(t, { operation:'refresh' }, inv(1)).reply.revision, 1); }
});

test('refresh is stable, mutates nothing and never sends formulas or the roll seed', () => {
  const s = seed(); const a = execute(s, { operation:'refresh' }, inv(1, 2, 3));
  assert.deepEqual(a.reply, execute(s, { operation:'refresh' }, inv(1, 2, 3)).reply); assert.equal(s.revision, 1);
  const json = JSON.stringify(a.reply);
  for (const secret of ['affinityGain', 'rollSeed', 'chanceByAffinity', SEED, 'returnRefusedUnit']) assert.equal(json.includes(secret), false, secret);
  assert.deepEqual(a.reply.buddyUnits, inv(1, 2, 3));
});

test('world items: one per tier with the player count, per-tier chance and useAllowed; toys unchanged', () => {
  const w = execute(seed(), { operation:'refresh' }, inv(2, 0, 1)).reply;
  const items = w.worldStates[0].items;
  assert.deepEqual(items.map(i => i.itemId), ['carrot', 'buddy_light', 'buddy_medium', 'buddy_heavy']);
  assert.deepEqual(items.slice(1).map(i => [i.remaining, i.useAllowed, i.captureChance01]), [[2, true, 0.35], [0, false, 0.65], [1, true, 1]]);
  assert.equal(items[0].captureChance01, 0); assert.equal(items[0].useAllowed, true);
  assert.equal(w.worldStates[0].captureChance01, 0.35, 'top-level chance = Light tier');
  assert.deepEqual(w.encounters[0].allowedToyIds, ['buddy_light', 'buddy_heavy']);
  const closed = seed(); closed.encounters[0].items[1].useAllowed = false;
  const c = execute(closed, { operation:'refresh' }, inv(2, 2, 2)).reply;
  assert.deepEqual(c.encounters[0].allowedToyIds, []); assert.ok(c.worldStates[0].items.filter(i => i.kind === 'buddy_unit').every(i => !i.useAllowed));
  assert.throws(() => execute(closed, capture(), inv(2, 2, 2)), /not_allowed/);
});

test('affinity formula: base at affinity 0, encounter lift added for Light/Medium, Heavy always 1, clamped to 1', () => {
  const [L, M, H] = B.BUDDY_UNIT_TIERS;
  assert.deepEqual(B.BUDDY_UNIT_TIERS.map(t => [t.id, t.baseChance01, t.affinityApplies]), [['buddy_light', 0.35, true], ['buddy_medium', 0.65, true], ['buddy_heavy', 1, false]]);
  assert.equal(B.AFFINITY_LIFT_SCALE, 1);
  assert.equal(B.captureChance01(L, [0.3, 0.65], 0), 0.35); assert.equal(B.captureChance01(L, [0.3, 0.65], 1), 0.7);
  assert.equal(B.captureChance01(M, [0.3, 0.65], 0), 0.65); assert.equal(B.captureChance01(M, [0.3, 0.65], 1), 1);
  assert.equal(B.captureChance01(M, [0.1, 0.2, 0.3], 2), 0.85);
  assert.equal(B.captureChance01(H, [0, 0], 0), 1); assert.equal(B.captureChance01(H, [0.9, 0.1], 1), 1);
  assert.equal(B.captureChance01(L, [0.9, 0.1], 1), 0.35, 'a falling curve never lowers the tier base');
  for (let a = 0; a <= 4; a++) for (const t of B.BUDDY_UNIT_TIERS) { const c = B.captureChance01(t, [0, 0.2, 0.5, 0.9, 1], a); assert.ok(c >= t.baseChance01 && c <= 1); }
  const s = seed(); const t = execute(s, toy(), inv(1)).reply;
  assert.equal(t.worldStates[0].captureChance01, 0.7); assert.deepEqual(t.worldStates[0].items.slice(1).map(i => i.captureChance01), [0.7, 1, 1]);
});

test('toy spends once, raises the chance, exhaustion denied', () => {
  const a = execute(seed(), toy(), inv(1));
  assert.equal(a.reply.worldStates[0].items[0].remaining, 0); assert.equal(a.session.revision, 2);
  assert.throws(() => execute(a.session, toy('toy2'), inv(1)), /not_allowed/);
});

test('refusal CONSUMES the tier (no retryGuaranteed); the encounter stays; a capture withdraws it', () => {
  const no = rid('no', HIGH);
  const a = execute(seed(), capture(no), inv(2));
  const cr = a.reply.captureResult;
  assert.equal(cr.outcome, 'refused'); assert.equal(cr.captured, false); assert.equal(cr.retryGuaranteed, false);
  assert.equal(cr.buddyUnitsSpent, 1); assert.equal(cr.toyConsumedId, 'buddy_light'); assert.equal(cr.buddyUnitTier, 'buddy_light');
  assert.equal(cr.rolled, true); assert.ok(cr.roll >= cr.captureChance01); assert.equal(cr.captureChance01, 0.35);
  assert.deepEqual(a.unitsAfter, inv(1)); assert.deepEqual(a.reply.buddyUnits, inv(1)); assert.equal(a.reply.encounters.length, 1);
  assert.equal(a.reply.worldStates[0].reaction, 'refused');
  const yes = rid('yes', LOW);
  const b = execute(a.session, capture(yes), inv(1));
  assert.equal(b.reply.captureResult.outcome, 'captured'); assert.equal(b.reply.captureResult.retryGuaranteed, false); assert.deepEqual(b.unitsAfter, inv(0));
  assert.deepEqual(b.reply.withdrawnEncounterIds, ['hare_001']); assert.equal(b.reply.roster.entries[0].source, 'capture'); assert.equal(b.reply.encounters.length, 0);
  assert.throws(() => execute(b.session, capture('later'), inv(3)), /not_allowed/);
});

test('per-tier spend: each tier spends only itself, on capture and on refusal', () => {
  for (const [tierId, key] of [['buddy_light', 'light'], ['buddy_medium', 'medium'], ['buddy_heavy', 'heavy']]) {
    const start = inv(3, 3, 3);
    const yes = execute(seed(), capture(rid(`y_${key}`, LOW), tierId), start);
    assert.equal(yes.reply.captureResult.outcome, 'captured'); assert.equal(yes.reply.captureResult.buddyUnitTier, tierId);
    assert.deepEqual(yes.unitsAfter, { ...start, [key]: 2 });
    if (key !== 'heavy') {
      const no = execute(seed(), capture(rid(`n_${key}`, HIGH), tierId), start);
      assert.equal(no.reply.captureResult.outcome, 'refused'); assert.deepEqual(no.unitsAfter, { ...start, [key]: 2 });
    }
  }
});

test('no_buddy_units per tier: names the tier, mutates nothing, reveals no roll', () => {
  for (const [tierId, key] of [['buddy_light', 'light'], ['buddy_medium', 'medium'], ['buddy_heavy', 'heavy']]) {
    const s = seed(); const before = structuredClone(s);
    const units = { ...inv(4, 4, 4), [key]: 0 };
    const r = execute(s, capture('try', tierId), units);
    const cr = r.reply.captureResult;
    assert.equal(cr.outcome, 'no_buddy_units'); assert.equal(cr.buddyUnitTier, tierId); assert.equal(cr.captured, false);
    assert.equal(cr.buddyUnitsSpent, 0); assert.equal(cr.toyConsumedId, ''); assert.equal(cr.retryGuaranteed, false);
    assert.equal(cr.rolled, false); assert.equal(cr.roll, 0);
    assert.deepEqual(r.unitsAfter, units); assert.deepEqual(r.session, before); assert.deepEqual(s, before); assert.equal(r.reply.revision, before.revision);
  }
});

test('Heavy is always captured (1000 seeded rolls, any affinity, falling curve)', () => {
  const s = seed(); s.encounters[0].chanceByAffinity = [1, 0];
  for (let k = 0; k < 1000; k++) {
    const r = execute(s, capture(`h_${k}`, 'buddy_heavy'), inv(0, 0, 1)).reply.captureResult;
    assert.equal(r.outcome, 'captured'); assert.equal(r.captureChance01, 1);
  }
});

test('Light / Medium odds are statistically right over 20000 seeded rolls each (±4σ)', () => {
  const N = 20000;
  for (const [tierId, affinity, expected] of [['buddy_light', 0, 0.35], ['buddy_light', 1, 0.7], ['buddy_medium', 0, 0.65]]) {
    const s = seed(); s.encounters[0].affinityTier = affinity;
    let hits = 0;
    for (let k = 0; k < N; k++) {
      const r = execute(s, capture(`stat_${tierId}_${affinity}_${k}`, tierId), inv(1, 1, 1)).reply.captureResult;
      assert.equal(r.captureChance01, expected); assert.equal(r.captured, r.roll < expected);
      hits += r.captured ? 1 : 0;
    }
    const sigma = Math.sqrt(expected * (1 - expected) / N);
    assert.ok(Math.abs(hits / N - expected) < 4 * sigma, `${tierId}@${affinity}: ${hits / N} vs ${expected}`);
  }
  // Rolls are uniform: 10 equal buckets each within ±4σ.
  const buckets = Array(10).fill(0);
  for (let k = 0; k < N; k++) buckets[Math.floor(B.captureRoll01(SEED, 'hare_001', `u_${k}`) * 10)]++;
  for (const b of buckets) assert.ok(Math.abs(b / N - 0.1) < 4 * Math.sqrt(0.09 / N), String(buckets));
});

test('roll is deterministic per (session seed, encounter, requestId) and secret-dependent', () => {
  const a = B.captureRoll01(SEED, 'hare_001', 'r1');
  assert.equal(B.captureRoll01(SEED, 'hare_001', 'r1'), a); assert.ok(a >= 0 && a < 1);
  assert.notEqual(B.captureRoll01('cd'.repeat(32), 'hare_001', 'r1'), a);
  assert.notEqual(B.captureRoll01(SEED, 'hare_002', 'r1'), a); assert.notEqual(B.captureRoll01(SEED, 'hare_001', 'r2'), a);
  const x = execute(seed(), capture('same'), inv(1)).reply.captureResult, y = execute(seed(), capture('same'), inv(1)).reply.captureResult;
  assert.deepEqual(x, y);
  // The tier does not change the roll, only the chance it is compared with.
  assert.equal(execute(seed(), capture('same', 'buddy_medium'), inv(0, 1)).reply.captureResult.roll, x.roll);
  const noSeed = seed(); delete noSeed.rollSeed; assert.throws(() => execute(noSeed, capture(), inv(1)), /unavailable/);
  assert.equal(execute(noSeed, capture('n', 'buddy_light'), inv(0)).reply.captureResult.outcome, 'no_buddy_units', 'no seed needed when nothing is rolled');
  for (const bad of ['', 'xyz', 'AB'.repeat(32), 'ab'.repeat(31), 7]) { const s = seed(); s.rollSeed = bad; assert.throws(() => execute(s, { operation:'refresh' }, inv(1)), /unavailable/); }
  assert.throws(() => B.captureRoll01('nope', 'e', 'r'), RangeError);
});

test('client health never affects capture; owned session records are preserved', () => {
  assert.deepEqual(execute(seed(), capture('h', 'buddy_light', 0), inv(1)).reply, execute(seed(), capture('h', 'buddy_light', 1), inv(1)).reply);
  const s = seed(); s.entries = [{ holobotId:'hare', availability:'owned', source:'story', copies:1 }];
  const r = execute(s, capture('own', 'buddy_heavy'), inv(0, 0, 1)); assert.deepEqual(r.session.entries, s.entries); assert.deepEqual(r.unitsAfter, inv(0));
});

test('forged ids, schema, tiers and numbers denied; acquisition-1 and the old item id are rejected', () => {
  for (const x of [NaN, Infinity, -1, 2]) assert.throws(() => validateCommand(capture('r', 'buddy_light', x)), /invalid_request/);
  for (const t of ['unit', 'light', 'buddy_ultra', 'BUDDY_LIGHT', '', null, 7]) assert.throws(() => validateCommand(capture('r', t)), /invalid_request/);
  const old = capture(); old.intent.schemaVersion = 'acquisition-1'; assert.throws(() => validateCommand(old), /invalid_request/);
  assert.throws(() => execute(seed(), { operation:'worldState', encounterId:'other' }, inv(1)), /not_allowed/);
  const s = seed(); s.encounters[0].chanceByAffinity = [2, 3]; assert.throws(() => execute(s, capture(), inv(1)), /unavailable/);
  for (const bad of [inv(-1), { light: 1, medium: 0 }, { light: 1.5, medium: 0, heavy: 0 }, 1, null]) assert.throws(() => execute(seed(), { operation:'refresh' }, bad), /unavailable/);
});

test('receipt replay preserves ruling; changed body conflicts', () => {
  const reply = execute(seed(), capture(), inv(1)).reply;
  assert.equal(replayReceipt({ digest:'same', reply }, 'same'), reply);
  assert.throws(() => replayReceipt({ digest:'old', reply }, 'changed'), /sequence_conflict/);
  assert.equal(replayReceipt(undefined, 'new'), undefined);
});

test('world presentation contracts reject zero affinity range and repeated item kinds', () => {
  const zero = seed(); zero.encounters[0].affinityMax = 0; zero.encounters[0].chanceByAffinity = [.3]; assert.throws(() => execute(zero, { operation:'refresh' }, inv(1)), /unavailable/);
  const duplicate = seed(); duplicate.encounters[0].items.push({ ...duplicate.encounters[0].items[0], itemId:'other' }); assert.throws(() => execute(duplicate, { operation:'refresh' }, inv(1)), /unavailable/);
  assert.equal(execute(seed(), capture(rid('w', HIGH)), inv(1)).reply.worldStates[0].requestId, '');
});

test('wire bot IDs reject uppercase and hyphens before mutation', () => {
  for (const id of ['HARE', 'bad-bot', '1hare', '_hare', '', undefined, null, 'a'.repeat(129)]) { const s = seed(); s.encounters[0].holobotId = id; assert.throws(() => execute(s, { operation:'refresh' }, inv(1)), /unavailable/); }
});

test('squad IDs and int32 revision bounds fail closed without rewriting profile', () => {
  const { readTravelSquad, projectCapture } = require('../lib/acquisition/captureOwnership.js');
  for (const bad of ['1hare', '_hare', 'bad-bot']) { const p = { holobots:[{ name:bad }], travelSquad:{ schemaVersion:'travel-squad-1', revision:0, holobotIds:[bad] } }; assert.throws(() => readTravelSquad(p), /unavailable/); assert.throws(() => projectCapture({ holobots:[] }, bad), /unavailable/); }
  const p = { holobots:[], travelSquad:{ schemaVersion:'travel-squad-1', revision:2147483647, holobotIds:[] } };
  assert.equal(readTravelSquad(p).revision, 2147483647); assert.throws(() => projectCapture(p, 'hare'), /unavailable/); assert.deepEqual(p.travelSquad.holobotIds, []);
  p.travelSquad.revision = 2147483648; assert.throws(() => readTravelSquad(p), /unavailable/);
});

test('empty snapshot for an unprovisioned pilot carries the tier map and no encounters', () => {
  const e = emptySnapshot(inv(1));
  assert.deepEqual(e, { travelSquad:{ schemaVersion:'travel-squad-1', revision:0, holobotIds:[] }, buddyUnits:inv(1), revision:0, encounters:[], worldStates:[], withdrawnEncounterIds:[], roster:{ schemaVersion:'acquisition-2', revision:0, entries:[] } });
  assert.throws(() => emptySnapshot(1), /unavailable/);
});

test('inventory read: missing → starter Light (once), #43 integer → Light migration, tier map as-is, malformed fails closed', () => {
  const { readPlayerUnits } = require('../lib/acquisition/wildEncounterStore.js');
  assert.deepEqual(B.readBuddyInventory({}), { units: inv(1), updates: { buddyUnits: inv(1) }, migration: 'starter' });
  assert.deepEqual(B.readBuddyInventory({ buddyUnits: 4 }), { units: inv(4), updates: { buddyUnits: inv(4) }, migration: 'integer' });
  assert.deepEqual(B.readBuddyInventory({ buddyUnits: 0 }), { units: inv(0), updates: { buddyUnits: inv(0) }, migration: 'integer' }, 'a spent #43 pilot never gets the starter again');
  assert.deepEqual(B.readBuddyInventory({ buddyUnits: inv(1, 2, 3) }), { units: inv(1, 2, 3), updates: {}, migration: '' });
  // Idempotent: applying the migration once leaves nothing to write.
  const p = { buddyUnits: 7 }; Object.assign(p, B.readBuddyInventory(p).updates); assert.deepEqual(B.readBuddyInventory(p).updates, {}); assert.deepEqual(p.buddyUnits, inv(7));
  for (const bad of [-1, 1.5, '1', null, [], {}, { light: 1 }, { light: 1, medium: 0 }, { ...inv(1), extra: 0 }, { light: -1, medium: 0, heavy: 0 }, { light: '1', medium: 0, heavy: 0 }]) {
    assert.equal(B.readBuddyInventory({ buddyUnits: bad }), null, JSON.stringify(bad));
    assert.throws(() => readPlayerUnits({ buddyUnits: bad }), /unavailable/);
  }
  assert.deepEqual(readPlayerUnits({ buddyUnits: 2 }), { units: inv(2), inventoryUpdates: { buddyUnits: inv(2) } });
  assert.equal(B.totalBuddyUnits(inv(1, 2, 3)), 6);
  assert.throws(() => B.withTierDelta(inv(0), 'medium', -1), RangeError);
});
