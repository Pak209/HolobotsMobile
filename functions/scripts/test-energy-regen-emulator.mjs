// energy-quest-server-1 Firestore-emulator tests: refreshEnergy (host regen, account zone, steps from the
// server-only fitness_daily doc) and the quest / training starts regenerating before their energy check.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator required; never run against production');
const { db } = require('../lib/admin.js');
const { refreshEnergy, transactRefreshEnergy } = require('../lib/energy/refreshEnergy.js');
const { transactStartQuestRun } = require('../lib/progression/startQuestRun.js');

const at = (iso) => new Date(iso).getTime();
const LA = 'America/Los_Angeles';
let serial = 0;
const uids = [];
after(async () => { for (const uid of uids) { await db.recursiveDelete(db.doc(`users/${uid}`)); } });
async function setup(extra = {}) {
  const uid = `energy_${Date.now()}_${serial++}`; uids.push(uid);
  await db.doc(`users/${uid}`).set({ dailyEnergy: 20, maxDailyEnergy: 100, lastEnergyRefresh: new Date(at('2026-10-23T20:00:00Z')),
    holobots: [{ name: 'ACE', level: 5, experience: 0, nextLevelExp: 1300 }], rewardSystem: { activeQuests: [] }, ...extra });
  return uid;
}
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();

test('refreshEnergy stores the first zone, resets at its local midnight, and writes Timestamps', async () => {
  const uid = await setup();
  const r1 = await transactRefreshEnergy(db, uid, { timeZone: LA }, at('2026-10-23T20:50:00Z'));
  assert.equal(r1.schemaVersion, 'energy-regen-1');
  assert.equal(r1.timeZoneStatus, 'set');
  assert.equal(r1.dailyEnergy, 23);
  let u = await user(uid);
  assert.equal(u.energyTimeZone, LA);
  assert.equal(u.energyDayKey, '2026-10-23');
  assert.equal(typeof u.lastEnergyRefresh.toMillis, 'function', 'stored as a Timestamp');
  const r2 = await transactRefreshEnergy(db, uid, { timeZone: LA }, at('2026-10-24T07:00:00Z'));
  assert.equal(r2.dailyEnergy, 100);
  u = await user(uid);
  assert.equal(u.energyDayKey, '2026-10-24');
  const r3 = await transactRefreshEnergy(db, uid, {}, at('2026-10-24T07:00:00Z'));
  assert.equal(r3.changed, false, 'replay writes nothing');
});

test('step bonus comes from users/{uid}/fitness_daily/{account-zone today}, not the profile', async () => {
  const uid = await setup({ energyTimeZone: LA, energyDayKey: '2026-10-23', energyDayStartedAt: new Date(at('2026-10-23T07:00:00Z')), todaySteps: 99999 });
  await db.doc(`users/${uid}/fitness_daily/2026-10-23`).set({ stepsTotal: 2600 });
  await db.doc(`users/${uid}/fitness_daily/2026-10-24`).set({ stepsTotal: 99999 });
  const r = await transactRefreshEnergy(db, uid, {}, at('2026-10-23T20:00:00Z'));
  assert.equal(r.dailyEnergy, 30);
  assert.equal((await user(uid)).stepEnergyGrantedToday, 10);
});

test('zone change inside the cooldown is refused (reported), and computes in the stored zone', async () => {
  const uid = await setup({ energyTimeZone: LA, energyTimeZoneChangedAt: new Date(at('2026-10-22T00:00:00Z')), energyDayKey: '2026-10-23', energyDayStartedAt: new Date(at('2026-10-23T07:00:00Z')) });
  const r = await transactRefreshEnergy(db, uid, { timeZone: 'Pacific/Kiritimati' }, at('2026-10-23T20:00:00Z'));
  assert.equal(r.timeZoneStatus, 'cooldown');
  assert.equal(r.dailyEnergy, 20);
  assert.equal((await user(uid)).energyTimeZone, LA);
});

test('bad requests and missing auth are refused; nothing is written', async () => {
  const uid = await setup();
  const before = await user(uid);
  await assert.rejects(() => refreshEnergy.run({ auth: { uid }, data: { now: 0 } }), (e) => e.details?.rejectionCode === 'invalid_request');
  await assert.rejects(() => refreshEnergy.run({ data: {} }), (e) => e.code === 'unauthenticated');
  assert.deepEqual(await user(uid), before);
  const reply = await refreshEnergy.run({ auth: { uid }, data: { timeZone: LA } });
  assert.equal(reply.schemaVersion, 'energy-regen-1');
});

test('startQuestRun regenerates first: a new local day pays the reset, then debits', async () => {
  const uid = await setup({ dailyEnergy: 5, energyTimeZone: LA, energyDayKey: '2026-10-23', energyDayStartedAt: new Date(at('2026-10-23T07:00:00Z')) });
  const r = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'regen_q_01' }, at('2026-10-24T07:30:00Z'));
  assert.equal(r.dailyEnergy, 90);
  const u = await user(uid);
  assert.equal(u.dailyEnergy, 90);
  assert.equal(u.energyDayKey, '2026-10-24');
  assert.ok(u.progressionTimers.quests.qr_regen_q_01);
});
