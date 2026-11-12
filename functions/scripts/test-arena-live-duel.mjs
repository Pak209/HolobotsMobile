// arena-live-1 (Pak 2026-11-11): the Arena CPU match as a live input-log duel, issued with buildFightReplayIssue and settled by
// verifyFightReplay (the rival live duel's checker), on the in-memory Firestore double. Economy (fee, rewards, daily cap, refund,
// forfeit, idempotency, expiry) must match the resolver path; only the outcome source changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer, verifyFightReplay, clone } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const A = require('../lib/arena/arenaMatchStore.js');
const R = require('../lib/lib/duelResolver.js');
const P = require('../lib/lib/progression.js');
const { ledgerHealthAfterFight } = require('../lib/lib/partStats.js');
const { FIGHT_PLAUSIBILITY_COLLECTION } = require('../lib/rival/rivalBattleStore.js');

const T0 = Date.UTC(2026, 10, 11, 9), S = 'arena-match-1', START = T0 + 1, LATER = START + A.ARENA_MIN_WIN_MS_LIVE + 5_000;
const SEED = process.env.ARENA_LIVE_SEED || '3e'.repeat(32);
const ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const LIVE = { duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const db = fakeDb({ now: T0 });
let serial = 0;
const threshold = (l) => P.calculateExperience(l + 1);
const strong = (level = 21) => ({ name: 'ACE', level, experience: 0, nextLevelExp: threshold(level), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
const weak = () => ({ name: 'ACE', level: 1, experience: 0, nextLevelExp: threshold(1), attributePoints: 0, boostedAttributes: {} });
async function setup(bot = strong(), extra = {}) {
  const uid = `arena_live_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [bot], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false }, ...extra });
  return uid;
}
const call = (uid, body, now = T0, options = ON) => A.transactArenaMatch(db, uid, { schemaVersion: S, ...body }, now, options);
const issue = (uid, extra = LIVE, now = T0, options = ON) => call(uid, { operation: 'issue', requestId: `req_live_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra }, now, options);
async function started(uid, extra = LIVE, options = ON) { const i = await issue(uid, extra, T0, options); await call(uid, { operation: 'start', matchId: i.matchId }, START, options); return i; }
const record = async (uid, id) => (await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data();
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const payouts = async (uid) => (await db.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).get()).data();
const code = (c) => (e) => e.code === c;
const winLog = (duel) => recordFightLog(duel, smartPlayer(duel, 'ace', 'Legendary')).wire;
const idleLog = (duel) => recordFightLog(duel, { read: () => F.toInput(F.idleRecord()) }).wire;
const settle = (uid, id, inputLog, now = LATER, options = ON) => call(uid, { operation: 'settle', matchId: id, inputLog }, now, options);

test('flag: off by default; ON only with both HOLOCITY_ARENA_FIGHT_REPLAY=1 and HOLOCITY_FIGHT_REPLAY=1', () => {
  assert.equal(A.ARENA_FIGHT_REPLAY_FLAG, 'HOLOCITY_ARENA_FIGHT_REPLAY');
  assert.equal(A.arenaFightReplayEnabled({}), false);
  assert.equal(A.arenaFightReplayEnabled({ HOLOCITY_ARENA_FIGHT_REPLAY: '1' }), false);
  assert.equal(A.arenaFightReplayEnabled({ HOLOCITY_FIGHT_REPLAY: '1' }), false);
  assert.equal(A.arenaFightReplayEnabled({ HOLOCITY_ARENA_FIGHT_REPLAY: 'true', HOLOCITY_FIGHT_REPLAY: '1' }), false);
  assert.equal(A.arenaFightReplayEnabled({ HOLOCITY_ARENA_FIGHT_REPLAY: '1', HOLOCITY_FIGHT_REPLAY: '1' }), true);
});

test('issue: live opt-in pins an input-log issue bound to the match and serves the rival-shaped duel block (seed disclosed)', async () => {
  const uid = await setup(), i = await issue(uid);
  assert.deepEqual(Object.keys(i).sort(), ['alreadyProcessed', 'duel', 'match', 'matchId', 'payoutCapped', 'schemaVersion']);
  const d = i.duel;
  assert.equal(d.mode, 'input-log'); assert.equal(d.schemaVersion, 'duel-receipt-2'); assert.equal(d.inputsSchema, 'duel-inputs-2'); assert.equal(d.simVersion, 'duel-sim-3');
  assert.equal(d.rulesId, `duel-rules-6:${i.matchId}`); assert.equal(d.seed, SEED); assert.equal(d.playerSide, 0);
  assert.deepEqual(d.player.roster, [{ fighterId: 'ace', holobotId: 'ace' }]);
  assert.deepEqual(d.cpu.roster, [{ fighterId: 'cpu-hare', holobotId: 'hare', profile: 'hare' }]);
  assert.equal(d.cpu.rank.rank, 'starter', 'rookie tier -> Starter CPU rank');
  assert.equal('readinessStart' in d, false);
  assert.deepEqual(d.rules.fighters.map(f => [f.id, f.side]), [['ace', 0], ['cpu-hare', 1]]);
  assert.ok(d.rules.fighters[0].hp > 0 && d.rules.fighters[0].hp === d.rules.fighters[0].maxHp, 'a full bot starts full');
  assert.equal('duel' in i.match, false);
  assert.deepEqual((await record(uid, i.matchId)).duel, d, 'the reply block is the stored block');
  assert.deepEqual((await call(uid, { operation: 'resume', matchId: i.matchId })).duel, d);
  assert.deepEqual((await call(uid, { operation: 'start', matchId: i.matchId }, START)).duel, d);
  // the shared flags pick the rules version exactly as on the rival host
  const plain = await issue(await setup(), { duelInputs: 'duel-inputs-2' }, T0, { ...ON, fightChase: false, fightAttrs: false });
  assert.match(plain.duel.rulesId, /^duel-rules-3:/);
  const five = await issue(await setup(), { duelInputs: 'duel-inputs-2' });
  assert.match(five.duel.rulesId, /^duel-rules-5:/, 'no fightRules ask: duel-rules-5');
  const tiers = [];
  for (const [tierId, opponentName] of [['challenger', 'KUMA'], ['elite', 'TORA'], ['legend', 'ERA']]) tiers.push((await issue(await setup(), { ...LIVE, tierId, opponentName })).duel.cpu.rank.rank);
  assert.deepEqual(tiers, ['champion', 'rare', 'elite']);
});

test('flag off: duelInputs is ignored (resolver with duelSchema, else legacy), exactly as before', async () => {
  const off = { ...ON, arenaFightReplay: false };
  const r = await issue(await setup(), LIVE, T0, off);
  assert.equal(r.duel.mode, 'resolver');
  const l = await issue(await setup(), { duelInputs: 'duel-inputs-2' }, T0, off);
  assert.equal('duel' in l, false);
  // the default (no options) reads the env, which the test run leaves unset
  const env = await A.transactArenaMatch(db, await setup(), { schemaVersion: S, operation: 'issue', requestId: 'req_live_envdefault', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE }, T0);
  if (!A.arenaFightReplayEnabled()) assert.equal(env.duel.mode, 'resolver');
});

test('valid win: outcome, HP and rewards come from the verified replay; fightReceipt at the top level; plausibility kept host-side', async () => {
  const uid = await setup(), i = await started(uid), m = await record(uid, i.matchId), before = await user(uid);
  const log = winLog(i.duel), expected = verifyFightReplay(i.duel, log, { battleId: i.matchId });
  assert.equal(expected.receipt.winner, 'player', 'pinned seed gives the scripted player a win');
  const s = await settle(uid, i.matchId, log);
  assert.deepEqual(s.fightReceipt, expected.receipt);
  assert.equal(s.match.state, 'settled'); assert.equal(s.match.settlementReceipt.outcome, 'win');
  assert.equal(s.match.settlementReceipt.report.fightWinner, 'player');
  assert.deepEqual([s.match.settlementReceipt.report.combosCompleted, s.match.settlementReceipt.report.perfectDefenses], [0, 0]);
  for (const k of ['fightReceipt', 'fightPlausibility', 'duel']) assert.equal(k in s.match, false, k);
  assert.equal(s.duel.mode, 'input-log');
  const after = await user(uid), pf = expected.receipt.playerFinal[0];
  assert.equal(after.holobotVitals.ace.currentHealth, ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, m.entrant), 'HP is the replay\'s, on the ledger scale');
  assert.equal(after.holosTokens, before.holosTokens + m.rules.holos);
  assert.equal(after.blueprints.hare, m.rules.blueprints);
  assert.equal(after.wins, 1); assert.equal(after.losses, 0);
  assert.equal(s.match.settlementReceipt.settlement.exp, m.rules.exp, 'no performance bonus');
  assert.equal(s.progression[0].expGained, m.rules.exp);
  assert.equal((await payouts(uid)).paidSettles, 1);
  const rec = await record(uid, i.matchId);
  assert.deepEqual(rec.fightPlausibility, expected.plausibility);
  assert.equal(rec.fightPlausibility.flagged, false);
  assert.equal([...db.docs.keys()].some(k => k.startsWith(`${FIGHT_PLAUSIBILITY_COLLECTION}/${uid}_`)), false);
  assert.equal((await db.doc(`arenaMatches/${uid}`).get()).data().open, false, 'lease released');
  assert.equal(A.readArenaMatchRecord(rec, i.matchId).state, 'settled', 'the record validator accepts the settled live match');
});

test('valid loss: fee kept, no Holos or blueprints, loss counted, HP from the replay', async () => {
  const uid = await setup(weak()), i = await started(uid, { ...LIVE, opponentName: 'KUMA' }), m = await record(uid, i.matchId), before = await user(uid);
  const log = idleLog(i.duel), expected = verifyFightReplay(i.duel, log, { battleId: i.matchId });
  assert.notEqual(expected.receipt.winner, 'player');
  // a loss is never too fast
  const s = await settle(uid, i.matchId, log, START + 2_000);
  assert.equal(s.match.settlementReceipt.outcome, 'loss');
  assert.deepEqual(s.fightReceipt, expected.receipt);
  const after = await user(uid), pf = expected.receipt.playerFinal[0];
  assert.equal(after.holosTokens, before.holosTokens); assert.deepEqual(after.blueprints ?? {}, {});
  assert.equal(after.losses, 1); assert.equal(after.wins, 0);
  assert.equal(after.holobotVitals.ace.currentHealth, ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, m.entrant));
  assert.equal(s.match.settlementReceipt.settlement.exp, Math.floor(m.rules.exp * m.rules.lossExpFraction));
  assert.equal((await record(uid, i.matchId)).fightPlausibility, undefined, 'a loss is not judged');
});

test('tampered log: replay_mismatch closes the match as a no-pay forfeit (fee kept, HP as issued), then reports; a resend replays', async () => {
  const uid = await setup(), i = await started(uid), before = await user(uid);
  const log = F.parseInputLog(winLog(i.duel));
  for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
  await assert.rejects(settle(uid, i.matchId, F.inputLogToWire(log)), e => e.code === 'replay_mismatch' && ['hash', 'final_hash'].includes(e.detail.reason) && e.detail.fromTick === 0);
  const rec = await record(uid, i.matchId);
  assert.equal(rec.state, 'cancelled');
  assert.deepEqual([rec.settlementReceipt.outcome, rec.settlementReceipt.settlement, rec.settlementReceipt.closedBy, rec.settlementReceipt.refunded], ['forfeit', null, 'replay_mismatch', false]);
  assert.equal(rec.fightReceipt, undefined);
  const after = await user(uid);
  for (const k of ['holosTokens', 'holobots', 'wins', 'losses', 'syncPoints', 'blueprints']) assert.deepEqual(after[k], before[k], k);
  assert.equal(after.holobotVitals.ace.currentHealth, before.holobotVitals.ace.currentHealth, 'HP as issued');
  assert.equal(await payouts(uid), undefined, 'never counts toward the cap');
  // a resend (even of an honest log) replays the closure, never pays
  const again = await settle(uid, i.matchId, winLog(i.duel), LATER + 1);
  assert.deepEqual([again.alreadyProcessed, again.match.state, again.match.settlementReceipt.closedBy], [true, 'cancelled', 'replay_mismatch']);
  assert.equal('fightReceipt' in again, false);
  assert.deepEqual(await user(uid), after);
  assert.equal((await issue(uid)).duel.mode, 'input-log', 'lease freed: a new match issues at once');
});

test('wrong issue / seed: a log recorded for another match, or with a forged seed, never verifies and never pays', async () => {
  const a = await setup(), ia = await started(a), b = await setup(), ib = await started(b);
  await assert.rejects(settle(b, ib.matchId, winLog(ia.duel)), e => e.code === 'replay_mismatch' && e.detail.reason === 'identity' && e.detail.field === 'rulesId');
  const c = await setup(), ic = await started(c), forged = clone(ic.duel); forged.seed = 'ab'.repeat(32);
  await assert.rejects(settle(c, ic.matchId, winLog(forged)), e => e.code === 'replay_mismatch' && e.detail.field === 'seed');
  for (const uid of [b, c]) assert.equal((await user(uid)).holosTokens, 1000 - 50, 'only the entry fee moved');
  // undecodable is not a mismatch: invalid_request (reason invalid_log), nothing written, the match stays open and settles later
  const d = await setup(), id = await started(d), bad = clone(winLog(id.duel)); bad.sides[0].stream = '!!!!';
  await assert.rejects(settle(d, id.matchId, bad), e => e.code === 'invalid_request' && e.reason === 'invalid_log');
  assert.equal((await record(d, id.matchId)).state, 'active');
  assert.equal((await settle(d, id.matchId, winLog(id.duel))).match.settlementReceipt.outcome, 'win');
});

test('settled twice: the second settle replays the stored receipt and writes nothing', async () => {
  const uid = await setup(), i = await started(uid), log = winLog(i.duel);
  const first = await settle(uid, i.matchId, log), snapshot = await user(uid);
  const second = await settle(uid, i.matchId, log, LATER + 10);
  assert.equal(second.alreadyProcessed, true);
  assert.deepEqual(second.fightReceipt, first.fightReceipt); assert.deepEqual(second.progression, first.progression);
  assert.deepEqual(second.match.settlementReceipt, first.match.settlementReceipt);
  assert.deepEqual(await user(uid), snapshot);
  assert.equal((await payouts(uid)).paidSettles, 1);
  assert.deepEqual((await call(uid, { operation: 'resume', matchId: i.matchId }, LATER + 20)).fightReceipt, first.fightReceipt);
});

test('too_fast: a verified win sooner than 20 s after start writes nothing and carries retryAfterMs; the same log settles later', async () => {
  const uid = await setup(), i = await started(uid), log = winLog(i.duel), before = [await user(uid), await record(uid, i.matchId)];
  await assert.rejects(settle(uid, i.matchId, log, START + 5_000), e => e.code === 'too_fast' && e.retryAfterMs === A.ARENA_MIN_WIN_MS_LIVE - 5_000);
  assert.deepEqual([await user(uid), await record(uid, i.matchId)], before);
  assert.equal((await settle(uid, i.matchId, log, START + A.ARENA_MIN_WIN_MS_LIVE)).match.state, 'settled');
});

test('forfeit: cancel after start = no-pay forfeit with HP as issued (no client HP); cancel before start refunds the fee', async () => {
  const a = await setup(), i = await issue(a);
  const r = await call(a, { operation: 'cancel', matchId: i.matchId }, T0 + 1);
  assert.equal(r.match.settlementReceipt.outcome, 'cancelled_before_start');
  assert.equal((await user(a)).holosTokens, 1000, 'refunded');
  const b = await setup(), j = await started(b), hp = j.match.entrant.currentHealth;
  await assert.rejects(call(b, { operation: 'cancel', matchId: j.matchId, playerFinalHealth: 1 }, START + 10), code('invalid_request'));
  const f = await call(b, { operation: 'cancel', matchId: j.matchId }, START + 10);
  assert.deepEqual([f.match.state, f.match.settlementReceipt.outcome, f.match.settlementReceipt.settlement], ['cancelled', 'forfeit', null]);
  const u = await user(b);
  assert.deepEqual([u.holobotVitals.ace.currentHealth, u.holosTokens, u.losses], [hp, 950, 0]);
  const late = await settle(b, j.matchId, winLog(j.duel));
  assert.deepEqual([late.alreadyProcessed, late.match.settlementReceipt.outcome], [true, 'forfeit'], 'a later winning log cannot reopen it');
});

test('daily cap reached: a verified win closes and writes HP but pays nothing (payoutWithheld daily_cap)', async () => {
  const uid = await setup(), i = await started(uid), before = await user(uid);
  await db.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).set({ schemaVersion: A.ARENA_CPU_PAYOUTS_SCHEMA, day: new Date(LATER).toISOString().slice(0, 10), paidSettles: A.ARENA_CPU_DAILY_PAYOUT_CAP });
  assert.equal((await issue(await setup())).payoutCapped, false, 'another account is not capped');
  const s = await settle(uid, i.matchId, winLog(i.duel));
  assert.equal(s.match.settlementReceipt.outcome, 'win');
  assert.equal(s.match.settlementReceipt.settlement.payoutWithheld, 'daily_cap');
  const after = await user(uid);
  assert.equal(after.holosTokens, before.holosTokens); assert.equal(s.progression[0].expGained, 0);
  assert.ok(after.holobotVitals.ace.currentHealth <= before.holobotVitals.ace.currentHealth);
  assert.equal((await payouts(uid)).paidSettles, A.ARENA_CPU_DAILY_PAYOUT_CAP, 'unchanged');
});

test('expiry: a live settle past the TTL is match_expired and writes nothing', async () => {
  const uid = await setup(), i = await started(uid), before = await user(uid);
  await assert.rejects(settle(uid, i.matchId, winLog(i.duel), T0 + A.ARENA_MATCH_TTL_MS + 1), code('match_expired'));
  assert.deepEqual(await user(uid), before); assert.equal((await record(uid, i.matchId)).state, 'active');
});

test('old clients: resolver (duelSchema only) and legacy (no opt-in) are unchanged with the flag ON', async () => {
  const uid = await setup(), i = await started(uid, { duelSchema: 'duel-receipt-1' });
  assert.equal(i.duel.mode, 'resolver'); assert.equal(JSON.stringify(i).includes('"seed"'), false);
  const m = await record(uid, i.matchId), plan = ['strike', 'heavy', 'strike', 'defend'];
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: plan }, START + A.ARENA_MIN_SETTLE_MS_CPU + 500);
  assert.deepEqual(s.duelReceipt, R.resolveDuel({ ...m.duel.input, playerIntents: plan }));
  assert.equal('fightReceipt' in s, false);
  const old = await setup(), j = await started(old, {});
  assert.equal('duel' in j, false);
  const l = await call(old, { operation: 'settle', matchId: j.matchId, playerFinalHealth: 100, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, START + A.ARENA_MIN_SETTLE_MS_CPU + 500);
  assert.equal(l.match.settlementReceipt.outcome, 'win');
  // a log is refused on both old modes
  const r2 = await setup(), k = await started(r2, { duelSchema: 'duel-receipt-1' });
  await assert.rejects(settle(r2, k.matchId, { any: 1 }), code('invalid_request'));
  const l2 = await setup(), n = await started(l2, {});
  await assert.rejects(settle(l2, n.matchId, { any: 1 }), code('invalid_request'));
});

test('mode lock: a live match refuses intents, HP reports and a missing log; the request shape is validated', async () => {
  const uid = await setup(), i = await started(uid);
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: ['strike'] }, LATER), code('invalid_request'));
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, playerFinalHealth: 100, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, LATER), e => e.code === 'invalid_request' && e.reason === 'input_log_required');
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, inputLog: winLog(i.duel), playerFinalHealth: 100 }, LATER), code('invalid_request'));
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, inputLog: 7 }, LATER), code('invalid_request'));
  assert.equal((await record(uid, i.matchId)).state, 'active');
  const v = await setup();
  await assert.rejects(issue(v, { duelInputs: 'duel-inputs-1' }), code('invalid_request'));
  await assert.rejects(issue(v, { fightRules: 'duel-rules-7', duelInputs: 'duel-inputs-2' }), code('invalid_request'));
  await assert.rejects(issue(v, { duelInputs: 'duel-inputs-2', tournamentId: 'starter' }), code('invalid_request'));
  const body = { requestId: 'req_live_identity', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE' };
  await call(v, { operation: 'issue', ...body, duelSchema: 'duel-receipt-1' });
  await assert.rejects(call(v, { operation: 'issue', ...body, ...LIVE }), code('request_conflict'), 'a requestId cannot change mode');
  // a live settle on a match that was never started
  const w = await setup(), x = await issue(w);
  await assert.rejects(settle(w, x.matchId, winLog(x.duel)), code('invalid_state'));
});

test('a realistic fight (unboosted level 21 ACE vs HARE, rules-6): the settle follows the replay whatever the winner', async () => {
  const bot = { ...strong(), boostedAttributes: {} };
  const uid = await setup(bot), i = await started(uid), log = winLog(i.duel), v = verifyFightReplay(i.duel, log, { battleId: i.matchId });
  assert.ok(v.ticks > 300, `a real-time length fight (${v.ticks} ticks)`);
  const s = await settle(uid, i.matchId, log);
  assert.equal(s.match.settlementReceipt.outcome, v.receipt.winner === 'player' ? 'win' : 'loss');
  assert.deepEqual(s.fightReceipt, v.receipt);
  console.log(`# realistic fight: ${v.receipt.winner} by ${v.receipt.reason} at tick ${v.receipt.endTick}`);
});
