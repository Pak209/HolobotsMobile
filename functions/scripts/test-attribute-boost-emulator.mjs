// DECISIONS #53-2 Firestore-emulator tests: the boostHolobotAttribute callable end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-boost-tests';
const { db } = require('../lib/admin.js');
const { boostHolobotAttribute } = require('../lib/progression/boostHolobotAttribute.js');
let serial = 0;
const setup = async (holobots) => { const uid = `boost_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots, holosTokens: 3 }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const boost = (uid, data) => boostHolobotAttribute.run({ auth: uid ? { uid } : undefined, data });
const ace = { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 2, boostedAttributes: { health: 10 }, career: { workouts: 3 } };

test('applies one boost per request id, persists it, and replays without spending', async () => {
  const uid = await setup([ace, { name: 'KUMA', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }]);
  const r = await boost(uid, { holobotName: 'ACE', attribute: 'health', requestId: 'b1' });
  assert.equal(r.applied, true); assert.equal(r.holobot.attributePoints, 1); assert.equal(r.holobot.boostedAttributes.health, 20);
  let u = await user(uid);
  assert.deepEqual(u.holobots[0], r.holobot); assert.deepEqual(u.holobots[0].career, { workouts: 3 }); assert.deepEqual(u.attributeBoostRequestIds, ['b1']); assert.equal(u.holosTokens, 3);
  const again = await boost(uid, { holobotName: 'ACE', attribute: 'health', requestId: 'b1' });
  assert.equal(again.applied, false); assert.equal(again.reason, 'already_processed'); assert.equal(again.holobot.attributePoints, 1);
  assert.deepEqual(await user(uid), u, 'a replay writes nothing');
  const speed = await boost(uid, { holobotName: 'ace', attribute: 'speed', requestId: 'b2' });
  assert.equal(speed.applied, true); assert.equal(speed.holobot.attributePoints, 0); assert.equal(speed.holobot.boostedAttributes.speed, 1);
  const out = await boost(uid, { holobotName: 'ACE', attribute: 'attack', requestId: 'b3' });
  assert.equal(out.applied, false); assert.equal(out.reason, 'no_attribute_points');
  u = await user(uid); assert.deepEqual(u.attributeBoostRequestIds, ['b1', 'b2']); assert.equal(u.holobots[0].attributePoints, 0);
});

test('SPECIAL is refused (tied to SYNC): applied false, nothing written', async () => {
  const uid = await setup([ace]);
  const before = await user(uid);
  const r = await boost(uid, { holobotName: 'ACE', attribute: 'special', requestId: 's1' });
  assert.equal(r.applied, false); assert.equal(r.reason, 'attribute_not_boostable'); assert.equal(r.holobot.attributePoints, 2);
  assert.deepEqual(await user(uid), before);
});

test('rejections: unauthenticated, invalid request, not owned, no profile', async () => {
  await assert.rejects(() => boost(undefined, { holobotName: 'ACE', attribute: 'attack', requestId: 'x' }), e => e.code === 'unauthenticated');
  const uid = await setup([ace]);
  for (const data of [{}, { holobotName: 'ACE', attribute: 'intelligence', requestId: 'x' }, { holobotName: 'ACE', attribute: 'attack', requestId: 'bad id' }, { holobotName: '', attribute: 'attack', requestId: 'x' }]) {
    await assert.rejects(() => boost(uid, data), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request', JSON.stringify(data));
  }
  await assert.rejects(() => boost(uid, { holobotName: 'WOLF', attribute: 'attack', requestId: 'x' }), e => e.code === 'failed-precondition' && e.details.rejectionCode === 'not_owned');
  await assert.rejects(() => boost('nobody_here', { holobotName: 'ACE', attribute: 'attack', requestId: 'x' }), e => e.code === 'not-found');
});

test('concurrent duplicate request ids spend exactly one point', async () => {
  const uid = await setup([{ ...ace, attributePoints: 5 }]);
  const results = await Promise.all(Array.from({ length: 4 }, () => boost(uid, { holobotName: 'ACE', attribute: 'attack', requestId: 'dup' })));
  assert.equal(results.filter(r => r.applied).length, 1);
  const u = await user(uid); assert.equal(u.holobots[0].attributePoints, 4); assert.equal(u.holobots[0].boostedAttributes.attack, 1);
});
