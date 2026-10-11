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
const L = require('../lib/lib/rivalLadder.js');
const { desktopPracticeCommands } = require('../lib/lib/desktopPracticeCommands.js');
const S = 'zell-story-1', V3 = 'rival-battle-3', T = Date.UTC(2026, 9, 10, 15, 0);
let seq = 0;
const setup = async (rivalWins = 0) => { const uid = `zell_${Date.now()}_${seq++}`; await db.doc(`users/${uid}`).set({ holobots: [], buddyUnits: { light: 0, medium: 0, heavy: 0 }, rivalWins }); return uid; };
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
test('HOLOCITY_ZELL_STORY is read per request by the callable: only "1" serves Zell, at the tier an ordinary issue gets', async () => {
  const uid = await setup(35), data = { operation: 'issue', schemaVersion: V3, storySchema: S, rivalId: 'zell' }, saved = process.env.HOLOCITY_ZELL_STORY;
  const call = d => rivalBattleHost.run({ auth: { uid }, data: d });
  try {
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      if (value === undefined) delete process.env.HOLOCITY_ZELL_STORY; else process.env.HOLOCITY_ZELL_STORY = value;
      await assert.rejects(() => call(data), e => e.code === 'unavailable' && e.details.rejectionCode === 'unavailable', `flag ${JSON.stringify(value)} must stay off`);
    }
    assert.equal(await story(uid), undefined); assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 0);
    process.env.HOLOCITY_ZELL_STORY = '1';
    const zell = await call(data), ordinary = await call({ operation: 'issue', schemaVersion: V3 });
    assert.equal(zell.story.enabled, true); assert.equal(zell.story.phase, 'rival'); assert.equal(zell.encounter.opponentPilot.pilotId, 'zell');
    assert.equal(zell.tier, 3); assert.equal(zell.tier, ordinary.tier); assert.equal(zell.encounter.opponentPilot.tier, ordinary.encounter.opponentPilot.tier);
    assert.deepEqual(zell.encounter.opponentSquad, [{ ...L.rivalScaledCombatant('wolf', 3), ...L.rivalScaledCombatantStats(3), commandRules: desktopPracticeCommands('wolf') }]);
    assert.deepEqual((await db.doc(`rivalBattles/${uid}/battles/${zell.battleId}`).get()).data().lineup.opponentSquad, [L.rivalScaledCombatant('wolf', 3)]);
    delete process.env.HOLOCITY_ZELL_STORY;
    assert.equal((await call({ operation: 'status', schemaVersion: V3, storySchema: S })).story.enabled, false);
    await assert.rejects(() => call(data), e => e.code === 'unavailable');
  } finally { if (saved === undefined) delete process.env.HOLOCITY_ZELL_STORY; else process.env.HOLOCITY_ZELL_STORY = saved; }
});
test('only the first accepted Zell win turns him: forged request fields and a later Zell win never re-turn him', async () => {
  const uid = await setup(), a = await issue(uid);
  const forged = { phase: 'ally', turnedAlly: true, story: { phase: 'ally', turnedAlly: true }, storyRivalId: 'zell', victoryBattleId: a.battleId, allyAtMs: T };
  assert.equal((await command(uid, { operation: 'settle', battleId: a.battleId, didWin: false, ...forged }, T + 21000)).story.phase, 'rival');
  const b = await command(uid, { operation: 'issue', rivalId: 'zell', ...forged }, T + 22000); assert.equal(b.story.phase, 'rival');
  assert.equal((await story(uid)).phase, 'rival');
  assert.equal((await command(uid, { operation: 'settle', battleId: b.battleId, didWin: true, ...forged }, T + 42000)).story.turnedAlly, true);
  const turned = await story(uid); assert.deepEqual(turned, { schemaVersion: S, phase: 'ally', metAtMs: T, allyAtMs: T + 42000, victoryBattleId: b.battleId });
  const c = await command(uid, { operation: 'issue', rivalId: 'zell' }, T + 43000);
  const again = await command(uid, { operation: 'settle', battleId: c.battleId, didWin: true }, T + 63000);
  assert.equal(again.alreadyProcessed, false); assert.equal(again.status.rivalWins, 2); assert.equal(again.story.turnedAlly, true);
  assert.deepEqual(await story(uid), turned);
});
// The emulator can surface a contention abort as INVALID_ARGUMENT "Transaction is invalid or closed" on a transactional
// read (nothing committed; the SDK retries only ABORTED). Re-send that settle, as the Unity client's settle retry would.
const settleRetryingContention = async (uid, data, now) => {
  for (let attempt = 1; ; attempt++) {
    try { return await command(uid, data, now); } catch (e) { if (attempt >= 3 || e?.code !== 3 || !/Transaction is invalid or closed/.test(e?.message ?? '')) throw e; }
  }
};
test('concurrent wins on two different Zell battles turn him once, on the win that committed first', async () => {
  const uid = await setup(), a = await issue(uid), b = await command(uid, { operation: 'issue', rivalId: 'zell' }, T + 1);
  const rs = await Promise.all([a, b].map(i => settleRetryingContention(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 30000)));
  assert.deepEqual(rs.map(r => r.alreadyProcessed), [false, false]); assert.deepEqual(rs.map(r => r.status.rivalWins).sort(), [1, 2]);
  assert.ok(rs.every(r => r.story.turnedAlly)); assert.equal(rs[0].buddyUnitsGranted + rs[1].buddyUnitsGranted, 1);
  const first = rs[0].status.rivalWins === 1 ? a : b;
  assert.deepEqual(await story(uid), { schemaVersion: S, phase: 'ally', metAtMs: T, allyAtMs: T + 30000, victoryBattleId: first.battleId });
  assert.equal((await user(uid)).rivalWins, 2);
});
test('a malformed stored story fails closed on settle too (story and old-client shapes) and is never reset', async () => {
  const uid = await setup(), i = await issue(uid), corrupt = { schemaVersion: S, phase: 'ally' };
  await db.doc(`storyProgress/${uid}`).set(corrupt);
  const snapshot = async () => ({ user: await user(uid), battle: (await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).get()).data(), ledger: (await db.doc(`rivalBattles/${uid}`).get()).data() });
  const before = await snapshot();
  await assert.rejects(() => command(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000), /unavailable/);
  await assert.rejects(() => transactRivalBattle(db, uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T + 20000), /unavailable/);
  await assert.rejects(() => command(uid, { operation: 'status' }), /unavailable/);
  assert.deepEqual(await story(uid), corrupt); assert.deepEqual(await snapshot(), before);
});
