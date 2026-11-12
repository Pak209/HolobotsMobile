// early-progression-1 (Pak 2026-11-12, fresh-account playtest): make early progress less of a wall. On the in-memory Firestore double.
//  1 starter Holos (300) + one free Arena entry for NEW accounts only
//  2 the live win bonus is back: counts from the verified receipt, multiplier capped at x2 (Arena, rival, Guild Court)
//  3 faster first levels: 200 / 500 / 1,000 / 1,800 / 3,600 for LV2-6, then floor(100 x L^2); existing records catch up safely
//  4 first live win of the UTC day: x2 EXP and x2 Holos, after the cap, once per account per day across all three hosts
//  5 the quest item reward grants real Parts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const P = require('../lib/lib/progression.js');
const W = require('../lib/lib/liveWinRewards.js');
const A = require('../lib/arena/arenaMatchStore.js');
const G = require('../lib/lib/genesisSignup.js');
const BP = require('../lib/lib/battleProgression.js');
const { repairHolobotProgression } = require('../lib/lib/holobotRecordRepair.js');
const { transactCreateGenesisProfile } = require('../lib/account/createGenesisProfile.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { rivalReplyForVersion } = require('../lib/lib/rivalLadder.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const ZW = require('../lib/lib/holoZoneWire.js');
const Q = require('../lib/lib/progressionEconomy.js');
const { MARKETPLACE_PART_CATALOG } = require('../lib/lib/economy.js');

const T0 = Date.UTC(2026, 10, 12, 9), DAY = 86_400_000;
const SEED = '3e'.repeat(32);
const winLog = duel => recordFightLog(duel, smartPlayer(duel, 'ace', 'Legendary')).wire;
const idleLog = duel => recordFightLog(duel, { read: () => F.toInput(F.idleRecord()) }).wire;
const code = c => e => e.code === c;
let serial = 0;

// ------------------------------------------------------------------ 3. the curve

test('curve: LV2-6 = 200 / 500 / 1,000 / 1,800 / 3,600, then floor(100 x L^2) unchanged; strictly rising', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(P.calculateExperience), [100, 200, 500, 1000, 1800, 3600, 4900]);
  for (let l = 6; l <= 80; l++) assert.equal(P.calculateExperience(l), Math.floor(100 * l * l), `LV${l} rejoins 100 x L^2`);
  for (let l = 2; l <= 80; l++) assert.ok(P.calculateExperience(l) > P.calculateExperience(l - 1));
  assert.deepEqual([2, 3, 4, 5, 6].map(P.legacyCalculateExperience), [400, 900, 1600, 2500, 3600]);
  // a fresh LV1 Holobot reaches LV2 at 200 EXP (was 400): 2 live Arena wins at the rookie tier, or one first-win-of-the-day.
  const fresh = G.buildGenesisStarterHolobot('ACE');
  assert.equal(fresh.nextLevelExp, 200);
  const up = P.applyHolobotExperience(fresh, 200);
  assert.deepEqual([up.level, up.attributePoints, up.nextLevelExp, up.rank], [2, 2, 500, 'Starter']);
  assert.equal(P.applyHolobotExperience(fresh, 199).level, 1);
});

test('curve: stored old-curve thresholds read as the new ones; every other stored value passes through', () => {
  assert.deepEqual([[1, 400], [2, 900], [3, 1600], [4, 2500]].map(([l, s]) => P.migrateStoredNextLevelExp(l, s)), [200, 500, 1000, 1800]);
  assert.equal(P.migrateStoredNextLevelExp(5, 3600), 3600);
  assert.equal(P.migrateStoredNextLevelExp(3, 139), 139, 'a legacy remainder-era threshold is not touched');
  assert.equal(P.migrateStoredNextLevelExp(20, 44100), 44100);
  assert.equal(P.normalizeUserHolobot({ name: 'ACE', level: 1, experience: 0, nextLevelExp: 400 }).nextLevelExp, 200);
});

test('existing players: cumulative EXP is kept; every old-canonical record gains at most one level (+1 point) on its next award, never a crash', () => {
  for (let level = 1; level <= 7; level++) {
    for (let exp = P.legacyCalculateExperience(level === 1 ? 0 : level); exp < P.legacyCalculateExperience(level + 1); exp += 37) {
      const stored = { name: 'KUMA', level, experience: exp, nextLevelExp: P.legacyCalculateExperience(level + 1), attributePoints: 3 };
      let expected = 1; while (exp >= P.calculateExperience(expected + 1)) expected++;
      expected = Math.max(level, expected);
      const after = P.applyHolobotExperience(stored, 0);
      assert.equal(after.experience, exp, 'EXP never changes');
      assert.equal(after.level, expected, `LV${level} @ ${exp}`);
      assert.ok(after.level - level <= 1, 'at most one level');
      assert.equal(after.attributePoints, 3 + (after.level - level), '+1 point per level gained');
      assert.equal(after.nextLevelExp, P.calculateExperience(after.level + 1));
      // the arena's record repair heals the same record the same way instead of refusing it
      const healed = repairHolobotProgression(stored);
      assert.equal(healed.ok, true, JSON.stringify(stored));
      assert.deepEqual([healed.holobot.level, healed.holobot.attributePoints, healed.holobot.nextLevelExp, healed.holobot.experience], [after.level, after.attributePoints, after.nextLevelExp, exp]);
    }
  }
  // past the OLD threshold too: still refused (a forged / over-levelled record is never healed into a level grant)
  assert.deepEqual(repairHolobotProgression({ name: 'ACE', level: 1, experience: 400 }), { ok: false, reason: 'experience_over_level' });
  // the catch-up updates rank only when the record carries one; an absent attributePoints stays absent (it reads as `level`)
  const r = repairHolobotProgression({ name: 'ACE', level: 1, experience: 300, nextLevelExp: 400, rank: 'Rookie' });
  assert.deepEqual(r.holobot, { name: 'ACE', level: 2, experience: 300, nextLevelExp: 500, rank: 'Starter' });
  assert.deepEqual(r.changes.map(c => c.path).sort(), ['holobot.level', 'holobot.nextLevelExp', 'holobot.rank']);
});

// ------------------------------------------------------------------ Arena world

const LIVE = { duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const strongAce = (level = 21) => ({ name: 'ACE', level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
function arenaWorld({ bot = strongAce(), holos = 1000, starter = false, db = fakeDb({ now: T0 }), uid = `ep_${serial++}`, extra = {}, seed = SEED } = {}) {
  const ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => seed };
  db.put(`users/${uid}`, { holobots: [bot], arenaPassses: 0, holosTokens: holos, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
    storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, ...extra });
  if (starter) db.put(`arenaMatches/${uid}/ledger/starterEntry`, A.arenaStarterEntryGrant(T0));
  const call = (body, now = T0, options = ON) => A.transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...body }, now, options);
  const issue = (extra = LIVE, now = T0, options = ON) => call({ operation: 'issue', requestId: `req_ep_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra }, now, options);
  const start = (id, now = T0 + 1) => call({ operation: 'start', matchId: id }, now);
  const settle = (id, inputLog, now) => call({ operation: 'settle', matchId: id, inputLog }, now);
  return { db, uid, call, issue, start, settle, user: () => db.read(`users/${uid}`), starter: () => db.read(`arenaMatches/${uid}/ledger/starterEntry`),
    record: id => db.read(`arenaMatches/${uid}/matches/${id}`), firstWin: () => db.read(`firstWinOfDay/${uid}`) };
}
async function arenaWin(w, day = 0) {
  const t = T0 + day * DAY, i = await w.issue(LIVE, t);
  await w.start(i.matchId, t + 1);
  const log = winLog(i.duel), v = verifyFightReplay(i.duel, log, { battleId: i.matchId });
  assert.equal(v.receipt.winner, 'player');
  return { i, v, s: await w.settle(i.matchId, log, t + 1 + A.ARENA_MIN_WIN_MS_LIVE + 5_000) };
}

// ------------------------------------------------------------------ 1. starter Holos + free entry

test('new account: createGenesisProfile grants 300 Holos and one free Arena entry; an existing profile is untouched', async () => {
  const db = fakeDb({ now: T0 }), uid = 'genesis_new';
  assert.deepEqual(await transactCreateGenesisProfile(db, uid, { starterHolobot: 'ACE', username: 'Fresh Pilot' }, T0, 'TS'), { schemaVersion: 'genesis-profile-1', created: true });
  const u = db.read(`users/${uid}`);
  assert.equal(u.holosTokens, G.GENESIS_STARTER_HOLOS); assert.equal(G.GENESIS_STARTER_HOLOS, 300);
  assert.ok(u.holosTokens >= 50, 'the Rookie Arena (50) is open');
  assert.deepEqual(db.read(`arenaMatches/${uid}/ledger/starterEntry`), { schemaVersion: 'arena-starter-entry-1', state: 'available', grantedAtMs: T0 });
  assert.equal(u.holobots[0].nextLevelExp, 200);
  // existing account: nothing changes, no starter entry appears
  db.put('users/old_pilot', { holosTokens: 7, holobots: [] });
  assert.equal((await transactCreateGenesisProfile(db, 'old_pilot', { starterHolobot: 'ACE', username: 'Old Pilot' }, T0, 'TS')).created, false);
  assert.equal(db.read('users/old_pilot').holosTokens, 7);
  assert.equal(db.read('arenaMatches/old_pilot/ledger/starterEntry'), undefined);
});

test('free first entry: charges nothing (amount 0, starterFree), method stays the requested one, once per account; cancel gives it back', async () => {
  const w = arenaWorld({ holos: 0, starter: true });
  const a = await w.issue();
  const e = a.match.entryReceipt;
  assert.deepEqual([e.method, e.amount, e.balanceBefore, e.balanceAfter, e.starterFree], ['tokens', 0, 0, 0, true], 'a shipped phone checks method === paymentMethod and before - amount === after');
  assert.equal(w.user().holosTokens, 0);
  assert.deepEqual([w.starter().state, w.starter().matchId], ['used', a.matchId]);
  assert.equal(A.readArenaMatchRecord(w.record(a.matchId), a.matchId).state, 'issued', 'the record validator accepts the free admission');
  // cancel before start: the free entry comes back
  const c = await w.call({ operation: 'cancel', matchId: a.matchId });
  assert.equal(c.match.settlementReceipt.refund.amount, 0);
  assert.equal(w.starter().state, 'available');
  // issue again (still free), play it out (a loss), and the next entry is charged
  const b = await w.issue();
  assert.equal(b.match.entryReceipt.starterFree, true);
  await w.start(b.matchId);
  const s = await w.settle(b.matchId, idleLog(b.duel), T0 + 3_000);
  assert.equal(s.match.settlementReceipt.outcome, 'loss', 'rewards as normal: the loss rule');
  assert.equal(w.starter().state, 'used');
  const healed = w.user(); delete healed.holobotVitals; w.db.put(`users/${w.uid}`, healed);   // the loss KO'd the bot; heal it to re-enter
  await assert.rejects(w.issue(), code('insufficient_funds'), 'the free entry was spent');
  // an account without the starter doc (every existing account) is charged as before
  const old = arenaWorld({ holos: 100 });
  const o = await old.issue();
  assert.deepEqual([o.match.entryReceipt.amount, 'starterFree' in o.match.entryReceipt, old.user().holosTokens], [50, false, 50]);
  // a pass entry is free too, and keeps the pass
  const pass = arenaWorld({ holos: 0, starter: true, extra: { arenaPassses: 2 } });
  const p = await pass.issue({ ...LIVE, paymentMethod: 'pass' });
  assert.deepEqual([p.match.entryReceipt.method, p.match.entryReceipt.amount, pass.user().arenaPassses], ['pass', 0, 2]);
});

test('free first entry: a forged record (starterFree with a charge, or a charge-free entry without the marker) is refused by the validator', async () => {
  const w = arenaWorld({ holos: 0, starter: true }), a = await w.issue(), rec = w.record(a.matchId);
  assert.throws(() => A.readArenaMatchRecord({ ...rec, entryReceipt: { ...rec.entryReceipt, starterFree: false } }, a.matchId), code('unavailable'));
  assert.throws(() => A.readArenaMatchRecord({ ...rec, entryReceipt: { ...rec.entryReceipt, amount: 50, balanceBefore: 50 } }, a.matchId), code('unavailable'));
  const { starterFree: _s, ...plain } = rec.entryReceipt;
  assert.throws(() => A.readArenaMatchRecord({ ...rec, entryReceipt: plain }, a.matchId), code('unavailable'));
});

// ------------------------------------------------------------------ 2. win bonus

test('win bonus: counts from the receipt witness (perfect guards, counter hits), clamped 0..25, multiplier capped at x2', () => {
  const r = (pg, ct) => ({ playerSide: 0, witness: { sides: [{ perfectGuards: pg, counters: ct }, { perfectGuards: 9, counters: 9 }] } });
  assert.deepEqual(W.livePerformanceFromReceipt(r(3, 4)), { perfectDefenses: 3, combosCompleted: 4 });
  assert.deepEqual(W.livePerformanceFromReceipt(r(99, -2)), { perfectDefenses: 25, combosCompleted: 0 });
  assert.deepEqual(W.livePerformanceFromReceipt({}), { perfectDefenses: 0, combosCompleted: 0 });
  assert.equal(W.liveWinMultiplier({ perfectDefenses: 3, combosCompleted: 4 }), 1 + 0.15 + 0.4);
  assert.equal(W.liveWinMultiplier({ perfectDefenses: 10, combosCompleted: 10 }), 2);
  assert.equal(W.liveWinMultiplier({ perfectDefenses: 25, combosCompleted: 25 }), 2, 'was x4.75 on the old path');
  // the shared award: cap, then the first-win multiplier, then the EXP Booster; a loss is 0.3, uncapped and never doubled by the cap
  const profile = { holobots: [{ name: 'ACE', level: 30, experience: 90000, nextLevelExp: 96100 }] };
  const win = BP.awardBattleExperienceRaw(profile, ['ace'], { kind: 'rival', tier: 0, didWin: true, perfectDefenses: 25, combosCompleted: 25 }, T0, { bonusCap: 2, expMultiplier: 2 });
  assert.deepEqual([win.tableExp, win.expPerHolobot], [190, 380]);
  const boosted = BP.awardBattleExperienceRaw({ ...profile, expBoosterActiveUntil: T0 + 1 }, ['ace'], { kind: 'rival', tier: 0, didWin: true, perfectDefenses: 25, combosCompleted: 25 }, T0, { bonusCap: 2, expMultiplier: 2 });
  assert.equal(boosted.expPerHolobot, 760, 'x2 cap x2 first win x2 booster');
  assert.equal(BP.awardBattleExperienceRaw(profile, ['ace'], { kind: 'rival', tier: 0, didWin: false }, T0, { bonusCap: 2 }).expPerHolobot, 28);
});

test('Arena live win: the report carries the receipt counts, EXP = floor(base x min(bonus, 2)); the validator recomputes it', async () => {
  const w = arenaWorld({ seed: '02'.repeat(32) });   // a pinned fight whose win has a perfect guard and a counter hit
  w.db.put(`firstWinOfDay/${w.uid}`, W.firstWinRecord('arena', 'earlier', T0));   // today's first win already spent: the bonus alone
  const { i, v, s } = await arenaWin(w);
  const m = w.record(i.matchId), perf = W.livePerformanceFromReceipt(v.receipt), rep = s.match.settlementReceipt.report;
  assert.ok(perf.perfectDefenses + perf.combosCompleted > 0, 'the pinned fight has counts');
  assert.deepEqual([rep.combosCompleted, rep.perfectDefenses], [perf.combosCompleted, perf.perfectDefenses]);
  assert.equal(m.rules.winBonusCap, 2);
  const exp = Math.floor(m.rules.exp * W.liveWinMultiplier(perf));
  assert.equal(s.match.settlementReceipt.settlement.exp, exp);
  assert.equal(s.match.settlementReceipt.settlement.holos, m.rules.holos, 'Holos are not touched by the win bonus');
  assert.equal('firstWinOfDay' in s, false); assert.equal('firstWinOfDay' in s.match.settlementReceipt.settlement, false);
  console.log(`# arena live win: perfect ${perf.perfectDefenses}, counters ${perf.combosCompleted}, x${W.liveWinMultiplier(perf)} -> ${exp} EXP (base ${m.rules.exp})`);
  // a record whose paid EXP does not match its report is refused
  const bad = { ...m, settlementReceipt: { ...m.settlementReceipt, settlement: { ...m.settlementReceipt.settlement, exp: exp + 1, awardedExp: exp + 1 } } };
  assert.throws(() => A.readArenaMatchRecord(bad, i.matchId), code('unavailable'));
  // the cap quote is only legal on a live match
  const resolverLike = { ...m, duel: undefined, rules: { ...m.rules } }; delete resolverLike.duel;
  assert.throws(() => A.readArenaMatchRecord(resolverLike, i.matchId), code('unavailable'));
});

test('Arena: a resolver (plan-and-send) win keeps 0 / 0 and quotes no cap; losses keep the 0.3 rule', async () => {
  const w = arenaWorld();
  const r = await w.issue({ duelSchema: 'duel-receipt-1' });
  assert.equal(r.duel.mode, 'resolver'); assert.equal(w.record(r.matchId).rules.winBonusCap, undefined);
  const l = arenaWorld({ bot: { name: 'ACE', level: 1, experience: 0, nextLevelExp: 200, attributePoints: 0, boostedAttributes: {} } });
  const i = await l.issue({ ...LIVE, opponentName: 'KUMA' }); await l.start(i.matchId);
  const s = await l.settle(i.matchId, idleLog(i.duel), T0 + 3_000);
  assert.equal(s.match.settlementReceipt.outcome, 'loss');
  assert.equal(s.match.settlementReceipt.settlement.exp, Math.floor(l.record(i.matchId).rules.exp * 0.3));
  assert.deepEqual([s.match.settlementReceipt.report.combosCompleted, s.match.settlementReceipt.report.perfectDefenses], [0, 0]);
});

// ------------------------------------------------------------------ 4. first win of the day

test('first win of the day (Arena): x2 EXP and x2 Holos after the cap; the second win that day is normal; the next UTC day pays again', async () => {
  const w = arenaWorld();
  const first = await arenaWin(w), m1 = w.record(first.i.matchId), perf = W.livePerformanceFromReceipt(first.v.receipt);
  const set1 = first.s.match.settlementReceipt.settlement;
  assert.equal(set1.firstWinOfDay, true);
  assert.equal(set1.exp, Math.floor(m1.rules.exp * W.liveWinMultiplier(perf)) * 2);
  assert.equal(set1.holos, m1.rules.holos * 2);
  assert.deepEqual(first.s.firstWinOfDay, { schemaVersion: 'first-win-1', day: '2026-11-12', expMultiplier: 2, holosMultiplier: 2 });
  assert.deepEqual([w.firstWin().day, w.firstWin().source, w.firstWin().battleId], ['2026-11-12', 'arena', first.i.matchId]);
  // the resend replays the field
  const again = await w.settle(first.i.matchId, winLog(first.i.duel), T0 + 60_000);
  assert.equal(again.alreadyProcessed, true); assert.deepEqual(again.firstWinOfDay, first.s.firstWinOfDay);
  const second = await arenaWin(w, 0.01);
  assert.equal('firstWinOfDay' in second.s, false);
  assert.equal(second.s.match.settlementReceipt.settlement.holos, m1.rules.holos);
  const third = await arenaWin(w, 1);
  assert.equal(third.s.firstWinOfDay.day, '2026-11-13');
  // a malformed ledger reads as spent (no bonus), never a refusal
  assert.equal(W.firstWinAvailable({ day: 'junk' }, T0), false);
  assert.equal(W.firstWinAvailable(undefined, T0), true);
});

const RIVAL_ON = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightSeed: () => SEED };
function rivalCall(w, c, time, options = RIVAL_ON) { return transactRivalBattle(w.db, w.uid, { schemaVersion: 'rival-battle-3', ...c }, time, () => 0.4, options); }
async function rivalWin(w, t) {
  const issue = await rivalCall(w, { operation: 'issue', duelInputs: 'duel-inputs-2' }, t);
  const log = winLog(issue.duel), v = verifyFightReplay(issue.duel, log, { battleId: issue.battleId });
  assert.equal(v.receipt.winner, 'player');
  return { issue, v, r: await rivalCall(w, { operation: 'settle', battleId: issue.battleId, inputLog: log }, t + 25_000) };
}

test('first win of the day is shared: an Arena win spends it, a rival win the same day is normal; the rival win bonus comes from its receipt', async () => {
  const w = arenaWorld({ bot: { ...strongAce(99), experience: 0, nextLevelExp: P.calculateExperience(100) } });
  const arena = await arenaWin(w);
  assert.equal(arena.s.match.settlementReceipt.settlement.firstWinOfDay, true);
  const { issue, v, r } = await rivalWin(w, T0 + 120_000);
  assert.equal(r.didWin, true);
  assert.equal(r.holosGranted, 100, 'not doubled: the day was spent in the Arena');
  assert.equal('firstWinOfDay' in r, false);
  const perf = W.livePerformanceFromReceipt(v.receipt);
  assert.deepEqual(r.winBonus, W.liveWinBonusWire(perf));
  const tier = w.db.read(`rivalBattles/${w.uid}/battles/${issue.battleId}`).tier;
  assert.equal(r.progression[0].expGained, Math.floor(Math.floor(95 * (1 + 0.45 * tier)) * W.liveWinMultiplier(perf)));
  // v1 / v2 projections drop the new fields (strict Unity readers)
  for (const ver of ['rival-battle-1', 'rival-battle-2']) {
    const p = rivalReplyForVersion({ ...r, firstWinOfDay: W.firstWinWire('2026-11-12') }, ver);
    assert.equal('winBonus' in p, false); assert.equal('firstWinOfDay' in p, false);
  }
});

test('first win of the day (rival, fresh day): x2 Holos and x2 EXP; replays carry firstWinOfDay', async () => {
  const w = arenaWorld({ bot: { ...strongAce(99), experience: 0, nextLevelExp: P.calculateExperience(100) } });
  const { issue, v, r } = await rivalWin(w, T0);
  assert.equal(r.holosGranted, 200);
  assert.deepEqual(r.firstWinOfDay, W.firstWinWire('2026-11-12'));
  const tier = w.db.read(`rivalBattles/${w.uid}/battles/${issue.battleId}`).tier;
  assert.equal(r.progression[0].expGained, Math.floor(Math.floor(95 * (1 + 0.45 * tier)) * W.liveWinMultiplier(W.livePerformanceFromReceipt(v.receipt))) * 2);
  assert.equal(w.firstWin().source, 'rival');
  const replay = await rivalCall(w, { operation: 'settle', battleId: issue.battleId, inputLog: winLog(issue.duel) }, T0 + 40_000);
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.firstWinOfDay, r.firstWinOfDay);
});

test('first win of the day (Guild Court): x2 Holos; receipt-derived counts replace the kills mapping; v1 strips the new fields', async () => {
  const db = fakeDb({ now: T0 }), uid = `court_ep_${serial++}`;
  db.put(`users/${uid}`, { holosTokens: 0, holobots: [strongAce()], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const opts = { courtFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
  let n = 0;
  const call = (body, now) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...body }, now, () => `${String(++n).padStart(8, '0')}-2222-4222-8222-222222222222`, opts);
  const i = await call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, T0);
  const log = winLog(i.duel), v = verifyFightReplay(i.duel, log, { battleId: i.runId });
  assert.equal(v.receipt.winner, 'player');
  const s = await call({ operation: 'settle', runId: i.runId, inputLog: log }, T0 + Z.COURT_LIVE_MIN_WIN_MS + 5_000);
  const perf = W.livePerformanceFromReceipt(v.receipt);
  assert.equal(s.holosGranted, 200);
  assert.deepEqual(s.firstWinOfDay, W.firstWinWire('2026-11-12'));
  assert.deepEqual(s.winBonus, W.liveWinBonusWire(perf));
  assert.deepEqual([s.settlement.combosCompleted, s.settlement.perfectDefenses], [perf.combosCompleted, perf.perfectDefenses]);
  assert.equal(s.settlement.tableExp, Math.floor(s.settlement.tableExp), 'whole EXP');
  assert.equal(s.settlement.expPerHolobot, s.settlement.tableExp * 2);
  assert.equal(db.read(`firstWinOfDay/${uid}`).source, 'court');
  const v1 = ZW.holoZoneSettleReplyForVersion(s, 'holozone-run-1');
  for (const k of ['winBonus', 'firstWinOfDay', 'holosGranted']) assert.equal(k in v1, false, k);
});

// ------------------------------------------------------------------ 5. quest Parts

test('quest reward: the Cave quest grants a real COMMON Part into users.parts; rare / legendary pay rare / epic Parts; a failed run pays none', () => {
  const user = { holobots: [{ name: 'ACE', level: 5, experience: 1800, nextLevelExp: 3600 }], parts: [{ name: 'Old', rarity: 'rare', slot: 'head' }], inventory: { common: 2 } };
  const cave = Q.applyQuestClaim(user, { id: 'qr_abc', questId: 'cave_exploration', holobotName: 'ACE', holobotPower: 99999 }, 0);
  assert.equal(cave.succeeded, true);
  assert.equal(cave.partsGranted.length, 1);
  const commons = MARKETPLACE_PART_CATALOG.filter(o => o.rarity === 'common').map(o => o.name);
  assert.ok(commons.includes(cave.partsGranted[0].name));
  assert.deepEqual(Object.keys(cave.partsGranted[0]).sort(), ['name', 'rarity', 'slot'], 'the Marketplace purchase row shape');
  assert.deepEqual(cave.updates.parts, [...user.parts, cave.partsGranted[0]]);
  assert.deepEqual(cave.updates.inventory, { common: 2 }, 'the dead inventory counter is no longer incremented');
  assert.deepEqual(Q.applyQuestClaim(user, { id: 'qr_abc', questId: 'cave_exploration', holobotName: 'ACE', holobotPower: 99999 }, 0).partsGranted, cave.partsGranted, 'deterministic per run id');
  const factory = Q.applyQuestClaim(user, { id: 'qr_f', questId: 'factory_raid', holobotName: 'ACE', holobotPower: 99999 }, 0);
  assert.deepEqual(factory.partsGranted.map(p => p.rarity), ['rare', 'rare']);
  const fortress = Q.applyQuestClaim(user, { id: 'qr_x', questId: 'abandoned_fortress', holobotName: 'ACE', holobotPower: 99999 }, 0);
  assert.deepEqual(fortress.partsGranted.map(p => p.rarity), ['epic', 'epic', 'epic']);
  const forest = Q.applyQuestClaim(user, { id: 'qr_y', questId: 'forest_patrol', holobotName: 'ACE', holobotPower: 99999 }, 0);
  assert.deepEqual(forest.partsGranted, []); assert.equal('parts' in forest.updates, false);
  const failed = Q.applyQuestClaim(user, { id: 'qr_z', questId: 'cave_exploration', holobotName: 'ACE', holobotPower: 0 }, 0.99);
  assert.equal(failed.succeeded, false); assert.deepEqual(failed.partsGranted, []); assert.equal('parts' in failed.updates, false);
  // every quest's advertised key maps onto a rarity the catalog has
  for (const quest of Q.QUEST_ECONOMY) if (quest.rewards.itemKey) assert.ok(MARKETPLACE_PART_CATALOG.some(o => o.rarity === Q.QUEST_REWARD_PART_RARITY[quest.rewards.itemKey]), quest.id);
});

test('existing players in the Arena: an old-curve LV1 record at 300 EXP is caught up at issue (LV2, +1 point), never holobot_record_invalid', async () => {
  const w = arenaWorld({ bot: { name: 'ACE', level: 1, experience: 300, nextLevelExp: 400, attributePoints: 1, boostedAttributes: {} } });
  const i = await w.issue();
  assert.equal(i.match.entrant.level, 2);
  const bot = w.user().holobots[0];
  assert.deepEqual([bot.level, bot.experience, bot.attributePoints, bot.nextLevelExp], [2, 300, 2, 500]);
  assert.ok(w.db.read(`accountRepairs/${w.uid}`) !== undefined || [...w.db.docs.keys()].some(k => k.startsWith(`accountRepairs/${w.uid}`)), 'the catch-up is audited like any repair');
});
