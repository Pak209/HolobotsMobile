// DECISIONS #53 domain tests: rival-battle-3 — real player combatants on issue, Holobot XP on settle
// (one battle table, fielded bots only, EXP Booster, once per battleId), and the exact v2/v1 projections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/rivalLadder.js');
const S = require('../lib/lib/rivalTierStats.js');
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
const PLAYER_KEYS = [...V2_COMBATANT_KEYS, 'attributePoints', 'boostedAttributes', 'experience', 'intelligence', 'nextLevelExp', 'rank', 'speed', 'commandRules'].sort();

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
  // #53 amendment 1: v3 opponents are WOLF at level 1 + 4t (tier 0 = a fresh L1 WOLF).
  for (const c of i.reply.encounter.opponentSquad) assert.deepEqual([c.level, c.maxHealth, c.attack, c.defense, c.speed, c.intelligence], [1, 175, 50, 50, 50, 40]);
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

test('#53 amendment 1: rival tier t = WOLF getHolobotBattleStats at level 1 + 4t (v3); v1 / v2 keep the #43 baseline x statScale', () => {
  // Tier 0 = a fresh L1 WOLF, tier 9 = L37; capped at level 99 (tier 25+).
  const expected = [
    [0, 1, 175, 50, 50, 50, 40], [1, 5, 210, 60, 60, 60, 48], [2, 9, 244, 70, 70, 70, 56], [3, 13, 280, 80, 80, 80, 64], [4, 17, 315, 90, 90, 90, 72],
    [5, 21, 350, 100, 100, 100, 80], [6, 25, 385, 110, 110, 110, 88], [7, 29, 420, 120, 120, 120, 96], [8, 33, 455, 130, 130, 130, 104], [9, 37, 489, 140, 140, 140, 112],
  ];
  for (const [tier, level, maxHealth, attack, defense, speed, intelligence] of expected) {
    assert.deepEqual(S.rivalTierBattleStats(tier), { level, maxHealth, attack, defense, speed, intelligence }, `tier ${tier}`);
    const w = P.getHolobotBattleStats('WOLF', level, {});
    assert.deepEqual([w.maxHP, w.attack, w.defense, w.speed, w.intelligence], [maxHealth, attack, defense, speed, intelligence]);
  }
  assert.equal(S.rivalTierBattleStats(24).level, 97); assert.equal(S.rivalTierBattleStats(25).level, 99); assert.equal(S.rivalTierBattleStats(10000).level, 99);
  for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => S.rivalTierBattleStats(bad), RangeError, String(bad));
  assert.equal(L.rivalLineupScaleFor('rival-battle-3'), S.RIVAL_LINEUP_SCALE_WOLF);
  assert.equal(L.rivalLineupScaleFor('rival-battle-2'), L.RIVAL_LINEUP_SCALE_BASELINE); assert.equal(L.rivalLineupScaleFor('rival-battle-1'), L.RIVAL_LINEUP_SCALE_BASELINE);
  for (const wins of [0, 10, 25, 45, 90, 99, 400]) {
    const tier = L.tierForWins(wins), row = L.getRivalTierRow(tier), st = S.rivalTierBattleStats(tier);
    n = 31; const v3 = L.issueRivalBattle(profile({ rivalWins: wins }), T0, 'rb_scale', rnd, ['ace'], L.rivalLineupScaleFor('rival-battle-3'));
    n = 31; const v2 = L.issueRivalBattle(profile({ rivalWins: wins }), T0, 'rb_scale', rnd, ['ace'], L.rivalLineupScaleFor('rival-battle-2'));
    // Same draws: same rival ids, pilot (label = the #43 table), count and seed.
    assert.deepEqual(v3.reply.encounter.opponentSquad.map(c => c.holobotId), v2.reply.encounter.opponentSquad.map(c => c.holobotId));
    assert.equal(v3.reply.encounter.seed, v2.reply.encounter.seed); assert.deepEqual(v3.reply.encounter.opponentPilot, v2.reply.encounter.opponentPilot);
    assert.equal(v3.reply.encounter.opponentPilot.tier, row.label); assert.equal(v3.reply.encounter.opponentSquad.length, row.rivals);
    for (const c of v3.reply.encounter.opponentSquad) assert.deepEqual({ level: c.level, maxHealth: c.maxHealth, attack: c.attack, defense: c.defense, speed: c.speed, intelligence: c.intelligence }, st);
    for (const c of L.rivalReplyForVersion(v2.reply, 'rival-battle-2').encounter.opponentSquad) {
      assert.deepEqual(Object.keys(c).sort(), V2_COMBATANT_KEYS);
      assert.deepEqual([c.level, c.maxHealth, c.attack, c.defense], [row.level, Math.round(285 * row.statScale), Math.round(52 * row.statScale), Math.round(18 * row.statScale)]);
    }
    // The record keeps the #43 combatant format (no speed / intelligence) and names its scale.
    assert.equal(v3.battle.lineupScale, S.RIVAL_LINEUP_SCALE_WOLF); assert.equal(v2.battle.lineupScale, L.RIVAL_LINEUP_SCALE_BASELINE);
    for (const c of [...v3.battle.lineup.opponentSquad, ...v2.battle.lineup.opponentSquad]) assert.deepEqual(Object.keys(c).sort(), V2_COMBATANT_KEYS);
    assert.deepEqual(v3.battle.lineup.opponentSquad.map(c => [c.level, c.maxHealth, c.attack, c.defense]), v3.battle.lineup.opponentSquad.map(() => [st.level, st.maxHealth, st.attack, st.defense]));
    assert.equal(v3.battle.tier, v2.battle.tier); assert.equal(v3.battle.schemaVersion, 'rival-battle-1');
  }
  // The #43 table rows (labels, rival counts, levels, statScale) are unchanged.
  assert.deepEqual(L.RIVAL_TIER_TABLE.map(r => [r.label, r.level, r.statScale, r.rivals]), [['rookie', 5, 0.8, 1], ['rookie', 8, 0.9, 1], ['challenger', 11, 1, 2], ['challenger', 14, 1.1, 2], ['elite', 18, 1.2, 3], ['elite', 22, 1.3, 3], ['elite', 26, 1.4, 3], ['legend', 30, 1.5, 3], ['legend', 35, 1.62, 3], ['legend', 40, 1.75, 3]]);
});

// Additive practice command tuning: host data, never a client fallback.
test('command profile: all roster ids, costs and identity exceptions; v2 strips it', () => {
 const C=require('../lib/lib/desktopPracticeCommands.js');
 for(const id of L.RIVAL_ROSTER_IDS){const r=C.desktopPracticeCommands(id);assert.equal(r.maxStamina,7);assert.deepEqual([r.halfCost,r.fullCost,r.halfSync,r.fullSync,r.halfEffect,r.fullEffect],[2,4,50,100,.5,1]);assert.equal(r.guardCharges,id==='hare'?2:1);assert.equal(r.syncFloor,id==='era'?25:0);}
 const reply=issue(profile(),['ace']).reply;assert.deepEqual(reply.playerCombatants[0].commandRules,C.desktopPracticeCommands('ace'));
 const legacy=L.rivalReplyForVersion(reply,'rival-battle-2');assert.equal(legacy.playerCombatants,undefined);assert.ok(legacy.encounter.opponentSquad.every(c=>!('commandRules' in c)));
});
