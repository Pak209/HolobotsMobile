// live-move-ranks-1 (Pak 2026-11-11, Move Lab rework slice 1): five live-move slots (Jab, Heavy, Guard, Dash, Special), ranks 0-3
// at the old Sync Point costs, folded into the per-fighter fields a live fight is already issued with. No rules / hash / sim change.
//  A  the pure table: slots, costs, per-rank numbers, caps (total damage edge <= +9 %, even from crafted profile data)
//  B  carry-over from the old card ranks (highest rank per category; Dash 0) + the one-time refund (idempotent, never loses SP)
//  C  the upgrade path (live slot form, migrate-only form, legacy form refused once a Holobot is on live moves)
//  D  the issue: rank 0 = byte-identical issue; ranks change only the player's attack/defense/special/step fields; rival, Arena
//     and Guild Court all apply them through inputLogCombatant; the CPU side never gets them
//  E  fairness bench; F  reviewer follow-ups: the "+1 per ranked slot" floor (no dead slot for any roster Holobot), refund >= 0
//     fuzz, ranks changed between issue and settle, repeated issue idempotency, liveMoves kept by every other holobots writer
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, buildFightReplayIssue, combatant } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/liveMoveRanks.js');
const FI = require('../lib/rival/fightReplayIssue.js');
const P = require('../lib/lib/progression.js');
const A = require('../lib/arena/arenaMatchStore.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { courtLiveIssue } = require('../lib/lib/holoZoneCourtLive.js');
const { EMPTY_PART_BOOSTS } = require('../lib/lib/partStats.js');

const FULL = { jab: 3, heavy: 3, guard: 3, dash: 3, special: 3 };
const ZERO = { jab: 0, heavy: 0, guard: 0, dash: 0, special: 0 };
const SEED = '3e'.repeat(32), T0 = Date.UTC(2026, 10, 11, 9);
// the shipped boost: floor(v x (1000 + pm) / 1000), but at least +1 per slot with any rank feeding the field (Pak 2026-11-11)
const up = (v, pm, min) => Math.max(Math.floor(v * (1000 + pm) / 1000), v + min);
const bot = (name, level, extra = {}) => ({ name, level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: {}, ...extra });

// ------------------------------------------------------------------ A the table
test('A: five slots in button order, ranks 0-3 at 25/60/120 SP (205 per slot)', () => {
  assert.deepEqual([...L.LIVE_MOVE_SLOTS], ['jab', 'heavy', 'guard', 'dash', 'special']);
  assert.deepEqual(L.LIVE_MOVE_RANK_SP_COSTS, { 1: 25, 2: 60, 3: 120 });
  assert.deepEqual([0, 1, 2, 3].map(L.cumulativeRankCost), [0, 25, 85, 205]);
  assert.equal(L.LIVE_MOVE_MAX_RANK, 3);
});

test('A: rank 0 everywhere is the identity; each slot moves only its own field', () => {
  assert.deepEqual(L.liveMoveModifiers(ZERO), { attackPm: 0, defensePm: 0, specialPm: 0, stepPm: 0 });
  assert.equal(L.isIdentityModifiers(L.liveMoveModifiers(ZERO)), true);
  const only = slot => L.liveMoveModifiers({ ...ZERO, [slot]: 1 });
  assert.deepEqual(only('jab'), { attackPm: 7, defensePm: 0, specialPm: 0, stepPm: 0 });
  assert.deepEqual(only('heavy'), { attackPm: 7, defensePm: 0, specialPm: 0, stepPm: 0 });
  assert.deepEqual(only('guard'), { attackPm: 0, defensePm: 7, specialPm: 0, stepPm: 0 });
  assert.deepEqual(only('dash'), { attackPm: 0, defensePm: 0, specialPm: 0, stepPm: 50 });
  assert.deepEqual(only('special'), { attackPm: 0, defensePm: 0, specialPm: 8, stepPm: 0 });
  assert.deepEqual(L.liveMoveModifiers(FULL), { attackPm: 42, defensePm: 21, specialPm: 24, stepPm: 150 });
});

test('A: the total damage edge of any hit (attack x defense x special) is at most +9 %, and a crafted profile cannot exceed it', () => {
  const edge = m => (1000 + m.attackPm) * (1000 + m.defensePm) * (1000 + m.specialPm) / 1e9 - 1;
  assert.ok(edge(L.liveMoveModifiers(FULL)) <= 0.09, 'full ranks');
  assert.equal(L.LIVE_MOVE_MAX_DAMAGE_EDGE_PM, 90);
  for (const crafted of [{ jab: 99, heavy: 1e9, guard: 7, dash: 50, special: 4 }, { jab: '3', heavy: 3.9, guard: -2, dash: null, special: Infinity }, null, 'x', []]) {
    const m = L.liveMoveModifiers(L.normalizeLiveMoveRanks(crafted));
    assert.ok(edge(m) <= 0.09, JSON.stringify(crafted));
    assert.ok(m.stepPm <= 150);
  }
  assert.deepEqual(L.normalizeLiveMoveRanks({ jab: 99, heavy: 2.5, guard: -1, dash: '2', special: 3 }), { jab: 0, heavy: 0, guard: 0, dash: 0, special: 3 });
  // the clamp itself (a future table edit can never lift the edge past the cap): attack is trimmed first
  const trimmed = L.capDamageEdge({ attackPm: 80, defensePm: 30, specialPm: 30, stepPm: 0 });
  assert.ok(edge(trimmed) <= 0.09 && trimmed.defensePm === 30 && trimmed.specialPm === 30 && trimmed.attackPm < 80);
});

test('A: applying modifiers floors (never above the cap) and leaves rank-0 numbers untouched', () => {
  const m = L.liveMoveModifiers(FULL);
  assert.equal(L.scalePm(100, m.attackPm), 104);
  assert.equal(L.scalePm(52, m.attackPm), 54);
  assert.equal(L.scalePm(10, m.attackPm), 10);
  assert.equal(L.scalePm(600, m.stepPm), 690);
  assert.equal(L.scalePm(77, 0), 77);
});

// ------------------------------------------------------------------ B carry-over + refund
test('B: highest rank per old category -> its live slot (STRIKE->Jab, COMBO->Heavy, DEFEND->Guard, FINISHER->Special); Dash 0', () => {
  assert.deepEqual(L.LEGACY_CATEGORY_TO_SLOT, { strike: 'jab', combo: 'heavy', defense: 'guard', finisher: 'special' });
  const c = L.carryOverFromLegacy({
    'strike.quickJab': { rank: 1 }, 'strike.heavySwing': { rank: 3, specializationId: 'strike.power' },
    'defense.guardUp': { rank: 2, specializationId: 'defense.safety' }, 'combo.chainBurst': { rank: 1 },
  });
  assert.deepEqual(c.ranks, { jab: 3, heavy: 1, guard: 2, dash: 0, special: 0 });
  // spent: 25 + 205 + 85 + 25 = 340; carried: jab 205 + heavy 25 + guard 85 = 315; refund the lower STRIKE card: 25
  assert.deepEqual({ spentSp: c.spentSp, carriedSp: c.carriedSp, refundSp: c.refundSp }, { spentSp: 340, carriedSp: 315, refundSp: 25 });
});

test('B: no old ranks -> all zero, no refund; junk rows count as 0 (never a negative refund)', () => {
  assert.deepEqual(L.carryOverFromLegacy(undefined), { ranks: ZERO, spentSp: 0, carriedSp: 0, refundSp: 0 });
  const junk = L.carryOverFromLegacy({ 'strike.x': { rank: 9 }, 'combo.y': { rank: -1 }, 'nope.z': { rank: 2 }, 'finisher.w': 'bad' });
  assert.equal(junk.ranks.jab, 0, 'rank 9 is not a rank this system ever sold');
  assert.equal(junk.ranks.heavy, 0);
  assert.equal(junk.refundSp, 85, 'an uncategorised paid rank-2 row is refunded in full');
  assert.ok(junk.refundSp >= 0 && junk.spentSp === junk.carriedSp + junk.refundSp);
});

test('B: migration pays the refund once and marks the Holobot (a second migration changes nothing)', () => {
  const user = { syncPoints: 10, holobots: [bot('ACE', 5, { moveProgress: { 'strike.quickJab': { rank: 2 }, 'strike.flurry': { rank: 1 }, 'finisher.tacticalOverride': { rank: 3 } } }), bot('HARE', 3)] };
  const m1 = L.migrateHolobotLiveMoves(user, 'ace');
  assert.equal(m1.migrated, true);
  assert.equal(m1.refundSp, 25);
  assert.equal(m1.updates.syncPoints, 35);
  const ace = m1.updates.holobots[0];
  assert.deepEqual(ace.liveMoves, { schemaVersion: 'live-moves-1', ranks: { jab: 2, heavy: 0, guard: 0, dash: 0, special: 3 }, carryOver: { spentSp: 315, carriedSp: 290, refundSp: 25 } });
  assert.equal(ace.moveSystemVersion, 2);
  assert.deepEqual(ace.moveProgress, user.holobots[0].moveProgress, 'old ranks stay readable');
  assert.deepEqual(m1.updates.holobots[1], user.holobots[1], 'other Holobots untouched');
  const m2 = L.migrateHolobotLiveMoves({ ...user, ...m1.updates }, 'ACE');
  assert.equal(m2.migrated, false);
  assert.equal(m2.refundSp, 0);
  assert.equal(m2.updates, null);
  // a Holobot already carrying liveMoves (even malformed) is never refunded again
  const m3 = L.migrateHolobotLiveMoves({ syncPoints: 0, holobots: [bot('ACE', 1, { liveMoves: 'garbage', moveProgress: { 'strike.quickJab': { rank: 3 } } })] }, 'ACE');
  assert.equal(m3.migrated, false);
  assert.throws(() => L.migrateHolobotLiveMoves(user, 'KURAI'), /do not own/);
});

test('B: the ranks a fight reads before any write are the carried ranks (lazy read), stored ranks once migrated', () => {
  const legacy = { holobots: [bot('ACE', 5, { moveProgress: { 'defense.guardUp': { rank: 3 } } })] };
  assert.deepEqual(L.liveMoveRanksFor(legacy, 'ace'), { ...ZERO, guard: 3 });
  const live = { holobots: [bot('ACE', 5, { moveProgress: { 'defense.guardUp': { rank: 3 } }, liveMoves: { schemaVersion: 'live-moves-1', ranks: { ...ZERO, dash: 2 } } })] };
  assert.deepEqual(L.liveMoveRanksFor(live, 'ace'), { ...ZERO, dash: 2 });
  assert.deepEqual(L.liveMoveRanksFor({ holobots: [] }, 'ace'), ZERO);
  assert.deepEqual(L.liveMoveRanksFor({}, 'ace'), ZERO);
});

// ------------------------------------------------------------------ C upgrade path
test('C: a live-slot upgrade migrates first (refund), checks expectedRank against the carried rank, charges the rank cost', () => {
  const user = { syncPoints: 50, holobots: [bot('ACE', 5, { moveProgress: { 'strike.quickJab': { rank: 1 }, 'strike.flurry': { rank: 1 } } })] };
  const r = L.transactMoveUpgrade(user, { holobotName: 'ACE', liveMoveSlot: 'jab', expectedRank: 1 });
  // refund 25 (the second STRIKE card) -> 75, then rank 2 costs 60 -> 15
  assert.deepEqual(r.response, { form: 'live', slot: 'jab', cost: 60, nextRank: 2, refundSp: 25, syncPoints: 15,
    liveMoves: { schemaVersion: 'live-moves-1', ranks: { ...ZERO, jab: 2 }, carryOver: { spentSp: 50, carriedSp: 25, refundSp: 25 } },
    modifiers: { attackPm: 14, defensePm: 0, specialPm: 0, stepPm: 0 } });
  assert.equal(r.updates.syncPoints, 15);
  // second upgrade on the written doc: no second refund
  const next = { ...user, ...r.updates };
  assert.throws(() => L.transactMoveUpgrade(next, { holobotName: 'ACE', liveMoveSlot: 'dash', expectedRank: 0 }), /Not enough Sync Points \(need 25\)/);
  const r2 = L.transactMoveUpgrade({ ...next, syncPoints: 40 }, { holobotName: 'ACE', liveMoveSlot: 'dash', expectedRank: 0 });
  assert.equal(r2.response.refundSp, 0, 'no second refund');
  assert.equal(r2.response.syncPoints, 15);
  assert.deepEqual(r2.response.liveMoves.ranks, { ...ZERO, jab: 2, dash: 1 });
  assert.deepEqual(r2.response.liveMoves.carryOver, { spentSp: 50, carriedSp: 25, refundSp: 25 }, 'the receipt is kept');
});

test('C: stale expectedRank, max rank, unknown slot, unknown Holobot are refused with nothing written', () => {
  const user = { syncPoints: 1000, holobots: [bot('ACE', 5, { liveMoves: { schemaVersion: 'live-moves-1', ranks: { ...ZERO, guard: 3 } } })] };
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'ACE', liveMoveSlot: 'jab', expectedRank: 1 }), /changed elsewhere/);
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'ACE', liveMoveSlot: 'guard', expectedRank: 3 }), /max rank/);
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'ACE', liveMoveSlot: 'kick', expectedRank: 0 }), /live move/);
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'KURAI', liveMoveSlot: 'jab', expectedRank: 0 }), /do not own/);
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'ACE', liveMoveSlot: 'jab' }), /current rank/);
});

test('C: the migrate-only form pays the refund once and reports the ranks; repeat is a no-op reply', () => {
  const user = { syncPoints: 0, holobots: [bot('ACE', 5, { moveProgress: { 'combo.chainBurst': { rank: 3 }, 'combo.x': { rank: 3 } } })] };
  const r = L.transactMoveUpgrade(user, { holobotName: 'ACE', migrate: true });
  assert.deepEqual(r.response, { form: 'migrate', refundSp: 205, syncPoints: 205,
    liveMoves: { schemaVersion: 'live-moves-1', ranks: { ...ZERO, heavy: 3 }, carryOver: { spentSp: 410, carriedSp: 205, refundSp: 205 } },
    modifiers: { attackPm: 21, defensePm: 0, specialPm: 0, stepPm: 0 } });
  const again = L.transactMoveUpgrade({ ...user, ...r.updates }, { holobotName: 'ACE', migrate: true });
  assert.equal(again.updates, null);
  assert.equal(again.response.refundSp, 0);
  assert.equal(again.response.syncPoints, 205);
});

test('C: the legacy card form still works for a Holobot not on live moves, and is refused once it is (no silent SP sink)', () => {
  const user = { syncPoints: 100, holobots: [bot('ACE', 5)] };
  const old = L.transactMoveUpgrade(user, { holobotName: 'ACE', moveTemplateId: 'strike.quickJab', expectedRank: 0 });
  assert.deepEqual(old.response, { cost: 25, nextRank: 1, syncPoints: 75 });
  const migrated = { ...user, ...L.transactMoveUpgrade(user, { holobotName: 'ACE', migrate: true }).updates };
  assert.throws(() => L.transactMoveUpgrade(migrated, { holobotName: 'ACE', moveTemplateId: 'strike.quickJab', expectedRank: 0 }), /live moves/);
  assert.throws(() => L.transactMoveUpgrade(user, { holobotName: 'ACE' }), /required/);
});

test('C: SP is never lost: refund + carried value always equals what the old ranks cost', () => {
  const cats = ['strike', 'defense', 'combo', 'finisher'];
  let s = 7;
  const rnd = n => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  for (let i = 0; i < 200; i++) {
    const mp = {};
    for (let k = 0; k < rnd(9); k++) mp[`${cats[rnd(4)]}.m${k}`] = { rank: rnd(4) };
    const c = L.carryOverFromLegacy(mp);
    const spent = Object.values(mp).reduce((t, r) => t + L.cumulativeRankCost(r.rank), 0);
    assert.equal(c.spentSp, spent);
    assert.equal(c.carriedSp + c.refundSp, spent);
    assert.equal(c.carriedSp, L.LIVE_MOVE_SLOTS.reduce((t, k) => t + L.cumulativeRankCost(c.ranks[k]), 0));
  }
});

// ------------------------------------------------------------------ D the issue
const baseArgs = { battleId: 'rb_lmr', seed: SEED, tier: 4, mentor: false, chase: true, attrs: true, tempo: true, live: true };
const pc = () => ({ ...combatant('ace', 480, 90, 200), speed: 60, intelligence: 50, level: 5 });

test('D: rank 0 (or no ranks) issues the exact same bytes as before', () => {
  const before = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true)], opponent: [combatant('wolf', 450, 85, 40)] });
  const zero = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true, ZERO)], opponent: [combatant('wolf', 450, 85, 40)] });
  assert.deepEqual(zero, before);
  assert.equal(zero.rulesHash, before.rulesHash);
});

test('D: full ranks change only the player fighter attack/defense/special/step distances (floored), never the CPU or any rule', () => {
  const before = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true)], opponent: [combatant('wolf', 450, 85, 40)] });
  const ranked = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true, FULL)], opponent: [combatant('wolf', 450, 85, 40)] });
  const [b0, b1] = before.rules.fighters, [r0, r1] = ranked.rules.fighters;
  assert.deepEqual(r1, b1, 'CPU fighter untouched');
  assert.equal(r0.attack, up(b0.attack, 42, 2));
  assert.equal(r0.defense, up(b0.defense, 21, 1));
  assert.equal(r0.special, up(b0.special, 24, 1));
  for (const k of ['backstepMm', 'sidestepMm', 'forwardJumpMm']) assert.equal(r0[k], up(b0[k], 150, 1), k);
  const changed = Object.keys(b0).filter(k => b0[k] !== r0[k]).sort();
  assert.deepEqual(changed, ['attack', 'backstepMm', 'defense', 'forwardJumpMm', 'sidestepMm', 'special'].sort());
  const strip = d => { const { fighters, ...rest } = d.rules; return rest; };
  assert.deepEqual(strip(ranked), strip(before), 'every global rule identical');
  assert.equal(ranked.rulesId, before.rulesId, 'same rules schema');
  assert.notEqual(ranked.rulesHash, before.rulesHash, 'hash covers the pinned numbers');
  // the issue replays: the ranked doc parses and validates as the same schema
  F.rulesDocFromJson(ranked.rules);
});

test('D: on a pre-attrs issue (duel-rules-3/4) ranks touch attack/defense/steps only (no special field exists)', () => {
  const args = { battleId: 'rb_lmr3', seed: SEED, tier: 4, mentor: false };
  const before = buildFightReplayIssue({ ...args, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, false)], opponent: [combatant('wolf', 450, 85, 40)] });
  const ranked = buildFightReplayIssue({ ...args, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, false, FULL)], opponent: [combatant('wolf', 450, 85, 40)] });
  assert.equal(ranked.rules.fighters[0].attack, up(before.rules.fighters[0].attack, 42, 2));
  assert.equal('special' in ranked.rules.fighters[0], false);
});

test('D: the rival, Arena and Guild Court hosts issue the player with its live-move ranks (read from the stored profile)', async () => {
  const opts = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
  const issueRival = async (holobot) => {
    const rdb = fakeDb({ now: T0 }), uid = 'lmr_rival';
    rdb.put(`users/${uid}`, { holobots: [holobot], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
    const r = await transactRivalBattle(rdb, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, T0, () => 0.4, opts);
    return r.duel.rules.fighters;
  };
  const liveMoves = { schemaVersion: 'live-moves-1', ranks: FULL };
  const [p0, c0] = await issueRival(bot('ACE', 20)), [p1, c1] = await issueRival(bot('ACE', 20, { liveMoves }));
  assert.equal(p1.attack, up(p0.attack, 42, 2), 'rival');
  assert.equal(p1.sidestepMm, up(p0.sidestepMm, 150, 1));
  assert.deepEqual(c1, c0, 'rival CPU unchanged');

  const issueArena = async (holobot) => {
    const adb = fakeDb({ now: T0 }), uid = 'lmr_arena';
    await adb.doc(`users/${uid}`).set({ holobots: [holobot], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
    const r = await A.transactArenaMatch(adb, uid, { schemaVersion: 'arena-match-1', operation: 'issue', requestId: 'req_lmr_0001', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' },
      T0, { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    return r.duel.rules.fighters;
  };
  const [a0, ac0] = await issueArena(bot('ACE', 4)), [a1, ac1] = await issueArena(bot('ACE', 4, { liveMoves }));
  assert.equal(a1.defense, up(a0.defense, 21, 1), 'arena');
  assert.equal(a1.special, up(a0.special, 24, 1));
  assert.deepEqual(ac1, ac0, 'arena CPU unchanged');

  const fighter = { ...pc(), holobotId: 'ace', currentHealth: 480 };
  const court = moves => courtLiveIssue({ fighter, gear: EMPTY_PART_BOOSTS, zoneId: 'guild_court', tier: 0, runId: 'zr_lmr', seed: SEED, chase: true, attrs: true, tempo: true, moves });
  const k0 = court(undefined), k1 = court(FULL);
  if (k0) {
    assert.equal(k1.rules.fighters[0].attack, up(k0.rules.fighters[0].attack, 42, 2), 'court');
    assert.deepEqual(k1.rules.fighters[1], k0.rules.fighters[1], 'court beast unchanged');
    assert.deepEqual(court(ZERO), k0);
  } else assert.fail('court issue unexpressible for guild_court tier 0');
});

// ------------------------------------------------------------------ E fairness (win-rate edge)
test('E: a fully ranked bot gains at most ~12 points of win rate over the same bot at rank 0 (mirror bench, live rules-6)', async () => {
  const { benchLiveMoveRanks } = await import('./bench-live-move-ranks.mjs');
  const r = benchLiveMoveRanks({ n: 800 });
  assert.ok(r.edgePoints <= 12, `edge ${r.edgePoints} points`);
  assert.ok(r.edgePoints > 0, `ranks should still help: edge ${r.edgePoints} points`);
});

// ------------------------------------------------------------------ F reviewer follow-ups (Pak 2026-11-11 "every bought rank raises its stat by at least 1")
const KITS = [...FI.KIT_IDS ?? require('../lib/sim/fight/index.js').KIT_IDS];
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');
const { recordFightLog, smartPlayer, verifyFightReplay } = await import('./lib/fight-replay-helpers.mjs');
const rosterCombatant = (id, level) => ({ ...buildPlayerCombatants({ holobots: [{ name: id.toUpperCase(), level, experience: 0 }] }, [id])[0], statSource: 'progression' });
const issuedPlayer = (id, level, ranks) => buildFightReplayIssue({ ...baseArgs, battleId: 'rb_lmr_floor',
  player: [FI.inputLogCombatant(rosterCombatant(id, level), EMPTY_PART_BOOSTS, true, ranks)], opponent: [combatant('wolf', 450, 85, 40)] }).rules.fighters[0];
/** No player level cap exists in functions/src (progression.ts levels freely); 99 is the cap every other level table uses. */
const MAX_LEVEL = 99;

test('F: boostStat: the per-mille gain, floored, but never less than +1 per ranked slot feeding the field (Pak "at least +1 per slot")', () => {
  const g = L.liveMoveMinGain;
  assert.deepEqual(g(FULL), { attack: 2, defense: 1, special: 1, step: 1 });
  assert.deepEqual(g({ ...ZERO, jab: 1 }), { attack: 1, defense: 0, special: 0, step: 0 });
  assert.deepEqual(g({ ...ZERO, jab: 3 }), { attack: 1, defense: 0, special: 0, step: 0 }, 'rank 3 in one slot is still one +1');
  assert.deepEqual(g({ ...ZERO, jab: 2, heavy: 1 }), { attack: 2, defense: 0, special: 0, step: 0 }, 'two attack slots: at most +2');
  assert.deepEqual(g({ ...ZERO, guard: 2, special: 3, dash: 1 }), { attack: 0, defense: 1, special: 1, step: 1 });
  assert.deepEqual(g({ jab: 9, heavy: '3' }), { attack: 0, defense: 0, special: 0, step: 0 }, 'crafted ranks normalize to 0');
  // special 30 at Special ranks 1-3: pure per-mille 30 / 30 / 30, with the slot floor 31 / 31 / 31 (one +1 for the slot, not three)
  assert.deepEqual([1, 2, 3].map(r => L.scalePm(30, 8 * r)), [30, 30, 30]);
  assert.deepEqual([1, 2, 3].map(r => L.boostStat(30, 8 * r, g({ ...ZERO, special: r }).special)), [31, 31, 31]);
  // attack 60 at Jab ranks 1-3: pure 60 / 60 / 61, with the slot floor 61 / 61 / 61
  assert.deepEqual([1, 2, 3].map(r => L.scalePm(60, 7 * r)), [60, 60, 61]);
  assert.deepEqual([1, 2, 3].map(r => L.boostStat(60, 7 * r, g({ ...ZERO, jab: r }).attack)), [61, 61, 61]);
  // a high stat keeps the pure per-mille gain (the floor does not bind): 400 x 1.042 = 416
  assert.equal(L.boostStat(400, 42, 2), 416);
  assert.equal(L.boostStat(77, 0, 0), 77, 'no ranks: identity');
  assert.equal(L.boostStat(0, 24, 1), 1, 'a 0 special with a Special rank becomes 1 (the slot +1), never more');
  assert.equal(L.boostStat(0, 0, 0), 0, 'a 0 special with no Special rank stays 0');
  // the floor binds exactly below these values at full ranks (attack 2, defense 1, special 1, step 1)
  const binds = (pm, min) => { let last = 0; for (let v = 1; v < 5000; v++) if (Math.floor(v * pm / 1000) < min) last = v; return last; };
  assert.deepEqual([binds(42, 2), binds(21, 1), binds(24, 1), binds(150, 1)], [47, 47, 41, 6]);
});

test('F: refundSp >= 0 and spent = carried + refund over many random legacy states (junk ranks, junk rows, junk containers)', () => {
  let s = 0x2545f491;
  const rnd = n => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
  const ids = ['strike.quickJab', 'strike.heavySwing', 'strike.flurry', 'combo.chainBurst', 'combo.x', 'defense.guardUp', 'finisher.tacticalOverride',
    'finisher.w', 'nope.z', 'strike', '', '__proto__x', 'constructor', 'toString'];
  const ranks = [0, 1, 2, 3, 4, -1, 2.5, '2', null, undefined, NaN, Infinity, 1e9, true, {}, []];
  const containers = () => [undefined, null, 'x', 7, [], [{ rank: 3 }]][rnd(6)];
  for (let i = 0; i < 5000; i++) {
    let mp;
    if (rnd(10) === 0) mp = containers();
    else {
      mp = {};
      for (let k = 0, n = rnd(12); k < n; k++) {
        const id = ids[rnd(ids.length)] + (rnd(3) ? '' : `.${k}`);
        const row = rnd(8) === 0 ? [null, 'bad', 3, []][rnd(4)] : { rank: ranks[rnd(ranks.length)] };
        mp[id] = row;
      }
    }
    const c = L.carryOverFromLegacy(mp);
    assert.ok(Number.isInteger(c.refundSp) && c.refundSp >= 0, `refund ${c.refundSp} for ${JSON.stringify(mp)}`);
    assert.equal(c.spentSp, c.carriedSp + c.refundSp);
    for (const k of L.LIVE_MOVE_SLOTS) assert.ok([0, 1, 2, 3].includes(c.ranks[k]));
    // the migration only ever adds the refund to the balance
    const sp = rnd(500);
    const m = L.migrateHolobotLiveMoves({ syncPoints: sp, holobots: [bot('ACE', 5, { moveProgress: mp })] }, 'ACE');
    assert.equal(m.updates.syncPoints, sp + c.refundSp);
  }
});

test('F: per-slot floor for every roster Holobot at levels 1, 5, 20 and max: rank 1 moves the stat, ranks 2-3 do not force another +1, monotonic', () => {
  const fieldsOf = { jab: ['attack'], heavy: ['attack'], guard: ['defense'], special: ['special'], dash: ['backstepMm', 'sidestepMm', 'forwardJumpMm'] };
  const all = ['attack', 'defense', 'special', 'backstepMm', 'sidestepMm', 'forwardJumpMm'];
  const slotsOf = { attack: ['jab', 'heavy'], defense: ['guard'], special: ['special'], backstepMm: ['dash'], sidestepMm: ['dash'], forwardJumpMm: ['dash'] };
  let checked = 0, rank23Free = 0;
  for (const id of KITS) for (const level of [1, 5, 20, MAX_LEVEL]) for (const others of [0, 3]) {
    const base = Object.fromEntries(L.LIVE_MOVE_SLOTS.map(k => [k, others]));
    const zero = issuedPlayer(id, level, ZERO);
    for (const slot of L.LIVE_MOVE_SLOTS) {
      let prev = issuedPlayer(id, level, { ...base, [slot]: 0 });
      for (const r of [1, 2, 3]) {
        const ranks = { ...base, [slot]: r };
        const cur = issuedPlayer(id, level, ranks);
        for (const k of all) {
          if (!fieldsOf[slot].includes(k)) { assert.equal(cur[k], prev[k], `${id} L${level} ${slot} rank moved ${k}`); continue; }
          // monotonic: a higher rank never gives a lower stat
          assert.ok(cur[k] >= prev[k], `${id} L${level} ${slot} ${r - 1}->${r} (others ${others}): ${k} ${prev[k]} -> ${cur[k]} went down`);
          // the slot floor: every ranked slot feeding k guarantees +1 over the unranked stat (attack up to +2 with Jab and Heavy)
          const ranked = slotsOf[k].filter(s => ranks[s] > 0).length;
          assert.ok(cur[k] >= zero[k] + ranked, `${id} L${level} ${JSON.stringify(ranks)}: ${k} ${zero[k]} -> ${cur[k]} (< +${ranked})`);
          // rank 1 in a slot (the others unranked) always changes the stat by at least 1
          if (r === 1 && others === 0) assert.ok(cur[k] >= prev[k] + 1, `${id} L${level} ${slot} 0->1: ${k} ${prev[k]} -> ${cur[k]}`);
          if (r > 1 && cur[k] === prev[k]) rank23Free++;
        }
        prev = cur; checked++;
      }
    }
  }
  assert.equal(checked, KITS.length * 4 * 2 * 5 * 3);
  assert.ok(rank23Free > 0, 'ranks 2-3 do not each force another +1 (some low-stat rank 2/3 steps leave the stat where rank 1 put it)');
});

test('F: ranks 2 and 3 in one slot do not each force another +1 (a low stat where the per-mille share rounds to 0)', () => {
  // a level-1 bot with a small special: Special ranks 1, 2, 3 all give exactly +1 on the issued special (old rule: +1, +2, +3)
  const lowSpecial = KITS.map(id => [id, issuedPlayer(id, 1, ZERO).special]).filter(([, s]) => s > 0 && s <= 41);
  assert.ok(lowSpecial.length > 0, 'some roster Holobot has special <= 41 at level 1');
  for (const [id, s0] of lowSpecial) {
    const at = r => issuedPlayer(id, 1, { ...ZERO, special: r }).special;
    assert.deepEqual([1, 2, 3].map(at), [s0 + 1, s0 + 1, s0 + 1], `${id} special ${s0}`);
  }
});

test('F: ranks changing between issue and settle do not break verification (Arena + rival: settle checks the stored issue)', async () => {
  const liveMoves = ranks => ({ schemaVersion: 'live-moves-1', ranks, carryOver: { spentSp: 0, carriedSp: 0, refundSp: 0 } });
  const setRanks = (db, path, ranks) => { const u = db.read(path); db.put(path, { ...u, holobots: u.holobots.map(h => ({ ...h, liveMoves: liveMoves(ranks) })) }); };
  // Arena: issue at FULL, start, drop to ZERO, settle; and the reverse
  for (const [atIssue, atSettle] of [[FULL, ZERO], [ZERO, FULL], [FULL, { ...ZERO, jab: 1 }]]) {
    const adb = fakeDb({ now: T0 }), uid = `lmr_settle_${JSON.stringify(atIssue).length}_${JSON.stringify(atSettle).length}`;
    adb.put(`users/${uid}`, { holobots: [bot('ACE', 21, { boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 }, liveMoves: liveMoves(atIssue) })], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0,
      buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
    const ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
    const call = (body, now) => A.transactArenaMatch(adb, uid, { schemaVersion: 'arena-match-1', ...body }, now, ON);
    const req = { operation: 'issue', requestId: 'req_lmr_settle', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
    const i = await call(req, T0);
    await call({ operation: 'start', matchId: i.matchId }, T0 + 1);
    setRanks(adb, `users/${uid}`, atSettle);
    // idempotency: the same requestId after the rank change replays the stored issue (same pinned numbers), never a re-issue
    const again = await call(req, T0 + 2);
    assert.equal(again.alreadyProcessed, true);
    assert.deepEqual(again.duel, i.duel, 'a repeated issue returns the issue-time ranks');
    const log = recordFightLog(i.duel, smartPlayer(i.duel, 'ace', 'Legendary')).wire;
    const expected = verifyFightReplay(i.duel, log, { battleId: i.matchId });
    const s = await call({ operation: 'settle', matchId: i.matchId, inputLog: log }, T0 + 1 + A.ARENA_MIN_WIN_MS_LIVE + 5_000);
    assert.equal(s.match.state, 'settled');
    assert.deepEqual(s.fightReceipt, expected.receipt, 'verified against the stored issue');
    assert.deepEqual(adb.read(`users/${uid}`).holobots[0].liveMoves.ranks, atSettle, 'the settle write keeps liveMoves (arenaMatchStore settle spread)');
  }
  // the issue pins the ranks: the same log does NOT verify against an issue rebuilt at other ranks (so verification is ranks-sensitive)
  const full = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true, FULL)], opponent: [combatant('wolf', 450, 85, 40)] });
  const zero = buildFightReplayIssue({ ...baseArgs, player: [FI.inputLogCombatant(pc(), EMPTY_PART_BOOSTS, true, ZERO)], opponent: [combatant('wolf', 450, 85, 40)] });
  const fl = recordFightLog(full, smartPlayer(full, 'ace', 'Legendary')).wire;
  assert.ok(verifyFightReplay(full, fl, { battleId: baseArgs.battleId }).receipt);
  assert.throws(() => verifyFightReplay(zero, fl, { battleId: baseArgs.battleId }));

  // rival: issue at FULL, ranks cleared before the settle
  const rdb = fakeDb({ now: T0 }), uid = 'lmr_rival_settle';
  rdb.put(`users/${uid}`, { holobots: [bot('ACE', 30, { liveMoves: liveMoves(FULL) })], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const opts = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
  const call = (c, t) => transactRivalBattle(rdb, uid, { schemaVersion: 'rival-battle-3', ...c }, t, () => 0.4, opts);
  const issue = await call({ operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, T0);
  setRanks(rdb, `users/${uid}`, ZERO);
  const log = recordFightLog(issue.duel, smartPlayer(issue.duel, 'ace', 'Legendary')).wire;
  const expected = verifyFightReplay(issue.duel, log, { battleId: issue.battleId });
  const s = await call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, T0 + 60_000);
  assert.equal(s.didWin, expected.receipt.winner === 'player');
  assert.deepEqual(rdb.read(`users/${uid}`).holobots[0].liveMoves.ranks, ZERO, 'the rival settle write keeps liveMoves');
});

test('F: liveMoves survives a write by every other writer of the holobots array', async () => {
  const PE = require('../lib/lib/progressionEconomy.js');
  const FS = require('../lib/lib/fitnessSyncOutcome.js');
  const AE = require('../lib/lib/arenaEconomy.js');
  const BP = require('../lib/lib/battleProgression.js');
  const HL = require('../lib/lib/holobotLoadout.js');
  const ME = require('../lib/lib/mintingEconomy.js');
  const lm = { schemaVersion: 'live-moves-1', ranks: { jab: 1, heavy: 2, guard: 3, dash: 0, special: 1 }, carryOver: { spentSp: 50, carriedSp: 25, refundSp: 25 } };
  const user = () => ({ syncPoints: 5000, holosTokens: 100, blueprints: { ace: 500 }, legendaryBlueprints: 1, rankSkips: 1,
    holobots: [bot('ACE', 5, { liveMoves: lm, moveSystemVersion: 2, attributePoints: 3, syncAbilityUnlocks: ['x'], syncStats: { bond: 0, focus: 0, guard: 0, power: 0, tempo: 0 } }), bot('KUMA', 3)] });
  const keeps = (label, holobots) => {
    assert.ok(Array.isArray(holobots), `${label}: wrote holobots`);
    const ace = holobots.find(h => h && h.name === 'ACE');
    assert.deepEqual(ace.liveMoves, lm, `${label}: liveMoves kept`);
    assert.equal(ace.moveSystemVersion, 2, `${label}: moveSystemVersion kept`);
  };
  // fitnessSyncOutcome (manual sync: EXP + workout career)
  keeps('fitnessSyncOutcome', FS.computeFitnessSyncOutcome(user(), {}, { date: '2026-11-11', stepsTotal: 4000, expAwarded: 500, holobotName: 'ACE', sessionIncrement: 1, distanceMeters: 1000 }).userUpdates.holobots);
  // syncWatchWorkoutRewards rebuilds inline in its onCall handler (not importable without firebase-admin) with exactly these two calls
  keeps('syncWatchWorkoutRewards (applyHolobotExperience + applyWorkoutCareer)', [P.applyWorkoutCareer(P.applyHolobotExperience(user().holobots[0], 500), { date: '2026-11-11', distanceMeters: 100 })]);
  // progressionEconomy: quest claim, training claim, sync-stat upgrade, attribute boost
  keeps('progressionEconomy.applyQuestClaim', PE.applyQuestClaim(user(), { questId: 'forest_patrol', holobotName: 'ACE', holobotPower: 99999 }, 0).updates.holobots);
  keeps('progressionEconomy.applyTrainingClaim', PE.applyTrainingClaim(user(), { courseId: 'attack', holobotName: 'ACE', statBoosts: { attack: 12 } }).updates.holobots);
  keeps('progressionEconomy.buildSyncStatUpgrade', PE.buildSyncStatUpgrade(user(), 'ACE', 'power').updates.holobots);
  keeps('progressionEconomy.buildAttributeBoostRaw', PE.buildAttributeBoostRaw(user(), { holobotName: 'ACE', attribute: 'attack', requestId: 'req_lmr_boost_1' }).updates.holobots);
  // arenaEconomy (legacy arena settle)
  keeps('arenaEconomy.buildArenaSettlementUpdatesRaw', AE.buildArenaSettlementUpdatesRaw(user(), 'ACE', { combosCompleted: 0, didWin: true, opponentName: 'HARE', perfectDefenses: 0, tierId: 'rookie' }).updates.holobots);
  // missionBoard, rivalLadder (and holoZoneRuns) award EXP through battleProgression.awardBattleExperienceRaw and write award.holobots
  keeps('battleProgression.awardBattleExperienceRaw (missionBoard / rivalLadder)', BP.awardBattleExperienceRaw(user(), ['ace'], { kind: 'rival', tier: 3, didWin: true }, T0).holobots);
  // holobotLoadout: equip a sync ability; equipHolobotPart writes equippedParts only (never the holobots array)
  const eq = HL.buildEquipSyncAbility(user(), { holobotName: 'ACE', abilityId: 'x' });
  keeps('holobotLoadout.buildEquipSyncAbility', eq.updates.holobots);
  const part = HL.buildEquipPart({ ...user(), parts: [{ id: 'p1', name: 'Core Unit', rarity: 'common', slot: 'core' }] }, { holobotName: 'ACE', slot: 'core', partId: 'p1' });
  assert.ok(part.updates && !('holobots' in part.updates), 'equipHolobotPart never writes holobots');
  // mintingEconomy: rank upgrade / ascension / rank skip rebuild the record from normalizeUserHolobot (spread)
  keeps('mintingEconomy.buildRankUpgradeUpdates', ME.buildRankUpgradeUpdates(user(), 'ACE', 'Champion').updates.holobots);
  keeps('mintingEconomy.buildLegendaryAscensionRaw', ME.buildLegendaryAscensionRaw(user(), 'ACE').updates.holobots);
  keeps('mintingEconomy.buildRankSkipRaw', ME.buildRankSkipRaw(user(), 'ACE').updates.holobots);
});
