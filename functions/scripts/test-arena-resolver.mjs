// arena-match-1 resolver path (plan + send) and battle-progression-1. Runs on the in-memory Firestore double by default
// (npm test) and on the Firestore emulator when FIRESTORE_EMULATOR_HOST + a demo- project are set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('demo emulator only');
const db = emulator ? require('../lib/admin.js').db : fakeDb({ now: Date.UTC(2026, 10, 8, 9) });
const A = require('../lib/arena/arenaMatchStore.js');
const R = require('../lib/lib/duelResolver.js');
const P = require('../lib/lib/progression.js');
const B = require('../lib/story/tournamentBracketStore.js');
const G = require('../lib/story/arenaGathering.js');
const TR = require('../lib/story/tournamentResultStore.js');

const T0 = Date.UTC(2026, 10, 8, 9), S = 'arena-match-1', LATER = T0 + 1 + A.ARENA_MIN_SETTLE_MS_CPU + 500;
let serial = 0;
const threshold = (l) => P.calculateExperience(l + 1);
const strong = (level = 21, experience = 0) => ({ name: 'ACE', level, experience, nextLevelExp: threshold(level), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
const weak = () => ({ name: 'ACE', level: 1, experience: 0, nextLevelExp: threshold(1), attributePoints: 0, boostedAttributes: {} });
async function setup(bot = strong(), extra = {}) {
  const uid = `arena_resolver_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [bot], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false }, ...extra });
  return uid;
}
const call = (uid, body, now = T0) => A.transactArenaMatch(db, uid, { schemaVersion: S, ...body }, now);
const issue = (uid, extra = {}, now = T0) => call(uid, { operation: 'issue', requestId: `req_resolver_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra }, now);
const opted = { duelSchema: 'duel-receipt-1' };
async function started(uid, extra = opted) { const i = await issue(uid, extra); await call(uid, { operation: 'start', matchId: i.matchId }, T0 + 1); return i; }
const record = async (uid, id) => (await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data();
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const code = (c) => (e) => e.code === c;
const legacy = { playerFinalHealth: 100, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 };
const PLAN = ['strike', 'heavy', 'strike', 'defend'];

test('no opt-in: deployed reply shape, no duel keys; a legacy settle adds only top-level progression', async () => {
  const uid = await setup(), i = await started(uid, {});
  assert.deepEqual(Object.keys(i).sort(), ['alreadyProcessed', 'match', 'matchId', 'payoutCapped', 'schemaVersion']);
  assert.equal('duel' in i.match, false);
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, ...legacy }, LATER);
  assert.deepEqual(Object.keys(s).sort(), ['alreadyProcessed', 'match', 'matchId', 'progression', 'schemaVersion']);
  assert.equal('progression' in s.match, false);
  assert.equal(s.progression[0].holobotId, 'ace'); assert.equal(s.progression[0].expGained, s.match.settlementReceipt.settlement.awardedExp);
  assert.deepEqual(Object.keys(s.progression[0]).sort(), ['attributePoints', 'expGained', 'experience', 'holobotId', 'levelAfter', 'levelBefore', 'nextLevelExp', 'rank']);
  await assert.rejects(call(uid, { operation: 'resume', matchId: i.matchId, playerIntents: PLAN }, LATER), code('invalid_request'));
});

test('opt-in issue pins the fight and serves the public duel block; the seed is never disclosed before settle', async () => {
  const uid = await setup(), i = await issue(uid, opted);
  assert.equal(i.duel.mode, 'resolver'); assert.equal(i.duel.schemaVersion, 'duel-receipt-1'); assert.equal(i.duel.maxRounds, 120);
  assert.equal(i.duel.player[0].holobotId, 'ace'); assert.equal(i.duel.opponent[0].holobotId, 'hare');
  assert.equal(i.duel.player[0].currentHealth, i.match.entrant.currentHealth);
  assert.equal(JSON.stringify(i).includes('"seed"'), false);
  assert.equal(JSON.stringify(await call(uid, { operation: 'resume', matchId: i.matchId })).includes('"seed"'), false);
  assert.equal(JSON.stringify(await call(uid, { operation: 'start', matchId: i.matchId }, T0 + 1)).includes('"seed"'), false);
  const m = await record(uid, i.matchId);
  assert.ok(Number.isSafeInteger(m.duel.input.seed)); assert.equal(m.duel.input.player[0].tier, 0);
});

test('settle resolves on the server: outcome, HP, rewards and receipt come from the resolver; a replay pays nothing', async () => {
  const uid = await setup(), i = await started(uid), m = await record(uid, i.matchId), before = await user(uid);
  const expected = R.resolveDuel({ ...m.duel.input, playerIntents: PLAN });
  assert.equal(expected.winner, 'player');
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: PLAN }, LATER);
  assert.deepEqual(s.duelReceipt, expected);
  assert.equal(s.match.state, 'settled'); assert.equal(s.match.settlementReceipt.outcome, 'win');
  assert.equal('duelReceipt' in s.match, false);
  const after = await user(uid);
  assert.equal(after.holobotVitals.ace.currentHealth, expected.playerFinal[0].currentHealth, 'HP is the resolver\'s');
  assert.equal(after.holosTokens, before.holosTokens + m.rules.holos, 'payout unchanged');
  assert.equal(after.blueprints.hare, m.rules.blueprints);
  assert.equal(s.match.settlementReceipt.settlement.exp, m.rules.exp, 'no client-reported performance bonus');
  assert.equal(s.progression[0].expGained, m.rules.exp);
  assert.equal((await db.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).get()).data().paidSettles, 1, 'counts toward the daily cap');
  const replay = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: ['defend'] }, LATER + 1);
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.duelReceipt, expected); assert.deepEqual(replay.progression, s.progression);
  assert.deepEqual(await user(uid), after);
  assert.deepEqual((await call(uid, { operation: 'resume', matchId: i.matchId }, LATER + 2)).duelReceipt, expected);
});

test('a loss resolves too: fee kept, no Holos or blueprints, KO HP written from the resolver', async () => {
  const uid = await setup(weak()), i = await started(uid, { ...opted, opponentName: 'KUMA' }), before = await user(uid);
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: ['defend'] }, LATER);
  assert.equal(s.duelReceipt.winner, 'opponent'); assert.equal(s.match.settlementReceipt.outcome, 'loss');
  const after = await user(uid);
  assert.equal(after.holosTokens, before.holosTokens); assert.deepEqual(after.blueprints ?? {}, {});
  assert.equal(after.holobotVitals.ace.currentHealth, s.duelReceipt.playerFinal[0].currentHealth);
  assert.equal(after.losses, 1);
});

test('a round-limit result with both fighters alive stores and replays (not rejected by the record check)', async () => {
  const bot = { ...strong(), boostedAttributes: { attack: 0, defense: 3000, health: 5000, speed: 0 } };
  const uid = await setup(bot), i = await started(uid);
  // Pure defence with a huge HP pool: nobody can be knocked out inside 120 rounds.
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: ['defend'] }, LATER);
  assert.equal(s.duelReceipt.reason, 'round_limit');
  assert.ok(s.duelReceipt.playerFinal[0].currentHealth > 0 && s.duelReceipt.opponentFinal[0].currentHealth > 0);
  assert.equal((await call(uid, { operation: 'resume', matchId: i.matchId }, LATER + 1)).match.state, 'settled');
});

test('no client HP or performance on the resolver path, and no intents on a legacy match', async () => {
  const uid = await setup(), i = await started(uid);
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, ...legacy }, LATER), code('invalid_request'), 'stored mode cannot be downgraded');
  await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: PLAN, playerFinalHealth: 9999 }, LATER), code('invalid_request'));
  for (const bad of [[], ['punch'], 'strike', Array(121).fill('strike')]) await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: bad }, LATER), code('invalid_request'));
  const old = await setup(), j = await started(old, {});
  await assert.rejects(call(old, { operation: 'settle', matchId: j.matchId, playerIntents: PLAN }, LATER), code('invalid_request'));
});

test('the floor refuses every outcome before resolving (no plan oracle) and writes nothing; the same plan succeeds later', async () => {
  for (const [bot, plan] of [[strong(), PLAN], [weak(), ['strike']]]) {
    const uid = await setup(bot), i = await started(uid), before = [await user(uid), await record(uid, i.matchId)];
    await assert.rejects(call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: plan }, T0 + 500), (e) => e.code === 'too_fast' && e.retryAfterMs === A.ARENA_MIN_SETTLE_MS_CPU - 499);
    assert.deepEqual([await user(uid), await record(uid, i.matchId)], before);
    assert.equal((await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: plan }, LATER)).match.state, 'settled');
  }
});

test('daily cap and expiry are unchanged', async () => {
  const uid = await setup(), i = await started(uid), before = await user(uid);
  await db.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).set({ schemaVersion: A.ARENA_CPU_PAYOUTS_SCHEMA, day: new Date(LATER).toISOString().slice(0, 10), paidSettles: A.ARENA_CPU_DAILY_PAYOUT_CAP });
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: PLAN }, LATER);
  assert.equal(s.match.settlementReceipt.settlement.payoutWithheld, 'daily_cap');
  assert.equal((await user(uid)).holosTokens, before.holosTokens);
  assert.equal(s.progression[0].expGained, 0);
  const late = await setup(), j = await started(late);
  await assert.rejects(call(late, { operation: 'settle', matchId: j.matchId, playerIntents: PLAN }, T0 + A.ARENA_MATCH_TTL_MS + 1), code('match_expired'));
});

test('cancel on the resolver path: before start refunds; after start forfeits with HP unchanged and no client HP', async () => {
  const a = await setup(), i = await issue(a, opted);
  assert.equal((await call(a, { operation: 'cancel', matchId: i.matchId }, T0 + 1)).match.settlementReceipt.outcome, 'cancelled_before_start');
  const b = await setup(), j = await started(b), hp = j.match.entrant.currentHealth;
  await assert.rejects(call(b, { operation: 'cancel', matchId: j.matchId, playerFinalHealth: 1 }, T0 + 10), code('invalid_request'));
  const f = await call(b, { operation: 'cancel', matchId: j.matchId }, T0 + 10);
  assert.equal(f.match.settlementReceipt.outcome, 'forfeit');
  assert.equal((await user(b)).holobotVitals.ace.currentHealth, hp);
});

test('issue validation: duelSchema value, cups never resolver, one requestId cannot change mode, activity conflicts unchanged', async () => {
  const uid = await setup();
  await assert.rejects(issue(uid, { duelSchema: 'duel-receipt-2' }), code('invalid_request'));
  await assert.rejects(issue(uid, { ...opted, tournamentId: 'starter' }), code('invalid_request'));
  const body = { requestId: 'req_same_identity', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE' };
  const i = await call(uid, { operation: 'issue', ...body, ...opted });
  await assert.rejects(call(uid, { operation: 'issue', ...body }), code('request_conflict'));
  assert.equal((await call(uid, { operation: 'issue', ...body, ...opted })).alreadyProcessed, true);
  await assert.rejects(issue(uid, opted), code('activity_conflict'));
  assert.ok(i.duel);
});

test('progression reports LEVEL UP', async () => {
  const uid = await setup(strong(11, threshold(11) - 1)), i = await started(uid);
  const [row] = (await call(uid, { operation: 'settle', matchId: i.matchId, playerIntents: PLAN }, LATER)).progression;
  assert.equal(row.levelBefore, 11); assert.ok(row.levelAfter >= 12); assert.equal(row.rank, P.getHolobotRank(row.levelAfter));
});

const BS = 'arena-bracket-1';
async function bracket(bot, fields, level) {
  const uid = await setup(bot);
  await G.transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' });
  const i = await issue(uid, { tournamentId: 'starter' });
  const go = (operation, extra = {}) => B.transactTournamentBracket(db, uid, { schemaVersion: BS, operation, matchId: i.matchId, ...extra }, T0);
  let r = await go('start');
  while (!r.bracket.done && r.bracket.playerAlive) {
    const round = r.bracket.round;
    r = await go('advance', { expectedRound: round, ...fields });
    if (!r.bracket.done && r.bracket.playerAlive) assert.equal('progression' in r, false, 'only once the bracket has closed');
  }
  return { uid, r, go, id: i.matchId };
}

test('bracket progression is opt-in: default replies keep Unity\'s exact keys; asked-for replies carry the row, on resume too', async () => {
  const plain = await bracket(strong(), {});
  assert.deepEqual(Object.keys(plain.r).sort(), ['alreadyProcessed', 'bracket', 'cancelled', 'matchId', 'schemaVersion', 'storyFlags']);
  const asked = await bracket(strong(), { progressionSchema: 'battle-progression-1' });
  assert.equal(asked.r.progression[0].holobotId, 'ace');
  assert.ok(asked.r.progression[0].expGained > 0);
  assert.deepEqual((await asked.go('resume', { progressionSchema: 'battle-progression-1' })).progression, asked.r.progression);
  assert.deepEqual(Object.keys(await asked.go('resume')).sort(), ['alreadyProcessed', 'bracket', 'cancelled', 'matchId', 'schemaVersion', 'storyFlags']);
  await assert.rejects(asked.go('resume', { progressionSchema: 'x' }), code('invalid_request'));
});

test('an eliminated pilot also gets progression; tournamentResultHost honours the same opt-in', async () => {
  // The bracket seed is random per start, and a level 2 bot can occasionally win out: try fresh pilots until one is eliminated.
  let lost;
  for (let tries = 0; tries < 25 && (!lost || lost.r.bracket.playerAlive); tries++) lost = await bracket({ ...strong(2), boostedAttributes: {} }, { progressionSchema: 'battle-progression-1' });
  assert.equal(lost.r.bracket.playerAlive, false);
  assert.equal(lost.r.progression.length, 1);
  await assert.rejects(TR.transactTournamentResult(db, lost.uid, { schemaVersion: 'arena-tournament-1', tournamentId: 'starter', matchId: lost.id, progressionSchema: 'x' }), code('invalid_request'));
  const uid = await setup(strong());
  await G.transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' });
  const i = await issue(uid, { tournamentId: 'starter' });
  let r = await B.transactTournamentBracket(db, uid, { schemaVersion: BS, operation: 'start', matchId: i.matchId }, T0);
  while (!r.bracket.done) r = await B.transactTournamentBracket(db, uid, { schemaVersion: BS, operation: 'advance', matchId: i.matchId, expectedRound: r.bracket.round }, T0);
  const flags = await user(uid);
  await db.doc(`users/${uid}`).update({ storyFlags: { ...flags.storyFlags, tournamentsWon: 0 } });
  const direct = await TR.transactTournamentResult(db, uid, { schemaVersion: 'arena-tournament-1', tournamentId: 'starter', matchId: i.matchId, progressionSchema: 'battle-progression-1' });
  assert.equal(direct.progression[0].holobotId, 'ace');
});
