// Critic review 2026-10-17 S2 Firestore-emulator tests: claimDailyMission pays from the server-only
// users/{uid}.dailyMissionLedger. The client-writable rewardSystem mirror can neither re-open a claim nor
// complete a mission; the real counter callables bump the ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-daily-mission-tests';
const { db } = require('../lib/admin.js');
const { claimDailyMission } = require('../lib/economy/claimDailyMission.js');
const { openGachaPack } = require('../lib/economy/openGachaPack.js');
const { getTodayMissionKey, DAILY_MISSION_LEDGER_FIELD } = require('../lib/lib/economy.js');
let serial = 0;
const setup = async (fields = {}) => { const uid = `dm_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ gachaTickets: 0, holosTokens: 0, holobots: [{ name: 'ACE', level: 1 }], ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const claim = (uid, missionId) => claimDailyMission.run({ auth: { uid }, data: { missionId } });
const refused = (uid, missionId, message) => assert.rejects(() => claim(uid, missionId), e => e.code === 'failed-precondition' && message.test(e.message));

test('a second claim of the same mission on the same day is refused and writes nothing', async () => {
  const uid = await setup({ rewardSystem: { activeQuests: [{ questId: 'q1', endsAt: 'x' }], syncBoostEnabled: true } });
  assert.deepEqual(await claim(uid, 'daily_login'), { gachaTickets: 1, holosTokens: 0, missionId: 'daily_login' });
  const after = await user(uid), today = getTodayMissionKey();
  assert.equal(after.gachaTickets, 1);
  assert.deepEqual(after[DAILY_MISSION_LEDGER_FIELD].missionClaims, { daily_login: today });
  assert.deepEqual(after.rewardSystem.missionClaims, { daily_login: today }, 'display mirror');
  assert.deepEqual(after.rewardSystem.activeQuests, [{ questId: 'q1', endsAt: 'x' }], 'quest state survives the merge');
  assert.equal(after.rewardSystem.syncBoostEnabled, true);
  await refused(uid, 'daily_login', /already claimed/);
  assert.deepEqual(await user(uid), after);
});

test('client-writable rewardSystem tampering (cleared claims, forged counters) cannot re-open or complete a mission', async () => {
  const uid = await setup();
  await claim(uid, 'daily_login');
  const today = getTodayMissionKey();
  // Everything below is what firestore.rules still lets the owner write to rewardSystem.
  await db.doc(`users/${uid}`).update({ rewardSystem: { arenaBattlesToday: 99, boosterPacksToday: 99, lastDailyMissionReset: today, missionClaims: {} } });
  const before = await user(uid);
  await refused(uid, 'daily_login', /already claimed/);
  await refused(uid, 'arena_v2_battle', /not completed/);
  await refused(uid, 'open_booster_pack', /not completed/);
  assert.deepEqual(await user(uid), before);
  assert.equal(before.gachaTickets, 1);
});

test('the real counter callable bumps the ledger: open a pack, claim once, refuse the second', async () => {
  const uid = await setup({ gachaTickets: 1 });
  await refused(uid, 'open_booster_pack', /not completed/);
  await openGachaPack.run({ auth: { uid }, data: { packId: 'basic' } });
  const opened = await user(uid);
  assert.equal(opened[DAILY_MISSION_LEDGER_FIELD].boosterPacksToday, 1);
  assert.equal(opened.rewardSystem.boosterPacksToday, 1, 'display mirror bumped too');
  const r = await claim(uid, 'open_booster_pack');
  assert.equal(r.gachaTickets, 1);
  assert.equal((await user(uid)).gachaTickets, opened.gachaTickets + 1);
  await refused(uid, 'open_booster_pack', /already claimed/);
});

test('deploy day: a claim recorded only in the pre-ledger rewardSystem still blocks a re-claim; arena progress needs the ledger', async () => {
  const today = getTodayMissionKey();
  const uid = await setup({ rewardSystem: { arenaBattlesToday: 3, boosterPacksToday: 0, lastDailyMissionReset: today, missionClaims: { daily_login: today } } });
  await refused(uid, 'daily_login', /already claimed/);
  await refused(uid, 'arena_v2_battle', /not completed/);
  await db.doc(`users/${uid}`).update({ [DAILY_MISSION_LEDGER_FIELD]: { arenaBattlesToday: 3, boosterPacksToday: 0, lastDailyMissionReset: today, missionClaims: {} } });
  assert.deepEqual(await claim(uid, 'arena_v2_battle'), { gachaTickets: 2, holosTokens: 100, missionId: 'arena_v2_battle' });
  await refused(uid, 'arena_v2_battle', /already claimed/);
  const u = await user(uid);
  assert.deepEqual(u.rewardSystem.missionClaims, { daily_login: today, arena_v2_battle: today });
  assert.deepEqual(u[DAILY_MISSION_LEDGER_FIELD].missionClaims, { arena_v2_battle: today });
});

test('stale-day ledger counters do not count; unauthenticated and unknown missions are refused', async () => {
  const uid = await setup({ [DAILY_MISSION_LEDGER_FIELD]: { arenaBattlesToday: 3, boosterPacksToday: 1, lastDailyMissionReset: '2026-01-01', missionClaims: {} } });
  await refused(uid, 'arena_v2_battle', /not completed/);
  await refused(uid, 'open_booster_pack', /not completed/);
  await assert.rejects(() => claimDailyMission.run({ data: { missionId: 'daily_login' } }), e => e.code === 'unauthenticated');
  await assert.rejects(() => claim(uid, 'nope'), e => e.code === 'invalid-argument');
});
