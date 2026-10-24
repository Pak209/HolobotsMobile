// rules5-progression-gate-1 (DECISIONS #72.78 item 7 + #72.81): the #72.78 progression changes — base SPEED 4-6, SPECIAL
// points-buyable (+1), HP +3 per NEW point — ship together with duel-rules-5 behind its host flag HOLOCITY_FIGHT_ATTRS.
// Flag off (default) = the pre-#72.78 outputs (values pinned from origin/main 7bf73ce^); flag on = the #72.78 outputs.
// The flag is read at call time, so each test sets / clears process.env around the calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../lib/lib/progression.js');
const E = require('../lib/lib/progressionEconomy.js');
const M = require('../lib/lib/battlefieldMovement.js');
const D = require('../lib/desktop/desktopAccountReply.js');
const L = require('../lib/lib/rivalLadder.js');
const { FIGHT_ATTRS_FLAG } = require('../lib/shared/fightReplayContract.js');
const { readBuddyInventory } = require('../lib/lib/buddyUnits.js');

const FLAG = 'HOLOCITY_FIGHT_ATTRS';
function withFlag(value, fn) {
  const had = Object.hasOwn(process.env, FLAG), prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
  try { return fn(); } finally { if (had) process.env[FLAG] = prev; else delete process.env[FLAG]; }
}
const off = fn => withFlag(undefined, fn), on = fn => withFlag('1', fn);

const OLD_SPEED = { ACE: 7, KUMA: 3, SHADOW: 4, ERA: 6, HARE: 4, TORA: 6, WAKE: 4, GAMA: 3, KEN: 6, KURAI: 3, TSUIN: 5, WOLF: 5 };
const NEW_SPEED = { ACE: 6, KUMA: 4, SHADOW: 4, ERA: 6, HARE: 4, TORA: 6, WAKE: 4, GAMA: 4, KEN: 6, KURAI: 4, TSUIN: 5, WOLF: 5 };
const aceL4 = () => ({ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 }, career: { workouts: 2 } });
const boostProfile = (bot) => ({ holobots: [bot], holosTokens: 5 });
const req = (attribute) => ({ holobotName: 'ACE', attribute, requestId: 'boost_1' });

test('the gate is the duel-rules-5 host flag, on only for exactly "1"', () => {
  assert.equal(P.PROGRESSION_RULES5_FLAG, FIGHT_ATTRS_FLAG);
  for (const [v, want] of [['1', true], [undefined, false], ['', false], ['0', false], ['true', false], [' 1', false]]) {
    assert.equal(P.progressionRules5Enabled({ [FLAG]: v }), want, String(v));
  }
  assert.equal(off(() => P.progressionRules5Enabled()), false);
  assert.equal(on(() => P.progressionRules5Enabled()), true);
});

test('base-stat table: flag off = the pre-#72.78 SPEED column 3-7; flag on = the #72.78 column 4-6; every other column identical', () => {
  const speeds = t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.speed]));
  assert.deepEqual(speeds(P.HOLOBOT_BASE_STATS), OLD_SPEED);
  assert.deepEqual(speeds(P.HOLOBOT_BASE_STATS_RULES5), NEW_SPEED);
  assert.deepEqual(P.LEGACY_BASE_SPEED_PRE_72_78, OLD_SPEED);
  assert.deepEqual(Object.keys(P.HOLOBOT_BASE_STATS_RULES5), Object.keys(P.HOLOBOT_BASE_STATS));
  for (const [k, v] of Object.entries(P.HOLOBOT_BASE_STATS)) assert.deepEqual({ ...P.HOLOBOT_BASE_STATS_RULES5[k], speed: v.speed }, v, k);
  assert.equal(off(() => P.getHolobotBaseStatsTable()), P.HOLOBOT_BASE_STATS);
  assert.equal(on(() => P.getHolobotBaseStatsTable()), P.HOLOBOT_BASE_STATS_RULES5);
});

test('battleStats / displayStats: flag off = pre-#72.78 numbers, flag on = #72.78 numbers (only speed moves)', () => {
  const both = (name, level, boosts) => [off(() => P.getHolobotBattleStats(name, level, boosts)), on(() => P.getHolobotBattleStats(name, level, boosts))];
  let [a, b] = both('ACE', 4, { attack: 3, health: 20 });
  assert.equal(a.speed, 80); assert.equal(b.speed, 69); assert.deepEqual({ ...b, speed: a.speed }, a);
  [a, b] = both('KUMA', 1, {});
  assert.equal(a.speed, 30); assert.equal(b.speed, 40);
  assert.deepEqual(off(() => P.getHolobotDisplayStats('ACE', 4, { attack: 3, health: 20 })), { attack: 12, defense: 6, hp: 192, special: 5, speed: 8 });
  assert.deepEqual(on(() => P.getHolobotDisplayStats('ACE', 4, { attack: 3, health: 20 })), { attack: 12, defense: 6, hp: 192, special: 5, speed: 6 });
  assert.deepEqual(off(() => P.getHolobotDisplayStats('KUMA', 1, {})).speed, 3);
  assert.deepEqual(on(() => P.getHolobotDisplayStats('KUMA', 1, {})).speed, 4);
});

test('attribute boost flag off: +1 attack/defense/speed, +10 HP, SPECIAL refused (attribute_not_boostable) and writes nothing', () => off(() => {
  assert.deepEqual([...P.getBoostableAttributes()], ['attack', 'defense', 'speed', 'health']);
  assert.deepEqual(P.getAttributeBoostAmounts(), { attack: 1, defense: 1, health: 10, speed: 1 });
  const legacy = { name: 'ACE', level: 3, attributePoints: 2, boostedAttributes: { health: 100 } };
  const hp = E.buildAttributeBoostRaw(boostProfile(legacy), req('health'));
  assert.equal(hp.reply.applied, true); assert.equal(hp.reply.holobot.boostedAttributes.health, 110);
  const sp = E.buildAttributeBoostRaw(boostProfile(legacy), req('special'));
  assert.deepEqual({ applied: sp.reply.applied, reason: sp.reply.reason, updates: sp.updates, points: sp.reply.holobot.attributePoints }, { applied: false, reason: 'attribute_not_boostable', updates: null, points: 2 });
  assert.equal(P.isBoostableAttribute('special'), false);
}));

test('attribute boost flag on: SPECIAL +1, HP +3 per NEW point on top of grandfathered HP (100 -> 103)', () => on(() => {
  assert.deepEqual([...P.getBoostableAttributes()], ['attack', 'defense', 'speed', 'health', 'special']);
  assert.deepEqual(P.getAttributeBoostAmounts(), { attack: 1, defense: 1, health: 3, special: 1, speed: 1 });
  for (const attribute of E.ATTRIBUTE_BOOST_WIRE_ATTRIBUTES) assert.equal(P.isBoostableAttribute(attribute), true, attribute);
  const legacy = { name: 'ACE', level: 3, attributePoints: 2, boostedAttributes: { health: 100, special: 2 } };
  const hp = E.buildAttributeBoostRaw(boostProfile(legacy), req('health'));
  assert.equal(hp.reply.applied, true); assert.equal(hp.reply.holobot.boostedAttributes.health, 103); assert.equal(hp.reply.holobot.attributePoints, 1);
  const sp = E.buildAttributeBoostRaw(boostProfile(legacy), req('special'));
  assert.equal(sp.reply.applied, true); assert.deepEqual(sp.reply.holobot.boostedAttributes, { health: 100, special: 3 });
  const before = P.getHolobotBattleStats('ACE', 3, legacy.boostedAttributes), after = P.getHolobotBattleStats('ACE', 3, sp.reply.holobot.boostedAttributes);
  assert.equal(after.intelligence - before.intelligence, 1);
  assert.equal(P.applyAttributeBoost(legacy, 'intelligence').reason, 'attribute_not_boostable');
}));

test('quest / training power score is frozen (#72.78) whatever the flag: ACE L5 +4 atk = 2316', () => {
  const bot = { name: 'ACE', level: 5, boostedAttributes: { attack: 4 } };
  assert.equal(off(() => E.getHolobotPowerScore(bot)), 2316);
  assert.equal(on(() => E.getHolobotPowerScore(bot)), 2316);
  for (const name of Object.keys(P.HOLOBOT_BASE_STATS)) for (const level of [1, 7, 30]) {
    const b = { name, level, boostedAttributes: { speed: 2, health: 13 } };
    assert.equal(on(() => E.getHolobotPowerScore(b)), off(() => E.getHolobotPowerScore(b)), `${name} L${level}`);
  }
});

test('desktop-account-3 snapshot: flag off = pre-#72.78 battleStats / displayStats; flag on = #72.78', () => {
  const profile = { holobots: [aceL4(), { name: 'KUMA', level: 1 }] };
  const snap = () => D.buildDesktopAccountReply(structuredClone(profile), 'uid-1', 'desktop-account-3', readBuddyInventory(profile).units);
  const [a0, k0] = off(snap).holobots, [a1, k1] = on(snap).holobots;
  assert.deepEqual(a0.battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 80, intelligence: 60 });
  assert.deepEqual(a0.displayStats, { attack: 12, defense: 6, hp: 192, special: 5, speed: 8 });
  assert.deepEqual(k0.battleStats, { attack: 70, defense: 50, maxHP: 200, speed: 30, intelligence: 40 });
  assert.deepEqual(k0.displayStats, { attack: 7, defense: 5, hp: 200, special: 4, speed: 3 });
  assert.deepEqual(a1.battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 69, intelligence: 60 });
  assert.deepEqual(a1.displayStats, { attack: 12, defense: 6, hp: 192, special: 5, speed: 6 });
  assert.deepEqual(k1.battleStats, { attack: 70, defense: 50, maxHP: 200, speed: 40, intelligence: 40 });
  assert.deepEqual(k1.displayStats, { attack: 7, defense: 5, hp: 200, special: 4, speed: 4 });
});

test('rival-battle-3 issue: ACE L4 player combatant speed 80 flag off, 69 flag on', () => {
  const issue = () => {
    const p = { buddyUnits: { light: 1, medium: 0, heavy: 0 }, rivalWins: 0, holobots: [aceL4(), { name: 'WOLF', level: 12, experience: 16000, nextLevelExp: 16900, rank: 'Champion', attributePoints: 4 }] };
    let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    return L.issueRivalBattle(p, Date.UTC(2026, 9, 1) - L.RIVAL_MIN_WIN_MS, 'rb_gate', rnd, ['ace', 'wolf']).reply.playerCombatants[0];
  };
  const a0 = off(issue), a1 = on(issue);
  assert.deepEqual([a0.maxHealth, a0.attack, a0.defense, a0.speed, a0.intelligence], [192, 96, 71, 80, 60]);
  assert.deepEqual([a1.maxHealth, a1.attack, a1.defense, a1.speed, a1.intelligence], [192, 96, 71, 69, 60]);
});

test('battlefield movement: JUSAN ACE-fallback reference 70 flag off, 60 flag on; every fleet LV 1 run speed is identical', () => {
  assert.deepEqual(off(() => M.movementReference('jusan', 'player')), { referenceSpeedStat: 70, referenceSourceHolobotId: 'ace', provisional: true });
  assert.deepEqual(on(() => M.movementReference('jusan', 'player')), { referenceSpeedStat: 60, referenceSourceHolobotId: 'ace', provisional: true });
  for (const id of M.FLEET_IDS) {
    const lv1 = flag => withFlag(flag, () => M.battlefieldMovement(id, M.movementReference(id, 'player').referenceSpeedStat, 'player').runMmPerSecond);
    assert.equal(lv1('1'), lv1(undefined), id);
  }
});
