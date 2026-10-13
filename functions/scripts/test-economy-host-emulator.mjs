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

// ---- Step 2: per-rival cooldown --------------------------------------------

const { rivalBattleHost } = require('../lib/rival/rivalBattleHost.js');
const rejectsCooldown = async (p, retryAfterMs) => { await assert.rejects(p, e => { assert.equal(e.code, 'rival_cooldown'); assert.equal(e.retryAfterMs, retryAfterMs); return true; }); };

test('step 2: the same rival cannot be re-issued within 5 min of its last settle; retryAfterMs counts down; at 5 min it can (known-bad main: issued immediately)', async () => {
  const uid = await setup();
  const s = await fight(uid, true, T0); // settled at T0 + 20 s
  const settledAt = T0 + L.RIVAL_MIN_WIN_MS;
  assert.equal(L.RIVAL_COOLDOWN_MS, 5 * MIN);
  const before = await user(uid);
  await rejectsCooldown(rival(uid, { operation: 'issue' }, settledAt + 1000), 5 * MIN - 1000);
  await rejectsCooldown(rival(uid, { operation: 'issue' }, settledAt + 4 * MIN), MIN);
  assert.deepEqual(await user(uid), before, 'a refused issue writes nothing');
  assert.deepEqual(Object.keys((await db.doc(`rivalBattles/${uid}`).get()).data().openBattles ?? {}), [], 'no battle opened');
  const ok = await rival(uid, { operation: 'issue' }, settledAt + 5 * MIN);
  assert.match(ok.battleId, /^rb_/);
  assert.equal(s.holosGranted, 100);
});

test('step 2: a loss starts the cooldown too; the callable carries details.retryAfterMs', async () => {
  const uid = await setup();
  const settledAt = Date.now(); // the callable rules at the wall clock
  await fight(uid, false, settledAt - L.RIVAL_MIN_XP_MS, L.RIVAL_MIN_XP_MS);
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid }, data: { schemaVersion: 'rival-battle-3', operation: 'issue' }, rawRequest: {} }), e => {
    assert.equal(e.code, 'failed-precondition'); assert.equal(e.message, 'rival_cooldown');
    assert.equal(e.details.rejectionCode, 'rival_cooldown'); assert.ok(e.details.retryAfterMs > 0 && e.details.retryAfterMs <= 5 * MIN); return true;
  });
  assert.ok(settledAt);
});

test('step 2: different rivals are independent (tier-0 rival settled; the tier-1 rival issues at once)', async () => {
  const uid = await setup({ rivalWins: 9 });
  const s = await fight(uid, true, T0); // tier 0 → tier 1 (rival_tier_0 settled)
  assert.equal(s.tierAfter, 1);
  const i = await rival(uid, { operation: 'issue' }, T0 + L.RIVAL_MIN_WIN_MS + 1000);
  assert.equal(i.encounter.opponentPilot.pilotId, 'rival_tier_1');
  // and the cooldown map is keyed by rival id
  const ledger = (await db.doc(`rivalBattles/${uid}`).get()).data();
  assert.deepEqual(Object.keys(ledger.rivalLastSettledAtMs), ['rival_tier_0']);
});

test('step 2: a cooldown never blocks a replay of an existing settle, nor the settle of a battle issued before it', async () => {
  const uid = await setup();
  const a = await rival(uid, { operation: 'issue' }, T0);
  const b = await rival(uid, { operation: 'issue' }, T0 + 1000);
  const sa = await rival(uid, { operation: 'settle', battleId: a.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS);
  const replay = await rival(uid, { operation: 'settle', battleId: a.battleId, didWin: true }, T0 + MIN);
  assert.equal(replay.alreadyProcessed, true); assert.equal(replay.holosGranted, sa.holosGranted);
  const sb = await rival(uid, { operation: 'settle', battleId: b.battleId, didWin: false }, T0 + MIN);
  assert.equal(sb.alreadyProcessed, false);
  await rejectsCooldown(rival(uid, { operation: 'issue' }, T0 + 2 * MIN), 4 * MIN, 'the clock restarted at the last first-time settle');
  const ledger = (await db.doc(`rivalBattles/${uid}`).get()).data();
  assert.equal(ledger.rivalLastSettledAtMs.rival_tier_0, T0 + MIN);
});

test('step 2: a malformed cooldown map fails closed (unavailable), nothing issued', async () => {
  const uid = await setup();
  await db.doc(`rivalBattles/${uid}`).set({ openBattles: {}, rivalLastSettledAtMs: { rival_tier_0: 'soon' } });
  await assert.rejects(() => rival(uid, { operation: 'issue' }, T0), /unavailable/);
});
