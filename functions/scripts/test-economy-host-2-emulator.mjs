import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator required');
const { db } = require('../lib/admin.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { holoZoneHost } = require('../lib/holozone/holoZoneHost.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const T0 = Date.UTC(2026, 9, 14, 12);
let serial = 0;
const setup = async () => {
  const uid = `econ2_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [{ name: 'ACE', level: 1, experience: 0 }], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, holosTokens: 600 });
  return uid;
};
const call = (uid, data, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...data }, now);
const issue = (uid, at) => call(uid, { operation: 'issue', zoneId: 'neonforest' }, at);
const settle = (uid, id, at, kills = 1) => call(uid, { operation: 'settle', runId: id, kills, bossDefeated: false, fielded: ['ace'] }, at);
const state = async uid => [(await db.doc(`users/${uid}`).get()).data(), (await db.doc(`holoZoneRuns/${uid}`).get()).data()];
const blocked = async (uid, at, expected) => assert.rejects(() => issue(uid, at), e => e.code === 'zone_cooldown' && e.retryAfterMs === expected);

test('3-minute ISSUE refusal counts down exactly, writes nothing, and admits at the boundary', async () => {
  const uid = await setup();
  const i = await issue(uid, T0 - 20000);
  const s = await settle(uid, i.runId, T0);
  assert.equal(s.holosGranted, 100);
  const before = await state(uid);
  await blocked(uid, T0, 180000);
  await blocked(uid, T0 + 1000, 179000);
  await blocked(uid, T0 + 179999, 1);
  assert.deepEqual(await state(uid), before);
  assert.equal((await call(uid, { operation: 'status' }, T0 + 1000)).run, null);
  const next = await issue(uid, T0 + 180000);
  assert.notEqual(next.runId, i.runId);
  assert.equal(next.schemaVersion, 'holozone-run-2');
});

test('losses and reward-withheld settles start the same clock; replay neither resets it nor pays again', async () => {
  for (const duration of [0, 20000]) {
    const uid = await setup();
    const i = await issue(uid, T0 - duration);
    const s = await settle(uid, i.runId, T0, 0);
    assert.equal(s.holosGranted, duration === 0 ? 0 : 25);
    const before = await state(uid);
    const replay = await settle(uid, i.runId, T0 + 60000, 99);
    assert.equal(replay.alreadyProcessed, true);
    assert.deepEqual(await state(uid), before);
    await blocked(uid, T0 + 60000, 120000);
    await issue(uid, T0 + 180000);
  }
});

test('callable reports failed-precondition / zone_cooldown with details.retryAfterMs for v1 and v2', async () => {
  const uid = await setup();
  const now = Date.now();
  const i = await issue(uid, now - 20000);
  await settle(uid, i.runId, now, 0);
  const before = await state(uid);
  for (const schemaVersion of ['holozone-run-1', 'holozone-run-2']) {
    await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { schemaVersion, operation: 'issue', zoneId: 'neonforest' } }), e => {
      assert.equal(e.code, 'failed-precondition');
      assert.equal(e.message, 'zone_cooldown');
      assert.equal(e.details.rejectionCode, 'zone_cooldown');
      assert.ok(e.details.retryAfterMs > 0 && e.details.retryAfterMs <= 180000);
      return true;
    });
  }
  assert.deepEqual(await state(uid), before);
});

test('pre-upgrade runs enforce cooldown; bounded history pruning cannot remove the parent cooldown', async () => {
  const uid = await setup();
  const i = await issue(uid, T0 - 20000);
  await settle(uid, i.runId, T0);
  const ref = db.doc(`holoZoneRuns/${uid}`);
  const ledger = (await ref.get()).data();
  delete ledger.zoneLastSettledAtMs;
  await ref.set(ledger);
  await blocked(uid, T0 + 1000, 179000);
  await ref.set({ schemaVersion: 'holozone-runs-1', runs: [], zoneLastSettledAtMs: { neonforest: T0 } });
  await blocked(uid, T0 + 2000, 178000);
});

test('cooldowns are per zone, and an ISSUE alone does not start or reset the settle clock', async () => {
  const uid = await setup();
  await db.doc(`holoZoneRuns/${uid}`).set({ schemaVersion: 'holozone-runs-1', runs: [], zoneLastSettledAtMs: { futurezone: T0 } });
  const a = await issue(uid, T0);
  const b = await issue(uid, T0 + 1000);
  assert.notEqual(a.runId, b.runId);
  const [, ledger] = await state(uid);
  assert.deepEqual(ledger.zoneLastSettledAtMs, { futurezone: T0 });
  assert.equal(ledger.runs[0].closedAtMs, T0 + 1000);
});

test('malformed cooldown state fails closed atomically, preserving the open run and account', async () => {
  const uid = await setup();
  const i = await issue(uid, T0);
  await db.doc(`holoZoneRuns/${uid}`).update({ zoneLastSettledAtMs: { neonforest: 'soon' } });
  const before = await state(uid);
  await assert.rejects(() => issue(uid, T0 + 1000), /unavailable/);
  await assert.rejects(() => settle(uid, i.runId, T0 + 20000), /unavailable/);
  assert.deepEqual(await state(uid), before);
});

test('parallel first-time settles start one clock; simultaneous refused issues create no runs', async () => {
  const uid = await setup();
  const i = await issue(uid, T0 - 20000);
  const rs = await Promise.all([settle(uid, i.runId, T0), settle(uid, i.runId, T0)]);
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1);
  const before = await state(uid);
  await Promise.all([blocked(uid, T0 + 1, 179999), blocked(uid, T0 + 2, 179998)]);
  assert.deepEqual(await state(uid), before);
  assert.equal(before[0].holosTokens, 700);
});
