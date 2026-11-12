// forfeit-is-loss (Pak 2026-11-11): quitting a live (input-log) fight after it started records a loss and starts the normal cooldown,
// in all three live battle types (city rivals, Arena, Guild Court), on the in-memory Firestore double. A forfeit pays nothing (no
// consolation Holos / EXP / Sync / IQ) and keeps the issue-time HP. A replay_mismatch closure is treated the same. Plan-and-send and
// legacy paths are unchanged. Pak 2026-11-11 (second ruling): a court issue over an open live run closes it as that loss and is refused
// with zone_cooldown; a started live fight that times out unplayed is recorded as the same loss on the next touch of that battle
// type (counted once); a rival forfeit / timeout resets the win streak of the LEAD Holobot only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const { transactRivalBattle, liveLeadHolobotId } = require('../lib/rival/rivalBattleStore.js');
const { RIVAL_BATTLE_TTL_MS, RIVAL_COOLDOWN_MS } = require('../lib/lib/rivalLadder.js');
const { momentumAfterForfeit } = require('../lib/lib/readinessFight.js');
const A = require('../lib/arena/arenaMatchStore.js');
const P = require('../lib/lib/progression.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const Z = require('../lib/lib/holoZoneRuns.js');

const now = Date.UTC(2026, 10, 11, 15), later = now + 25_000;
const SEED = '3e'.repeat(32);
const winLog = (duel, id = 'ace') => recordFightLog(duel, smartPlayer(duel, id, 'Legendary')).wire;
function tampered(duel) {
  const log = F.parseInputLog(winLog(duel));
  for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
  return F.inputLogToWire(log);
}
let serial = 0;

// ---------------------------------------------------------------- city rivals

const RIVAL_ON = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false };
const bot = (name, level = 30) => ({ name, level, experience: 0, nextLevelExp: 400, attributePoints: 0 });
function rivalWorld({ squad = ['ace'], ...extra } = {}) {
  const db = fakeDb({ now }), uid = `fil_rival_${serial++}`;
  db.put(`users/${uid}`, { holobots: squad.map(id => bot(id.toUpperCase())), holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: squad }, ...extra });
  const call = (c, time = now, options = RIVAL_ON) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...c }, time, () => 0.4, { ...options, fightSeed: () => SEED });
  return { db, uid, call, user: () => db.read(`users/${uid}`), record: id => db.read(`rivalBattles/${uid}/battles/${id}`), ledger: () => db.read(`rivalBattles/${uid}`),
    issue: (time = now, options = RIVAL_ON) => call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, time, options) };
}

test('momentumAfterForfeit: owned fighters lose their win streak (0), unknown ids are ignored, battleIq is never returned', () => {
  const profile = { holobots: [bot('ACE'), bot('KUMA')], syncMomentum: { ACE: 3, KUMA: 2, TORA: 1 }, battleIq: { ACE: 40 } };
  assert.deepEqual(momentumAfterForfeit(profile, ['ace', 'kuma', 'ghost', 'ace']), { syncMomentum: { ACE: 0, KUMA: 0, TORA: 1 } });
  assert.deepEqual(momentumAfterForfeit({ holobots: [bot('ACE')] }, ['ace']), { syncMomentum: { ACE: 0 } });
});

test('rival forfeit with HOLOCITY_BATTLE_IQ: only the lead fighter\'s win streak breaks, no IQ is taught, nothing is paid, cooldown starts', async () => {
  const w = rivalWorld({ squad: ['ace', 'kuma'], syncMomentum: { ACE: 3, KUMA: 2, TORA: 1 }, battleIq: { ACE: 40, KUMA: 10 } });
  const IQ = { ...RIVAL_ON, battleIq: true };
  const issue = await w.issue(now, IQ);
  assert.deepEqual(issue.duel.player.roster.map(s => s.holobotId), ['ace', 'kuma']);
  const before = w.user();
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 1_000, IQ);
  assert.deepEqual([r.didWin, r.holosGranted, r.closedBy, r.alreadyProcessed], [false, 0, 'forfeit', false]);
  const after = w.user();
  assert.deepEqual(after.syncMomentum, { ACE: 0, KUMA: 2, TORA: 1 }, 'the lead (ACE) loses its streak; the bench (KUMA) keeps it');
  assert.deepEqual(after.battleIq, before.battleIq, 'no loss-to-a-stronger-opponent IQ (a consolation)');
  for (const k of ['holosTokens', 'holobots', 'holobotVitals', 'rivalWins', 'pilotRank', 'buddyUnits', 'onboarding']) assert.deepEqual(after[k], before[k], k);
  const pilotId = w.record(issue.battleId).lineup.opponentPilot.pilotId;
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, { [pilotId]: now + 1_000 });
  // idempotent
  const snap = JSON.stringify([w.user(), w.ledger()]);
  assert.equal((await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 2_000, IQ)).alreadyProcessed, true);
  assert.equal(JSON.stringify([w.user(), w.ledger()]), snap);
  // without the IQ flag the forfeit writes no momentum (as the ordinary settle writes no fight learning)
  const w2 = rivalWorld({ syncMomentum: { ACE: 3 } }), i2 = await w2.issue();
  await w2.call({ operation: 'forfeit', battleId: i2.battleId }, now + 1_000);
  assert.deepEqual(w2.user().syncMomentum, { ACE: 3 });
});

test('rival replay_mismatch with HOLOCITY_BATTLE_IQ: the same loss treatment as the forfeit (streak broken, cooldown, no pay)', async () => {
  const w = rivalWorld({ syncMomentum: { ACE: 3 } }), IQ = { ...RIVAL_ON, battleIq: true };
  const issue = await w.issue(now, IQ), before = w.user();
  await assert.rejects(() => w.call({ operation: 'settle', battleId: issue.battleId, inputLog: tampered(issue.duel) }, later, IQ), /replay_mismatch/);
  const after = w.user();
  assert.deepEqual(after.syncMomentum, { ACE: 0 });
  for (const k of ['holosTokens', 'holobots', 'holobotVitals', 'battleIq']) assert.deepEqual(after[k], before[k], k);
  assert.equal(Object.values(w.ledger().rivalLastSettledAtMs)[0], later);
});

test('rival forfeit of an onboarding mentor battle: still a no-pay loss, but no cooldown (as its ordinary loss); the onboarding beat is not advanced', async () => {
  const w = rivalWorld({ onboarding: { step: 2, skipped: false, stepAt: now - 1 } });
  const issue = await w.issue();
  assert.equal(w.record(issue.battleId).onboardingMentor, true);
  const before = w.user();
  await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 1_000);
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, {}, 'a mentor loss never starts the cooldown');
  assert.deepEqual(w.user().onboarding, before.onboarding, 'today\'s rule kept: only a real settle completes the mentor-duel beat');
  assert.equal((await w.issue(now + 2_000)).duel.mode, 'input-log');
});

test('rival lead: the first issued player fighter with HP above 0 (the sim\'s first fielded slot)', () => {
  const issue = { player: { roster: [{ fighterId: 'ace', holobotId: 'ace' }, { fighterId: 'kuma', holobotId: 'kuma' }] },
    rules: { fighters: [{ id: 'ace', side: 0, hp: 0 }, { id: 'kuma', side: 0, hp: 120 }, { id: 'cpu-wolf', side: 1, hp: 90 }] } };
  assert.equal(liveLeadHolobotId(issue), 'kuma');
  issue.rules.fighters[0].hp = 50;
  assert.equal(liveLeadHolobotId(issue), 'ace');
});

test('rival normal live loss (unchanged, reported): every fighter that entered the fight loses its streak, not only the lead', async () => {
  const w = rivalWorld({ squad: ['ace', 'kuma'], syncMomentum: { ACE: 3, KUMA: 2 } }), IQ = { ...RIVAL_ON, battleIq: true };
  // level-1 fighters vs the rival: an idle log loses; a KO of the lead forces KUMA in
  w.db.put(`users/${w.uid}`, { ...w.user(), holobots: [bot('ACE', 1), bot('KUMA', 1)] });
  const issue = await w.issue(now, IQ);
  const idle = recordFightLog(issue.duel, { read: () => F.toInput(F.idleRecord()) }).wire;
  const r = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: idle }, later, IQ);
  assert.equal(r.didWin, false);
  const fielded = r.fightReceipt.playerFinal.filter(f => f.fielded).map(f => f.holobotId.toUpperCase());
  const expected = { ACE: 3, KUMA: 2 };
  for (const id of fielded) expected[id] = 0;
  assert.deepEqual(w.user().syncMomentum, expected);
  console.log(`# normal loss fielded ${JSON.stringify(fielded)} -> momentum ${JSON.stringify(w.user().syncMomentum)}`);
});

test('rival timeout is a loss: an unplayed live battle past its TTL is closed (closedBy expired) on the next issue, counted once', async () => {
  const w = rivalWorld({ squad: ['ace', 'kuma'], syncMomentum: { ACE: 3, KUMA: 2 }, battleIq: { ACE: 40 } }), IQ = { ...RIVAL_ON, battleIq: true };
  const issue = await w.issue(now, IQ), before = w.user();
  const expiresAtMs = w.record(issue.battleId).expiresAtMs, pilotId = w.record(issue.battleId).lineup.opponentPilot.pilotId;
  const t = expiresAtMs + 1;
  // the cooldown runs from the expiry (the loss time): the same pilot right after the expiry is refused for the rest of it
  await assert.rejects(w.issue(t, IQ), e => e.code === 'rival_cooldown' && e.retryAfterMs === RIVAL_COOLDOWN_MS - 1);
  const s = w.record(issue.battleId).settlement;
  assert.deepEqual([s.didWin, s.closedBy, s.settledAtMs, s.holosGranted, s.buddyUnitsGranted, s.fielded], [false, 'expired', expiresAtMs, 0, 0, []]);
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, { [pilotId]: expiresAtMs });
  assert.deepEqual(Object.keys(w.ledger().openBattles), []);
  const after = w.user();
  assert.deepEqual(after.syncMomentum, { ACE: 0, KUMA: 2 }, 'the lead only');
  for (const k of ['holosTokens', 'holobots', 'holobotVitals', 'rivalWins', 'battleIq', 'pilotRank', 'buddyUnits', 'onboarding']) assert.deepEqual(after[k], before[k], k);
  // counted once: later touches write nothing more; a late settle / forfeit answers battle_expired as before, now with closedBy
  const snap = JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]);
  await w.call({ operation: 'status' }, t + 10, IQ);
  await assert.rejects(w.call({ operation: 'forfeit', battleId: issue.battleId }, t + 20, IQ), e => e.code === 'battle_expired' && e.detail?.closedBy === 'expired');
  await assert.rejects(w.call({ operation: 'settle', battleId: issue.battleId, inputLog: winLog(issue.duel) }, t + 30, IQ), e => e.code === 'battle_expired' && e.detail?.closedBy === 'expired');
  assert.equal(JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]), snap);
  assert.equal((await w.issue(expiresAtMs + RIVAL_COOLDOWN_MS + 1, IQ)).duel.mode, 'input-log');
});

test('rival timeout: a status call or a late settle records it too; legacy and plan-and-send expiries stay silent', async () => {
  const a = rivalWorld(), ia = await a.issue(), ta = a.record(ia.battleId).expiresAtMs + 1;
  await a.call({ operation: 'status' }, ta);
  assert.equal(a.record(ia.battleId).settlement.closedBy, 'expired');
  const b = rivalWorld(), ib = await b.issue(), tb = b.record(ib.battleId).expiresAtMs + 1;
  await assert.rejects(b.call({ operation: 'settle', battleId: ib.battleId, inputLog: winLog(ib.duel) }, tb), e => e.code === 'battle_expired');
  assert.equal(b.record(ib.battleId).settlement.closedBy, 'expired');
  for (const [options, body] of [[{ fightReplay: false, issueLegacy: true, allowLegacySettlement: true }, {}], [{ fightReplay: true, issueLegacy: false, allowLegacySettlement: false }, { duelSchema: 'duel-receipt-1' }]]) {
    const w = rivalWorld(), i = await w.call({ operation: 'issue', ...body }, now, options);
    assert.notEqual(i.duel.mode, 'input-log');
    const before = JSON.stringify([w.user(), w.record(i.battleId)]);
    const t = now + RIVAL_BATTLE_TTL_MS + 1;
    await w.call({ operation: 'issue', ...body }, t, options);
    assert.equal(w.record(i.battleId).settlement, null, 'no loss record');
    assert.deepEqual(w.ledger().rivalLastSettledAtMs, {}, 'no cooldown');
    assert.equal(JSON.stringify([w.user().holobotVitals, w.record(i.battleId)]), JSON.stringify([JSON.parse(before)[0].holobotVitals, JSON.parse(before)[1]]));
  }
});

test('rival timeout of a mentor battle: a loss with no cooldown (as its ordinary loss)', async () => {
  const w = rivalWorld({ onboarding: { step: 2, skipped: false, stepAt: now - 1 } });
  const issue = await w.issue(), t = w.record(issue.battleId).expiresAtMs + 1;
  await w.call({ operation: 'status' }, t);
  assert.equal(w.record(issue.battleId).settlement.closedBy, 'expired');
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, {});
});

// ---------------------------------------------------------------- Arena

const T0 = Date.UTC(2026, 10, 11, 9), START = T0 + 1;
const ARENA_ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const LIVE = { duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const adb = fakeDb({ now: T0 });
const strong = (level = 21) => ({ name: 'ACE', level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
async function arenaUser() {
  const uid = `fil_arena_${serial++}`;
  await adb.doc(`users/${uid}`).set({ holobots: [strong()], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
  return uid;
}
const acall = (uid, body, at = T0, options = ARENA_ON) => A.transactArenaMatch(adb, uid, { schemaVersion: 'arena-match-1', ...body }, at, options);
async function astarted(uid, extra = LIVE) {
  const i = await acall(uid, { operation: 'issue', requestId: `req_fil_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra });
  await acall(uid, { operation: 'start', matchId: i.matchId }, START);
  return i;
}
const auser = async uid => (await adb.doc(`users/${uid}`).get()).data();
const apayouts = async uid => (await adb.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).get()).data();

test('Arena live forfeit at the daily cap: the loss is still recorded; the cap counter stays at the cap (a capped loss does not count either)', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  await adb.doc(`arenaMatches/${uid}/ledger/cpuPayouts`).set({ schemaVersion: A.ARENA_CPU_PAYOUTS_SCHEMA, day: new Date(START).toISOString().slice(0, 10), paidSettles: A.ARENA_CPU_DAILY_PAYOUT_CAP });
  const f = await acall(uid, { operation: 'cancel', matchId: i.matchId }, START + 10);
  assert.equal(f.match.settlementReceipt.countedAsLoss, true);
  assert.equal((await auser(uid)).losses, 1);
  assert.equal((await apayouts(uid)).paidSettles, A.ARENA_CPU_DAILY_PAYOUT_CAP);
});

test('Arena timeout is a loss: the wait-then-cancel case closes as expired AND counts the loss (fee kept, HP as issued, one cap count)', async () => {
  const uid = await arenaUser(), i = await astarted(uid), hp = i.match.entrant.currentHealth;
  const f = await acall(uid, { operation: 'cancel', matchId: i.matchId }, T0 + A.ARENA_MATCH_TTL_MS + 1);
  assert.deepEqual([f.alreadyProcessed, f.match.state, f.match.settlementReceipt.outcome, f.match.settlementReceipt.countedAsLoss], [false, 'expired', 'forfeit', true]);
  const u = await auser(uid);
  assert.deepEqual([u.losses, u.holosTokens, u.holobotVitals.ace.currentHealth], [1, 950, hp]);
  assert.equal((await apayouts(uid)).paidSettles, 1);
  const snap = JSON.stringify([await auser(uid), await apayouts(uid)]);
  assert.equal((await acall(uid, { operation: 'cancel', matchId: i.matchId }, T0 + A.ARENA_MATCH_TTL_MS + 5)).alreadyProcessed, true);
  assert.equal(JSON.stringify([await auser(uid), await apayouts(uid)]), snap, 'counted once');
});

test('Arena timeout is a loss on the next issue / resume: the stale started live match closes, then the issue goes ahead', async () => {
  const uid = await arenaUser(), i = await astarted(uid), t = T0 + A.ARENA_MATCH_TTL_MS + 1;
  const n = await acall(uid, { operation: 'issue', requestId: `req_fil_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE }, t);
  assert.equal(n.match.state, 'issued');
  const old = (await adb.doc(`arenaMatches/${uid}/matches/${i.matchId}`).get()).data();
  assert.deepEqual([old.state, old.closedAtMs, old.settlementReceipt.countedAsLoss], ['expired', t, true]);
  assert.equal((await auser(uid)).losses, 1);
  // resume
  const uid2 = await arenaUser(), j = await astarted(uid2);
  const r = await acall(uid2, { operation: 'resume' }, t);
  assert.deepEqual([r.matchId, r.match.state, r.match.settlementReceipt.countedAsLoss], [j.matchId, 'expired', true]);
  assert.equal((await auser(uid2)).losses, 1);
  assert.equal((await acall(uid2, { operation: 'resume' }, t + 10)).match.state, 'expired');
  assert.equal((await auser(uid2)).losses, 1, 'counted once');
});

test('Arena never started: an issued-but-unstarted live match past the TTL is not a loss; its cancel still refunds', async () => {
  const uid = await arenaUser(), t = T0 + A.ARENA_MATCH_TTL_MS + 1;
  const i = await acall(uid, { operation: 'issue', requestId: `req_fil_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE });
  await assert.rejects(acall(uid, { operation: 'issue', requestId: `req_fil_${serial++}`, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...LIVE }, t), e => e.code === 'activity_conflict');
  assert.equal((await acall(uid, { operation: 'resume' }, t)).match.state, 'issued');
  const c = await acall(uid, { operation: 'cancel', matchId: i.matchId }, t);
  assert.deepEqual([c.match.state, c.match.settlementReceipt.outcome, c.match.settlementReceipt.refunded], ['expired', 'cancelled_before_start', true]);
  const u = await auser(uid);
  assert.deepEqual([u.losses, u.holosTokens], [0, 1000]);
});

test('Arena plan-and-send and legacy cancels after start are unchanged: no loss, no cap count, no countedAsLoss', async () => {
  for (const extra of [{ duelSchema: 'duel-receipt-1' }, {}]) {
    const uid = await arenaUser(), i = await astarted(uid, extra);
    assert.notEqual(i.duel?.mode, 'input-log');
    // a legacy cancel carries the client's HP report; a plan-and-send cancel refuses one
    const f = await acall(uid, { operation: 'cancel', matchId: i.matchId, ...(extra.duelSchema ? {} : { playerFinalHealth: i.match.entrant.currentHealth }) }, START + 10);
    assert.deepEqual([f.match.state, f.match.settlementReceipt.outcome, f.match.settlementReceipt.settlement], ['cancelled', 'forfeit', null]);
    assert.deepEqual(Object.keys(f.match.settlementReceipt).sort(), ['closedAtMs', 'finalVitals', 'matchId', 'outcome', 'refunded', 'report', 'settlement']);
    assert.equal((await auser(uid)).losses, 0);
    assert.equal(await apayouts(uid), undefined);
  }
});

test('Arena readArenaMatchRecord: countedAsLoss only on a live, issue-HP forfeit (cancelled or expired)', async () => {
  const uid = await arenaUser(), i = await astarted(uid);
  await acall(uid, { operation: 'cancel', matchId: i.matchId }, START + 10);
  const rec = (await adb.doc(`arenaMatches/${uid}/matches/${i.matchId}`).get()).data();
  assert.equal(A.readArenaMatchRecord(rec, i.matchId).state, 'cancelled');
  const bad = (patch) => assert.throws(() => A.readArenaMatchRecord({ ...rec, ...patch(rec) }, i.matchId), e => e.code === 'unavailable');
  bad(r => ({ settlementReceipt: { ...r.settlementReceipt, countedAsLoss: false } }));
  assert.equal(A.readArenaMatchRecord({ ...rec, state: 'expired', closedAtMs: rec.expiresAtMs + 1, settlementReceipt: { ...rec.settlementReceipt, closedAtMs: rec.expiresAtMs + 1 } }, i.matchId).state, 'expired');
  bad(r => ({ settlementReceipt: { ...r.settlementReceipt, report: { playerFinalHealth: r.entrant.currentHealth - 1 }, finalVitals: { ace: { ...r.settlementReceipt.finalVitals.ace, currentHealth: r.entrant.currentHealth - 1 } } } }));
  const resolverUid = await arenaUser(), j = await astarted(resolverUid, { duelSchema: 'duel-receipt-1' });
  await acall(resolverUid, { operation: 'cancel', matchId: j.matchId }, START + 10);
  const rrec = (await adb.doc(`arenaMatches/${resolverUid}/matches/${j.matchId}`).get()).data();
  assert.throws(() => A.readArenaMatchRecord({ ...rrec, settlementReceipt: { ...rrec.settlementReceipt, countedAsLoss: true } }, j.matchId), e => e.code === 'unavailable');
});

// ---------------------------------------------------------------- Guild Court

const COURT_ON = { courtFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
function courtWorld() {
  const db = fakeDb({ now }), uid = `fil_court_${serial++}`;
  db.put(`users/${uid}`, { holosTokens: 0, holobots: [strong()], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  let n = 0;
  const newRun = () => `${String(++n).padStart(8, '0')}-2222-4222-8222-${String(serial).padStart(12, '0')}`;
  const call = (body, at = now, options = COURT_ON) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...body }, at, newRun, options);
  const issue = (at = now) => call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, at);
  return { db, uid, call, issue, user: () => db.read(`users/${uid}`), doc: () => db.read(`holoZoneRuns/${uid}`) };
}

test('court forfeit pays no consolation (no 25 Holos, no loss EXP) and keeps the issue-time HP; the cooldown starts', async () => {
  const w = courtWorld(), i = await w.issue(), before = w.user();
  assert.equal(i.duel.mode, 'input-log');
  await w.call({ operation: 'forfeit', runId: i.runId }, later);
  const after = w.user();
  assert.deepEqual([after.holosTokens, after.holobots, after.holobotVitals, after.itemStocks], [before.holosTokens, before.holobots, before.holobotVitals, before.itemStocks]);
  assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: later });
  await assert.rejects(w.issue(later + 1), e => e.code === 'zone_cooldown');
});

test('court supersede is a loss: a new court issue over an open live run closes it (superseded) and is refused with zone_cooldown', async () => {
  const w = courtWorld(), i = await w.issue(), before = w.user();
  await assert.rejects(w.issue(now + 5_000), e => e.code === 'zone_cooldown' && e.retryAfterMs === Z.HOLOZONE_COOLDOWN_MS);
  const old = w.doc().runs.find(r => r.runId === i.runId);
  assert.deepEqual([old.settlement, old.closedAtMs, old.closedBy], [null, now + 5_000, 'superseded']);
  assert.equal(w.doc().runs.length, 1, 'no new run was issued');
  assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: now + 5_000 });
  const after = w.user();
  assert.deepEqual([after.holosTokens, after.holobots, after.holobotVitals], [before.holosTokens, before.holobots, before.holobotVitals]);
  // counted once: the closed run answers like any closure; the next issue after the cooldown works
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, inputLog: winLog(i.duel) }, now + 30_000), e => e.code === 'run_closed' && e.detail?.closedBy === 'superseded');
  assert.deepEqual(await w.call({ operation: 'forfeit', runId: i.runId }, now + 31_000), { schemaVersion: 'holozone-run-2', runId: i.runId, alreadyProcessed: true, closedBy: 'superseded' });
  assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: now + 5_000 });
  assert.equal((await w.issue(now + 5_000 + Z.HOLOZONE_COOLDOWN_MS + 1)).duel.mode, 'input-log');
  // a plain or plan-and-send court request over the open live run gets the same treatment
  const w2 = courtWorld(), i2 = await w2.issue();
  await assert.rejects(w2.call({ operation: 'issue', zoneId: 'guild_court' }, now + 1_000), e => e.code === 'zone_cooldown');
  assert.equal(w2.doc().runs.find(r => r.runId === i2.runId).closedBy, 'superseded');
});

test('court supersede by another zone: the open live court run closes as the loss (court cooldown) and the other zone issues', async () => {
  const w = courtWorld(), i = await w.issue();
  w.db.put(`users/${w.uid}`, { ...w.user(), storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: true } });
  const j = await w.call({ operation: 'issue', zoneId: 'neonforest' }, now + 5_000);
  assert.equal(j.zoneId, 'neonforest');
  assert.equal(w.doc().runs.find(r => r.runId === i.runId).closedBy, 'superseded');
  assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: now + 5_000 });
  await assert.rejects(w.issue(now + 6_000), e => e.code === 'zone_cooldown');
});

test('court supersede (unchanged): plain and plan-and-send runs are still superseded silently by a new issue', async () => {
  for (const extra of [{}, { duelSchema: 'duel-receipt-1', holobotId: 'ace' }]) {
    const w = courtWorld(), i = await w.call({ operation: 'issue', zoneId: 'guild_court', ...extra });
    const j = await w.call({ operation: 'issue', zoneId: 'guild_court', ...extra }, now + 5_000);
    const old = w.doc().runs.find(r => r.runId === i.runId);
    assert.deepEqual([old.closedAtMs, old.closedBy, w.doc().zoneLastSettledAtMs], [now + 5_000, undefined, {}]);
    assert.ok(j.runId);
  }
});

test('court timeout is a loss: an unplayed live run past its TTL is closed (expired) on the next touch, counted once', async () => {
  const w = courtWorld(), i = await w.issue(), before = w.user();
  const expiresAtMs = w.doc().runs[0].expiresAtMs, t = expiresAtMs + 1;
  assert.equal((await w.call({ operation: 'status' }, t)).run, null);
  const run = w.doc().runs.find(r => r.runId === i.runId);
  assert.deepEqual([run.settlement, run.closedAtMs, run.closedBy], [null, expiresAtMs, 'expired']);
  assert.deepEqual(w.doc().zoneLastSettledAtMs, { guild_court: expiresAtMs }, 'the cooldown runs from the expiry');
  const after = w.user();
  assert.deepEqual([after.holosTokens, after.holobots, after.holobotVitals], [before.holosTokens, before.holobots, before.holobotVitals]);
  const snap = JSON.stringify([w.user(), w.doc()]);
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, inputLog: winLog(i.duel) }, t + 10), e => e.code === 'run_expired' && e.detail?.closedBy === 'expired');
  await assert.rejects(w.call({ operation: 'forfeit', runId: i.runId }, t + 20), e => e.code === 'run_expired' && e.detail?.closedBy === 'expired');
  await assert.rejects(w.issue(t + 30), e => e.code === 'zone_cooldown' && e.retryAfterMs === Z.HOLOZONE_COOLDOWN_MS - 31);
  assert.equal(JSON.stringify([w.user(), w.doc()]), snap, 'counted once');
  assert.equal((await w.issue(expiresAtMs + Z.HOLOZONE_COOLDOWN_MS + 1)).duel.mode, 'input-log');
  // a late settle or a forfeit is a touch too
  for (const op of ['settle', 'forfeit']) {
    const v = courtWorld(), k = await v.issue(), tk = v.doc().runs[0].expiresAtMs + 1;
    await assert.rejects(v.call(op === 'settle' ? { operation: 'settle', runId: k.runId, inputLog: winLog(k.duel) } : { operation: 'forfeit', runId: k.runId }, tk), e => e.code === 'run_expired');
    assert.equal(v.doc().runs[0].closedBy, 'expired', op);
  }
});

test('court timeout (unchanged): plain and plan-and-send runs left past the TTL record nothing', async () => {
  for (const extra of [{}, { duelSchema: 'duel-receipt-1', holobotId: 'ace' }]) {
    const w = courtWorld(), i = await w.call({ operation: 'issue', zoneId: 'guild_court', ...extra });
    const before = JSON.stringify(w.doc()), t = now + Z.HOLOZONE_RUN_TTL_MS + 1;
    assert.equal((await w.call({ operation: 'status' }, t)).run, null);
    assert.equal(JSON.stringify(w.doc()), before);
    await assert.rejects(w.call({ operation: 'forfeit', runId: i.runId }, t), e => e.code === 'invalid_request');
  }
});
