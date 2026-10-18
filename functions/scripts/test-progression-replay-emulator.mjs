// training-reward-replay-proof-1 (Lex, 2026-10-18) Firestore-emulator proof: with HOLOCITY_LEGACY_QUEST_TIMERS=1 ON
// (the original app still claims runs it started on client timers), a training or quest pays EXACTLY ONCE however a
// stale client copy of rewardSystem comes back. Five stale-data paths, each with a training and a quest case:
//   (a) a client claims, then restores an older local copy of rewardSystem (or never clears it) and claims again;
//   (b) two devices on one account claim the same run (concurrently, and the second after a stale full-map write);
//   (c) a start retried with the same / a different requestId after a timeout, and a claim retried after a lost reply;
//   (d) a client-written endsAt in the past for a run that was never started;
//   (e) a reinstall that re-sends an old claim after newer runs were claimed.
// Known-bad: run against origin/main 8d60440 (= deployed host a90d061 for these files), (a), (b) stale write, (d) and
// (e) paid more than once; see Documentation/QA/2026-10-18-training-reward-replay-proof-1/README.md.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator required; never run against production');
const { db } = require('../lib/admin.js');
const { transactStartQuestRun } = require('../lib/progression/startQuestRun.js');
const { transactStartTrainingSession } = require('../lib/progression/startTrainingSession.js');
const { claimQuestRun, transactClaimQuestRun } = require('../lib/progression/claimQuestRun.js');
const { claimTrainingSession, transactClaimTrainingSession } = require('../lib/progression/claimTrainingSession.js');

const MIN = 60 * 1000;
const T = Date.UTC(2026, 9, 18, 12);
const iso = (ms) => new Date(ms).toISOString();
const LEGACY = { legacyTimers: true };
let serial = 0;
const uids = [];
after(async () => { for (const uid of uids) await db.doc(`users/${uid}`).delete(); });

const bot = (name) => ({ name, level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0, boostedAttributes: {} });
async function setup(rewardSystem = {}) {
  const uid = `replay_${Date.now()}_${serial++}`; uids.push(uid);
  await db.doc(`users/${uid}`).set({ dailyEnergy: 100, syncPoints: 0, lifetimeSyncPoints: 0, seasonSyncPoints: 0, inventory: {},
    holobots: ['ACE', 'KUMA', 'SHADOW', 'ERA', 'HARE'].map(bot),
    rewardSystem: { activeQuests: [], activeTraining: null, availableQuestIds: ['forest_patrol'], syncBoostEnabled: true, ...rewardSystem } });
  return uid;
}
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
/** What the original app's TrainingScreen writes at start (progressionSystems.startTrainingSession), attack course. */
const legacyTraining = (startMs, holobotName = 'KUMA', boost = 12) => ({ courseId: 'attack', holobotName, statBoosts: { attack: boost }, expReward: 70, startedAt: iso(startMs), endsAt: iso(startMs + 30 * MIN) });
/** What the original app's QuestsScreen writes at start (progressionSystems.startQuestRun), forest patrol (15 min, 15 SP). */
const legacyQuest = (id, startMs, holobotName = 'ACE') => ({ id, questId: 'forest_patrol', holobotName, holobotPower: 900, rewards: { exp: 50, syncPoints: 15 }, startedAt: iso(startMs), endsAt: iso(startMs + 15 * MIN), succeeded: true });
/** A client's full-map rewardSystem write (TrainingScreen sync-boost toggle / QuestsScreen refresh / any stale snapshot). */
const writeRewardSystem = (uid, rewardSystem) => db.doc(`users/${uid}`).update({ rewardSystem });
/** Training payouts so far: each attack-course claim adds its boost to the holobot's boostedAttributes.attack. */
const trainingPaid = async (uid, name = 'KUMA', boost = 12) => ((await user(uid)).holobots.find((h) => h.name === name).boostedAttributes?.attack ?? 0) / boost;
/** Quest payouts so far: roll 0 always succeeds, forest patrol pays 15 SP. */
const questsPaid = async (uid) => (await user(uid)).syncPoints / 15;
const settle = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; } };
const claimT = (uid, now) => settle(() => transactClaimTrainingSession(db, uid, now, LEGACY));
const claimQ = (uid, id, now) => settle(() => transactClaimQuestRun(db, uid, { questRunId: id }, now, LEGACY, 0));

// ---------------------------------------------------------------------------------------------------------------
// (a) claim, then restore an older local copy (or never clear it) and claim again

test('(a) training: restoring the claimed legacy activeTraining and claiming again pays exactly once', async () => {
  const start = T - 40 * MIN;
  const uid = await setup({ activeTraining: legacyTraining(start) });
  const stale = (await user(uid)).rewardSystem;
  assert.equal((await claimT(uid, T)).ok, true);
  for (let i = 1; i <= 3; i += 1) {
    await writeRewardSystem(uid, stale); // the device never cleared its copy / restored a backup
    await claimT(uid, T + i * MIN);
  }
  assert.equal(await trainingPaid(uid), 1, 'one payout for one training');
});

test('(a) quest: restoring the claimed legacy activeQuests entry and claiming its id again pays exactly once', async () => {
  const uid = await setup({ activeQuests: [legacyQuest('quest_1792000000000_aaaaaa', T - 20 * MIN)] });
  const stale = (await user(uid)).rewardSystem;
  assert.equal((await claimQ(uid, 'quest_1792000000000_aaaaaa', T)).ok, true);
  for (let i = 1; i <= 3; i += 1) {
    await writeRewardSystem(uid, stale);
    await claimQ(uid, 'quest_1792000000000_aaaaaa', T + i * MIN);
  }
  assert.equal(await questsPaid(uid), 1);
});

test('(a) host-started training: a resurrected display copy (no run id, README F4) does not pay the run again', async () => {
  const uid = await setup();
  await transactStartTrainingSession(db, uid, { courseId: 'attack', holobotName: 'KUMA', requestId: 'replay_t_host_01' }, T, 0);
  const stale = (await user(uid)).rewardSystem; // display copy {courseId, holobotName, statBoosts:{attack:10}, startedAt, endsAt}
  assert.equal((await claimT(uid, T + 30 * MIN)).ok, true);
  await writeRewardSystem(uid, stale);
  await claimT(uid, T + 31 * MIN);
  assert.equal(await trainingPaid(uid, 'KUMA', 10), 1);
});

test('(a) host-started quest: a resurrected qr_ display copy does not pay the run again', async () => {
  const uid = await setup();
  const r = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'replay_q_host_01' }, T);
  const stale = (await user(uid)).rewardSystem;
  assert.equal((await claimQ(uid, r.questRun.id, T + 15 * MIN)).ok, true);
  await writeRewardSystem(uid, stale);
  await claimQ(uid, r.questRun.id, T + 16 * MIN);
  assert.equal(await questsPaid(uid), 1);
});

// ---------------------------------------------------------------------------------------------------------------
// (b) two devices on one account

test('(b) training: two devices claiming concurrently pay once; the second device\'s stale full-map write then claim pays nothing more', async () => {
  const uid = await setup({ activeTraining: legacyTraining(T - 40 * MIN) });
  const deviceB = (await user(uid)).rewardSystem; // B loaded the profile before A claimed
  await Promise.all([claimT(uid, T), claimT(uid, T)]);
  assert.equal(await trainingPaid(uid), 1, 'concurrent claims serialize');
  await writeRewardSystem(uid, { ...deviceB, syncBoostEnabled: false }); // B toggles sync boost: full map, stale activeTraining
  await claimT(uid, T + MIN);
  assert.equal(await trainingPaid(uid), 1);
});

test('(b) quest: two devices claiming concurrently pay once; the second device\'s stale full-map write then claim pays nothing more', async () => {
  const uid = await setup({ activeQuests: [legacyQuest('quest_1792000000000_bbbbbb', T - 20 * MIN)] });
  const deviceB = (await user(uid)).rewardSystem;
  await Promise.all([claimQ(uid, 'quest_1792000000000_bbbbbb', T), claimQ(uid, 'quest_1792000000000_bbbbbb', T)]);
  assert.equal(await questsPaid(uid), 1, 'concurrent claims serialize');
  await writeRewardSystem(uid, { ...deviceB, availableQuestIds: ['factory_raid'] }); // B refreshes the board: full map
  await claimQ(uid, 'quest_1792000000000_bbbbbb', T + MIN);
  assert.equal(await questsPaid(uid), 1);
});

// ---------------------------------------------------------------------------------------------------------------
// (c) retries after a timeout

test('(c) training: a start retried with the same / a different requestId and a claim retried after a lost reply pay once', async () => {
  const uid = await setup();
  const first = await transactStartTrainingSession(db, uid, { courseId: 'attack', holobotName: 'KUMA', requestId: 'retry_t_req_01' }, T, 0);
  const same = await transactStartTrainingSession(db, uid, { courseId: 'attack', holobotName: 'KUMA', requestId: 'retry_t_req_01' }, T + 1000, 0.99);
  assert.equal(same.alreadyProcessed, true); assert.deepEqual(same.training, first.training);
  const other = await settle(() => transactStartTrainingSession(db, uid, { courseId: 'attack', holobotName: 'KUMA', requestId: 'retry_t_req_02' }, T + 2000, 0.99));
  assert.equal(other.error?.code, 'training_active');
  assert.equal((await user(uid)).dailyEnergy, 90, 'debited once');
  assert.equal((await claimT(uid, T + 30 * MIN)).ok, true);
  await claimT(uid, T + 30 * MIN + 1000); // reply lost; the identical claim again
  await settle(() => claimTrainingSession.run({ auth: { uid }, data: { requestId: 'retry_claim_02' } }));
  assert.equal(await trainingPaid(uid, 'KUMA', 10), 1);
});

test('(c) quest: a start retried with the same / a different requestId and a claim retried after a lost reply pay once', async () => {
  const uid = await setup();
  const first = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'retry_q_req_01' }, T);
  const same = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'retry_q_req_01' }, T + 1000);
  assert.equal(same.alreadyProcessed, true); assert.deepEqual(same.questRun, first.questRun);
  const other = await settle(() => transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'retry_q_req_02' }, T + 2000));
  assert.equal(other.error?.code, 'holobot_busy');
  assert.equal((await user(uid)).dailyEnergy, 90, 'debited once');
  assert.equal((await claimQ(uid, first.questRun.id, T + 15 * MIN)).ok, true);
  await claimQ(uid, first.questRun.id, T + 15 * MIN + 1000);
  assert.equal(await questsPaid(uid), 1);
});

test('(c) a retried claim replays the stored receipt (alreadyProcessed), host and legacy, flag on or off', async () => {
  const uid = await setup({ activeQuests: [legacyQuest('quest_1792000000000_cccccc', T - 20 * MIN, 'KUMA')] });
  const r = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'receipt_q_01' }, T - 20 * MIN);
  const host = await claimQ(uid, r.questRun.id, T);
  const legacy = await claimQ(uid, 'quest_1792000000000_cccccc', T);
  assert.equal(host.ok && legacy.ok, true);
  for (const legacyTimers of [true, false]) {
    const replayHost = await transactClaimQuestRun(db, uid, { questRunId: r.questRun.id }, T + MIN, { legacyTimers }, 0.99);
    assert.deepEqual(replayHost, { ...host.value, alreadyProcessed: true }, 'same outcome, not re-rolled');
  }
  const replayLegacy = await transactClaimQuestRun(db, uid, { questRunId: 'quest_1792000000000_cccccc' }, T + MIN, LEGACY, 0.99);
  assert.deepEqual(replayLegacy, { ...legacy.value, alreadyProcessed: true });
  const t = await setup();
  await transactStartTrainingSession(db, t, { courseId: 'attack', holobotName: 'KUMA', requestId: 'receipt_t_01' }, T, 0);
  assert.deepEqual(await transactClaimTrainingSession(db, t, T + 30 * MIN, { legacyTimers: false }), { claimed: true });
  assert.deepEqual(await transactClaimTrainingSession(db, t, T + 31 * MIN, { legacyTimers: false }), { claimed: true, alreadyProcessed: true });
  assert.equal(await questsPaid(uid), 2); assert.equal(await trainingPaid(t, 'KUMA', 10), 1);
});

// ---------------------------------------------------------------------------------------------------------------
// (d) a client-written endsAt in the past for a run that was never started

test('(d) training: a burst of forged never-started sessions (endsAt in the past) pays at most once', async () => {
  const uid = await setup();
  for (let i = 0; i < 5; i += 1) {
    await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeTraining: legacyTraining(T - (40 + 31 * i) * MIN) });
    await claimT(uid, T + i * 1000);
  }
  assert.equal(await trainingPaid(uid), 1, 'one slot: a session has to start after the previous claim');
});

test('(d) quest: forged never-started quests on every holobot pay at most the 3 quest slots, and a backdated one pays nothing', async () => {
  const uid = await setup();
  const names = ['ACE', 'KUMA', 'SHADOW', 'ERA', 'HARE'];
  const forged = names.map((name, i) => legacyQuest(`quest_forged_${i}`, T - 20 * MIN, name));
  await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeQuests: forged });
  for (const q of forged) await claimQ(uid, q.id, T);
  assert.ok(await questsPaid(uid) <= 3, `paid ${await questsPaid(uid)}`);
  const paid = await questsPaid(uid);
  await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeQuests: [legacyQuest('quest_forged_old', T - 365 * 24 * 60 * MIN, 'HARE')] });
  await claimQ(uid, 'quest_forged_old', T + MIN);
  assert.equal(await questsPaid(uid), paid, 'a run backdated before the claimed ones overlaps them');
});

// ---------------------------------------------------------------------------------------------------------------
// (e) a reinstall that re-sends an old claim

test('(e) training: after newer sessions were claimed, a reinstall restoring the old session and claiming pays nothing', async () => {
  const uid = await setup({ activeTraining: legacyTraining(T - 40 * MIN) });
  const oldInstall = (await user(uid)).rewardSystem;
  assert.equal((await claimT(uid, T)).ok, true);
  await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeTraining: legacyTraining(T + MIN) }); // next session, after the claim
  assert.equal((await claimT(uid, T + 31 * MIN)).ok, true);
  await writeRewardSystem(uid, oldInstall); // reinstall: restored cache / old device backup
  await claimT(uid, T + 40 * MIN);
  await settle(() => claimTrainingSession.run({ auth: { uid }, data: {} }));
  assert.equal(await trainingPaid(uid), 2, 'the two real sessions, once each');
});

test('(e) quest: after newer runs were claimed, a reinstall re-sending the old claim (with and without its record) pays nothing', async () => {
  const uid = await setup({ activeQuests: [legacyQuest('quest_1792000000000_eeeeee', T - 20 * MIN)] });
  const oldInstall = (await user(uid)).rewardSystem;
  assert.equal((await claimQ(uid, 'quest_1792000000000_eeeeee', T)).ok, true);
  await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeQuests: [legacyQuest('quest_1792000000000_ffffff', T + MIN)] });
  assert.equal((await claimQ(uid, 'quest_1792000000000_ffffff', T + 16 * MIN)).ok, true);
  await claimQ(uid, 'quest_1792000000000_eeeeee', T + 20 * MIN); // old claim re-sent, record gone
  await writeRewardSystem(uid, oldInstall);
  await claimQ(uid, 'quest_1792000000000_eeeeee', T + 21 * MIN); // old claim re-sent with the restored record
  process.env.HOLOCITY_LEGACY_QUEST_TIMERS = '1';
  try { await settle(() => claimQuestRun.run({ auth: { uid }, data: { questRunId: 'quest_1792000000000_eeeeee' } })); } finally { delete process.env.HOLOCITY_LEGACY_QUEST_TIMERS; }
  assert.equal(await questsPaid(uid), 2);
});

// ---------------------------------------------------------------------------------------------------------------
// Legacy clients keep working (flag ON)

test('legacy clients keep working: a new session started after a claim pays; 3 concurrent quests pay; the same holobot quests again after its claim', async () => {
  const uid = await setup({ activeTraining: legacyTraining(T - 40 * MIN),
    activeQuests: ['ACE', 'KUMA', 'SHADOW'].map((name, i) => legacyQuest(`quest_1792000000000_ok000${i}`, T - 20 * MIN, name)) });
  assert.equal((await claimT(uid, T)).ok, true);
  for (let i = 0; i < 3; i += 1) assert.equal((await claimQ(uid, `quest_1792000000000_ok000${i}`, T)).ok, true);
  await writeRewardSystem(uid, { ...(await user(uid)).rewardSystem, activeTraining: legacyTraining(T + 2 * MIN),
    activeQuests: [legacyQuest('quest_1792000000000_ok0003', T + 2 * MIN, 'ACE')] });
  assert.equal((await claimT(uid, T + 32 * MIN)).ok, true);
  assert.equal((await claimQ(uid, 'quest_1792000000000_ok0003', T + 17 * MIN)).ok, true);
  assert.equal(await trainingPaid(uid), 2); assert.equal(await questsPaid(uid), 4);
});
