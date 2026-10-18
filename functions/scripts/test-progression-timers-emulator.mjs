// Critic review 2026-10-17 S3 (host-economy-hardening-2) Firestore-emulator tests: quest / training claims validate
// elapsed time, power and boosts against the server-only users/{uid}.progressionTimers that startQuestRun /
// startTrainingSession write; a client-written rewardSystem record pays only with HOLOCITY_LEGACY_QUEST_TIMERS=1.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator required; never run against production');
const { db } = require('../lib/admin.js');
const { startQuestRun, transactStartQuestRun } = require('../lib/progression/startQuestRun.js');
const { startTrainingSession, transactStartTrainingSession } = require('../lib/progression/startTrainingSession.js');
const { claimQuestRun, transactClaimQuestRun } = require('../lib/progression/claimQuestRun.js');
const { claimTrainingSession, transactClaimTrainingSession } = require('../lib/progression/claimTrainingSession.js');
const MIN = 60 * 1000;
let serial = 0;
const uids = [];
after(async () => { for (const uid of uids) await db.doc(`users/${uid}`).delete(); });
async function setup(extra = {}) {
  const uid = `timers_${Date.now()}_${serial++}`; uids.push(uid);
  await db.doc(`users/${uid}`).set({ dailyEnergy: 100, syncPoints: 0, lifetimeSyncPoints: 0, seasonSyncPoints: 0, inventory: {},
    holobots: [{ name: 'ACE', level: 5, experience: 0, nextLevelExp: 1300, attributePoints: 0, boostedAttributes: {} }, { name: 'KUMA', level: 1, experience: 0, nextLevelExp: 400 }],
    rewardSystem: { activeQuests: [], activeTraining: null, availableQuestIds: ['forest_patrol', 'factory_raid'], syncBoostEnabled: true }, ...extra });
  return uid;
}
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
// Callable errors carry details.rejectionCode; the transact seams throw the TimerError itself (.code).
const rejection = c => e => e.details?.rejectionCode === c || (e.name === 'Error' && e.code === c && e.details === undefined);
const forgeDisplay = async (uid, patch) => { const u = await user(uid); await db.doc(`users/${uid}`).update({ rewardSystem: patch(u.rewardSystem) }); };

test('KNOWN-BAD (S3): a quest started on the host cannot be claimed early by forging the client-writable endsAt / power; nothing is written', async () => {
  const uid = await setup();
  const r = await startQuestRun.run({ auth: { uid }, data: { questId: 'abandoned_fortress', holobotName: 'ACE', requestId: 'forge_quest_01' } });
  assert.equal(r.schemaVersion, 'progression-timers-1'); assert.equal(r.alreadyProcessed, false); assert.equal(r.dailyEnergy, 70);
  assert.equal(r.questRun.endsAtMs - r.questRun.startedAtMs, 240 * MIN);
  await forgeDisplay(uid, rs => ({ ...rs, activeQuests: rs.activeQuests.map(q => ({ ...q, endsAt: '2020-01-01T00:00:00.000Z', holobotPower: 50000 })) }));
  const before = await user(uid);
  for (const legacy of ['1', undefined]) {
    if (legacy) process.env.HOLOCITY_LEGACY_QUEST_TIMERS = legacy; else delete process.env.HOLOCITY_LEGACY_QUEST_TIMERS;
    await assert.rejects(() => claimQuestRun.run({ auth: { uid }, data: { questRunId: r.questRun.id } }), e => e.code === 'failed-precondition' && rejection('not_complete')(e));
  }
  assert.deepEqual(await user(uid), before);
});

test('a host-started quest pays once at its real end from the recorded power; the record and display entry go, other rewardSystem keys stay', async () => {
  const uid = await setup();
  const r = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ace', requestId: 'quest_pay_01' }, Date.UTC(2026, 9, 17, 12));
  const replay = await transactStartQuestRun(db, uid, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'quest_pay_01' }, Date.UTC(2026, 9, 17, 12, 1));
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.questRun, r.questRun);
  assert.equal((await user(uid)).dailyEnergy, 90, 'debited once');
  await assert.rejects(() => transactClaimQuestRun(db, uid, { questRunId: r.questRun.id }, r.questRun.endsAtMs - 1, { legacyTimers: false }), rejection('not_complete'));
  const claim = await transactClaimQuestRun(db, uid, { questRunId: r.questRun.id }, r.questRun.endsAtMs, { legacyTimers: false }, 0);
  assert.equal(claim.succeeded, true); assert.equal(claim.rewards.syncPoints, 15);
  const u = await user(uid);
  assert.deepEqual(u.progressionTimers.quests, {}); assert.deepEqual(u.rewardSystem.activeQuests, []);
  assert.deepEqual(u.rewardSystem.availableQuestIds, ['forest_patrol', 'factory_raid']); assert.equal(u.rewardSystem.syncBoostEnabled, true);
  assert.equal(u.syncPoints, 15); assert.equal(u.holobots[0].experience, 50);
  // training-reward-replay-proof-1: a second claim replays the stored receipt (was: refused not_started_on_host).
  assert.deepEqual(await transactClaimQuestRun(db, uid, { questRunId: r.questRun.id }, r.questRun.endsAtMs + 1, { legacyTimers: false }, 0.99), { ...claim, alreadyProcessed: true });
  assert.equal((await user(uid)).syncPoints, 15, 'a second claim pays nothing');
});

test('legacy grace: a client-only rewardSystem quest / training pays only with HOLOCITY_LEGACY_QUEST_TIMERS=1', async () => {
  const legacyQuest = { id: 'quest_legacy_1', questId: 'forest_patrol', holobotName: 'ACE', holobotPower: 900, endsAt: '2026-01-01T00:00:00.000Z' };
  const legacyTraining = { courseId: 'attack', holobotName: 'KUMA', statBoosts: { attack: 12 }, expReward: 70, endsAt: '2026-01-01T00:00:00.000Z' };
  const uid = await setup({ rewardSystem: { activeQuests: [legacyQuest], activeTraining: legacyTraining } });
  delete process.env.HOLOCITY_LEGACY_QUEST_TIMERS;
  const before = await user(uid);
  await assert.rejects(() => claimQuestRun.run({ auth: { uid }, data: { questRunId: 'quest_legacy_1' } }), e => e.code === 'failed-precondition' && rejection('not_started_on_host')(e));
  await assert.rejects(() => claimTrainingSession.run({ auth: { uid }, data: {} }), rejection('not_started_on_host'));
  assert.deepEqual(await user(uid), before, 'refusals write nothing');
  process.env.HOLOCITY_LEGACY_QUEST_TIMERS = '1';
  try {
    await claimQuestRun.run({ auth: { uid }, data: { questRunId: 'quest_legacy_1' } });
    await claimTrainingSession.run({ auth: { uid }, data: {} });
  } finally { delete process.env.HOLOCITY_LEGACY_QUEST_TIMERS; }
  const u = await user(uid);
  assert.deepEqual(u.rewardSystem.activeQuests, []); assert.equal(u.rewardSystem.activeTraining, null);
  assert.equal(u.holobots[1].boostedAttributes.attack, 12, 'legacy record within the course clamp');
});

test('training: host roll recorded; a forged display copy (past endsAt, max boost) is ignored; claim at the real end applies the recorded boost once', async () => {
  const uid = await setup();
  const T = Date.UTC(2026, 9, 17, 12);
  const r = await transactStartTrainingSession(db, uid, { courseId: 'attack', holobotName: 'ACE', requestId: 'train_pay_01' }, T, 0);
  assert.deepEqual(r.training.statBoosts, { attack: 10 }); assert.equal(r.dailyEnergy, 90);
  await assert.rejects(() => transactStartTrainingSession(db, uid, { courseId: 'speed', holobotName: 'KUMA', requestId: 'train_pay_02' }, T, 0), rejection('training_active'));
  await forgeDisplay(uid, rs => ({ ...rs, activeTraining: { ...rs.activeTraining, endsAt: '2020-01-01T00:00:00.000Z', statBoosts: { attack: 18 } } }));
  await assert.rejects(() => transactClaimTrainingSession(db, uid, T + 30 * MIN - 1, { legacyTimers: true }), rejection('not_complete'));
  await transactClaimTrainingSession(db, uid, T + 30 * MIN, { legacyTimers: false });
  const u = await user(uid);
  assert.equal(u.holobots[0].boostedAttributes.attack, 10); assert.equal(u.progressionTimers.training, null); assert.equal(u.rewardSystem.activeTraining, null);
  assert.equal(u.rewardSystem.syncBoostEnabled, true);
  // training-reward-replay-proof-1: a retry right after the claim replays it (was: refused not_started_on_host); pays nothing.
  assert.deepEqual(await transactClaimTrainingSession(db, uid, T + 31 * MIN, { legacyTimers: false }), { claimed: true, alreadyProcessed: true });
  assert.equal((await user(uid)).holobots[0].boostedAttributes.attack, 10);
  await assert.rejects(() => transactClaimTrainingSession(db, uid, T + 46 * MIN, { legacyTimers: false }), rejection('not_started_on_host'));
});

test('start refusals write nothing: energy, slots, unknown holobot, unauthenticated; the callable starts training with host RNG', async () => {
  const uid = await setup({ dailyEnergy: 5 });
  const before = await user(uid);
  await assert.rejects(() => startQuestRun.run({ auth: { uid }, data: { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'refuse_q_01' } }), e => e.code === 'failed-precondition' && rejection('not_enough_energy')(e));
  await assert.rejects(() => startQuestRun.run({ auth: { uid }, data: { questId: 'forest_patrol', holobotName: 'SHADOW', requestId: 'refuse_q_02' } }), e => e.code === 'invalid-argument' && rejection('unknown_holobot')(e));
  await assert.rejects(() => startTrainingSession.run({ auth: { uid }, data: { courseId: 'attack', holobotName: 'ACE', requestId: 'refuse_t_01', statBoosts: { attack: 18 } } }), rejection('invalid_request'));
  await assert.rejects(() => startQuestRun.run({ data: { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'refuse_q_03' } }), e => e.code === 'unauthenticated');
  assert.deepEqual(await user(uid), before);
  const rich = await setup();
  const t = await startTrainingSession.run({ auth: { uid: rich }, data: { courseId: 'balanced', holobotName: 'KUMA', requestId: 'callable_t_01' } });
  const boost = t.training.statBoosts.attack;
  assert.ok(boost >= 5 && boost <= 8); assert.deepEqual(t.training.statBoosts, { attack: boost, defense: boost, health: boost, special: boost, speed: boost });
});
