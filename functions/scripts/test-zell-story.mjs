import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/zellStory.js');
const L = require('../lib/lib/rivalLadder.js');
const V3 = 'rival-battle-3', S = 'zell-story-1';
const initial = () => Z.freshZellStory();
const issued = () => { const r = L.issueRivalBattle({ buddyUnits: { light: 0, medium: 0, heavy: 0 } }, 1000, 'rb_zell', () => .5); Z.bindZellLineup(r); return r; };

test('known-bad: an ordinary installed lineup never names Zell or stamps a story battle', () => {
  const before = L.issueRivalBattle({ buddyUnits: 0 }, 1000, 'rb_before', () => .5);
  assert.notEqual(before.battle.lineup.opponentPilot.pilotId, 'zell');
  assert.equal(before.battle.storyRivalId, undefined);
  assert.equal(Z.allyAfterZellVictory(Z.meetZell(initial(), 1000), { ...before.battle, settlement: { didWin: true } }, 21000).phase, 'rival');
});
test('story request is additive opt-in on v3; no client can choose a different story rival', () => {
  for (const c of [{ operation: 'status' }, { operation: 'issue', schemaVersion: V3 }]) assert.deepEqual(Z.storyRequest(c), { requested: false, issueZell: false });
  assert.deepEqual(Z.storyRequest({ operation: 'issue', schemaVersion: V3, storySchema: S, rivalId: 'zell' }), { requested: true, issueZell: true });
  for (const c of [{ operation: 'issue', rivalId: 'zell' }, { operation: 'issue', schemaVersion: V3, storySchema: 'fake' }, { operation: 'issue', schemaVersion: 'rival-battle-2', storySchema: S }, { operation: 'settle', schemaVersion: V3, storySchema: S, rivalId: 'zell' }, { operation: 'issue', schemaVersion: V3, storySchema: S, rivalId: 'ace' }]) assert.throws(() => Z.storyRequest(c), /invalid_request/);
});
test('absent story is fresh; corrupted phase/timestamp/id never resets to fresh', () => {
  assert.deepEqual(Z.readZellStory(undefined), initial());
  for (const raw of [null, [], {}, { ...initial(), schemaVersion: 'bad' }, { ...initial(), phase: 'bogus' }, { ...initial(), phase: 'rival' }, { ...initial(), phase: 'ally', metAtMs: 9, allyAtMs: 8, victoryBattleId: 'rb_x' }, { ...initial(), phase: 'ally', metAtMs: 0, allyAtMs: 1, victoryBattleId: '../x' }]) assert.throws(() => Z.readZellStory(raw), /unavailable/);
  assert.deepEqual(Z.readZellStory(Z.meetZell(initial(), 0)), Z.meetZell(initial(), 0));
});
test('meet is monotone and idempotent; a repeat cannot overwrite the original time', () => {
  const met = Z.meetZell(initial(), 1000); assert.equal(met.phase, 'rival'); assert.equal(met.metAtMs, 1000);
  assert.equal(Z.meetZell(met, 9999), met);
  assert.throws(() => Z.meetZell(initial(), -1), /unavailable/);
});
test('named lineup is one server-selected WOLF at the existing ladder tier and uses WOLF commands', () => {
  const r = issued(); assert.deepEqual(r.battle.lineup.opponentPilot, { pilotId: 'zell', displayName: 'Zell', tier: 'rookie' });
  assert.equal(r.reply.encounter.opponentSquad.length, 1); assert.equal(r.reply.encounter.opponentSquad[0].holobotId, 'wolf');
  assert.deepEqual(r.battle.lineup.opponentSquad[0], L.rivalScaledCombatant('wolf', 0));
  assert.ok(r.reply.encounter.opponentSquad[0].commandRules);
  assert.equal(r.battle.storySchema, S); assert.equal(r.battle.storyRivalId, 'zell');
});
test('only a stamped, validated Zell WIN advances the ally flag, once', () => {
  const state = Z.meetZell(initial(), 1000), r = issued();
  const loss = { ...r.battle, settlement: { didWin: false } }; assert.equal(Z.allyAfterZellVictory(state, loss, 21000), state);
  for (const b of [{ ...r.battle, storySchema: undefined, settlement: { didWin: true } }, { ...r.battle, storyRivalId: 'rival', settlement: { didWin: true } }, { ...r.battle, lineup: { ...r.battle.lineup, opponentPilot: { pilotId: 'other' } }, settlement: { didWin: true } }]) assert.equal(Z.allyAfterZellVictory(state, b, 21000), state);
  const ally = Z.allyAfterZellVictory(state, { ...r.battle, settlement: { didWin: true } }, 21000);
  assert.equal(ally.phase, 'ally'); assert.equal(ally.victoryBattleId, 'rb_zell'); assert.equal(ally.allyAtMs, 21000);
  assert.equal(Z.allyAfterZellVictory(ally, { ...r.battle, settlement: { didWin: true } }, 99999), ally);
  assert.equal(Z.meetZell(ally, 99999), ally); assert.deepEqual(Z.readZellStory(ally), ally);
});
test('public view has the placeholder and feature flag but no internal timestamps or victory ids', () => {
  assert.deepEqual(Z.zellStoryView(initial(), false), { schemaVersion: S, pilotId: 'zell', phase: 'unmet', turnedAlly: false, placeholder: true, placeholderHolobotId: 'wolf', enabled: false });
});
test('stand-in: Zell is WOLF at exactly the ladder tier an ordinary issue serves, with rivalScaledCombatant numbers, at every tier', () => {
  const { desktopPracticeCommands } = require('../lib/lib/desktopPracticeCommands.js');
  const tiers = [];
  for (const wins of [0, 9, 10, 25, 35, 45, 55, 65, 75, 85, 95, 105, 150, 240, 250, 1000]) {
    const profile = { buddyUnits: { light: 0, medium: 0, heavy: 0 }, rivalWins: wins }, tier = L.tierForWins(wins);
    const ordinary = L.issueRivalBattle(profile, 1000, 'rb_ordinary', () => .5, [], L.rivalLineupScaleFor(V3));
    const zell = L.issueRivalBattle(profile, 1000, 'rb_zell', () => .5, [], L.rivalLineupScaleFor(V3)); Z.bindZellLineup(zell);
    assert.equal(zell.battle.tier, tier); assert.equal(zell.reply.tier, ordinary.reply.tier); assert.deepEqual(zell.reply.status, ordinary.reply.status);
    assert.equal(zell.battle.lineup.opponentPilot.tier, ordinary.battle.lineup.opponentPilot.tier);
    const expected = L.rivalScaledCombatant('wolf', tier);
    assert.deepEqual(zell.battle.lineup.opponentSquad, [expected]);
    assert.deepEqual(zell.reply.encounter.opponentSquad, [{ ...expected, ...L.rivalScaledCombatantStats(tier), commandRules: desktopPracticeCommands('wolf') }]);
    const numbers = ({ holobotId: _id, commandRules: _rules, ...rest }) => rest;
    assert.deepEqual(numbers(zell.reply.encounter.opponentSquad[0]), numbers(ordinary.reply.encounter.opponentSquad[0]), 'same numbers an ordinary rival gets at this tier');
    // known-bad: the comparison tells a neighbouring tier apart (below the level-99 cap at tier 25)
    if (tier < 24) assert.notDeepEqual(zell.battle.lineup.opponentSquad[0], L.rivalScaledCombatant('wolf', tier + 1));
    tiers.push(tier);
  }
  assert.deepEqual(tiers, [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 24, 25, 100]);
});
