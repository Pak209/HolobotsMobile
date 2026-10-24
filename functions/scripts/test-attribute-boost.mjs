// DECISIONS #53-2 domain tests: boostHolobotAttribute request validation, the boost math,
// typed refusals (SPECIAL tied to SYNC, no points), idempotency per requestId.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../lib/lib/progressionEconomy.js');

const ace = (over = {}) => ({ name: 'ACE', level: 3, experience: 950, nextLevelExp: 1600, rank: 'Starter', attributePoints: 2, boostedAttributes: { attack: 4 }, career: { workouts: 7 }, syncStats: { focus: 9 }, ...over });
const kuma = () => ({ name: 'KUMA', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 1 });
const req = (over = {}) => ({ holobotName: 'ACE', attribute: 'attack', requestId: 'boost_1', ...over });
const profile = (holobots = [ace(), kuma()], extra = {}) => ({ holobots, holosTokens: 5, ...extra });

test('request validation: shape, attribute set, request id, name bounds', () => {
  assert.deepEqual(E.validateAttributeBoostRequest(req()), req());
  assert.deepEqual(E.validateAttributeBoostRequest(req({ holobotName: '  ace ' })), req({ holobotName: 'ace' }));
  for (const attribute of ['attack', 'defense', 'speed', 'health', 'special']) assert.equal(E.validateAttributeBoostRequest(req({ attribute })).attribute, attribute);
  for (const bad of [undefined, null, 'x', [], {}, req({ attribute: 'intelligence' }), req({ attribute: 'hp' }), req({ attribute: 'ATTACK' }), req({ attribute: 1 }),
    req({ requestId: '' }), req({ requestId: 'has space' }), req({ requestId: 'x'.repeat(129) }), req({ requestId: 7 }),
    req({ holobotName: '' }), req({ holobotName: '   ' }), req({ holobotName: 'A'.repeat(65) }), req({ holobotName: 3 })]) {
    assert.equal(E.validateAttributeBoostRequest(bad), null, JSON.stringify(bad));
  }
  assert.equal(E.validateAttributeBoostRequest(req({ requestId: 'x'.repeat(128) })).requestId.length, 128);
});

test('applied boost: +1 attack/defense/speed, +10 HP, one point spent, ledger appended, other bots and extra keys untouched', () => {
  for (const [attribute, key, before, after] of [['attack', 'attack', 4, 5], ['defense', 'defense', undefined, 1], ['speed', 'speed', undefined, 1], ['health', 'health', undefined, 10]]) {
    const p = profile();
    const r = E.buildAttributeBoostRaw(p, req({ attribute }));
    assert.equal(r.reply.applied, true); assert.equal('reason' in r.reply, false);
    assert.equal(r.reply.holobot.attributePoints, 1);
    assert.equal(p.holobots[0].boostedAttributes[key], before, 'input not mutated');
    assert.equal(r.reply.holobot.boostedAttributes[key], after);
    assert.deepEqual(r.updates.holobots[0], r.reply.holobot);
    assert.deepEqual(r.updates.holobots[1], kuma());
    assert.deepEqual(r.reply.holobot.career, { workouts: 7 }); assert.deepEqual(r.reply.holobot.syncStats, { focus: 9 });
    assert.deepEqual(r.updates.attributeBoostRequestIds, ['boost_1']);
    assert.deepEqual(Object.keys(r.updates).sort(), ['attributeBoostRequestIds', 'holobots'], 'writes nothing else');
  }
});

test('names match case-insensitively; an unknown name is not_owned', () => {
  assert.equal(E.buildAttributeBoostRaw(profile(), req({ holobotName: 'kuma' })).reply.holobot.name, 'KUMA');
  assert.equal(E.buildAttributeBoostRaw(profile(), req({ holobotName: 'WOLF' })), 'not_owned');
  assert.equal(E.buildAttributeBoostRaw({}, req()), 'not_owned');
  assert.equal(E.buildAttributeBoostRaw({ holobots: 'junk' }, req()), 'not_owned');
});

test('SPECIAL is refused (tied to SYNC) and writes nothing', () => {
  const r = E.buildAttributeBoostRaw(profile(), req({ attribute: 'special' }));
  assert.deepEqual({ applied: r.reply.applied, reason: r.reply.reason, updates: r.updates }, { applied: false, reason: 'attribute_not_boostable', updates: null });
  assert.equal(r.reply.holobot.attributePoints, 2);
});

test('no attribute points is refused and writes nothing', () => {
  for (const attributePoints of [0, -1]) {
    const r = E.buildAttributeBoostRaw(profile([ace({ attributePoints })]), req());
    assert.equal(r.reply.applied, false); assert.equal(r.reply.reason, 'no_attribute_points'); assert.equal(r.updates, null);
  }
  // A legacy record without attributePoints has `level` points (normalizeUserHolobot), as on mobile.
  const legacy = ace(); delete legacy.attributePoints;
  assert.equal(E.buildAttributeBoostRaw(profile([legacy]), req()).reply.holobot.attributePoints, 2);
});

test('idempotent per requestId: a replay returns the current holobot, applied:false, already_processed, no write', () => {
  const p = profile();
  const first = E.buildAttributeBoostRaw(p, req());
  Object.assign(p, first.updates);
  const replay = E.buildAttributeBoostRaw(p, req());
  assert.deepEqual({ applied: replay.reply.applied, reason: replay.reply.reason, updates: replay.updates }, { applied: false, reason: 'already_processed', updates: null });
  assert.equal(replay.reply.holobot.attributePoints, 1); assert.equal(replay.reply.holobot.boostedAttributes.attack, 5);
  // The same request id replays even for a different attribute or bot (the id is the intent).
  assert.equal(E.buildAttributeBoostRaw(p, req({ attribute: 'speed', holobotName: 'KUMA' })).reply.reason, 'already_processed');
  // A fresh id spends the next point; then the bot is out of points.
  const second = E.buildAttributeBoostRaw(p, req({ requestId: 'boost_2' })); Object.assign(p, second.updates);
  assert.equal(second.reply.applied, true); assert.equal(p.holobots[0].attributePoints, 0); assert.deepEqual(p.attributeBoostRequestIds, ['boost_1', 'boost_2']);
  assert.equal(E.buildAttributeBoostRaw(p, req({ requestId: 'boost_3' })).reply.reason, 'no_attribute_points');
});

test('ledger keeps the last 20 ids and ignores junk entries', () => {
  const p = profile([ace({ attributePoints: 50 })], { attributeBoostRequestIds: [7, null, ...Array.from({ length: 20 }, (_, i) => `old_${i}`)] });
  const r = E.buildAttributeBoostRaw(p, req({ requestId: 'new' }));
  assert.equal(r.updates.attributeBoostRequestIds.length, E.MAX_ATTRIBUTE_BOOST_REQUEST_IDS);
  assert.equal(r.updates.attributeBoostRequestIds.at(-1), 'new'); assert.equal(r.updates.attributeBoostRequestIds[0], 'old_1');
  assert.equal(E.buildAttributeBoostRaw({ ...p, attributeBoostRequestIds: 'junk' }, req()).reply.applied, true);
});
