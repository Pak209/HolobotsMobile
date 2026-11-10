// Arena issue after a closed cup, and a bot whose stored nextLevelExp is stale. Runs on the in-memory Firestore double by
// default (npm test) and on the Firestore emulator when FIRESTORE_EMULATOR_HOST + a demo- project are set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('demo emulator only');
const db = emulator ? require('../lib/admin.js').db : fakeDb({ now: Date.UTC(2026, 10, 8, 9) });
const A = require('../lib/arena/arenaMatchStore.js');
const B = require('../lib/story/tournamentBracketStore.js');
const G = require('../lib/story/arenaGathering.js');
const P = require('../lib/lib/progression.js');

const T0 = Date.UTC(2026, 10, 8, 9), LATER = T0 + 1 + A.ARENA_MIN_SETTLE_MS_CPU + 500;
const OPT_IN = { progressionSchema: 'battle-progression-1', prizeSchema: 'cup-prize-1' };
let serial = 0;
const next = (level) => P.calculateExperience(level + 1);
const bot = (name, level, extra = {}) => ({ name, level, experience: 0, nextLevelExp: next(level), attributePoints: 0, boostedAttributes: {}, ...extra });
const strongAce = () => bot('ACE', 21, { boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
const weakAce = () => bot('ACE', 2);
/** The emulator account's shape: a captured record (next 400, 10 points) whose level was raised without its threshold. */
const staleKurai = () => bot('KURAI', 12, { nextLevelExp: 400, attributePoints: 10 });
async function setup(holobots) {
  const uid = `after_cup_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots, arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
  return uid;
}
const call = (uid, body, now) => A.transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...body }, now);
const issue = (uid, extra = {}, now = T0 + 1000) => call(uid, { operation: 'issue', requestId: `after_cup_req_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra }, now);
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const code = (c) => (e) => e.code === c;
const RESOLVER = { duelSchema: 'duel-receipt-1' };

test('a cup entry before the gathering is refused at issue before any charge; practice still issues', async () => {
  const uid = await setup([strongAce()]);
  const flags = (await user(uid)).storyFlags;
  await db.doc(`users/${uid}`).update({ storyFlags: { ...flags, arenaGatheringSeen: false } });
  const before = await user(uid);
  await assert.rejects(() => issue(uid, { tournamentId: 'starter' }), code('not_admitted'));
  assert.deepEqual(await user(uid), before);
  assert.equal((await issue(uid)).match.tournament, undefined);
});

async function playCup(holobots, fields) {
  const uid = await setup(holobots);
  await G.transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' });
  const i = await issue(uid, { tournamentId: 'starter' }, T0);
  let r = await B.transactTournamentBracket(db, uid, { schemaVersion: 'arena-bracket-1', operation: 'start', matchId: i.matchId }, T0);
  while (!r.bracket.done && r.bracket.playerAlive) r = await B.transactTournamentBracket(db, uid, { schemaVersion: 'arena-bracket-1', operation: 'advance', matchId: i.matchId, expectedRound: r.bracket.round, ...fields }, T0);
  return { uid, r, matchId: i.matchId };
}
/** The bracket seed is random: a level 2 bot can occasionally win out, so play fresh pilots until one is eliminated. */
async function eliminated(fields) {
  for (let tries = 0; tries < 25; tries++) {
    const cup = await playCup([weakAce(), bot('KUMA', 1)], fields);
    if (!cup.r.bracket.playerAlive) return cup;
  }
  throw new Error('no elimination in 25 tries');
}
async function assertArenaWorks(uid, holobotId) {
  for (const extra of [{}, RESOLVER]) {
    const i = await issue(uid, { holobotId, ...extra });
    assert.equal(i.match.state, 'issued', JSON.stringify(extra));
    await call(uid, { operation: 'cancel', matchId: i.matchId }, T0 + 1001);
  }
}

for (const [label, fields] of [['with progressionSchema + prizeSchema', OPT_IN], ['without them (production clients today)', {}]]) {
  test(`a cup closed by elimination ${label}: discovery reads it, the KO'd bot is holobot_ko, another bot can enter`, async () => {
    const { uid, matchId } = await eliminated(fields);
    const seen = await call(uid, { operation: 'resume' }, T0 + 500);
    assert.deepEqual([seen.matchId, seen.match.state, seen.match.settlementReceipt.outcome], [matchId, 'settled', 'loss']);
    for (const extra of [{}, RESOLVER]) await assert.rejects(issue(uid, extra), code('holobot_ko'), JSON.stringify(extra));
    await assertArenaWorks(uid, 'kuma');
  });

  test(`a cup won ${label}: the same bot can enter the Arena again on both paths`, async () => {
    const { uid, r } = await playCup([strongAce()], fields);
    assert.equal(r.bracket.playerAlive, true);
    await assertArenaWorks(uid, 'ace');
  });
}

test('a stale nextLevelExp no longer refuses the entry, after a cup or not, on both paths; the entrant shows the real threshold', async () => {
  const fresh = await setup([staleKurai()]);
  await assertArenaWorks(fresh, 'kurai');
  const uid = await setup([weakAce(), staleKurai()]);
  await G.transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' });
  const i = await issue(uid, { holobotId: 'kurai', ...RESOLVER });
  assert.equal(i.match.entrant.nextLevelExp, next(12));
  assert.equal(i.match.entrant.level, 12);
});

test('settling repairs the stale threshold and grants no free level (it would otherwise jump at 400 EXP)', async () => {
  const uid = await setup([staleKurai()]);
  const i = await issue(uid, { holobotId: 'kurai', opponentName: 'KUMA' }, T0);
  await call(uid, { operation: 'start', matchId: i.matchId }, T0 + 1);
  const s = await call(uid, { operation: 'settle', matchId: i.matchId, playerFinalHealth: 5, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, LATER);
  const [row] = s.progression, after = (await user(uid)).holobots[0];
  assert.ok(row.expGained > 0);
  assert.deepEqual([row.levelBefore, row.levelAfter, row.nextLevelExp], [12, 12, next(12)]);
  assert.deepEqual([after.level, after.nextLevelExp, after.experience], [12, next(12), row.expGained]);
  // A withheld payout (0 EXP) closes the same way: still no level, still repaired.
  await db.doc(`users/${uid}`).update({ holobots: [staleKurai()], holobotVitals: {} });
  await db.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).set({ schemaVersion: A.ARENA_CPU_PAYOUTS_SCHEMA, day: new Date(LATER).toISOString().slice(0, 10), paidSettles: A.ARENA_CPU_DAILY_PAYOUT_CAP });
  const j = await issue(uid, { holobotId: 'kurai', opponentName: 'KUMA' }, LATER + 10);
  await call(uid, { operation: 'start', matchId: j.matchId }, LATER + 11);
  await call(uid, { operation: 'settle', matchId: j.matchId, playerFinalHealth: 5, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, LATER + 11 + A.ARENA_MIN_SETTLE_MS_CPU + 10);
  assert.deepEqual([(await user(uid)).holobots[0].level, (await user(uid)).holobots[0].nextLevelExp], [12, next(12)]);
});

// host-crawl-fixes-1 (Pak: repair, not refuse): a derived field the host can recompute from level is healed at issue
// (persisted, audited in accountRepairs) and the entry goes ahead; level and EXP are never changed. Real corruption of
// the stored facts is still refused, now as the non-transient holobot_record_invalid + reason (was 'unavailable').
const repairEntries = async (uid) => { const q = db.collection(`accountRepairs/${uid}/entries`); return (q.get ? await q.get() : q.run()).size; };
test('a derived field from no level is healed at issue; real corruption is still refused, as holobot_record_invalid', async () => {
  for (const [label, extra, healed] of [
    ['non-numeric nextLevelExp', { nextLevelExp: 'x' }, { nextLevelExp: next(12) }],
    ['fractional nextLevelExp', { nextLevelExp: 400.5 }, { nextLevelExp: next(12) }],
    ['negative nextLevelExp', { nextLevelExp: -1 }, { nextLevelExp: next(12) }],
    ['a threshold no level has', { nextLevelExp: 1 }, { nextLevelExp: next(12) }],
    ['a threshold above the level', { nextLevelExp: next(20) }, { nextLevelExp: next(12) }],
    ['fractional attribute points', { attributePoints: 1.5 }, { attributePoints: 1 }],
  ]) {
    const uid = await setup([bot('KURAI', 12, extra)]);
    const i = await issue(uid, { holobotId: 'kurai' });
    assert.equal(i.match.state, 'issued', label);
    assert.deepEqual([i.match.entrant.level, i.match.entrant.nextLevelExp], [12, next(12)], label);
    assert.deepEqual((await user(uid)).holobots[0], bot('KURAI', 12, healed), label);
    assert.equal(await repairEntries(uid), 1, label);
  }
  for (const [label, extra, reason] of [
    ['EXP past the level', { experience: next(12) }, 'experience_over_level'],
    ['fractional EXP', { experience: 1.5 }, 'experience_malformed'],
    ['malformed boosts', { boostedAttributes: { attack: 'x' } }, 'boosted_attributes_malformed'],
    ['fractional level', { level: 12.5 }, 'level_malformed'],
  ]) {
    const uid = await setup([bot('KURAI', 12, extra)]);
    const before = await user(uid);
    await assert.rejects(issue(uid, { holobotId: 'kurai' }), (e) => e.code === A.ARENA_HOLOBOT_RECORD_INVALID && e.reason === reason, label);
    assert.deepEqual(await user(uid), before, label);
    assert.equal(await repairEntries(uid), 0, label);
  }
});
