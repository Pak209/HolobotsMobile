// court-live-1 (Pak 2026-11-11: every battle is a live duel): the Guild Court's single fight as an input-log duel, issued with
// buildFightReplayIssue and settled by verifyFightReplay (the rival / Arena checker), on the in-memory Firestore double. The court's
// economy (EXP, Holos, fragment, cooldown, HP ledger, receipts doc) must match the plan-and-send court; only the outcome source
// changes. Live-only clients that cannot get a live fight are refused with live_unavailable before anything is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const L = require('../lib/lib/holoZoneCourtLive.js');
const B = require('../lib/lib/holoZoneBeastStats.js');
const P = require('../lib/lib/progression.js');
const { ledgerHealthAfterFight } = require('../lib/lib/partStats.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');

const T0 = Date.UTC(2026, 10, 11, 12), V = 'holozone-run-2', LATER = T0 + L_MIN() + 5_000;
function L_MIN() { return Z.COURT_LIVE_MIN_WIN_MS; }
const SEED = process.env.COURT_LIVE_SEED || '3e'.repeat(32);
const ON = { courtFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const OFF = { ...ON, courtFightReplay: false };
const LIVE_ONLY = { duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const dump = db => JSON.stringify([...db.docs.entries()].map(([k, v]) => [k, v.data]).sort(([a], [b]) => a < b ? -1 : 1));
const isCode = (code, detail = {}) => e => { assert.equal(e.code, code); for (const [k, v] of Object.entries(detail)) assert.equal(e.detail?.[k], v, k); return true; };
const threshold = l => P.calculateExperience(l + 1);
const strong = (name = 'ACE', level = 21) => ({ name, level, experience: 0, nextLevelExp: threshold(level), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
const weak = (name = 'ACE') => ({ name, level: 1, experience: 0, nextLevelExp: threshold(1), attributePoints: 0, boostedAttributes: {} });

let serial = 0, runSerial = 0;
function world(bots = [strong(), weak('KUMA')]) {
  const db = fakeDb({ now: T0 }), uid = `court_live_${serial++}`;
  db.put(`users/${uid}`, { holosTokens: 0, holobots: bots, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: bots.map(b => b.name.toLowerCase()) } });
  const newRun = () => `${String(++runSerial).padStart(8, '0')}-1111-4111-8111-111111111111`;
  const call = (body, now = T0, options = ON) => transactHoloZoneRun(db, uid, { schemaVersion: V, ...body }, now, newRun, options);
  const issue = (extra = LIVE_ONLY, now = T0, options = ON) => call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', ...extra }, now, options);
  const settle = (runId, inputLog, now = LATER, options = ON) => call({ operation: 'settle', runId, inputLog }, now, options);
  const user = () => db.read(`users/${uid}`), runs = () => db.read(`holoZoneRuns/${uid}`)?.runs ?? [];
  const receipt = runId => db.read(`holoZoneRuns/${uid}/receipts/${runId}`);
  return { db, uid, call, issue, settle, user, runs, receipt };
}
const winLog = duel => recordFightLog(duel, smartPlayer(duel, 'ace', 'Legendary')).wire;
const idleLog = duel => recordFightLog(duel, { read: () => F.toInput(F.idleRecord()) }).wire;
function tampered(duel) {
  const log = F.parseInputLog(winLog(duel));
  for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
  return F.inputLogToWire(log);
}

test('flag: off by default; ON only with both HOLOCITY_COURT_FIGHT_REPLAY=1 and HOLOCITY_FIGHT_REPLAY=1', () => {
  assert.equal(L.COURT_FIGHT_REPLAY_FLAG, 'HOLOCITY_COURT_FIGHT_REPLAY');
  assert.equal(L.courtFightReplayEnabled({}), false);
  assert.equal(L.courtFightReplayEnabled({ HOLOCITY_COURT_FIGHT_REPLAY: '1' }), false);
  assert.equal(L.courtFightReplayEnabled({ HOLOCITY_FIGHT_REPLAY: '1' }), false);
  assert.equal(L.courtFightReplayEnabled({ HOLOCITY_COURT_FIGHT_REPLAY: 'true', HOLOCITY_FIGHT_REPLAY: '1' }), false);
  assert.equal(L.courtFightReplayEnabled({ HOLOCITY_COURT_FIGHT_REPLAY: '1', HOLOCITY_FIGHT_REPLAY: '1' }), true);
});

test('live issue: the run pins an input-log fight bound to the run id; the rival-shaped duel block is served on issue and status', async () => {
  const w = world(), i = await w.issue();
  const d = i.duel;
  assert.equal(d.mode, 'input-log'); assert.equal(d.schemaVersion, 'duel-receipt-2'); assert.equal(d.inputsSchema, 'duel-inputs-2'); assert.equal(d.simVersion, 'duel-sim-3');
  assert.equal(d.rulesId, `duel-rules-6:${i.runId}`); assert.equal(d.seed, SEED); assert.equal(d.playerSide, 0);
  assert.deepEqual(d.player.roster, [{ fighterId: 'ace', holobotId: 'ace' }]);
  // beast-fighter-1: the court beast is issued as itself (body/name 'cacheback'), with its archetype's kit and CPU profile
  assert.equal(L.COURT_LIVE_BODY, 'cacheback');
  assert.deepEqual(d.cpu.roster, [{ fighterId: 'cpu-cacheback', holobotId: 'cacheback', profile: 'beast_bruiser' }]);
  assert.equal(d.cpu.profile.id, 'beast_bruiser');
  // the beast fights with the court's own scaled Cacheback numbers (the plan-and-send court's numbers)
  const beast = B.scaledBeastStats('guild_court', 0, 'cacheback', 21), cpu = d.rules.fighters.find(f => f.side === 1);
  assert.equal(cpu.maxHp, beast.maxHealth); assert.equal(cpu.hp, beast.maxHealth); assert.equal(cpu.attack, Math.round(beast.attack)); assert.equal(cpu.defense, Math.round(beast.defense));
  assert.ok(i.playerCombatants.length === 2, 'the run carries the host HP rows (rival-health-1), as the plan-and-send court');
  assert.equal(i.zoneId, 'guild_court'); assert.equal(i.population, null);
  const stored = w.runs()[0];
  assert.deepEqual(stored.duel, d, 'the reply block is the stored block');
  assert.equal(stored.healthSchema, 'rival-health-1');
  assert.deepEqual((await w.call({ operation: 'status' })).duel, d);
  // the shared flags pick the rules version exactly as on the rival / Arena hosts
  assert.match((await world().issue({ duelInputs: 'duel-inputs-2' })).duel.rulesId, /^duel-rules-5:/, 'no fightRules ask: duel-rules-5');
  assert.match((await world().issue(LIVE_ONLY, T0, { ...ON, fightChase: false, fightAttrs: false })).duel.rulesId, /^duel-rules-3:/);
  // a live ask with duelSchema as fallback also gets the live fight when the flag is on
  assert.equal((await world().issue({ ...LIVE_ONLY, duelSchema: 'duel-receipt-1' })).duel.mode, 'input-log');
});

test('live settle (win): outcome, HP and pay come from the verified replay; fightReceipt at the top level; resend replays', async () => {
  const w = world(), i = await w.issue(), issuedVitals = w.runs()[0].issuedVitals;
  const log = winLog(i.duel), expected = verifyFightReplay(i.duel, log, { battleId: i.runId });
  assert.equal(expected.receipt.winner, 'player', 'pinned seed gives the scripted player a win');
  const s = await w.settle(i.runId, log);
  assert.deepEqual(s.fightReceipt, expected.receipt);
  assert.equal(s.alreadyProcessed, false);
  assert.deepEqual([s.settlement.didWin, s.settlement.kills, s.settlement.bossDefeated, s.settlement.expWithheld], [true, 1, false, false]);
  assert.deepEqual(s.settlement.fielded, ['ace']);
  // early-progression-1: the account's first live win of the UTC day pays x2 Holos (and x2 EXP after the capped receipt bonus).
  assert.equal(s.holosGranted, 200); assert.equal(s.blueprintFragmentsGranted, 1);
  assert.equal(s.firstWinOfDay.day, new Date(LATER).toISOString().slice(0, 10));
  assert.equal(s.progression.length, 1); assert.equal(s.progression[0].holobotId, 'ace');
  const u = w.user(), pf = expected.receipt.playerFinal[0];
  assert.equal(u.holosTokens, 200); assert.equal(u.itemStocks.blueprint_fragment, 1);
  assert.equal(u.holobotVitals.ace.currentHealth, ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, issuedVitals.ace), 'HP is the replay\'s, on the ledger scale');
  const rec = w.receipt(i.runId);
  assert.deepEqual(rec.fightReceipt, expected.receipt); assert.deepEqual(rec.fightPlausibility, expected.plausibility);
  assert.equal('fightPlausibility' in s, false, 'the plausibility read stays host-side');
  assert.equal(w.db.read(`holoZoneRuns/${w.uid}`).zoneLastSettledAtMs.guild_court, LATER, 'the court cooldown starts as for any court settle');
  const before = dump(w.db);
  const again = await w.settle(i.runId, log, LATER + 1);
  assert.equal(again.alreadyProcessed, true); assert.deepEqual(again.fightReceipt, expected.receipt); assert.equal(again.holosGranted, 200);
  assert.deepEqual(again.firstWinOfDay, s.firstWinOfDay, 'the replay says the first win was spent here');
  assert.equal(dump(w.db), before, 'a resend writes nothing');
  await assert.rejects(w.issue(), isCode('zone_cooldown'));
});

test('live settle (loss): loss pay (25 Holos, loss EXP, no fragment); a loss is never too fast', async () => {
  const w = world([weak(), weak('KUMA')]), i = await w.issue();
  const log = idleLog(i.duel), expected = verifyFightReplay(i.duel, log, { battleId: i.runId });
  assert.notEqual(expected.receipt.winner, 'player');
  const s = await w.settle(i.runId, log, LATER);
  assert.deepEqual([s.settlement.didWin, s.settlement.kills], [false, 0]);
  assert.equal(s.holosGranted, 25); assert.equal(s.blueprintFragmentsGranted, 0);
  assert.deepEqual(s.fightReceipt, expected.receipt);
  assert.equal(w.receipt(i.runId).fightPlausibility, undefined, 'a loss is not judged');
  // inside the 20 s window a loss still settles, under the existing withheld rule (0 EXP, 0 Holos)
  const w2 = world([weak(), weak('KUMA')]), i2 = await w2.issue();
  const s2 = await w2.settle(i2.runId, idleLog(i2.duel), T0 + 2_000);
  assert.deepEqual([s2.settlement.didWin, s2.settlement.expWithheld, s2.holosGranted], [false, true, 0]);
});

test('too_fast: a verified win sooner than 20 s after issue writes nothing and can be resent after retryAfterMs', async () => {
  const w = world(), i = await w.issue(), log = winLog(i.duel), before = dump(w.db);
  await assert.rejects(w.settle(i.runId, log, T0 + 5_000), e => e.code === 'too_fast' && e.retryAfterMs === L_MIN() - 5_000);
  assert.equal(dump(w.db), before);
  assert.equal((await w.settle(i.runId, log, T0 + L_MIN())).settlement.didWin, true);
});

// court-full-hp (Pak 2026-11-11): a live court fight starts at FULL HP like the live Arena (live-tuning-1 item 4); the ledger after
// it is min(ledger before, fight end mapped from a full start); a forfeit leaves it.
const aceMaxHp = w => buildPlayerCombatants(w.user(), ['ace'])[0].maxHealth;
const carry = (w, hp) => { const max = aceMaxHp(w); w.db.put(`users/${w.uid}`, { ...w.user(), holobotVitals: { ace: { currentHealth: hp, maxHealth: max, hpUpdatedAt: T0 } } }); return max; };
test('full HP: a live court fight starts at full HP whatever the ledger carries; settle writes min(ledger before, fight end); forfeit leaves it', async () => {
  // win
  const w = world(), max = aceMaxHp(w), low = Math.ceil(max * 0.3); // ko-return-25: a carried HP the gate admits
  carry(w, low);
  const i = await w.issue(), p = i.duel.rules.fighters.find(f => f.side === 0);
  assert.equal(p.hp, p.maxHp, 'fight HP is full');
  assert.deepEqual(w.runs()[0].issuedVitals.ace, { currentHealth: low, maxHealth: max }, 'issuedVitals keeps the ledger row as issued');
  assert.equal(w.user().holobotVitals.ace.currentHealth, low, 'issue leaves the ledger as it was');
  const log = winLog(i.duel), v = verifyFightReplay(i.duel, log, { battleId: i.runId });
  assert.equal(v.receipt.winner, 'player');
  await w.settle(i.runId, log);
  const pf = v.receipt.playerFinal[0], end = ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, { currentHealth: max, maxHealth: max });
  assert.equal(w.user().holobotVitals.ace.currentHealth, Math.min(low, end), 'ledger = min(ledger before, fight end)');
  // loss
  const w2 = world([weak(), weak('KUMA')]), max2 = aceMaxHp(w2), low2 = Math.max(1, Math.floor(max2 / 3));
  carry(w2, low2);
  const i2 = await w2.issue(), p2 = i2.duel.rules.fighters.find(f => f.side === 0);
  assert.equal(p2.hp, p2.maxHp, 'fight HP is full');
  const log2 = idleLog(i2.duel), v2 = verifyFightReplay(i2.duel, log2, { battleId: i2.runId }), pf2 = v2.receipt.playerFinal[0];
  assert.notEqual(v2.receipt.winner, 'player');
  await w2.settle(i2.runId, log2);
  assert.equal(w2.user().holobotVitals.ace.currentHealth, Math.min(low2, ledgerHealthAfterFight(pf2.currentHealth, pf2.maxHealth, { currentHealth: max2, maxHealth: max2 })));
  // forfeit after the issue: the ledger keeps the carried HP
  const w3 = world(), carried = Math.ceil(aceMaxHp(w3) * 0.3), max3 = carry(w3, carried);
  const i3 = await w3.issue(), p3 = i3.duel.rules.fighters.find(f => f.side === 0);
  assert.equal(p3.hp, p3.maxHp);
  await w3.call({ operation: 'forfeit', runId: i3.runId }, T0 + 3_000);
  assert.deepEqual(w3.user().holobotVitals.ace, { currentHealth: carried, maxHealth: max3, hpUpdatedAt: T0 }, 'forfeit keeps the ledger as it was');
});

test('full HP: courtReportFromFightReceipt maps the fight end from a full start, capped at the issue-time ledger row', () => {
  const r = (cur, max, winner = 'player') => ({ winner, playerFinal: [{ holobotId: 'ace', currentHealth: cur, maxHealth: max }] });
  const issued = { ace: { currentHealth: 99, maxHealth: 172 } };
  assert.equal(L.courtReportFromFightReceipt(r(141, 141), issued).health[0].currentHealth, 99, 'an untouched fighter keeps the carried ledger HP');
  assert.equal(L.courtReportFromFightReceipt(r(70, 141), issued).health[0].currentHealth, Math.ceil(172 * 70 / 141), 'below the carried HP: the fight end');
  assert.equal(L.courtReportFromFightReceipt(r(0, 141, 'cpu'), issued).health[0].currentHealth, 0);
  // same scale (no fight-row delta): capped at the carried HP so settleVitals accepts the report
  assert.equal(L.courtReportFromFightReceipt(r(90, 100), { ace: { currentHealth: 50, maxHealth: 100 } }).health[0].currentHealth, 50);
  assert.equal(L.courtReportFromFightReceipt(r(30, 100), { ace: { currentHealth: 50, maxHealth: 100 } }).health[0].currentHealth, 30);
});

test('tampered log: replay_mismatch closes the run as a no-pay forfeit counted as a loss (HP as issued, cooldown started), then reports; a resend reads run_closed', async () => {
  const w = world(), i = await w.issue(), before = w.user();
  await assert.rejects(w.settle(i.runId, tampered(i.duel)), e => e.code === 'replay_mismatch' && ['hash', 'final_hash'].includes(e.detail.reason) && e.detail.fromTick === 0);
  const run = w.runs()[0];
  assert.deepEqual([run.settlement, run.closedAtMs, run.closedBy], [null, LATER, 'replay_mismatch']);
  assert.ok(run.replayRejection && run.replayRejection.reason);
  assert.deepEqual(w.user(), before, 'nothing paid, HP ledger as issued');
  assert.equal(w.receipt(i.runId), undefined);
  assert.deepEqual(w.db.read(`holoZoneRuns/${w.uid}`).zoneLastSettledAtMs, { guild_court: LATER }, 'forfeit-is-loss: the court cooldown starts');
  // a resend (even of an honest log) never pays and never moves the cooldown
  const after = dump(w.db);
  await assert.rejects(w.settle(i.runId, winLog(i.duel), LATER + 1), isCode('run_closed', { closedBy: 'replay_mismatch' }));
  assert.equal(dump(w.db), after);
  assert.equal((await w.call({ operation: 'forfeit', runId: i.runId }, LATER + 2)).closedBy, 'replay_mismatch');
  assert.equal(dump(w.db), after);
  assert.equal((await w.call({ operation: 'status' }, LATER + 3)).run, null);
  await assert.rejects(w.issue(LIVE_ONLY, LATER + 4), e => e.code === 'zone_cooldown' && e.retryAfterMs === Z.HOLOZONE_COOLDOWN_MS - 4);
  assert.equal((await w.issue(LIVE_ONLY, LATER + Z.HOLOZONE_COOLDOWN_MS)).duel.mode, 'input-log', 'a new run issues once the cooldown is over');
});

test('undecodable log: invalid_request (invalid_log), nothing written, the run stays open', async () => {
  const w = world(), i = await w.issue(), before = dump(w.db);
  await assert.rejects(w.settle(i.runId, 'not-a-log'), isCode('invalid_request', { reason: 'invalid_log' }));
  assert.equal(dump(w.db), before);
  assert.equal((await w.settle(i.runId, winLog(i.duel))).settlement.didWin, true);
});

test('forfeit (a fight cut off after it started): closes the open live run as a loss, no pay, HP as issued, cooldown started; repeat replays', async () => {
  const w = world(), i = await w.issue(), before = w.user();
  const f = await w.call({ operation: 'forfeit', runId: i.runId }, T0 + 3_000);
  assert.deepEqual(f, { schemaVersion: V, runId: i.runId, alreadyProcessed: false, closedBy: 'forfeit' }, 'the reply shape is unchanged');
  assert.deepEqual(w.user(), before, 'no Holos, EXP, fragment; HP ledger as issued');
  assert.deepEqual([w.runs()[0].closedBy, w.runs()[0].settlement], ['forfeit', null]);
  assert.deepEqual(w.db.read(`holoZoneRuns/${w.uid}`).zoneLastSettledAtMs, { guild_court: T0 + 3_000 }, 'forfeit-is-loss: the court cooldown starts');
  const closedDump = dump(w.db);
  assert.deepEqual(await w.call({ operation: 'forfeit', runId: i.runId }, T0 + 4_000), { schemaVersion: V, runId: i.runId, alreadyProcessed: true, closedBy: 'forfeit' });
  assert.equal(dump(w.db), closedDump, 'a repeated forfeit writes nothing (no second loss, the cooldown does not move)');
  await assert.rejects(w.settle(i.runId, winLog(i.duel)), isCode('run_closed', { closedBy: 'forfeit' }));
  await assert.rejects(w.issue(LIVE_ONLY, T0 + 5_000), e => e.code === 'zone_cooldown' && e.retryAfterMs === Z.HOLOZONE_COOLDOWN_MS - 2_000);
  assert.equal((await w.issue(LIVE_ONLY, T0 + 3_000 + Z.HOLOZONE_COOLDOWN_MS)).duel.mode, 'input-log', 'issues again once the cooldown is over');
  // a settled run's forfeit replays its ruling; a plain (client-reported) run refuses a forfeit
  const s = world(), si = await s.issue(), log = winLog(si.duel);
  await s.settle(si.runId, log);
  const replay = await s.call({ operation: 'forfeit', runId: si.runId }, LATER + 1);
  assert.equal(replay.alreadyProcessed, true); assert.equal(replay.settlement.didWin, true); assert.ok(replay.fightReceipt);
  const p = world(), pi = await p.issue({}, T0, ON);
  assert.equal(pi.duel, undefined);
  await assert.rejects(p.call({ operation: 'forfeit', runId: pi.runId }), isCode('invalid_request'));
  await assert.rejects(p.call({ operation: 'forfeit', runId: '99999999-1111-4111-8111-111111111111' }), isCode('unknown_run'));
});

test('mode lock: a live run refuses a report or a plan; other runs refuse a log; a live settle carries the log only', async () => {
  const w = world(), i = await w.issue();
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'] }, LATER), isCode('invalid_request', { reason: 'input_log_required' }));
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, playerIntents: ['strike'] }, LATER), isCode('invalid_request', { reason: 'input_log_required' }));
  await assert.rejects(w.call({ operation: 'settle', runId: i.runId, inputLog: winLog(i.duel), kills: 1 }, LATER), isCode('invalid_request'));
  const p = world(), pi = await p.issue({}, T0);
  await assert.rejects(p.settle(pi.runId, winLog(i.duel)), isCode('invalid_request'));
  const r = world(), ri = await r.issue({ duelSchema: 'duel-receipt-1' }, T0);
  assert.equal(ri.duel.mode, 'resolver');
  await assert.rejects(r.settle(ri.runId, winLog(i.duel)), isCode('invalid_request'));
  // expired live run
  await assert.rejects(w.settle(i.runId, winLog(i.duel), T0 + Z.HOLOZONE_RUN_TTL_MS + 1), isCode('run_expired'));
});

test('flag off: a live-only issue refuses live_unavailable (replay_off) and writes nothing, even over an open run; the retry works once on', async () => {
  const w = world(), before = dump(w.db);
  await assert.rejects(w.issue(LIVE_ONLY, T0, OFF), isCode('live_unavailable', { reason: 'replay_off' }));
  assert.equal(dump(w.db), before, 'no run, no HP ledger write, no cooldown');
  // an open plain run is NOT superseded by the refused request
  const open = await w.call({ operation: 'issue', zoneId: 'guild_court' }, T0, OFF), withOpen = dump(w.db);
  await assert.rejects(w.issue(LIVE_ONLY, T0 + 1, OFF), isCode('live_unavailable', { reason: 'replay_off' }));
  assert.equal(dump(w.db), withOpen);
  assert.equal((await w.call({ operation: 'status' }, T0 + 2, OFF)).run.runId, open.runId);
  // a live-only request that names no court fighter is malformed whatever the flag
  await assert.rejects(w.call({ operation: 'issue', zoneId: 'guild_court', ...LIVE_ONLY }, T0, OFF), isCode('invalid_request'));
  await assert.rejects(w.call({ operation: 'issue', zoneId: 'neonforest', holobotId: 'ace', ...LIVE_ONLY }, T0, ON), isCode('invalid_request'));
  // the same request with the flag on gets the live fight
  assert.equal((await w.issue(LIVE_ONLY, T0 + 3, ON)).duel.mode, 'input-log');
});

test('lineup_unsupported: flag on but the fight core cannot express the fighter -> live-only refused with nothing written; others fall back', async () => {
  // BLAZE builds a host combatant but has no fight kit (not in KIT_IDS), so buildFightReplayIssue returns null.
  const K = require('../lib/sim/fight/rules.js');
  assert.equal(K.KIT_IDS.includes('blaze'), false);
  const w = world([{ ...weak('BLAZE'), level: 5 }]), before = dump(w.db);
  await assert.rejects(w.call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'blaze', ...LIVE_ONLY }, T0, ON), isCode('live_unavailable', { reason: 'lineup_unsupported' }));
  assert.equal(dump(w.db), before, 'nothing written (no run, no HP ledger)');
  // with duelSchema as fallback the plan-and-send court is issued instead; the capability alone gets today's plain-shaped run
  const r = await w.call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'blaze', ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, T0, ON);
  assert.equal(r.duel.mode, 'resolver');
  const p = await world([{ ...weak('BLAZE'), level: 5 }]).call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'blaze', duelInputs: 'duel-inputs-2' }, T0, ON);
  assert.equal(p.duel, undefined);
});

test('a realistic fight (unboosted level-21 ACE, scripted CPU-grade player) verifies and settles from its own winner', async () => {
  const w = world([{ ...strong(), boostedAttributes: {} }, weak('KUMA')]), i = await w.issue();
  const log = recordFightLog(i.duel, smartPlayer(i.duel, 'ace', 'Elite')).wire, expected = verifyFightReplay(i.duel, log, { battleId: i.runId });
  assert.ok(expected.ticks > 300, `a real-length fight (${expected.ticks} ticks)`);
  const s = await w.settle(i.runId, log);
  assert.equal(s.settlement.didWin, expected.receipt.winner === 'player');
  assert.deepEqual(s.fightReceipt, expected.receipt);
});

test('flag off: requests carrying the capability without the live-only ask behave exactly like the same request without it', async () => {
  const pairs = [
    [{ holobotId: 'ace', duelInputs: 'duel-inputs-2' }, { holobotId: 'ace' }],
    [{ holobotId: 'ace', ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, { holobotId: 'ace', duelSchema: 'duel-receipt-1' }],
  ];
  for (const [withCap, without] of pairs) {
    const out = [];
    for (const extra of [withCap, without]) {
      runSerial = 2000; serial = 6000;
      const w = world(), i = await w.issue(extra, T0, OFF);
      out.push(JSON.stringify([i, JSON.parse(dump(w.db))]).replace(/"seed":\d+/g, '"seed":0'));
    }
    assert.equal(out[0], out[1], JSON.stringify(withCap));
  }
});

test('non-opt-in requests are byte-identical with the flag on and off (plain, health, plan-and-send issue + settle + status)', async () => {
  const shapes = [
    { issue: { operation: 'issue', zoneId: 'guild_court' }, settle: runId => ({ operation: 'settle', runId, kills: 1, bossDefeated: false, fielded: ['ace'] }) },
    { issue: { operation: 'issue', zoneId: 'guild_court', healthSchema: 'rival-health-1' }, settle: runId => ({ operation: 'settle', runId, kills: 0, bossDefeated: false, fielded: ['ace'], healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 1 }] }) },
    { issue: { operation: 'issue', zoneId: 'guild_court', holobotId: 'ace' }, settle: runId => ({ operation: 'settle', runId, kills: 1, bossDefeated: false, fielded: [] }) },
    { issue: { operation: 'issue', zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'ace' }, settle: runId => ({ operation: 'settle', runId, playerIntents: ['strike', 'heavy', 'defend'] }) },
    // the capability alone with an unknown value, or fightRules alone, is ignored exactly as every unknown field is today
    { issue: { operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', duelInputs: 'duel-inputs-1', fightRules: 'duel-rules-6' }, settle: runId => ({ operation: 'settle', runId, kills: 1, bossDefeated: false, fielded: ['ace'] }) },
  ];
  for (const version of ['holozone-run-1', 'holozone-run-2']) for (const shape of shapes) {
    const trace = [];
    for (const options of [OFF, ON]) {
      runSerial = 1000; serial = 5000;
      const w = world();
      // resolver seeds are random per call; pin them by comparing the stored resolver input instead of the receipt
      const call = (body, now) => transactHoloZoneRun(w.db, w.uid, { schemaVersion: version, ...body }, now, () => '00001000-1111-4111-8111-111111111111', options);
      const i = await call(shape.issue, T0);
      const status = await call({ operation: 'status' }, T0 + 1);
      const seedless = JSON.parse(dump(w.db).replace(/"seed":\d+/g, '"seed":0'));
      let settled;
      if (shape.issue.duelSchema) {
        // replace the random resolver seed with a fixed one so both runs resolve identically
        const doc = w.db.read(`holoZoneRuns/${w.uid}`); doc.runs[0].duel.input.seed = 7; w.db.put(`holoZoneRuns/${w.uid}`, doc);
      }
      settled = await call(shape.settle(i.runId), LATER);
      trace.push(JSON.stringify([i, status, seedless, settled, dump(w.db)]));
    }
    assert.equal(trace[1], trace[0], `${version} ${JSON.stringify(shape.issue)}`);
  }
});
