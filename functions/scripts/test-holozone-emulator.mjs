// DECISIONS #53 amendment 1 Firestore-emulator tests: holoZoneHost through the real transaction and callable —
// server-issued runs at holoZoneRuns/{uid}, beast XP written once per runId, the refusals write nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-holozone-tests';
const { db } = require('../lib/admin.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { holoZoneHost } = require('../lib/holozone/holoZoneHost.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const P = require('../lib/lib/progression.js');
const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
let serial = 0;
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
  { name: 'WOLF', level: 12, experience: 16000, nextLevelExp: 16900, attributePoints: 4 },
];
const squad = (ids, revision = 1) => ({ schemaVersion: 'travel-squad-1', revision, holobotIds: ids });
const setup = async (fields = {}) => { const uid = `hz_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots: bots(), travelSquad: squad(['ace', 'kuma']), ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const runsDoc = async uid => (await db.doc(`holoZoneRuns/${uid}`).get()).data();
const call = (uid, data, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-1', ...data }, now);
const ISSUED = T0 - Z.HOLOZONE_MIN_XP_MS;

test('issue → settle → replay: server uuid, travel squad snapshot, XP written once; duplicates and parallel settles replay', async () => {
  const uid = await setup();
  assert.deepEqual(await call(uid, { operation: 'status' }), { schemaVersion: 'holozone-run-1', run: null });
  const i = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, ISSUED);
  assert.match(i.runId, Z.HOLOZONE_RUN_ID); assert.equal(i.tier, 0); assert.deepEqual(i.squad, ['ace', 'kuma']);
  assert.equal(i.issuedAtMs, ISSUED); assert.equal(i.expiresAtMs, ISSUED + Z.HOLOZONE_RUN_TTL_MS);
  assert.deepEqual((await call(uid, { operation: 'status' })).run, { runId: i.runId, zoneId: 'neonforest', tier: 0, squad: ['ace', 'kuma'], issuedAtMs: ISSUED, expiresAtMs: i.expiresAtMs });
  assert.deepEqual(await user(uid), { holobots: bots(), travelSquad: squad(['ace', 'kuma']) }, 'issue writes nothing on users/{uid}');
  const results = await Promise.all(Array.from({ length: 5 }, () => call(uid, { operation: 'settle', runId: i.runId, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'] })));
  assert.equal(results.filter(r => !r.alreadyProcessed).length, 1, 'exactly one first settle');
  const s = results.find(r => !r.alreadyProcessed);
  assert.deepEqual(s.progression.map(r => [r.holobotId, r.expGained, r.levelBefore, r.levelAfter]), [['ace', 123, 4, 4], ['kuma', 123, 1, 2]]);
  for (const r of results) { assert.deepEqual(r.settlement, s.settlement); assert.deepEqual(r.progression, s.progression); }
  const u = await user(uid);
  assert.deepEqual(u.holobots[0], P.applyHolobotExperience(bots()[0], 123)); assert.equal(u.holobots[1].level, 2); assert.deepEqual(u.holobots[2], bots()[2]);
  const replay = await holoZoneHost.run({ auth: { uid }, data: { schemaVersion: 'holozone-run-1', operation: 'settle', runId: i.runId, kills: 99, bossDefeated: true, fielded: ['ace'] } });
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.settlement, s.settlement);
  assert.deepEqual(await user(uid), u, 'no second XP write');
  const stored = await runsDoc(uid);
  assert.equal(stored.schemaVersion, 'holozone-runs-1'); assert.equal(stored.runs.length, 1);
  assert.deepEqual(stored.runs[0].settlement, s.settlement); assert.deepEqual(stored.runs[0].progression, s.progression);
  assert.equal((await call(uid, { operation: 'status' })).run, null);
});

test('expired run: run_expired (failed-precondition), nothing written', async () => {
  const uid = await setup();
  const i = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, ISSUED);
  const before = [await user(uid), await runsDoc(uid)];
  // Through the store at expiresAtMs + 1, and through the callable on the real clock (well past T0 + TTL).
  await assert.rejects(() => call(uid, { operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'] }, i.expiresAtMs + 1), /run_expired/);
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'] } }), e => e.code === 'failed-precondition' && e.details.rejectionCode === 'run_expired');
  assert.deepEqual([await user(uid), await runsDoc(uid)], before);
});

test('wrong owner: another pilot settling the run id reads unknown_run (not-found); both pilots unchanged', async () => {
  const alice = await setup(), bob = await setup();
  const i = await call(alice, { operation: 'issue', zoneId: 'neonforest' }, ISSUED);
  const before = [await user(alice), await runsDoc(alice), await user(bob)];
  await assert.rejects(() => call(bob, { operation: 'settle', runId: i.runId, kills: 5, bossDefeated: true, fielded: ['ace'] }), /unknown_run/);
  await assert.rejects(() => holoZoneHost.run({ auth: { uid: bob }, data: { operation: 'settle', runId: i.runId, kills: 5, bossDefeated: true, fielded: ['ace'] } }), e => e.code === 'not-found' && e.details.rejectionCode === 'unknown_run');
  assert.deepEqual([await user(alice), await runsDoc(alice), await user(bob)], before);
  assert.equal((await db.doc(`holoZoneRuns/${bob}`).get()).exists, false);
  await assert.rejects(() => holoZoneHost.run({ data: { operation: 'status' } }), e => e.code === 'unauthenticated');
});

test('fielded outside the run squad is invalid_request (nothing written), even when the bot is owned or joined the squad later', async () => {
  const uid = await setup();
  // Issued on the real clock: the callable below settles with Date.now(), inside the window.
  const i = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, Date.now() - Z.HOLOZONE_MIN_XP_MS);
  await db.doc(`users/${uid}`).update({ travelSquad: squad(['ace', 'kuma', 'wolf'], 2) });
  const before = [await user(uid), await runsDoc(uid)];
  for (const fielded of [['wolf'], ['ace', 'wolf'], ['hare']]) {
    await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { operation: 'settle', runId: i.runId, kills: 2, bossDefeated: false, fielded } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request', JSON.stringify(fielded));
  }
  assert.deepEqual([await user(uid), await runsDoc(uid)], before);
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { operation: 'issue', zoneId: 'crystalcaves' } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'unknown_zone');
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { operation: 'settle', runId: i.runId, kills: -1, bossDefeated: false, fielded: [] } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
});

test('zero-kill loss earns the loss amount; a settle < 20 s after issue earns 0; a re-issue supersedes the open run', async () => {
  const uid = await setup({ expBoosterActiveUntil: T0 + 60000 });
  const i = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, ISSUED);
  const s = await call(uid, { operation: 'settle', runId: i.runId, kills: 0, bossDefeated: false, fielded: ['ace'] });
  assert.equal(s.settlement.didWin, false); assert.equal(s.settlement.tableExp, 28); assert.equal(s.settlement.expPerHolobot, 56, 'EXP Booster');
  assert.equal((await user(uid)).holobots[0].experience, 1756);
  const fast = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, T0);
  const f = await call(uid, { operation: 'settle', runId: fast.runId, kills: 25, bossDefeated: true, fielded: ['ace', 'kuma'] }, T0 + 5000);
  assert.equal(f.alreadyProcessed, false); assert.equal(f.settlement.expWithheld, true); assert.deepEqual(f.progression.map(r => r.expGained), [0, 0]);
  assert.equal((await user(uid)).holobots[0].experience, 1756, 'withheld: no write');
  const a = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, T0 + 6000);
  const b = await call(uid, { operation: 'issue', zoneId: 'neonforest' }, T0 + 7000);
  assert.notEqual(a.runId, b.runId);
  await assert.rejects(() => call(uid, { operation: 'settle', runId: a.runId, kills: 1, bossDefeated: false, fielded: ['ace'] }, T0 + 60000), /run_closed/);
  assert.equal((await call(uid, { operation: 'status' }, T0 + 8000)).run.runId, b.runId);
  // An empty / malformed travel squad: an empty squad issues (fielded must be []); a malformed one fails closed.
  const empty = await setup({ travelSquad: squad([]) });
  assert.deepEqual((await call(empty, { operation: 'issue', zoneId: 'neonforest' })).squad, []);
  const broken = await setup({ travelSquad: squad(['NOT_A_BOT']) });
  await assert.rejects(() => call(broken, { operation: 'issue', zoneId: 'neonforest' }), /unavailable/);
});
