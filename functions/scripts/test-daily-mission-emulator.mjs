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

// ---- hardening-2: every mission-counter writer MERGES its display mirror into the stored rewardSystem. ----
const { transactArenaMatch, ARENA_MIN_SETTLE_MS_CPU } = require('../lib/arena/arenaMatchStore.js');
const { transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const { purchaseMarketplaceBooster } = require('../lib/economy/purchaseMarketplaceBooster.js');
const { dailyMissionCounterUpdates } = require('../lib/lib/economy.js');
/** What the main app / lite keep in rewardSystem (normalizeProgressionSystem) besides the four mission keys. */
const questState = () => ({
  activeQuests: [{ id: 'quest_live_1', questId: 'forest_patrol', holobotName: 'KUMA', holobotPower: 900, startedAt: '2026-10-17T00:00:00.000Z', endsAt: '2026-10-17T00:15:00.000Z' }],
  activeTraining: { courseId: 'attack', holobotName: 'ACE', startedAt: '2026-10-17T00:00:00.000Z', endsAt: '2026-10-17T00:30:00.000Z', expReward: 70, statBoosts: { attack: 12 } },
  availableQuestIds: ['forest_patrol', 'cave_exploration', 'factory_raid'],
  lastQuestRefreshDate: '2026-10-17', questRefreshesRemaining: 2, syncBoostEnabled: true,
});
const assertQuestStateSurvives = (rewardSystem, label) => {
  for (const [key, value] of Object.entries(questState())) assert.deepEqual(rewardSystem[key], value, `${label}: rewardSystem.${key} survives`);
};
const arenaProfile = () => ({
  storyFlags: { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: true },
  holobots: [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1 }, { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 }],
  travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] },
  buddyUnits: { light: 0, medium: 0, heavy: 0 }, arenaPassses: 3, syncPoints: 0, wins: 0, losses: 0, emergencyPatches: 3,
  holobotVitals: { ace: { currentHealth: 60, maxHealth: 172 } },
});

test('hardening-2: an arena CPU settle keeps the active quest / training / quest board and bumps the mission mirror', async () => {
  const uid = await setup({ ...arenaProfile(), holosTokens: 1000, rewardSystem: questState() });
  const T = Date.now(), arena = (data, now) => transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...data }, now);
  const issued = await arena({ operation: 'issue', requestId: 'merge_arena_1', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE' }, T);
  await arena({ operation: 'start', matchId: issued.matchId }, T + 1);
  const settled = await arena({ operation: 'settle', matchId: issued.matchId, playerFinalHealth: 30, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, T + 1 + ARENA_MIN_SETTLE_MS_CPU);
  assert.equal(settled.match.state, 'settled');
  const u = await user(uid);
  assertQuestStateSurvives(u.rewardSystem, 'arena settle (tx.update)');
  assert.equal(u.rewardSystem.arenaBattlesToday, 1, 'display mirror bumped'); assert.equal(u[DAILY_MISSION_LEDGER_FIELD].arenaBattlesToday, 1, 'ledger bumped');
});

test('hardening-2: the desktop cache pack, openGachaPack, the booster purchase and a mission claim all keep the quest / training state', async () => {
  const uid = await setup({ gachaTickets: 3, holosTokens: 5000, rewardSystem: questState() });
  const cache = await transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.gacha_ticket', requestId: 'merge_cache_1', packId: 'basic' });
  assert.equal(cache.result.kind, 'cache');
  let u = await user(uid);
  assertQuestStateSurvives(u.rewardSystem, 'desktop cache pack (tx.update)');
  assert.equal(u.rewardSystem.boosterPacksToday, 1); assert.equal(u[DAILY_MISSION_LEDGER_FIELD].boosterPacksToday, 1);
  await openGachaPack.run({ auth: { uid }, data: { packId: 'basic' } });
  u = await user(uid); assertQuestStateSurvives(u.rewardSystem, 'openGachaPack'); assert.equal(u[DAILY_MISSION_LEDGER_FIELD].boosterPacksToday, 2);
  await purchaseMarketplaceBooster.run({ auth: { uid }, data: { packId: 'common' } });
  u = await user(uid); assertQuestStateSurvives(u.rewardSystem, 'purchaseMarketplaceBooster'); assert.equal(u[DAILY_MISSION_LEDGER_FIELD].boosterPacksToday, 3);
  await claim(uid, 'open_booster_pack');
  u = await user(uid); assertQuestStateSurvives(u.rewardSystem, 'claimDailyMission'); assert.equal(u.rewardSystem.missionClaims.open_booster_pack, getTodayMissionKey());
});

test('KNOWN-BAD control: the #143 mirror shape (four mission keys only) through tx.update wipes the quest state — the assertion above discriminates', async () => {
  const uid = await setup({ rewardSystem: questState() });
  const profile = await user(uid);
  const merged = dailyMissionCounterUpdates(profile, 'arenaBattlesToday', new Date());
  const { arenaBattlesToday, boosterPacksToday, lastDailyMissionReset, missionClaims } = merged.rewardSystem;
  await db.runTransaction(async tx => { tx.update(db.doc(`users/${uid}`), { rewardSystem: { arenaBattlesToday, boosterPacksToday, lastDailyMissionReset, missionClaims } }); });
  const wiped = (await user(uid)).rewardSystem;
  assert.equal(wiped.activeQuests, undefined); assert.equal(wiped.activeTraining, undefined); assert.equal(wiped.availableQuestIds, undefined);
  assert.throws(() => assertQuestStateSurvives(wiped, 'control'));
});

// ---- hardening-2 item 5: desktopAccountSnapshot serves the ledger summary (clients stop reading the mirror). ----
const { writeFileSync } = require('node:fs');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const AjvRules = createRequire(new URL('../../rules-tests/package.json', import.meta.url))('ajv');
const validateLedgerSummary = new AjvRules({ strict: false }).compile(require('../../Schemas/daily-mission-ledger-1.json'));
test('hardening-2: every desktop-account version carries dailyMissionLedger from the server-only ledger; a forged mirror changes no count or claim', async () => {
  const uid = await setup({ gachaTickets: 1 });
  await openGachaPack.run({ auth: { uid }, data: { packId: 'basic' } });
  await claim(uid, 'daily_login'); await claim(uid, 'open_booster_pack');
  const tamperedMirror = { arenaBattlesToday: 99, boosterPacksToday: 99 };
  await db.doc(`users/${uid}`).update({ 'rewardSystem.arenaBattlesToday': 99, 'rewardSystem.boosterPacksToday': 99 });
  const expected = { schemaVersion: 'daily-mission-ledger-1', day: getTodayMissionKey(), arenaBattlesToday: 0, boosterPacksToday: 1, claimed: { daily_login: true, arena_v2_battle: false, open_booster_pack: true } };
  let v3;
  for (const data of [{}, { schemaVersion: 'desktop-account-2' }, { schemaVersion: 'desktop-account-3' }]) {
    const r = await desktopAccountSnapshot.run({ auth: { uid }, data });
    assert.ok(validateLedgerSummary(r.dailyMissionLedger), JSON.stringify(validateLedgerSummary.errors));
    assert.deepEqual(r.dailyMissionLedger, expected, r.schemaVersion);
    v3 = r;
  }
  assert.equal((await user(uid)).dailyMissionLedger.boosterPacksToday, 1, 'a snapshot read writes no ledger');
  if (process.env.DAILY_MISSION_LEDGER_FIXTURE_OUT) writeFileSync(process.env.DAILY_MISSION_LEDGER_FIXTURE_OUT, JSON.stringify({
    provenance: 'Offline demo emulator: openGachaPack, claimDailyMission daily_login + open_booster_pack, then the owner forged the rewardSystem mirror counters; desktopAccountSnapshot desktop-account-3 reply excerpt.',
    request: { schemaVersion: 'desktop-account-3' }, tamperedMirror, reply: { schemaVersion: v3.schemaVersion, dailyMissionLedger: v3.dailyMissionLedger },
  }, null, 2) + '\n');
});
