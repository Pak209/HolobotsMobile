import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Loopback emulator required; never production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-zell';
if (!process.env.GCLOUD_PROJECT.startsWith('demo-')) throw new Error('Demo project required');
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { rivalBattleHost } = require('../lib/rival/rivalBattleHost.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const Z = require('../lib/lib/zellStory.js');
const S = 'zell-story-1', V3 = 'rival-battle-3', T = Date.UTC(2026, 9, 10, 15, 0);
let seq = 0;
const setup = async () => { const uid = `zell_${Date.now()}_${seq++}`; await db.doc(`users/${uid}`).set({ holobots: [], buddyUnits: { light: 0, medium: 0, heavy: 0 }, rivalWins: 0 }); return uid; };
const command = (uid, data, now = T, enabled = true) => transactRivalBattle(db, uid, { schemaVersion: V3, storySchema: S, ...data }, now, () => .5, { zellEnabled: enabled });
const story = async uid => (await db.doc(`storyProgress/${uid}`).get()).data();
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const issue = uid => command(uid, { operation: 'issue', rivalId: 'zell' });

test('known-bad control: generic fight does not issue Zell, cannot turn him ally', async () => {
  const uid = await setup(); const i = await command(uid, { operation: 'issue' });
  assert.notEqual(i.encounter.opponentPilot.pilotId, 'zell');
  const s = await command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000);
  assert.equal(s.story.phase, 'unmet'); assert.equal(await story(uid), undefined);
});
test('server feature defaults OFF: Zell issue refuses without writing any battle or story', async () => {
  const uid = await setup(), before = await user(uid);
  const status = await command(uid, { operation: 'status' }, T, false); assert.equal(status.story.enabled, false);
  await assert.rejects(() => command(uid, { operation: 'issue', rivalId: 'zell' }, T, false), /unavailable/);
  await assert.rejects(() => transactRivalBattle(db, uid, { operation: 'issue', schemaVersion: V3, storySchema: S, rivalId: 'zell' }, T), /unavailable/);
  assert.deepEqual(await user(uid), before); assert.equal(await story(uid), undefined);
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 0);
});
test('Zell issue is an existing ladder battle with a host-owned placeholder and persists meeting', async () => {
  const uid = await setup(), i = await issue(uid); assert.equal(i.encounter.opponentPilot.displayName, 'Zell');
  assert.equal(i.encounter.opponentSquad.length, 1); assert.equal(i.encounter.opponentSquad[0].holobotId, 'wolf');
  assert.equal(i.story.phase, 'rival'); assert.equal(i.story.placeholder, true);
  assert.deepEqual(await story(uid), { schemaVersion: S, phase: 'rival', metAtMs: T, allyAtMs: null, victoryBattleId: null });
  const b = (await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).get()).data(); assert.equal(b.storyRivalId, 'zell'); assert.equal(b.storySchema, S);
});
test('loss keeps the story rival, validated win turns ally; repeated issues do not reset ally', async () => {
  const uid = await setup(), i = await issue(uid);
  const l = await command(uid, { operation: 'settle', battleId: i.battleId, didWin: false }, T + 21000); assert.equal(l.story.phase, 'rival');
  const j = await command(uid, { operation: 'issue', rivalId: 'zell' }, T + 22000);
  const w = await command(uid, { operation: 'settle', battleId: j.battleId, didWin: true }, T + 42000);
  assert.equal(w.story.turnedAlly, true); assert.equal(w.buddyUnitsGranted, 1); assert.equal(w.status.rivalWins, 1);
  assert.equal((await story(uid)).victoryBattleId, j.battleId);
  const snapshot = await story(uid); await command(uid, { operation: 'issue', rivalId: 'zell' }, T + 43000); assert.deepEqual(await story(uid), snapshot);
});
test('too-fast, foreign, invented and expired wins cannot advance the flag or pay', async () => {
  const uid = await setup(), foreign = await setup(), i = await issue(uid), before = await story(uid), profile = await user(uid);
  await assert.rejects(() => command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 19999), /too_fast/);
  await assert.rejects(() => command(foreign, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000), /unknown_battle/);
  await assert.rejects(() => command(uid, { operation: 'settle', battleId: 'rb_fake', didWin: true }, T + 20000), /unknown_battle/);
  await assert.rejects(() => command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, i.expiresAtMs + 1), /battle_expired/);
  assert.deepEqual(await story(uid), before); assert.deepEqual(await user(uid), profile); assert.equal(await story(foreign), undefined);
});
test('parallel duplicate wins grant once and never rewrite the first ally transition', async () => {
  const uid = await setup(), i = await issue(uid);
  const rs = await Promise.all(Array.from({ length: 4 }, () => command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000)));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1); assert.ok(rs.every(r => r.story.turnedAlly));
  assert.equal((await user(uid)).rivalWins, 1); const snapshot = await story(uid);
  const r = await command(uid, { operation: 'settle', battleId: i.battleId, didWin: false }, T + 99999); assert.equal(r.didWin, true); assert.deepEqual(await story(uid), snapshot);
});
test('old client settlement still advances the flag while the reply stays old-shaped', async () => {
  const uid = await setup(), i = await issue(uid);
  const r = await transactRivalBattle(db, uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000);
  assert.equal(r.schemaVersion, 'rival-battle-1'); assert.equal('story' in r, false); assert.equal((await story(uid)).phase, 'ally');
});
test('disabling the feature after issue never strands an existing settlement', async () => {
  const uid = await setup(), i = await issue(uid);
  const r = await command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000, false); assert.equal(r.story.turnedAlly, true); assert.equal(r.story.enabled, false);
});
test('requests cannot write a phase; corrupted stored state fails closed without touching balances', async () => {
  const uid = await setup(); const r = await command(uid, { operation: 'status', story: { phase: 'ally' }, phase: 'ally' }); assert.equal(r.story.phase, 'unmet');
  await db.doc(`storyProgress/${uid}`).set({ schemaVersion: S, phase: 'ally' }); const before = await user(uid);
  await assert.rejects(() => command(uid, { operation: 'status' }), /unavailable/);
  await assert.rejects(() => issue(uid), /unavailable/); assert.deepEqual(await user(uid), before);
  const ordinary = await transactRivalBattle(db, uid, { operation: 'status' }); assert.equal('story' in ordinary, false);
});
test('callable auth, malformed version and unknown rival fail before transaction', async () => {
  await assert.rejects(() => rivalBattleHost.run({ data: { operation: 'status', schemaVersion: V3, storySchema: S } }), e => e.code === 'unauthenticated');
  const uid = await setup();
  for (const d of [{ storySchema: 'zell-story-9' }, { rivalId: 'fake' }, { schemaVersion: 'rival-battle-2' }]) await assert.rejects(() => command(uid, { operation: 'issue', rivalId: 'zell', ...d }), /invalid_request/);
  assert.equal(await story(uid), undefined);
});
test('account deletion removes story state and subcollections alongside existing records', async () => {
  const uid = await setup(); await issue(uid); await db.doc(`storyProgress/${uid}/receipts/future`).set({ test: true });
  await deleteUserData(db, uid); assert.equal(await story(uid), undefined); assert.equal((await db.collection(`storyProgress/${uid}/receipts`).get()).size, 0); assert.equal(await user(uid), undefined);
});
