// fight-host-1 (fight-flow H1): rival-battle mode `input-log` end to end on the Firestore emulator. Issue pins duel-rules-3 +
// seed + CPU profile/rank; settle re-runs the client's duel-inputs-2 log through the TS duel-sim-3 twin and settles the
// outcome THE HOST computed through the existing ladder/economy/health paths. Flag HOLOCITY_FIGHT_REPLAY (default off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { F, recordFightLog, smartPlayer, scriptedPlayer, verifyFightReplay, clone } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw Error('Demo loopback emulator required');
const { db } = require('../lib/admin.js');
const { transactRivalBattle: host } = require('../lib/rival/rivalBattleStore.js');
const { rivalBattleHost } = require('../lib/rival/rivalBattleHost.js');
const D = require('../lib/lib/duelResolver.js');

const now = Date.UTC(2026, 9, 19), seed = () => 0.4, later = now + 20000;
const base = { schemaVersion: 'rival-battle-3' };
const ON = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false };
let serial = 0;
const call = (uid, c, time = now, options = ON) => host(db, uid, { ...base, ...c }, time, seed, options);
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const record = async (uid, id) => (await db.doc(`rivalBattles/${uid}/battles/${id}`).get()).data();
const code = e => e.details?.rejectionCode ?? e.code;
async function setup({ level = 1, bench = false, ...extra } = {}) {
  const uid = `fight_${Date.now()}_${serial++}`;
  const holobots = [{ name: 'ACE', level, experience: 0, nextLevelExp: 400, attributePoints: 0 }, ...(bench ? [{ name: 'KUMA', level, experience: 0, nextLevelExp: 400, attributePoints: 0 }] : [])];
  await db.doc(`users/${uid}`).set({ holobots, holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: bench ? ['ace', 'kuma'] : ['ace'] }, ...extra });
  return uid;
}
const issueInputLog = (uid, extra = {}, options = ON) => call(uid, { operation: 'issue', duelInputs: 'duel-inputs-2', ...extra }, now, options);
const clientLog = (duel, profile = 'ace', rank = 'Legendary') => recordFightLog(duel, smartPlayer(duel, profile, rank)).wire;

test('flag off, or no capability, or an older wire version: the existing modes are issued unchanged', async () => {
  const a = await setup();
  assert.equal((await issueInputLog(a, {}, { ...ON, fightReplay: false })).duel.mode, 'resolver');
  const b = await setup();
  assert.equal((await call(b, { operation: 'issue' })).duel.mode, 'resolver', 'no duelInputs capability');
  const c = await setup();
  assert.equal((await call(c, { operation: 'issue', duelInputs: 'duel-inputs-2', schemaVersion: 'rival-battle-2' })).duel.mode, 'resolver');
  const d = await setup();
  assert.equal((await issueInputLog(d, {}, { fightReplay: false, issueLegacy: true })).duel.mode, 'legacy');
  const e = await setup();
  await assert.rejects(() => call(e, { operation: 'issue', duelInputs: 'duel-inputs-1' }), /invalid_request/);
});

test('input-log issue pins duel-rules-3 + seed + CPU profile/rank on the record and serves the same block', async () => {
  const uid = await setup();
  const issue = await issueInputLog(uid, { duel: { mode: 'legacy' }, seed: 1, rules: { counterPm: 9999 } });
  const b = await record(uid, issue.battleId);
  assert.equal(issue.duel.mode, 'input-log'); assert.deepEqual(issue.duel, b.duel);
  assert.equal(b.duel.rulesId, 'duel-rules-3:' + issue.battleId);
  assert.match(b.duel.seed, /^[0-9a-f]{64}$/);
  assert.equal(F.rulesHash(F.rulesFromJson(b.duel.rules)), b.duel.rulesHash);
  assert.equal(b.duel.rules.rules.counterPm, 1500, 'request fields never reach the snapshot');
  assert.deepEqual(b.duel.player.roster.map(r => r.holobotId), ['ace']);
  assert.equal(b.duel.cpu.roster[0].fighterId, 'cpu-' + b.duel.cpu.roster[0].holobotId);
  assert.equal(b.duel.rules.fighters[0].hp, Math.floor(b.issuedVitals.ace.currentHealth));
  assert.equal(b.healthSchema, 'rival-health-1');
  await assert.rejects(() => issueInputLog(uid), /too_many_open/);
});

test('R2 issue uses host readiness/streak and CPU tier SYNC; first verified settle trains once', async () => {
  const uid = await setup({level:99,syncReadiness:{ACE:{milli:80_000,atMs:now}},syncMomentum:{ACE:2},battleIq:{ACE:10}});
  const options={...ON,readinessStart:true,battleIq:true};
  const issue=await issueInputLog(uid, {readinessStart:[{holobotId:'ace',startSync:100}]}, options);
  assert.deepEqual(issue.duel.readinessStart,[{holobotId:'ace',readiness:80,cap:50,startSync:50}]);
  assert.equal(issue.duel.rules.fighters[0].startSync,50);
  assert.equal(issue.duel.rules.fighters[1].startSync,0,'tier zero CPU Rookie starts at zero');
  const log=clientLog(issue.duel), expected=verifyFightReplay(issue.duel,log,{battleId:issue.battleId}).receipt;
  const settle={operation:'settle',battleId:issue.battleId,inputLog:log,didWin:expected.winner!=='player'};
  await call(uid,settle,later,options);
  const first=await user(uid);
  assert.equal(first.battleIq.ACE,10+(expected.winner==='player'?4:0));
  assert.equal(first.syncMomentum.ACE,expected.winner==='player'?3:0);
  await call(uid,settle,later+1000,options);
  assert.deepEqual(await user(uid),first,'a replay cannot train or increment momentum twice');
});

test('settle: the host replays the log and settles ITS outcome; forged didWin/health/fielded/damage are ignored', async () => {
  const uid = await setup({ level: 99, bench: true });
  const issue = await issueInputLog(uid);
  const log = clientLog(issue.duel);
  const expected = verifyFightReplay(issue.duel, log, { battleId: issue.battleId }).receipt;
  const result = await call(uid, { operation: 'settle', battleId: issue.battleId, inputLog: log, didWin: expected.winner !== 'player',
    healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 1 }], fielded: ['kuma', 'foreign'], damage: 1e9, playerIntents: ['strike'] }, later);
  assert.deepEqual(result.fightReceipt, expected);
  assert.equal(result.didWin, expected.winner === 'player');
  assert.equal(result.duelReceipt, undefined, 'duel-receipt-1 keeps its own field');
  const stored = await record(uid, issue.battleId), profile = await user(uid);
  assert.deepEqual(stored.fightReceipt, expected);
  assert.deepEqual(stored.settlement.fielded, expected.playerFinal.filter(f => f.fielded).map(f => f.holobotId));
  for (const f of expected.playerFinal) assert.equal(profile.holobotVitals[f.holobotId].currentHealth, Math.min(stored.issuedVitals[f.holobotId].currentHealth, f.currentHealth));
  assert.equal(result.holosGranted, expected.winner === 'player' ? 100 : 25);
  if (expected.winner === 'player') assert.equal(profile.pilotRank, 1);
  if (!expected.playerFinal.find(f => f.holobotId === 'kuma').fielded) assert.equal(profile.holobots.find(x => x.name === 'KUMA').experience, 0, 'never-fielded bench earns no XP');
});

test('settle twice / five concurrent settles: one ruling, the stored receipt is returned, a different log is ignored', async () => {
  const uid = await setup({ level: 99 });
  const issue = await issueInputLog(uid);
  const log = clientLog(issue.duel);
  const all = await Promise.all(Array.from({ length: 5 }, () => call(uid, { operation: 'settle', battleId: issue.battleId, inputLog: log, didWin: false }, later)));
  assert.equal(all.filter(x => !x.alreadyProcessed).length, 1);
  const stored = await record(uid, issue.battleId), before = await user(uid);
  const other = clientLog(issue.duel, 'ace', 'Rookie');
  for (const inputLog of [log, other, undefined]) {
    const replay = await call(uid, { operation: 'settle', battleId: issue.battleId, inputLog, didWin: true }, later + 1000);
    assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.fightReceipt, stored.fightReceipt);
  }
  assert.deepEqual(await user(uid), before); assert.deepEqual(await record(uid, issue.battleId), stored);
});

test('mismatch: a tampered log is rejected at its first divergent window via the callable; nothing settles', async () => {
  const uid = await setup();
  const prior = process.env.HOLOCITY_FIGHT_REPLAY, priorResolver = process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
  process.env.HOLOCITY_FIGHT_REPLAY = '1'; process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = '1';
  try {
    const issue = await rivalBattleHost.run({ auth: { uid }, data: { ...base, operation: 'issue', duelInputs: 'duel-inputs-2' } });
    assert.equal(issue.duel.mode, 'input-log', 'the deployed callable reads HOLOCITY_FIGHT_REPLAY');
    const log = F.parseInputLog(clientLog(issue.duel));
    assert.ok(log.tickCount >= 60, 'a fight long enough to carry 2+ hash windows');
    for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
    const before = await user(uid);
    await assert.rejects(() => call(uid, { operation: 'settle', battleId: issue.battleId, inputLog: F.inputLogToWire(log), didWin: true }, later),
      e => e.code === 'replay_mismatch' && e.detail.reason === 'hash' && e.detail.window === 0 && e.detail.fromTick === 0 && e.detail.toTick === 29);
    // the deployed wrapper: failed-precondition + the window in details (Unity reads details.rejectionCode)
    await assert.rejects(() => rivalBattleHost.run({ auth: { uid }, data: { ...base, operation: 'settle', battleId: issue.battleId, inputLog: F.inputLogToWire(log), didWin: true } }),
      e => e.code === 'failed-precondition' && e.details.rejectionCode === 'replay_mismatch' && e.details.reason === 'hash' && e.details.toTick === e.details.window * 30 + 29);
    const b = await record(uid, issue.battleId);
    assert.equal(b.settlement, null); assert.equal(b.fightReceipt, undefined); assert.deepEqual(await user(uid), before);
    assert.equal(b.fightReplayRejections, 2); assert.equal(b.lastFightReplayRejection.reason, 'hash');
  } finally {
    if (prior === undefined) delete process.env.HOLOCITY_FIGHT_REPLAY; else process.env.HOLOCITY_FIGHT_REPLAY = prior;
    if (priorResolver === undefined) delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER; else process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = priorResolver;
  }
});

test('tampered seed / rules hash / CPU rank / undecodable log / missing log: refused, no writes', async () => {
  const uid = await setup({ level: 99 });
  const issue = await issueInputLog(uid);
  const log = clientLog(issue.duel);
  const before = await user(uid);
  const settle = inputLog => call(uid, { operation: 'settle', battleId: issue.battleId, inputLog, didWin: true }, later);
  for (const [field, f] of [['seed', l => { l.seed = '0'.repeat(64); }], ['rulesHash', l => { l.rulesHash = 'f'.repeat(64); }], ['sides[1].rank', l => { l.sides[1].rank = l.sides[1].rank === 'rookie' ? 'legendary' : 'rookie'; }]]) {
    const w = clone(log); f(w);
    await assert.rejects(() => settle(w), e => e.code === 'replay_mismatch' && e.detail.reason === 'identity' && e.detail.field === field);
  }
  const bad = clone(log); bad.sides[0].stream = '!!!!';
  await assert.rejects(() => settle(bad), e => e.code === 'invalid_request' && e.detail.reason === 'invalid_log' && e.detail.decoderCode === 'invalid_stream');
  await assert.rejects(() => call(uid, { operation: 'settle', battleId: issue.battleId, didWin: true, legacyDidWin: true, playerIntents: ['strike'] }, later),
    e => e.code === 'invalid_request' && e.detail.reason === 'input_log_required');
  assert.deepEqual(await user(uid), before); assert.equal((await record(uid, issue.battleId)).settlement, null);
  // the same log is accepted afterwards (a rejection never burns the battle)
  const ok = await settle(log); assert.equal(ok.fightReceipt.verified, true);
});

test('economy parity: an input-log win and a resolver win pay through the same ladder/economy rows', async () => {
  const a = await setup({ level: 99 }), b = await setup({ level: 99 });
  const ia = await issueInputLog(a);
  const log = clientLog(ia.duel);
  const verdict = verifyFightReplay(ia.duel, log, { battleId: ia.battleId }).receipt;
  assert.equal(verdict.winner, 'player', 'a level-99 Legendary-driven ACE beats the tier-0 rival');
  const ib = await call(b, { operation: 'issue' });
  const rb = await record(b, ib.battleId);
  assert.equal(D.resolveDuel({ ...rb.duel.input, playerIntents: ['strike'] }).winner, 'player');
  const ra = await call(a, { operation: 'settle', battleId: ia.battleId, inputLog: log, didWin: false }, later);
  const rbs = await call(b, { operation: 'settle', battleId: ib.battleId, playerIntents: ['strike'], didWin: false }, later);
  const pa = await user(a), pb = await user(b);
  for (const k of ['didWin', 'holosGranted', 'buddyUnitsGranted', 'tierBefore', 'tierAfter']) assert.deepEqual(ra[k], rbs[k], k);
  assert.deepEqual(ra.progression.map(x => [x.holobotId, x.experienceGained ?? x.xpGained ?? null]), rbs.progression.map(x => [x.holobotId, x.experienceGained ?? x.xpGained ?? null]));
  for (const k of ['holosTokens', 'rivalWins', 'buddyUnits', 'pilotRank', 'rivalRewardDay']) assert.deepEqual(pa[k], pb[k], k);
  assert.deepEqual(pa.holobots, pb.holobots, 'same XP ruling for the same fielded bot');
  assert.equal(pa.holobotVitals.ace.currentHealth, Math.min((await record(a, ia.battleId)).issuedVitals.ace.currentHealth, verdict.playerFinal[0].currentHealth), 'HP from the replay');
});

test('a passive player loses: the host-computed loss pays the loss row and costs the replay HP', async () => {
  const uid = await setup();
  const issue = await issueInputLog(uid);
  const log = recordFightLog(issue.duel, scriptedPlayer([{ t: 0, move: [-40, 0] }])).wire;
  const r = await call(uid, { operation: 'settle', battleId: issue.battleId, inputLog: log, didWin: true }, later);
  assert.equal(r.didWin, false); assert.equal(r.fightReceipt.winner, 'opponent'); assert.equal(r.holosGranted, 25);
  assert.equal((await user(uid)).pilotRank, undefined);
});
