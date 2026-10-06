// DECISIONS #53 domain tests: rival-battle-3 — real player combatants on issue, Holobot XP on settle
// (one battle table, fielded bots only, EXP Booster, once per battleId), and the exact v2/v1 projections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/rivalLadder.js');
const B = require('../lib/lib/battleSettlement.js');
const E = require('../lib/lib/progressionEconomy.js');
const P = require('../lib/lib/progression.js');

const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const light = (n, medium = 0, heavy = 0) => ({ light: n, medium, heavy });
let n = 7;
const rnd = () => (n = (n * 9301 + 49297) % 233280) / 233280;
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
  { name: 'WOLF', level: 12, experience: 16000, nextLevelExp: 16900, rank: 'Champion', attributePoints: 4 },
];
const profile = (extra = {}) => ({ buddyUnits: light(1), rivalWins: 0, holobots: bots(), ...extra });
const apply = (p, updates) => Object.assign(p, updates);
const issue = (p, squad = ['ace', 'kuma'], now = T0 - L.RIVAL_MIN_WIN_MS, id = `rb_${n++}`) => { const r = L.issueRivalBattle(p, now, id, rnd, squad); apply(p, r.userUpdates); return r; };
const settle = (p, i, didWin, fielded, now = T0, current = []) => { const s = L.settleRivalBattle(p, i.battle, i.battle.battleId, didWin, now, fielded, current); apply(p, s.userUpdates); return s; };
const V2_ISSUE_KEYS = ['battleId', 'encounter', 'expiresAtMs', 'schemaVersion', 'status', 'tier'];
const V2_SETTLE_KEYS = ['alreadyProcessed', 'battleId', 'buddyUnitTierGranted', 'buddyUnitsGranted', 'didWin', 'schemaVersion', 'status', 'tierAfter', 'tierBefore'];
const V2_COMBATANT_KEYS = ['attack', 'defense', 'deployment', 'holobotId', 'level', 'maxHealth', 'maxStamina', 'moves', 'staminaRegen'];
const PLAYER_KEYS = [...V2_COMBATANT_KEYS, 'attributePoints', 'boostedAttributes', 'experience', 'intelligence', 'nextLevelExp', 'rank', 'speed'].sort();

test('requests: rival-battle-3 accepted; settle.fielded is 0-3 distinct travel-squad ids', () => {
  assert.deepEqual(L.validateRivalCommand({ operation: 'settle', battleId: 'rb_x', didWin: true, schemaVersion: 'rival-battle-3', fielded: ['ace', 'kuma'] }), { operation: 'settle', battleId: 'rb_x', didWin: true, fielded: ['ace', 'kuma'], schemaVersion: 'rival-battle-3' });
  assert.equal('fielded' in L.validateRivalCommand({ operation: 'settle', battleId: 'rb_x', didWin: true, schemaVersion: 'rival-battle-3' }), false, 'absent stays absent');
  assert.deepEqual(L.validateRivalCommand({ operation: 'settle', battleId: 'rb_x', didWin: false, fielded: [] }).fielded, []);
  for (const fielded of ['ace', null, {}, ['ace', 'ace'], ['ACE'], ['ace', 'kuma', 'wolf', 'hare'], [1], ['has space'], ['_x']]) {
    assert.throws(() => L.validateRivalCommand({ operation: 'settle', battleId: 'rb_x', didWin: true, schemaVersion: 'rival-battle-3', fielded }), /invalid_request/, JSON.stringify(fielded));
  }
});

test('issue: playerCombatants carry the real stats (getPlayerBattleStats) and progression fields; opponents gain speed/intelligence', () => {
  const p = profile();
  const i = issue(p, ['ace', 'wolf']);
  assert.equal(i.reply.schemaVersion, 'rival-battle-3');
  assert.deepEqual(i.battle.playerSquadIds, ['ace', 'wolf']);
  assert.deepEqual(i.reply.playerCombatants.map(c => c.holobotId), ['ace', 'wolf']);
  const [ace, wolf] = i.reply.playerCombatants;
  assert.deepEqual(Object.keys(ace).sort(), PLAYER_KEYS);
  const stats = E.getPlayerBattleStats(bots()[0]);
  assert.deepEqual({ maxHealth: ace.maxHealth, attack: ace.attack, defense: ace.defense, speed: ace.speed, intelligence: ace.intelligence }, { maxHealth: stats.maxHP, attack: stats.attack, defense: stats.defense, speed: stats.speed, intelligence: stats.intelligence });
  // ACE L4: base x10 x 1.15 + boosts, then power/guard/tempo/focus multipliers.
  assert.deepEqual([ace.maxHealth, ace.attack, ace.defense, ace.speed, ace.intelligence], [192, 96, 71, 80, 60]);
  assert.deepEqual({ level: ace.level, experience: ace.experience, nextLevelExp: ace.nextLevelExp, attributePoints: ace.attributePoints, rank: ace.rank }, { level: 4, experience: 1700, nextLevelExp: 2500, attributePoints: 1, rank: 'Starter' });
  assert.deepEqual(ace.boostedAttributes, { attack: 3, defense: 0, speed: 0, special: 0, health: 20 });
  assert.equal(wolf.level, 12); assert.equal(wolf.rank, 'Champion');
  assert.deepEqual({ maxStamina: ace.maxStamina, staminaRegen: ace.staminaRegen, deployment: ace.deployment }, { maxStamina: L.RIVAL_BASELINE.maxStamina, staminaRegen: L.RIVAL_BASELINE.staminaRegen, deployment: { ...L.RIVAL_BASELINE.deployment } });
  const row = L.getRivalTierRow(i.reply.tier);
  for (const c of i.reply.encounter.opponentSquad) { assert.equal(c.speed, Math.round(50 * row.statScale)); assert.equal(c.intelligence, Math.round(40 * row.statScale)); }
  assert.deepEqual(issue(profile(), []).reply.playerCombatants, [], 'empty travel squad → []');
});

test('v2 / v1 projections of issue and settle are the pre-#53 shapes exactly', () => {
  const p = profile();
  const i = issue(p);
  const v2 = L.rivalReplyForVersion(i.reply, 'rival-battle-2');
  assert.equal(v2.schemaVersion, 'rival-battle-2');
  assert.deepEqual(Object.keys(v2).sort(), V2_ISSUE_KEYS);
  assert.deepEqual(Object.keys(v2.encounter).sort(), ['encounterId', 'opponentPilot', 'opponentSquad', 'seed']);
  for (const c of v2.encounter.opponentSquad) assert.deepEqual(Object.keys(c).sort(), V2_COMBATANT_KEYS);
  assert.ok(i.reply.encounter.opponentSquad.every(c => 'speed' in c), 'the projection did not mutate the v3 reply');
  const v1 = L.rivalReplyForVersion(i.reply, 'rival-battle-1');
  assert.equal(v1.schemaVersion, 'rival-battle-1'); assert.equal(v1.status.buddyUnits, 1); assert.deepEqual(Object.keys(v1).sort(), V2_ISSUE_KEYS);
  for (const c of v1.encounter.opponentSquad) assert.deepEqual(Object.keys(c).sort(), V2_COMBATANT_KEYS);
  const s = settle(p, i, true, ['ace']);
  assert.deepEqual(Object.keys(L.rivalReplyForVersion(s.reply, 'rival-battle-2')).sort(), V2_SETTLE_KEYS);
  assert.deepEqual(Object.keys(L.rivalReplyForVersion(s.reply, 'rival-battle-1')).sort(), V2_SETTLE_KEYS.filter(k => k !== 'buddyUnitTierGranted'));
  assert.deepEqual(Object.keys(L.rivalReplyForVersion(s.reply, 'rival-battle-3')).sort(), [...V2_SETTLE_KEYS, 'progression'].sort());
});

test('settle win: every fielded bot gets the one-table EXP of the issued tier; bench and unfielded bots get none', () => {
  const p = profile({ rivalWins: 25 }); // tier 2
  const i = issue(p, ['ace', 'kuma']);
  const s = settle(p, i, true, ['ace', 'kuma']);
  const exp = B.computeBattleSettlement({ kind: 'rival', tier: 2, didWin: true }).exp;
  assert.equal(exp, 180);
  assert.deepEqual(s.reply.progression.map(r => [r.holobotId, r.expGained]), [['ace', 180], ['kuma', 180]]);
  assert.deepEqual(p.holobots[0], P.applyHolobotExperience(bots()[0], 180));
  assert.deepEqual(p.holobots[0].career, { workouts: 2 }, 'extra keys survive');
  assert.deepEqual(p.holobots[2], bots()[2], 'WOLF was not fielded');
  // KUMA 350 + 180 crosses 400: level 2, +1 attribute point, Starter.
  const kuma = s.reply.progression[1];
  assert.deepEqual(kuma, { holobotId: 'kuma', expGained: 180, levelBefore: 1, levelAfter: 2, attributePoints: 1, experience: 530, nextLevelExp: 900, rank: 'Starter' });
  assert.deepEqual(s.battleUpdates.settlement.progression, s.reply.progression);
  assert.deepEqual(s.battleUpdates.settlement.fielded, ['ace', 'kuma']);
});

test('fielded never changes the ladder ruling: rivalWins / Buddy Units identical with and without it', () => {
  const a = profile({ rivalWins: 9 }), b = profile({ rivalWins: 9 });
  n = 100; const ia = issue(a, ['ace'], T0 - L.RIVAL_MIN_WIN_MS, 'rb_same');
  n = 100; const ib = issue(b, ['ace'], T0 - L.RIVAL_MIN_WIN_MS, 'rb_same');
  const sa = L.settleRivalBattle(a, ia.battle, 'rb_same', true, T0, ['ace']);
  const sb = L.settleRivalBattle(b, ib.battle, 'rb_same', true, T0, undefined);
  const { holobots, ...ladderA } = sa.userUpdates;
  assert.ok(holobots); assert.deepEqual(ladderA, sb.userUpdates); assert.equal('holobots' in sb.userUpdates, false);
  const { progression: pa, ...replyA } = sa.reply; const { progression: pb, ...replyB } = sb.reply;
  assert.deepEqual(replyA, replyB); assert.equal(pa.length, 1); assert.deepEqual(pb, []);
  assert.equal(sa.reply.tierAfter, 1); assert.equal(sa.reply.buddyUnitsGranted, 1);
});

test('EXP Booster doubles the award while active', () => {
  const p = profile({ expBoosterActiveUntil: T0 + 1000 });
  const s = settle(p, issue(p), true, ['ace']);
  assert.equal(s.reply.progression[0].expGained, 190);
  const q = profile({ expBoosterActiveUntil: T0 });
  assert.equal(settle(q, issue(q), true, ['ace']).reply.progression[0].expGained, 95);
});

test('loss: 30 % EXP; a loss sooner than RIVAL_MIN_XP_MS settles but earns none (no instant-loss farming)', () => {
  const p = profile();
  const s = settle(p, issue(p), false, ['ace']);
  assert.equal(s.reply.progression[0].expGained, 28); assert.equal(p.holobots[0].experience, 1728);
  const q = profile();
  const fast = issue(q, ['ace'], T0 - 1000);
  const f = settle(q, fast, false, ['ace']);
  assert.equal(f.reply.alreadyProcessed, false); assert.equal(f.reply.didWin, false);
  assert.deepEqual(f.reply.progression, [{ holobotId: 'ace', expGained: 0, levelBefore: 4, levelAfter: 4, attributePoints: 1, experience: 1700, nextLevelExp: 2500, rank: 'Starter' }]);
  assert.equal('holobots' in f.userUpdates, false); assert.deepEqual(q.holobots, bots());
});

test('once per battleId: a duplicate settle replays the progression and writes no XP', () => {
  const p = profile();
  const i = issue(p);
  const first = settle(p, i, true, ['ace', 'kuma']);
  const after = structuredClone(p.holobots);
  const replay = L.settleRivalBattle(p, { ...i.battle, ...first.battleUpdates }, i.battle.battleId, true, T0 + 5000, ['ace', 'kuma', 'wolf']);
  assert.equal(replay.reply.alreadyProcessed, true); assert.equal(replay.battleUpdates, null);
  assert.deepEqual(replay.reply.progression, first.reply.progression);
  assert.equal('holobots' in replay.userUpdates, false); assert.deepEqual(p.holobots, after);
  // A record settled before #53 (no progression stored) replays [].
  const legacy = { ...i.battle, settlement: { ...first.battleUpdates.settlement } }; delete legacy.settlement.progression;
  assert.deepEqual(L.settleRivalBattle(p, legacy, i.battle.battleId, true, T0).reply.progression, []);
});

test('fielded must come from the issue-time or current travel squad; legacy records use the current squad', () => {
  const p = profile();
  assert.throws(() => settle(p, issue(p, ['ace']), true, ['wolf']), /invalid_request/);
  const q = profile();
  const s = settle(q, issue(q, ['ace']), true, ['wolf'], T0, ['wolf']);
  assert.equal(s.reply.progression[0].holobotId, 'wolf', 'swapped into the squad after issue');
  const r = profile();
  const old = issue(r, ['ace']); delete old.battle.playerSquadIds;
  assert.throws(() => settle(r, old, true, ['ace']), /invalid_request/);
  assert.equal(settle(r, old, true, ['ace'], T0, ['ace']).reply.progression.length, 1);
  // In the squad but no longer on the account: fail closed.
  const t = profile();
  const gone = issue(t, ['ace']); t.holobots = t.holobots.filter(b => b.name !== 'ACE');
  assert.throws(() => settle(t, gone, true, ['ace']), /unavailable/);
});

test('no fielded: progression [] and no holobots write (the shipped v2 Unity build)', () => {
  const p = profile();
  const s = settle(p, issue(p), true, undefined);
  assert.deepEqual(s.reply.progression, []); assert.equal('holobots' in s.userUpdates, false);
  assert.deepEqual(s.battleUpdates.settlement.fielded, []); assert.deepEqual(p.holobots, bots());
});
