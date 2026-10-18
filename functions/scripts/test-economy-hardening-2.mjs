// host-economy-hardening-2 pure unit tests (no emulator). Emulator twins: test-daily-mission-emulator.mjs,
// test-arena-match-emulator.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
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
});
