// DECISIONS #43 domain tests: Buddy Unit inventory, daily rival reward, rival ladder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/rivalLadder.js');
const { readPlayerUnits } = require('../lib/acquisition/wildEncounterStore.js');
const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 30, 12, 0, 0); // 2026-09-30 12:00 UTC
let n = 0;
const rnd = () => (n = (n * 9301 + 49297) % 233280) / 233280;
const issue = (profile, now = T0, id = 'rb_test') => L.issueRivalBattle(profile, now, id, rnd);
const apply = (profile, updates) => Object.assign(profile, updates);
// Issue, then settle, applying writes the way the store does.
function play(profile, didWin, now = T0, id = `rb_${n++}`) {
  const i = issue(profile, now, id); apply(profile, i.userUpdates);
  const s = L.settleRivalBattle(profile, i.battle, id, didWin, now); apply(profile, s.userUpdates);
  return { ...s, battle: { ...i.battle, ...s.battleUpdates } };
}

test('data table: constants, rival count by tier, monotone difficulty, real roster ids', () => {
  assert.equal(L.STARTING_BUDDY_UNITS, 1); assert.equal(L.DAILY_RIVAL_REWARD_BUDDY_UNITS, 1); assert.equal(L.RIVAL_WINS_PER_TIER, 10);
  for (const [tier, rivals] of [[0, 1], [1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [9, 3], [10, 3], [40, 3]]) {
    assert.equal(L.rivalCountForTier(tier), rivals); assert.equal(L.getRivalTierRow(tier).rivals, rivals, `tier ${tier}`);
    assert.equal(L.buildRivalLineup(tier, rnd).opponentSquad.length, rivals);
  }
  L.RIVAL_TIER_TABLE.forEach((row, i) => { assert.equal(row.tier, i); assert.equal(row.rivals, L.rivalCountForTier(i)); });
  for (let t = 1; t < 30; t++) { const a = L.getRivalTierRow(t - 1), b = L.getRivalTierRow(t); assert.ok(b.statScale > a.statScale, `scale ${t}`); assert.ok(b.level >= a.level && b.level <= L.RIVAL_MAX_LEVEL); }
  assert.equal(L.getRivalTierRow(1000).level, L.RIVAL_MAX_LEVEL);
  assert.deepEqual([...L.RIVAL_ROSTER_IDS].sort(), ['ace', 'era', 'gama', 'hare', 'ken', 'kuma', 'kurai', 'shadow', 'tora', 'tsuin', 'wake', 'wolf']);
  for (let k = 0; k < 50; k++) { const ids = L.buildRivalLineup(4, rnd).opponentSquad.map(c => c.holobotId); assert.equal(new Set(ids).size, 3); ids.forEach(id => assert.ok(L.RIVAL_ROSTER_IDS.includes(id))); }
});

test('lineup uses the Unity CombatantSnapshot / NpcPilotSnapshot shape and scales per tier', () => {
  const lo = L.buildRivalLineup(0, rnd), hi = L.buildRivalLineup(5, rnd);
  assert.deepEqual(Object.keys(lo.opponentPilot).sort(), ['displayName', 'pilotId', 'tier']);
  assert.deepEqual(Object.keys(lo.opponentSquad[0]).sort(), ['attack', 'defense', 'deployment', 'holobotId', 'level', 'maxHealth', 'maxStamina', 'moves', 'staminaRegen']);
  assert.deepEqual(Object.keys(lo.opponentSquad[0].moves[0]).sort(), ['breakPower', 'chargeable', 'damageScale', 'moveId', 'staminaCost']);
  assert.ok(hi.opponentSquad[0].level > lo.opponentSquad[0].level);
  for (const k of ['maxHealth', 'attack', 'defense']) assert.ok(hi.opponentSquad[0][k] > lo.opponentSquad[0][k], k);
});

test('tier boundaries 9→10 and 19→20; status counts wins to next tier', () => {
  const p = { buddyUnits: 0, rivalWins: 9 };
  let r = play(p, true, T0); assert.equal(r.reply.tierBefore, 0); assert.equal(r.reply.tierAfter, 1); assert.equal(p.rivalWins, 10);
  assert.equal(r.reply.status.winsToNextTier, 10); assert.equal(r.reply.status.rivalsThisTier, 1);
  p.rivalWins = 19; r = play(p, true, T0 + DAY); assert.equal(r.reply.tierBefore, 1); assert.equal(r.reply.tierAfter, 2); assert.equal(r.reply.status.rivalsThisTier, 2);
  assert.equal(L.tierForWins(39), 3); assert.equal(L.tierForWins(40), 4);
  const s = L.rivalStatus({ buddyUnits: 0, rivalWins: 9 }, T0).reply.status; assert.equal(s.tier, 0); assert.equal(s.winsToNextTier, 1);
  assert.equal(issue({ buddyUnits: 0, rivalWins: 40 }).reply.encounter.opponentSquad.length, 3);
  assert.equal(issue({ buddyUnits: 0, rivalWins: 20 }).reply.encounter.opponentSquad.length, 2);
  assert.equal(issue({ buddyUnits: 0, rivalWins: 19 }).reply.encounter.opponentSquad.length, 1);
});

test('first win of the UTC day grants one Unit, the second does not, next UTC day grants again', () => {
  const p = { buddyUnits: 0 };
  let r = play(p, true, T0); assert.equal(r.reply.buddyUnitsGranted, 1); assert.equal(p.buddyUnits, 1); assert.equal(p.rivalRewardDay, '2026-09-30'); assert.equal(r.reply.status.dailyRewardAvailable, false);
  r = play(p, true, T0 + 1000); assert.equal(r.reply.buddyUnitsGranted, 0); assert.equal(p.buddyUnits, 1); assert.equal(p.rivalWins, 2);
  // 23:59:59 UTC same day still no; 00:00 next UTC day yes.
  const endOfDay = Date.UTC(2026, 8, 30, 23, 59, 59);
  assert.equal(play(p, true, endOfDay).reply.buddyUnitsGranted, 0);
  assert.equal(L.rivalStatus(p, Date.UTC(2026, 9, 1, 0, 0, 0)).reply.status.dailyRewardAvailable, true);
  r = play(p, true, Date.UTC(2026, 9, 1, 0, 0, 0)); assert.equal(r.reply.buddyUnitsGranted, 1); assert.equal(p.buddyUnits, 2); assert.equal(p.rivalRewardDay, '2026-10-01');
});

test('a loss grants nothing, does not count toward the tier, and keeps the daily reward available', () => {
  const p = { buddyUnits: 2, rivalWins: 9 };
  const r = play(p, false); assert.equal(r.reply.buddyUnitsGranted, 0); assert.equal(r.reply.tierAfter, 0); assert.equal(p.rivalWins, 9); assert.equal(p.buddyUnits, 2);
  assert.equal(p.rivalRewardDay, undefined); assert.equal(r.reply.status.dailyRewardAvailable, true); assert.deepEqual(r.userUpdates, {});
  assert.equal(play(p, true).reply.buddyUnitsGranted, 1); // retry the same day after a loss
});

test('duplicate settle is a no-op that replays the original ruling', () => {
  const p = { buddyUnits: 0 };
  const first = play(p, true, T0, 'rb_dup');
  const snapshot = structuredClone(p);
  const again = L.settleRivalBattle(p, first.battle, 'rb_dup', true, T0 + 5);
  assert.equal(again.reply.alreadyProcessed, true); assert.equal(again.battleUpdates, null); assert.deepEqual(again.userUpdates, {});
  assert.equal(again.reply.buddyUnitsGranted, 1); assert.equal(again.reply.status.buddyUnits, 1); assert.deepEqual(p, snapshot);
  // A settled loss cannot be re-settled as a win, and replays after the TTL still answer.
  const loss = play(p, false, T0, 'rb_loss');
  const flip = L.settleRivalBattle(p, loss.battle, 'rb_loss', true, T0 + L.RIVAL_BATTLE_TTL_MS + 1);
  assert.equal(flip.reply.alreadyProcessed, true); assert.equal(flip.reply.didWin, false); assert.equal(flip.battleUpdates, null);
});

test('unknown, foreign, mismatched and expired battle ids are rejected without writes', () => {
  const p = { buddyUnits: 0 };
  assert.throws(() => L.settleRivalBattle(p, undefined, 'rb_none', true, T0), /unknown_battle/);
  const i = issue(p, T0, 'rb_mine');
  assert.throws(() => L.settleRivalBattle(p, i.battle, 'rb_other', true, T0), /unknown_battle/);
  assert.throws(() => L.settleRivalBattle(p, i.battle, 'rb_mine', true, T0 + L.RIVAL_BATTLE_TTL_MS + 1), /battle_expired/);
  assert.equal(L.settleRivalBattle(p, i.battle, 'rb_mine', true, T0 + L.RIVAL_BATTLE_TTL_MS).reply.alreadyProcessed, false);
  for (const bad of [null, {}, { operation: 'grant' }, { operation: 'settle', battleId: 'a/b', didWin: true }, { operation: 'settle', battleId: 'x', didWin: 'true' }, { operation: 'settle', didWin: true }])
    assert.throws(() => L.validateRivalCommand(bad), /invalid_request/);
});

test('starting Unit is granted once: missing field grants, present field (even 0) never re-grants', () => {
  const fresh = {};
  const a = L.rivalStatus(fresh, T0); assert.deepEqual(a.userUpdates, { buddyUnits: 1 }); assert.equal(a.reply.status.buddyUnits, 1);
  apply(fresh, a.userUpdates);
  assert.deepEqual(L.rivalStatus(fresh, T0).userUpdates, {});
  assert.deepEqual(readPlayerUnits({}), { units: 1, starterUpdates: { buddyUnits: 1 } });
  assert.deepEqual(readPlayerUnits({ buddyUnits: 0 }), { units: 0, starterUpdates: {} });
  assert.deepEqual(readPlayerUnits({ buddyUnits: 1 }), { units: 1, starterUpdates: {} });
  // A brand-new pilot whose first act is a rival win: starter 1 + daily 1 = 2, written once.
  const p = {}; play(p, true); assert.equal(p.buddyUnits, 2);
  for (const bad of [-1, 1.5, '1', null]) { assert.throws(() => readPlayerUnits({ buddyUnits: bad }), /unavailable/); assert.throws(() => L.rivalStatus({ buddyUnits: bad }, T0), /unavailable/); }
  assert.throws(() => L.rivalStatus({ buddyUnits: 0, rivalWins: -1 }, T0), /unavailable/);
  assert.throws(() => L.rivalStatus({ buddyUnits: 0, rivalRewardDay: 'yesterday' }, T0), /unavailable/);
});

test('TTL cleanup: expireAt = expiry + 7-day grace; expiresAtMs and the 2 h settle window are unchanged', () => {
  assert.equal(L.RIVAL_BATTLE_TTL_MS, 2 * 3600000); assert.equal(L.RIVAL_BATTLE_TTL_GRACE_MS, 7 * DAY); assert.equal(L.RIVAL_BATTLE_CLEANUP_FIELD, 'expireAt');
  const i = issue({ buddyUnits: 0 }, T0, 'rb_ttl');
  assert.equal(i.battle.expiresAtMs, T0 + L.RIVAL_BATTLE_TTL_MS); assert.equal(i.reply.expiresAtMs, i.battle.expiresAtMs);
  assert.equal(L.rivalBattleCleanupAtMs(i.battle), T0 + L.RIVAL_BATTLE_TTL_MS + 7 * DAY);
  assert.equal('expireAt' in i.battle, false, 'the pure record stays Firestore-free; the store adds the Timestamp');
  // An unsettled battle still expires at 2 h even though the record lives for the grace window.
  assert.throws(() => L.settleRivalBattle({ buddyUnits: 0 }, i.battle, 'rb_ttl', true, i.battle.expiresAtMs + 1), /battle_expired/);
  // A settled battle replays its ruling (writing nothing) right up to the cleanup instant.
  const p = { buddyUnits: 0 };
  const s = play(p, true, T0, 'rb_ttl2');
  const lastReplay = L.rivalBattleCleanupAtMs(s.battle);
  const replay = L.settleRivalBattle(p, s.battle, 'rb_ttl2', false, lastReplay);
  assert.equal(replay.reply.alreadyProcessed, true); assert.equal(replay.reply.didWin, true); assert.equal(replay.reply.buddyUnitsGranted, 1);
  assert.equal(replay.battleUpdates, null); assert.deepEqual(replay.userUpdates, {});
  // After TTL deletion the record is gone: a late duplicate is unknown_battle, never a second grant.
  assert.throws(() => L.settleRivalBattle(p, undefined, 'rb_ttl2', true, lastReplay + DAY), /unknown_battle/);
});
