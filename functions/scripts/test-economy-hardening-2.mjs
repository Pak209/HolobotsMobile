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
