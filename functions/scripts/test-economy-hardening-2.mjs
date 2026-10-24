// host-economy-hardening-2 pure unit tests (no emulator). Emulator twins: test-daily-mission-emulator.mjs,
// test-arena-match-emulator.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinFlags, withFlags } from './lib/flag-env.mjs';
// Stat-derived assertions pin the pre-#72.78 (flag OFF) tables; the ON counterpart is in the item 4 test below.
pinFlags({ HOLOCITY_FIGHT_ATTRS: undefined });
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../lib/lib/economy.js');

const DAY = new Date('2026-10-17T12:00:00.000Z');
const questKeys = { activeQuests: [{ id: 'q1', questId: 'forest_patrol' }], activeTraining: { courseId: 'attack' }, availableQuestIds: ['forest_patrol'], syncBoostEnabled: true };

test('item 2: the rewardSystem mission mirror merges into the stored map (quest / training keys kept, mission keys replaced)', () => {
  const stored = { ...questKeys, arenaBattlesToday: 7, boosterPacksToday: 2, lastDailyMissionReset: '2026-10-16', missionClaims: { daily_login: '2026-10-16' } };
  const u = E.dailyMissionCounterUpdates({ rewardSystem: stored }, 'arenaBattlesToday', DAY);
  assert.deepEqual(u.rewardSystem, { ...questKeys, arenaBattlesToday: 1, boosterPacksToday: 0, lastDailyMissionReset: '2026-10-17', missionClaims: { daily_login: '2026-10-16' } });
  assert.deepEqual(u[E.DAILY_MISSION_LEDGER_FIELD], { arenaBattlesToday: 1, boosterPacksToday: 0, lastDailyMissionReset: '2026-10-17', missionClaims: {} }, 'the ledger never inherits rewardSystem keys');
  for (const junk of [undefined, null, 'x', 7, ['activeQuests']])
    assert.deepEqual(Object.keys(E.dailyMissionCounterUpdates({ rewardSystem: junk }, 'boosterPacksToday', DAY).rewardSystem), ['arenaBattlesToday', 'boosterPacksToday', 'lastDailyMissionReset', 'missionClaims'], String(junk));
  const claim = E.buildMissionClaimUpdatesRaw({ rewardSystem: { ...questKeys } }, 'daily_login', DAY);
  assert.equal(claim.refusal, null);
  for (const [key, value] of Object.entries(questKeys)) assert.deepEqual(claim.updates.rewardSystem[key], value, `claim keeps ${key}`);
  assert.equal(claim.updates.rewardSystem.missionClaims.daily_login, '2026-10-17');
});

// ---- item 4 (critic S3): server-side quest / training start records ----
const PT = require('../lib/lib/progressionTimers.js');
const PE = require('../lib/lib/progressionEconomy.js');
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0), MIN = 60 * 1000;
const pilot = (extra = {}) => ({ dailyEnergy: 100, holobots: [{ name: 'ACE', level: 5, boostedAttributes: { attack: 4 } }, { name: 'KUMA', level: 2 }, { name: 'WOLF', level: 1 }, { name: 'HARE', level: 1 }], rewardSystem: { ...questKeys, activeQuests: [] }, ...extra });
const code = c => e => e instanceof PT.TimerError && e.code === c;
const startQ = (profile, questId, holobotName, requestId, now = T0) => PT.buildQuestStart(profile, { questId, holobotName, requestId }, now);
const apply = (profile, updates) => ({ ...profile, ...updates });

test('item 4: startQuestRun records host clock + host power, debits energy, appends the display copy and keeps rewardSystem', () => {
  const p = pilot();
  const r = startQ(p, 'factory_raid', 'ace', 'req_quest_0001');
  assert.equal(r.alreadyProcessed, false);
  const power = PE.getHolobotPowerScore(p.holobots[0]);
  assert.deepEqual(r.run, { runId: 'qr_req_quest_0001', questId: 'factory_raid', holobotName: 'ACE', holobotPower: power, energyCost: 20, startedAtMs: T0, endsAtMs: T0 + 60 * MIN });
  assert.equal(r.updates.dailyEnergy, 80);
  assert.deepEqual(r.updates.progressionTimers, { schemaVersion: 'progression-timers-1', quests: { qr_req_quest_0001: r.run }, training: null });
  const shown = r.updates.rewardSystem.activeQuests;
  assert.equal(shown.length, 1); assert.equal(shown[0].id, 'qr_req_quest_0001'); assert.equal(shown[0].endsAt, new Date(T0 + 60 * MIN).toISOString());
  for (const k of ['activeTraining', 'availableQuestIds', 'syncBoostEnabled']) assert.deepEqual(r.updates.rewardSystem[k], questKeys[k], k);
  // Replay of the same requestId is read-only; a different quest under it conflicts.
  const after = apply(p, r.updates);
  const replay = startQ(after, 'factory_raid', 'ACE', 'req_quest_0001', T0 + 5000);
  assert.equal(replay.alreadyProcessed, true); assert.equal(replay.updates, null); assert.deepEqual(replay.run, r.run);
  assert.throws(() => startQ(after, 'forest_patrol', 'ACE', 'req_quest_0001'), code('request_conflict'));
});

test('item 4: startQuestRun refusals (unknown quest / holobot, busy, 3 slots, energy, malformed state, extra fields)', () => {
  const p = pilot();
  assert.throws(() => startQ(p, 'moon_raid', 'ACE', 'req_quest_0002'), code('unknown_quest'));
  assert.throws(() => startQ(p, 'forest_patrol', 'SHADOW', 'req_quest_0002'), code('unknown_holobot'));
  assert.throws(() => startQ(pilot({ holobots: [{ name: 'ACE' }, { name: 'ace' }] }), 'forest_patrol', 'ACE', 'req_quest_0002'), code('unknown_holobot'), 'duplicate identity');
  let s = p;
  for (const [i, bot] of ['ACE', 'KUMA', 'WOLF'].entries()) s = apply(s, startQ(s, 'forest_patrol', bot, `req_slot_000${i}`).updates);
  assert.throws(() => startQ(s, 'forest_patrol', 'ACE', 'req_slot_0009'), code('holobot_busy'));
  assert.throws(() => startQ(s, 'forest_patrol', 'HARE', 'req_slot_0009'), code('quest_slots_full'));
  assert.throws(() => startQ(pilot({ dailyEnergy: 9 }), 'forest_patrol', 'ACE', 'req_quest_0003'), code('not_enough_energy'));
  for (const dailyEnergy of [-1, 'x', NaN]) assert.throws(() => startQ(pilot({ dailyEnergy }), 'forest_patrol', 'ACE', 'req_quest_0003'), code('unavailable'));
  for (const bad of [{ questId: 'forest_patrol', holobotName: 'ACE', requestId: 'short' }, { questId: 'forest_patrol', holobotName: 'ACE', requestId: 'req_quest_0004', endsAt: 0 }, { questId: 'forest_patrol', requestId: 'req_quest_0004' }, null])
    assert.throws(() => PT.buildQuestStart(p, bad, T0), code('invalid_request'), JSON.stringify(bad));
  const forged = { schemaVersion: 'progression-timers-1', quests: { qr_req_quest_0005: { runId: 'qr_req_quest_0005', questId: 'forest_patrol', holobotName: 'ACE', holobotPower: 1, energyCost: 10, startedAtMs: T0, endsAtMs: T0 } }, training: null };
  assert.throws(() => startQ(pilot({ progressionTimers: forged }), 'forest_patrol', 'KUMA', 'req_quest_0006'), code('unavailable'), 'endsAt must equal start + table duration');
});

test('KNOWN-BAD (S3): a forged rewardSystem endsAt / holobotPower is refused or ignored; the claim pays only from the server record after its real duration', () => {
  const p = pilot();
  const started = startQ(p, 'abandoned_fortress', 'ACE', 'req_quest_0010');
  // The owner rewrites the client-writable display copy: endsAt in the past, power at the cap.
  const forged = apply(p, { ...started.updates, rewardSystem: { ...started.updates.rewardSystem, activeQuests: [{ ...started.updates.rewardSystem.activeQuests[0], endsAt: '2020-01-01T00:00:00.000Z', holobotPower: 50000 }] } });
  for (const legacy of [false, true]) {
    assert.throws(() => PT.resolveQuestClaim(forged, 'qr_req_quest_0010', T0 + 1000, legacy), code('not_complete'), `legacy flag ${legacy}: the server record wins`);
    assert.throws(() => PT.resolveQuestClaim(forged, 'qr_req_quest_0010', T0 + 240 * MIN - 1, legacy), code('not_complete'));
  }
  const ok = PT.resolveQuestClaim(forged, 'qr_req_quest_0010', T0 + 240 * MIN, false);
  assert.equal(ok.source, 'host');
  assert.deepEqual(ok.record, { id: 'qr_req_quest_0010', questId: 'abandoned_fortress', holobotName: 'ACE', holobotPower: started.run.holobotPower });
  assert.deepEqual(ok.timerUpdates.progressionTimers.quests, {}, 'the claimed run is removed');
  // A legacy-shaped client record with no server record: refused unless HOLOCITY_LEGACY_QUEST_TIMERS=1.
  const legacy = pilot({ rewardSystem: { activeQuests: [{ id: 'quest_legacy_1', questId: 'abandoned_fortress', holobotName: 'ACE', holobotPower: 50000, endsAt: '2020-01-01T00:00:00.000Z' }] } });
  assert.throws(() => PT.resolveQuestClaim(legacy, 'quest_legacy_1', T0, false), code('not_started_on_host'));
  assert.equal(PT.resolveQuestClaim(legacy, 'quest_legacy_1', T0, true).source, 'legacy', 'grace path, flag on');
  assert.throws(() => PT.resolveQuestClaim(legacy, 'quest_nope', T0, true), code('not_active'));
  assert.throws(() => PT.resolveQuestClaim(pilot({ rewardSystem: { activeQuests: [{ id: 'q_future', questId: 'forest_patrol', endsAt: new Date(T0 + 1).toISOString() }] } }), 'q_future', T0, true), code('not_complete'));
});

test('item 4: training start rolls boosts on the host; the claim uses the recorded boosts after the real duration', () => {
  const p = pilot();
  const low = PT.buildTrainingStart(p, { courseId: 'attack', holobotName: 'ACE', requestId: 'req_train_0001' }, T0, 0);
  const high = PT.buildTrainingStart(p, { courseId: 'attack', holobotName: 'ACE', requestId: 'req_train_0001' }, T0, 0.999999);
  assert.deepEqual([low.run.statBoosts, high.run.statBoosts], [{ attack: 10 }, { attack: 18 }]);
  const balanced = PT.buildTrainingStart(p, { courseId: 'balanced', holobotName: 'ACE', requestId: 'req_train_0002' }, T0, 0.5);
  assert.deepEqual(balanced.run.statBoosts, { attack: 7, defense: 7, health: 7, special: 7, speed: 7 });
  assert.equal(balanced.run.endsAtMs, T0 + 60 * MIN); assert.equal(balanced.updates.dailyEnergy, 80);
  assert.deepEqual(balanced.updates.rewardSystem.activeQuests, [], 'rewardSystem kept'); assert.equal(balanced.updates.rewardSystem.activeTraining.endsAt, new Date(T0 + 60 * MIN).toISOString());
  const s = apply(p, low.updates);
  assert.throws(() => PT.buildTrainingStart(s, { courseId: 'speed', holobotName: 'KUMA', requestId: 'req_train_0003' }, T0, 0), code('training_active'));
  assert.equal(PT.buildTrainingStart(s, { courseId: 'attack', holobotName: 'ACE', requestId: 'req_train_0001' }, T0 + 9, 0.7).alreadyProcessed, true);
  const forged = apply(s, { rewardSystem: { ...s.rewardSystem, activeTraining: { ...s.rewardSystem.activeTraining, endsAt: '2020-01-01T00:00:00.000Z', statBoosts: { attack: 18 } } } });
  assert.throws(() => PT.resolveTrainingClaim(forged, T0 + 30 * MIN - 1, true), code('not_complete'));
  const claim = PT.resolveTrainingClaim(forged, T0 + 30 * MIN, false);
  assert.deepEqual(claim.record.statBoosts, { attack: 10 }, 'the host roll, not the forged copy');
  assert.equal(claim.timerUpdates.progressionTimers.training, null);
  assert.throws(() => PT.resolveTrainingClaim(pilot({ rewardSystem: { activeTraining: { courseId: 'attack', endsAt: '2020-01-01T00:00:00.000Z' } } }), T0, false), code('not_started_on_host'));
  assert.equal(PT.resolveTrainingClaim(pilot({ rewardSystem: { activeTraining: { courseId: 'attack', endsAt: '2020-01-01T00:00:00.000Z' } } }), T0, true).source, 'legacy');
});

test('item 4: HOLOCITY_LEGACY_QUEST_TIMERS is on only for exactly "1"; the power score is the client formula', () => {
  for (const [v, on] of [['1', true], [undefined, false], ['', false], ['0', false], ['true', false], [' 1', false]]) assert.equal(PT.legacyQuestTimersEnabled({ HOLOCITY_LEGACY_QUEST_TIMERS: v }), on, String(v));
  const s = require('../lib/lib/progression.js').getHolobotBattleStats('ACE', 5, { attack: 4 });
  assert.equal(PE.getHolobotPowerScore({ name: 'ACE', level: 5, boostedAttributes: { attack: 4 } }), Math.round(s.maxHP * 4 + s.attack * 6 + s.defense * 5 + s.speed * 4 + s.intelligence * 5));
  // Production (#72.86): FIGHT_ATTRS ON moves the fight speed (rules-5 table) but the power score keeps the pre-#72.78
  // speed column (getLegacyBattleSpeed), so quest odds and stored holobotPower values are unchanged.
  const offScore = PE.getHolobotPowerScore({ name: 'ACE', level: 5, boostedAttributes: { attack: 4 } });
  withFlags({ HOLOCITY_FIGHT_ATTRS: '1' }, () => {
    const on = require('../lib/lib/progression.js').getHolobotBattleStats('ACE', 5, { attack: 4 });
    assert.notEqual(on.speed, s.speed, 'the rules-5 table really moved ACE speed');
    assert.equal(PE.getHolobotPowerScore({ name: 'ACE', level: 5, boostedAttributes: { attack: 4 } }), offScore);
  });
});

// ---- item 5: dailyMissionLedger summary on desktop-account replies ----
const { default: Ajv } = require('ajv');
const S = require('../lib/desktop/desktopAccountReply.js');
const validateSummary = new Ajv({ strict: false }).compile(require('../../Schemas/daily-mission-ledger-1.json'));
const TODAY = '2026-10-17';
const ledger = (fields = {}) => ({ arenaBattlesToday: 2, boosterPacksToday: 1, lastDailyMissionReset: TODAY, missionClaims: { daily_login: TODAY }, ...fields });

test('item 5: the summary reads counts from the server-only ledger only; claimed matches the claim refusal rule (ledger OR mirror)', () => {
  const summary = E.dailyMissionLedgerSummary({ dailyMissionLedger: ledger(), rewardSystem: { arenaBattlesToday: 99, boosterPacksToday: 99, lastDailyMissionReset: TODAY, missionClaims: { open_booster_pack: TODAY } } }, DAY);
  assert.deepEqual(summary, { schemaVersion: 'daily-mission-ledger-1', day: TODAY, arenaBattlesToday: 2, boosterPacksToday: 1, claimed: { daily_login: true, arena_v2_battle: false, open_booster_pack: true } });
  assert.ok(validateSummary(summary), JSON.stringify(validateSummary.errors));
  // The summary's claimed flags agree with what claimDailyMission would rule for the same account.
  const account = { dailyMissionLedger: ledger({ arenaBattlesToday: 3 }), rewardSystem: { missionClaims: { open_booster_pack: TODAY } } };
  const s = E.dailyMissionLedgerSummary(account, DAY);
  for (const id of ['daily_login', 'arena_v2_battle', 'open_booster_pack'])
    assert.equal(s.claimed[id], E.buildMissionClaimUpdatesRaw(account, id, DAY).refusal === 'already_claimed', id);
  // Another UTC day, no ledger, or junk: zero counts, nothing claimed.
  for (const profile of [{ dailyMissionLedger: ledger({ lastDailyMissionReset: '2026-10-16' }) }, {}, { dailyMissionLedger: 'x', rewardSystem: [] }, { dailyMissionLedger: ledger({ arenaBattlesToday: -4, boosterPacksToday: 1.5 }) }]) {
    const z = E.dailyMissionLedgerSummary(profile, DAY);
    assert.ok(validateSummary(z), JSON.stringify(validateSummary.errors));
    assert.equal(z.claimed.arena_v2_battle, false);
  }
  const yesterday = { dailyMissionLedger: ledger({ lastDailyMissionReset: '2026-10-16', missionClaims: { daily_login: '2026-10-16', arena_v2_battle: '2026-10-16' } }) };
  assert.deepEqual(E.dailyMissionLedgerSummary(yesterday, DAY), { schemaVersion: 'daily-mission-ledger-1', day: TODAY, arenaBattlesToday: 0, boosterPacksToday: 0, claimed: { daily_login: false, arena_v2_battle: false, open_booster_pack: false } });
  assert.equal(E.dailyMissionLedgerSummary({ dailyMissionLedger: ledger({ arenaBattlesToday: -4 }) }, DAY).arenaBattlesToday, 0);
  // Known-bad control: the schema refuses a client-ish shape (extra field, string count).
  assert.equal(validateSummary({ ...summary, missionClaims: {} }), false);
  assert.equal(validateSummary({ ...summary, arenaBattlesToday: '2' }), false);
});

test('item 5: every desktop-account version carries the summary for the host day; the stored profile is untouched; the frozen fixture validates', () => {
  const profile = { dailyMissionLedger: ledger(), rewardSystem: { activeQuests: [] } };
  const before = structuredClone(profile);
  for (const version of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
    const r = S.buildDesktopAccountReply(profile, 'uid-1', version, { light: 0, medium: 0, heavy: 0 }, DAY.getTime());
    assert.deepEqual(r.dailyMissionLedger, E.dailyMissionLedgerSummary(profile, DAY), version);
  }
  assert.deepEqual(profile, before);
  const fixture = require('./fixtures/desktop-account/daily-mission-ledger.json');
  assert.ok(validateSummary(fixture.reply.dailyMissionLedger), JSON.stringify(validateSummary.errors));
  assert.equal(fixture.reply.schemaVersion, 'desktop-account-3');
  assert.deepEqual(fixture.reply.dailyMissionLedger.claimed, { daily_login: true, arena_v2_battle: false, open_booster_pack: true });
  assert.equal(fixture.reply.dailyMissionLedger.boosterPacksToday, 1);
  assert.equal(fixture.tamperedMirror.boosterPacksToday, 99, 'the fixture account had a forged mirror the summary ignored');
});

// ---- training-reward-replay-proof-1: the server-only claim ledger (progressionTimers.claimed) ----
const legacyT = (startMs, extra = {}) => ({ courseId: 'attack', holobotName: 'KUMA', statBoosts: { attack: 12 }, expReward: 70, startedAt: new Date(startMs).toISOString(), endsAt: new Date(startMs + 30 * MIN).toISOString(), ...extra });
const paidT = (profile, now) => { const r = PT.resolveTrainingClaim(profile, now, true); return { ...profile, progressionTimers: PT.settleTrainingClaim(r, now).progressionTimers, rewardSystem: { ...profile.rewardSystem, activeTraining: null } }; };

test('replay-proof: a paid legacy training is in the ledger by course + holobot + start; the same copy replays, a pre-claim start is refused (5 min skew)', () => {
  const p = pilot({ rewardSystem: { ...questKeys, activeQuests: [], activeTraining: legacyT(T0) } });
  const r = PT.resolveTrainingClaim(p, T0 + 30 * MIN, true);
  assert.equal(r.source, 'legacy');
  const after = paidT(p, T0 + 30 * MIN);
  assert.deepEqual(after.progressionTimers.claimed, { [`t:attack:KUMA:${T0}`]: { kind: 'training', source: 'legacy', runId: '', subject: 'attack', holobotName: 'KUMA', startedAtMs: T0, claimedAtMs: T0 + 30 * MIN } });
  const restored = { ...after, rewardSystem: { ...after.rewardSystem, activeTraining: legacyT(T0) } };
  for (const flag of [true, false]) {
    const replay = PT.resolveTrainingClaim(restored, T0 + 90 * MIN, flag);
    assert.equal(replay.source, 'replay'); assert.deepEqual(replay.displayUpdates, { 'rewardSystem.activeTraining': null });
  }
  const claimAt = T0 + 30 * MIN, skew = PT.LEGACY_CLOCK_SKEW_MS;
  assert.equal(PT.resolveTrainingClaim({ ...after, rewardSystem: { activeTraining: legacyT(claimAt - skew) } }, T0 + 90 * MIN, true).source, 'legacy');
  assert.throws(() => PT.resolveTrainingClaim({ ...after, rewardSystem: { activeTraining: legacyT(claimAt - skew - 1) } }, T0 + 90 * MIN, true), code('not_started_on_host'));
  // No record + nothing claimed recently: the old refusals.
  assert.throws(() => PT.resolveTrainingClaim(after, claimAt + PT.TRAINING_REPLAY_WINDOW_MS + 1, true), code('not_active'));
  assert.equal(PT.resolveTrainingClaim(after, claimAt + PT.TRAINING_REPLAY_WINDOW_MS, false).source, 'replay');
});

test('replay-proof: starts keep the ledger, and a profile without one gains no key; a malformed ledger fails closed', () => {
  const after = paidT(pilot({ rewardSystem: { ...questKeys, activeQuests: [], activeTraining: legacyT(T0) } }), T0 + 30 * MIN);
  const ledger = after.progressionTimers.claimed;
  assert.deepEqual(PT.buildTrainingStart(after, { courseId: 'attack', holobotName: 'ACE', requestId: 'req_train_0101' }, T0 + 40 * MIN, 0).updates.progressionTimers.claimed, ledger);
  assert.deepEqual(startQ(after, 'forest_patrol', 'ACE', 'req_quest_0101', T0 + 40 * MIN).updates.progressionTimers.claimed, ledger);
  assert.equal('claimed' in startQ(pilot(), 'forest_patrol', 'ACE', 'req_quest_0102').updates.progressionTimers, false);
  const [key, run] = Object.entries(ledger)[0];
  for (const bad of [[], 'x', { [key]: { ...run, kind: 'nope' } }, { [key]: { ...run, startedAtMs: T0 + 1 } }, { [key]: { ...run, holobotName: 'kuma' } },
    { [`q:forest_patrol:KUMA:${T0}`]: { ...run, kind: 'quest', subject: 'forest_patrol' } }, { [key]: { ...run, succeeded: true } }])
    assert.throws(() => PT.readProgressionTimers({ ...after.progressionTimers, claimed: bad }), code('unavailable'), JSON.stringify(bad).slice(0, 80));
});

test('replay-proof: the ledger keeps the most recent MAX_CLAIMED_RUNS claims', () => {
  let timers = PT.readProgressionTimers(undefined);
  for (let i = 0; i < PT.MAX_CLAIMED_RUNS + 5; i += 1)
    timers = PT.withClaimedRun(timers, { kind: 'quest', source: 'legacy', runId: `quest_${i}`, subject: 'forest_patrol', holobotName: 'ACE', startedAtMs: T0 + i * 20 * MIN, claimedAtMs: T0 + i * 20 * MIN + 15 * MIN, succeeded: true });
  const kept = Object.values(timers.claimed).map((r) => r.runId);
  assert.equal(kept.length, PT.MAX_CLAIMED_RUNS); assert.equal(kept.includes('quest_4'), false); assert.equal(kept.includes('quest_5'), true);
  assert.deepEqual(PT.readProgressionTimers(timers), timers);
});

test('replay-proof: quests replay by run id or identity; a qr_ copy with no server record never pays; legacy slots and holobots follow the original app', () => {
  const q = (id, startMs, holobotName = 'ACE') => ({ id, questId: 'forest_patrol', holobotName, holobotPower: 900, startedAt: new Date(startMs).toISOString(), endsAt: new Date(startMs + 15 * MIN).toISOString() });
  const pay = (profile, id, now) => { const r = PT.resolveQuestClaim(profile, id, now, true); assert.equal(r.source, 'legacy', id); return { ...profile, progressionTimers: PT.settleQuestClaim(r, true, now).progressionTimers, rewardSystem: { ...profile.rewardSystem, activeQuests: profile.rewardSystem.activeQuests.filter((e) => e.id !== id) } }; };
  let p = pilot({ rewardSystem: { ...questKeys, activeQuests: [q('quest_a', T0), q('quest_b', T0, 'KUMA'), q('quest_c', T0, 'WOLF'), q('quest_d', T0, 'HARE')] } });
  for (const id of ['quest_a', 'quest_b', 'quest_c']) p = pay(p, id, T0 + 15 * MIN);
  assert.throws(() => PT.resolveQuestClaim(p, 'quest_d', T0 + 15 * MIN, true), code('not_started_on_host'), 'a 4th concurrent legacy quest');
  const byId = PT.resolveQuestClaim(p, 'quest_a', T0 + 16 * MIN, false);
  assert.equal(byId.source, 'replay'); assert.equal(byId.prior.succeeded, true); assert.deepEqual(byId.displayUpdates, {});
  const renamed = { ...p, rewardSystem: { ...p.rewardSystem, activeQuests: [q('quest_a_copy', T0)] } };
  assert.deepEqual(PT.resolveQuestClaim(renamed, 'quest_a_copy', T0 + 16 * MIN, true).displayUpdates, { 'rewardSystem.activeQuests': [] }, 'a re-id\'d copy of a paid run replays by identity and is pruned');
  assert.throws(() => PT.resolveQuestClaim({ ...p, rewardSystem: { activeQuests: [q('quest_e', T0 + 5 * MIN)] } }, 'quest_e', T0 + 30 * MIN, true), code('not_started_on_host'), 'ACE was busy until its claim');
  assert.equal(PT.resolveQuestClaim({ ...p, rewardSystem: { activeQuests: [q('quest_f', T0 + 15 * MIN)] } }, 'quest_f', T0 + 30 * MIN, true).source, 'legacy', 'ACE again after its claim');
  assert.throws(() => PT.resolveQuestClaim(pilot({ rewardSystem: { activeQuests: [{ ...q('qr_req_quest_0999', T0), id: 'qr_req_quest_0999' }] } }), 'qr_req_quest_0999', T0 + 15 * MIN, true), code('not_active'));
  assert.equal(PT.resolveQuestClaim(pilot({ rewardSystem: { activeQuests: [{ id: 'q_x', questId: 'nope', endsAt: '2020-01-01T00:00:00.000Z' }] } }), 'q_x', T0, true).claim, null, 'unknown quest: applyQuestClaim refuses it');
});
