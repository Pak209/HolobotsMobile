// DECISIONS #58 (3) + amendment 1 (3) economy-host-1 Firestore-emulator tests: repeat rival / zone Holos,
// the per-rival cooldown, the zone blueprint fragment and the rank-tier Kit. Known-bad = origin/main
// behaviour (repeat battles pay 0 Holos; no cooldown; no fragment; 11/21/31/41 Kit table) — each test
// names the value main produced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Demo emulator on loopback required; never run against production');
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const L = require('../lib/lib/rivalLadder.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);
const MIN = 60 * 1000;
let serial = 0;
const bots = () => [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, attributePoints: 1 }, { name: 'KUMA', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }];
const squad = ids => ({ schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ids });
const setup = async (fields = {}) => { const uid = `econ_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots: bots(), travelSquad: squad(['ace', 'kuma']), holosTokens: 600, buddyUnits: { light: 0, medium: 0, heavy: 0 }, ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const rival = (uid, data, now) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now);
const zone = (uid, data, now, v = 'holozone-run-2') => transactHoloZoneRun(db, uid, { schemaVersion: v, ...data }, now);
/** Issue at `at`, settle `afterMs` later. */
const fight = async (uid, didWin, at, afterMs = L.RIVAL_MIN_WIN_MS) => { const i = await rival(uid, { operation: 'issue' }, at); return rival(uid, { operation: 'settle', battleId: i.battleId, didWin }, at + afterMs); };
const run = async (uid, kills, bossDefeated, at, afterMs = Z.HOLOZONE_MIN_XP_MS, v) => { const i = await zone(uid, { operation: 'issue', zoneId: 'neonforest' }, at, v); return zone(uid, { operation: 'settle', runId: i.runId, kills, bossDefeated, fielded: ['ace'] }, at + afterMs, v); };

// ---- Step 1: repeat rival and zone Holos ----------------------------------

test('step 1 rival: every settled battle pays win 100 / loss 25 (known-bad main: +0 after the intro, holosTokens stayed 600)', async () => {
  const uid = await setup();
  const w = await fight(uid, true, T0);
  assert.equal(w.holosGranted, 100);
  assert.equal((await user(uid)).holosTokens, 700);
  const l = await fight(uid, false, T0 + 10 * MIN);
  assert.equal(l.holosGranted, 25);
  assert.equal((await user(uid)).holosTokens, 725);
  const w2 = await fight(uid, true, T0 + 20 * MIN);
  assert.equal(w2.holosGranted, 100, 'repeat wins keep paying');
  assert.equal((await user(uid)).holosTokens, 825);
});

test('step 1 rival: a loss settled < 20 s after issue pays 0; replays never pay twice (parallel duplicates included)', async () => {
  const uid = await setup();
  const fast = await fight(uid, false, T0, L.RIVAL_MIN_XP_MS - 1);
  assert.equal(fast.holosGranted, 0);
  assert.equal((await user(uid)).holosTokens, 600);
  const i = await rival(uid, { operation: 'issue' }, T0 + 10 * MIN);
  const rs = await Promise.all(Array.from({ length: 6 }, () => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + 10 * MIN + L.RIVAL_MIN_WIN_MS)));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1);
  for (const r of rs) assert.equal(r.holosGranted, 100);
  const replay = await rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + 11 * MIN);
  assert.equal(replay.alreadyProcessed, true); assert.equal(replay.holosGranted, 100);
  assert.equal((await user(uid)).holosTokens, 700, 'paid exactly once');
});

test('step 1 rival: legacy v1 / v2 replies keep the deployed shape (no holosGranted) but the Holos are still paid', async () => {
  const uid = await setup();
  const i = await transactRivalBattle(db, uid, { operation: 'issue' }, T0);
  const s = await transactRivalBattle(db, uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS);
  assert.equal(s.schemaVersion, 'rival-battle-1'); assert.equal('holosGranted' in s, false);
  assert.equal((await user(uid)).holosTokens, 700);
});

test('step 1 rival: a malformed stored balance fails closed (unavailable), nothing written', async () => {
  const uid = await setup({ holosTokens: 'lots' });
  const i = await rival(uid, { operation: 'issue' }, T0);
  await assert.rejects(() => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS), /unavailable/);
  const p = await user(uid); assert.equal(p.holosTokens, 'lots'); assert.equal(p.rivalWins, undefined);
});

test('step 1 zone: win 100 (kills >= 1 or boss), zero-kill loss 25, < 20 s pays 0, replay pays once (known-bad main: 0 every time)', async () => {
  const uid = await setup();
  const w = await run(uid, 3, false, T0);
  assert.equal(w.holosGranted, 100); assert.equal((await user(uid)).holosTokens, 700);
  const l = await run(uid, 0, false, T0 + 10 * MIN);
  assert.equal(l.holosGranted, 25); assert.equal((await user(uid)).holosTokens, 725);
  const fast = await run(uid, 5, false, T0 + 20 * MIN, Z.HOLOZONE_MIN_XP_MS - 1);
  assert.equal(fast.holosGranted, 0); assert.equal((await user(uid)).holosTokens, 725);
  const i = await zone(uid, { operation: 'issue', zoneId: 'neonforest' }, T0 + 30 * MIN);
  const cmd = { operation: 'settle', runId: i.runId, kills: 0, bossDefeated: true, fielded: ['ace'] };
  const rs = await Promise.all(Array.from({ length: 5 }, () => zone(uid, cmd, T0 + 31 * MIN)));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1);
  for (const r of rs) assert.equal(r.holosGranted, 100);
  assert.equal((await user(uid)).holosTokens, 825);
});

test('step 1 zone: a holozone-run-1 settle reply keeps the deployed shape; the Holos are still paid', async () => {
  const uid = await setup();
  const s = await run(uid, 2, false, T0, Z.HOLOZONE_MIN_XP_MS, 'holozone-run-1');
  assert.deepEqual(Object.keys(s), ['schemaVersion', 'runId', 'alreadyProcessed', 'settlement', 'progression']);
  assert.equal((await user(uid)).holosTokens, 700);
});
