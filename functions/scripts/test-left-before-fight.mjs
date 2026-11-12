// no-loss-before-fight (Pak 2026-11-11): leaving a live (input-log) duel during its 3-2-1 countdown (the phone's runtime stepped zero
// ticks) cancels the fight with NO loss, in all three live battle types, on the in-memory Firestore double. The phone sends
// `leftBeforeFight: true` on the call it already uses to leave (rival / court `forfeit`, Arena `cancel`). The host honours it only
// within LEFT_BEFORE_FIGHT_WINDOW_MS of the fight's issue (rival / court issue, Arena start); later it is the ordinary forfeit loss.
// A request without the field (an old phone, or a LEAVE after ticks stepped) is exactly today's forfeit. Idempotent. Expiry stays a loss.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { recordFightLog, smartPlayer } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { RIVAL_COOLDOWN_MS } = require('../lib/lib/rivalLadder.js');
const A = require('../lib/arena/arenaMatchStore.js');
const P = require('../lib/lib/progression.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const L = require('../lib/lib/leftBeforeFight.js');

const now = Date.UTC(2026, 10, 11, 16), W = L.LEFT_BEFORE_FIGHT_WINDOW_MS;
const SEED = '4f'.repeat(32);
const winLog = (duel, id = 'ace') => recordFightLog(duel, smartPlayer(duel, id, 'Legendary')).wire;
let serial = 0;

test('the window constant and the field reader', () => {
  assert.equal(W, 60_000);
  assert.equal(L.LEFT_BEFORE_FIGHT_FIELD, 'leftBeforeFight');
  assert.equal(L.readLeftBeforeFight({}), false);
  assert.equal(L.readLeftBeforeFight({ leftBeforeFight: true }), true);
  for (const v of [false, 'true', 1, null]) assert.equal(L.readLeftBeforeFight({ leftBeforeFight: v }), null, String(v));
  assert.equal(L.leftBeforeFightInWindow(now, now), true);
  assert.equal(L.leftBeforeFightInWindow(now, now + W), true);
  assert.equal(L.leftBeforeFightInWindow(now, now + W + 1), false);
  assert.equal(L.leftBeforeFightInWindow(now, now - 1), false, 'a claim before the issue never is');
  assert.equal(L.leftBeforeFightInWindow(null, now), false);
});

// ---------------------------------------------------------------- city rivals

const RIVAL_ON = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, battleIq: true };
const bot = (name, level = 30) => ({ name, level, experience: 0, nextLevelExp: 400, attributePoints: 0 });
function rivalWorld(extra = {}) {
  const db = fakeDb({ now }), uid = `lbf_rival_${serial++}`;
  db.put(`users/${uid}`, { holobots: [bot('ACE'), bot('KUMA')], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, syncMomentum: { ACE: 3, KUMA: 2 }, battleIq: { ACE: 40 },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace', 'kuma'] }, ...extra });
  const call = (c, time = now) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...c }, time, () => 0.4, { ...RIVAL_ON, fightSeed: () => SEED });
  return { db, uid, call, user: () => db.read(`users/${uid}`), record: id => db.read(`rivalBattles/${uid}/battles/${id}`), ledger: () => db.read(`rivalBattles/${uid}`),
    issue: (time = now) => call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, time) };
}

test('rival, left before FIGHT within the window: closed with no loss (no cooldown, no streak reset, nothing paid, HP as issued), slot freed', async () => {
  const w = rivalWorld(), issue = await w.issue(), before = w.user();
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId, leftBeforeFight: true }, now + 4_000);
  assert.deepEqual([r.didWin, r.holosGranted, r.buddyUnitsGranted, r.closedBy, r.alreadyProcessed], [false, 0, 0, 'left_before_fight', false]);
  const s = w.record(issue.battleId).settlement;
  assert.deepEqual([s.didWin, s.closedBy, s.holosGranted, s.fielded], [false, 'left_before_fight', 0, []]);
  const after = w.user();
  for (const k of ['syncMomentum', 'battleIq', 'holosTokens', 'holobots', 'holobotVitals', 'rivalWins', 'pilotRank', 'buddyUnits', 'onboarding']) assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, {}, 'no per-rival cooldown');
  assert.deepEqual(Object.keys(w.ledger().openBattles), [], 'the slot is freed');
  // the same rival can be fought again at once
  assert.equal((await w.issue(now + 5_000)).duel.mode, 'input-log');
});

test('rival cancel is idempotent; a later settle replays it; the window edge (exactly 60 s) still counts', async () => {
  const w = rivalWorld(), issue = await w.issue();
  await w.call({ operation: 'forfeit', battleId: issue.battleId, leftBeforeFight: true }, now + W);
  const snap = JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]);
  for (const body of [{ leftBeforeFight: true }, {}]) {
    const again = await w.call({ operation: 'forfeit', battleId: issue.battleId, ...body }, now + W + 10_000);
    assert.deepEqual([again.alreadyProcessed, again.closedBy, again.didWin], [true, 'left_before_fight', false]);
  }
  const settle = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: winLog(issue.duel) }, now + W + 20_000);
  assert.deepEqual([settle.alreadyProcessed, settle.closedBy, settle.didWin], [true, 'left_before_fight', false]);
  assert.equal(JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]), snap, 'nothing written by the repeats');
});

test('rival, claim after the window: the ordinary forfeit loss (cooldown, lead streak reset)', async () => {
  const w = rivalWorld(), issue = await w.issue();
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId, leftBeforeFight: true }, now + W + 1);
  assert.equal(r.closedBy, 'forfeit');
  assert.deepEqual(w.user().syncMomentum, { ACE: 0, KUMA: 2 });
  assert.deepEqual(Object.values(w.ledger().rivalLastSettledAtMs), [now + W + 1]);
});

test('rival, LEAVE after ticks (the phone sends no field) and an old phone: exactly today\'s forfeit loss', async () => {
  const w = rivalWorld(), issue = await w.issue();
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 2_000);
  assert.deepEqual([r.closedBy, r.didWin, r.holosGranted], ['forfeit', false, 0]);
  assert.deepEqual(w.user().syncMomentum, { ACE: 0, KUMA: 2 });
  assert.deepEqual(Object.values(w.ledger().rivalLastSettledAtMs), [now + 2_000]);
  await assert.rejects(w.issue(now + 3_000), e => e.code === 'rival_cooldown');
});

test('rival: a cancel claim on an already forfeited battle changes nothing; a malformed field is invalid_request; an expired battle stays a loss', async () => {
  const w = rivalWorld(), issue = await w.issue();
  await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 1_000);
  const snap = JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]);
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId, leftBeforeFight: true }, now + 2_000);
  assert.deepEqual([r.alreadyProcessed, r.closedBy], [true, 'forfeit']);
  assert.equal(JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]), snap);
  const v = rivalWorld(), vi = await v.issue();
  for (const bad of [false, 'true', 1]) await assert.rejects(v.call({ operation: 'forfeit', battleId: vi.battleId, leftBeforeFight: bad }, now + 1_000), e => e.code === 'invalid_request', String(bad));
  assert.equal(v.record(vi.battleId).settlement, null, 'nothing written by a malformed request');
  const x = rivalWorld(), xi = await x.issue(), t = x.record(xi.battleId).expiresAtMs + 1;
  await assert.rejects(x.call({ operation: 'forfeit', battleId: xi.battleId, leftBeforeFight: true }, t), e => e.code === 'battle_expired' && e.detail?.closedBy === 'expired');
  assert.equal(x.record(xi.battleId).settlement.closedBy, 'expired');
});

// ---------------------------------------------------------------- Arena

const T0 = Date.UTC(2026, 10, 11, 10), START = T0 + 30_000;
const ARENA_ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const LIVE = { duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const adb = fakeDb({ now: T0 });
const strong = (level = 21) => ({ name: 'ACE', level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
async function arenaUser() {
  const uid = `lbf_arena_${serial++}`;
  await adb.doc(`users/${uid}`).set({ holobots: [strong()], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
  return uid;
}
const acall = (uid, body, at = T0) => A.transactArenaMatch(adb, uid, { schemaVersion: 'arena-match-1', ...body }, at, ARENA_ON);
async function astarted(uid, extra = LIVE, paymentMethod = 'tokens') {
  const i = await acall(uid, { operation: 'issue', requestId: `req_lbf_${serial++}`, tierId: 'rookie', paymentMethod, holobotId: 'ace', opponentName: 'HARE', ...extra });
  await acall(uid, { operation: 'start', matchId: i.matchId }, START);
  return i;
}
const auser = async uid => (await adb.doc(`users/${uid}`).get()).data();
const apayouts = async uid => (await adb.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).get()).data();

test('Arena, left before FIGHT within the window of the start: cancelled, entry refunded, no loss, no cap count, HP untouched, Arena freed', async () => {
  const uid = await arenaUser(), i = await astarted(uid), before = await auser(uid);
  assert.equal(before.holosTokens, 950);
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId, leftBeforeFight: true }, START + 5_000);
  const rc = c.match.settlementReceipt;
  assert.deepEqual([c.alreadyProcessed, c.match.state, rc.outcome, rc.refunded, rc.leftBeforeFight, rc.settlement], [false, 'cancelled', 'cancelled_before_start', true, true, null]);
  assert.deepEqual(rc.refund, { method: 'tokens', amount: 50, balanceBefore: 950, balanceAfter: 1000 });
  const u = await auser(uid);
  assert.deepEqual([u.holosTokens, u.losses, u.wins, u.arenaBattlesToday], [1000, 0, 0, before.arenaBattlesToday]);
  assert.deepEqual(u.holobotVitals, before.holobotVitals);
  assert.equal(await apayouts(uid), undefined, 'no CPU-cap count');
  assert.equal(A.readArenaMatchRecord((await adb.doc(`arenaMatches/${uid}/matches/${i.matchId}`).get()).data(), i.matchId).state, 'cancelled');
  // the Arena is free at once
  const n = await acall(uid, { operation: 'issue', requestId: `req_lbf_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE }, START + 6_000);
  assert.equal(n.match.state, 'issued');
});

test('Arena cancel is idempotent (a repeat, with or without the field, replays it); a pass entry comes back as a pass', async () => {
  const uid = await arenaUser(), i = await astarted(uid, LIVE, 'pass');
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId, leftBeforeFight: true }, START + W);
  assert.deepEqual(c.match.settlementReceipt.refund, { method: 'pass', amount: 1, balanceBefore: 4, balanceAfter: 5 });
  const snap = JSON.stringify(await auser(uid));
  for (const body of [{ leftBeforeFight: true }, {}]) {
    const again = await acall(uid, { operation: 'cancel', matchId: i.matchId, ...body }, START + W + 10_000);
    assert.deepEqual([again.alreadyProcessed, again.match.settlementReceipt.outcome, again.match.settlementReceipt.leftBeforeFight], [true, 'cancelled_before_start', true]);
  }
  assert.equal(JSON.stringify(await auser(uid)), snap);
});

test('Arena, claim after the window: the after-start forfeit loss (fee kept, losses + 1, one cap count)', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId, leftBeforeFight: true }, START + W + 1);
  assert.deepEqual([c.match.state, c.match.settlementReceipt.outcome, c.match.settlementReceipt.countedAsLoss, c.match.settlementReceipt.leftBeforeFight], ['cancelled', 'forfeit', true, undefined]);
  const u = await auser(uid);
  assert.deepEqual([u.holosTokens, u.losses], [950, 1]);
  assert.equal((await apayouts(uid)).paidSettles, 1);
});

test('Arena, LEAVE after ticks / an old phone (no field): exactly today\'s live forfeit receipt', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId }, START + 2_000);
  assert.deepEqual(Object.keys(c.match.settlementReceipt).sort(), ['closedAtMs', 'countedAsLoss', 'finalVitals', 'matchId', 'outcome', 'refunded', 'report', 'settlement']);
  assert.deepEqual([c.match.settlementReceipt.outcome, (await auser(uid)).losses, (await auser(uid)).holosTokens], ['forfeit', 1, 950]);
});

test('Arena: the field changes nothing for a plan-and-send match, an unstarted match, or an already-closed match; malformed is invalid_request', async () => {
  // plan-and-send after start: today's no-loss forfeit, fee kept, no marker
  const r = await arenaUser(), ri = await astarted(r, { duelSchema: 'duel-receipt-1' });
  const rc = await acall(r, { operation: 'cancel', matchId: ri.matchId, leftBeforeFight: true }, START + 1_000);
  assert.deepEqual(Object.keys(rc.match.settlementReceipt).sort(), ['closedAtMs', 'finalVitals', 'matchId', 'outcome', 'refunded', 'report', 'settlement']);
  assert.deepEqual([rc.match.settlementReceipt.outcome, (await auser(r)).holosTokens], ['forfeit', 950]);
  // issued, never started: the ordinary refund, no marker
  const u = await arenaUser();
  const ui = await acall(u, { operation: 'issue', requestId: `req_lbf_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE });
  const uc = await acall(u, { operation: 'cancel', matchId: ui.matchId, leftBeforeFight: true }, T0 + 1_000);
  assert.deepEqual([uc.match.settlementReceipt.outcome, uc.match.settlementReceipt.leftBeforeFight, (await auser(u)).holosTokens], ['cancelled_before_start', undefined, 1000]);
  // an already forfeited live match: the field changes nothing
  const f = await arenaUser(), fi = await astarted(f);
  await acall(f, { operation: 'cancel', matchId: fi.matchId }, START + 1_000);
  const snap = JSON.stringify(await auser(f));
  const fc = await acall(f, { operation: 'cancel', matchId: fi.matchId, leftBeforeFight: true }, START + 2_000);
  assert.deepEqual([fc.alreadyProcessed, fc.match.settlementReceipt.outcome, fc.match.settlementReceipt.countedAsLoss], [true, 'forfeit', true]);
  assert.equal(JSON.stringify(await auser(f)), snap);
  // malformed
  const m = await arenaUser(), mi = await astarted(m);
  for (const body of [{ leftBeforeFight: 'true' }, { leftBeforeFight: false }, { leftBeforeFight: true, playerFinalHealth: 10 }])
    await assert.rejects(acall(m, { operation: 'cancel', matchId: mi.matchId, ...body }, START + 1_000), e => e.code === 'invalid_request', JSON.stringify(body));
  await assert.rejects(acall(m, { operation: 'start', matchId: mi.matchId, leftBeforeFight: true }, START + 1_000), e => e.code === 'invalid_request');
});

test('Arena: an expired started match stays the timeout loss whatever is sent', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId, leftBeforeFight: true }, T0 + A.ARENA_MATCH_TTL_MS + 1);
  assert.deepEqual([c.match.state, c.match.settlementReceipt.outcome, c.match.settlementReceipt.countedAsLoss], ['expired', 'forfeit', true]);
  assert.equal((await auser(uid)).losses, 1);
});

test('Arena readArenaMatchRecord: leftBeforeFight only on the refund receipt of a started live match, cancelled', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  await acall(uid, { operation: 'cancel', matchId: i.matchId, leftBeforeFight: true }, START + 5_000);
  const rec = (await adb.doc(`arenaMatches/${uid}/matches/${i.matchId}`).get()).data();
  const bad = patch => assert.throws(() => A.readArenaMatchRecord({ ...rec, ...patch(rec) }, i.matchId), e => e.code === 'unavailable');
  bad(r => ({ settlementReceipt: { ...r.settlementReceipt, leftBeforeFight: false } }));
  bad(r => { const { leftBeforeFight: _, ...plain } = r.settlementReceipt; return { settlementReceipt: plain }; }, 'a started refund without the marker');
  bad(r => ({ state: 'expired', closedAtMs: r.expiresAtMs + 1, settlementReceipt: { ...r.settlementReceipt, closedAtMs: r.expiresAtMs + 1 } }));
  // the marker on a forfeit receipt, or on a non-live match, is refused
  const f = await arenaUser(), fi = await astarted(f);
  await acall(f, { operation: 'cancel', matchId: fi.matchId }, START + 1_000);
  const frec = (await adb.doc(`arenaMatches/${f}/matches/${fi.matchId}`).get()).data();
  assert.throws(() => A.readArenaMatchRecord({ ...frec, settlementReceipt: { ...frec.settlementReceipt, leftBeforeFight: true } }, fi.matchId), e => e.code === 'unavailable');
  const p = await arenaUser();
  const pi = await acall(p, { operation: 'issue', requestId: `req_lbf_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelSchema: 'duel-receipt-1' });
  await acall(p, { operation: 'cancel', matchId: pi.matchId }, T0 + 1_000);
  const prec = (await adb.doc(`arenaMatches/${p}/matches/${pi.matchId}`).get()).data();
  assert.throws(() => A.readArenaMatchRecord({ ...prec, settlementReceipt: { ...prec.settlementReceipt, leftBeforeFight: true } }, pi.matchId), e => e.code === 'unavailable');
});

// ---------------------------------------------------------------- Guild Court

const COURT_ON = { courtFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
function courtWorld() {
  const db = fakeDb({ now }), uid = `lbf_court_${serial++}`;
  db.put(`users/${uid}`, { holosTokens: 0, holobots: [strong()], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  let n = 0;
  const newRun = () => `${String(++n).padStart(8, '0')}-3333-4333-8333-${String(serial).padStart(12, '0')}`;
  const call = (body, at = now) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...body }, at, newRun, COURT_ON);
  const issue = (at = now) => call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, at);
  return { db, uid, call, issue, user: () => db.read(`users/${uid}`), doc: () => db.read(`holoZoneRuns/${uid}`) };
}

test('court, left before FIGHT within the window: closed with no loss: no 25 Holos, HP unchanged, no zone cooldown; a new court fight at once', async () => {
  const w = courtWorld(), i = await w.issue(), before = w.user(), cooldownBefore = w.doc().zoneLastSettledAtMs;
  const r = await w.call({ operation: 'forfeit', runId: i.runId, leftBeforeFight: true }, now + 4_000);
  assert.deepEqual(r, { schemaVersion: 'holozone-run-2', runId: i.runId, alreadyProcessed: false, closedBy: 'left_before_fight' });
  const run = w.doc().runs.find(x => x.runId === i.runId);
  assert.deepEqual([run.settlement, run.closedAtMs, run.closedBy], [null, now + 4_000, 'left_before_fight']);
  const after = w.user();
  assert.deepEqual([after.holosTokens, after.holobots, after.holobotVitals, after.itemStocks], [before.holosTokens, before.holobots, before.holobotVitals, before.itemStocks]);
  assert.deepEqual(w.doc().zoneLastSettledAtMs, cooldownBefore, 'no cooldown written');
  assert.equal((await w.issue(now + 5_000)).duel.mode, 'input-log');
});

test('court cancel is idempotent; a later settle answers run_closed with that closure', async () => {
  const w = courtWorld(), i = await w.issue();
  await w.call({ operation: 'forfeit', runId: i.runId, leftBeforeFight: true }, now + W);
  const snap = JSON.stringify([w.user(), w.doc()]);
  for (const body of [{ leftBeforeFight: true }, {}])
    assert.deepEqual(await w.call({ operation: 'forfeit', runId: i.runId, ...body }, now + W + 5_000), { schemaVersion: 'holozone-run-2', runId: i.runId, alreadyProcessed: true, closedBy: 'left_before_fight' });
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, inputLog: winLog(i.duel) }, now + W + 30_000), e => e.code === 'run_closed' && e.detail?.closedBy === 'left_before_fight');
  assert.equal(JSON.stringify([w.user(), w.doc()]), snap);
});

test('court, claim after the window / no field (LEAVE after ticks, an old phone): the ordinary forfeit loss with the zone cooldown', async () => {
  for (const [at, body] of [[now + W + 1, { leftBeforeFight: true }], [now + 2_000, {}]]) {
    const w = courtWorld(), i = await w.issue();
    const r = await w.call({ operation: 'forfeit', runId: i.runId, ...body }, at);
    assert.deepEqual([r.closedBy, r.alreadyProcessed], ['forfeit', false]);
    assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: at });
    await assert.rejects(w.issue(at + 1), e => e.code === 'zone_cooldown');
  }
});

test('court: a cancel claim on a forfeited run changes nothing; malformed is invalid_request; an expired run stays the timeout loss', async () => {
  const w = courtWorld(), i = await w.issue();
  await w.call({ operation: 'forfeit', runId: i.runId }, now + 1_000);
  const snap = JSON.stringify([w.user(), w.doc()]);
  assert.deepEqual(await w.call({ operation: 'forfeit', runId: i.runId, leftBeforeFight: true }, now + 2_000), { schemaVersion: 'holozone-run-2', runId: i.runId, alreadyProcessed: true, closedBy: 'forfeit' });
  assert.equal(JSON.stringify([w.user(), w.doc()]), snap);
  const v = courtWorld(), vi = await v.issue();
  await assert.rejects(v.call({ operation: 'forfeit', runId: vi.runId, leftBeforeFight: 'yes' }, now + 1_000), e => e.code === 'invalid_request');
  assert.equal(v.doc().runs[0].closedAtMs, null);
  const x = courtWorld(), xi = await x.issue(), t = x.doc().runs[0].expiresAtMs + 1;
  await assert.rejects(x.call({ operation: 'forfeit', runId: xi.runId, leftBeforeFight: true }, t), e => e.code === 'run_expired' && e.detail?.closedBy === 'expired');
  assert.equal(x.doc().runs[0].closedBy, 'expired');
  assert.deepEqual(x.doc().zoneLastSettledAtMs, { guild_court: x.doc().runs[0].expiresAtMs });
});

test('court: the field on a plain run\'s forfeit is refused exactly as the plain forfeit is (invalid_request)', async () => {
  const w = courtWorld(), i = await w.call({ operation: 'issue', zoneId: 'guild_court' });
  await assert.rejects(w.call({ operation: 'forfeit', runId: i.runId, leftBeforeFight: true }, now + 1_000), e => e.code === 'invalid_request');
  assert.equal(Z.HOLOZONE_COOLDOWN_MS > 0, true);
});
