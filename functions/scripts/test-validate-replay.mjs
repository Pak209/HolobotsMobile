// Replay validation groundwork (ship-readiness item 8): validateReplay classifies a duel-inputs-2 log against its issue
// (match / tamper / truncated / oversized / missing / invalid), never throwing; the pvp_async settle runs it as a DRY RUN
// (HOLOCITY_PVP_REPLAY=dry_run) that only logs a non-match, and as the strict gate with HOLOCITY_PVP_REPLAY=gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pinFlags } from './lib/flag-env.mjs';
import { F, recordFightLog, issueFor, smartPlayer, clone } from './lib/fight-replay-helpers.mjs';
pinFlags({ HOLOCITY_FIGHT_ATTRS: undefined, HOLOCITY_FIGHT_REPLAY: undefined, HOLOCITY_FIGHT_CHASE: undefined, HOLOCITY_RIVAL_ISSUE_RESOLVER: undefined, HOLOCITY_PVP_REPLAY: undefined, HOLOCITY_READINESS_START: undefined, HOLOCITY_BATTLE_IQ: undefined });
const require = createRequire(import.meta.url);
const { validateReplay, replayDryRunLine } = require('../lib/sim/fight/validateReplay.js');
const { FIGHT_LOG_MAX_BYTES } = require('../lib/shared/fightReplayContract.js');
const L = require('../lib/lib/rivalLadder.js');
const { transactPvpDaily } = require('../lib/pvp/pvpDailyStore.js');
const { transactRivalBattle, pvpReplayMode } = require('../lib/rival/rivalBattleStore.js');

const BATTLE = 'rb_fixture000000000000000000';
const v = (issue, log, extra = {}) => validateReplay(issue, log, { battleId: BATTLE, ...extra });

/** Re-seal a shorter log the way a client that stopped early would: every remaining hash and the final hash honest. */
function honestPrefix(issue, wire, ticks) {
  const log = F.parseInputLog(wire);
  log.tickCount = ticks;
  for (const s of log.sides) s.ticks = s.ticks.slice(0, ticks);
  log.hashes = log.hashes.slice(0, Math.trunc(ticks / log.hashEvery));
  const run = F.runFight(F.rulesFromJson(issue.rules), issue.seed, { inputs: F.logInputs(log, 0) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, { tickHashes: true, recordEvents: false, maxTicks: ticks });
  log.finalHash = run.tickHashes.get(ticks - 1);
  return F.inputLogToWire(log);
}

test('match: the replay agrees and carries the host-computed outcome', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  const r = v(issue, client.wire);
  assert.equal(r.verdict, 'match');
  assert.equal(r.replay.receipt.winner, client.winner === 0 ? 'player' : client.winner === 1 ? 'opponent' : 'draw');
  assert.ok(r.bytes > 0 && r.bytes <= FIGHT_LOG_MAX_BYTES);
  assert.equal(v(issue, JSON.stringify(client.wire)).verdict, 'match', 'object or compact wire string');
  // deterministic: the same (issue, log) gives the same receipt
  assert.deepEqual(v(issue, clone(client.wire)).replay.receipt, r.replay.receipt);
});

test('tamper: a rewritten stick, a forged hash, a swapped seed, an edited CPU stream are each tamper with the reason', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  const stick = F.parseInputLog(client.wire);
  for (let t = 100; t < stick.tickCount; t++) stick.sides[0].ticks[t] = { ...stick.sides[0].ticks[t], moveX: 127, moveZ: 0 };
  const a = v(issue, F.inputLogToWire(stick)); assert.equal(a.verdict, 'tamper'); assert.equal(a.reason, 'hash'); assert.ok(Number.isInteger(a.detail.window));
  const hash = clone(client.wire); hash.hashes = 'f'.repeat(16) + hash.hashes.slice(16);
  const b = v(issue, hash); assert.equal(b.verdict, 'tamper'); assert.equal(b.reason, 'hash'); assert.equal(b.detail.window, 0);
  const seed = clone(client.wire); seed.seed = '0'.repeat(64);
  const c = v(issue, seed); assert.equal(c.verdict, 'tamper'); assert.equal(c.reason, 'identity'); assert.equal(c.detail.field, 'seed');
  const cpu = F.parseInputLog(client.wire); cpu.sides[1].ticks[40] = { ...cpu.sides[1].ticks[40], press: cpu.sides[1].ticks[40].press === 1 ? 2 : 1 };
  const d = v(issue, F.inputLogToWire(cpu)); assert.equal(d.verdict, 'tamper'); assert.ok(['cpu_stream', 'hash'].includes(d.reason), d.reason);
  const final = clone(client.wire); final.finalHash = final.finalHash.replace(/^./, ch => (ch === '0' ? '1' : '0'));
  assert.equal(v(issue, final).verdict, 'tamper');
});

test('truncated: a log cut short (counts left inconsistent, or honestly re-sealed but unfinished) is truncated', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  assert.ok(client.endTick > 200, 'a fight long enough to cut');
  const cut = clone(client.wire); cut.tickCount = Math.trunc(client.wire.tickCount / 2);
  const a = v(issue, cut); assert.equal(a.verdict, 'truncated'); assert.ok(['stream_tick_range', 'invalid_hash_count', 'stream_truncated'].includes(a.reason), a.reason);
  const sealed = honestPrefix(issue, client.wire, 150);
  const b = v(issue, sealed); assert.equal(b.verdict, 'truncated'); assert.equal(b.reason, 'incomplete');
});

test('oversized: past the cap (default FIGHT_LOG_MAX_BYTES, or a lower caller cap) without replaying', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  const big = { ...clone(client.wire), pad: 'x'.repeat(FIGHT_LOG_MAX_BYTES) };
  const a = v(issue, big); assert.equal(a.verdict, 'oversized'); assert.ok(a.bytes > FIGHT_LOG_MAX_BYTES); assert.equal(a.detail.maxBytes, FIGHT_LOG_MAX_BYTES);
  assert.equal(v(issue, 'y'.repeat(FIGHT_LOG_MAX_BYTES + 1)).verdict, 'oversized');
  const b = v(issue, client.wire, { maxBytes: 64 }); assert.equal(b.verdict, 'oversized'); assert.equal(b.detail.maxBytes, 64);
  assert.equal(v(issue, client.wire, { maxBytes: FIGHT_LOG_MAX_BYTES * 4 }).verdict, 'match', 'a caller can lower the cap, never raise it');
});

test('missing / invalid log / invalid issue never throw', () => {
  const issue = issueFor();
  assert.equal(v(issue, undefined).verdict, 'missing');
  assert.equal(v(issue, null).verdict, 'missing');
  assert.equal(v(issue, '{not json').verdict, 'invalid_log');
  assert.equal(v(issue, { schemaVersion: 'duel-inputs-2' }).verdict, 'invalid_log');
  const client = recordFightLog(issue, smartPlayer(issue));
  assert.equal(v({ ...issue, rulesHash: '0'.repeat(64) }, client.wire).verdict, 'invalid_issue');
  assert.equal(v(null, client.wire).verdict, 'invalid_issue');
  const line = replayDryRunLine(BATTLE, v(issue, client.wire), true);
  assert.equal(line.event, 'pvp_replay_dry_run'); assert.equal(line.verdict, 'match');
  assert.ok(!JSON.stringify(line).includes(issue.seed), 'the telemetry line never carries the seed or the log');
});

test('HOLOCITY_PVP_REPLAY reads dry_run / gate only', () => {
  assert.equal(pvpReplayMode('dry_run'), 'dry_run'); assert.equal(pvpReplayMode('gate'), 'gate');
  assert.equal(pvpReplayMode(undefined), undefined); assert.equal(pvpReplayMode('1'), undefined);
});

// ---- the pvp settle path, offline (in-memory Firestore model, as test-pvp-daily.mjs) ------------------------------------
function memoryFirestore() {
  const rows = new Map(); let queue = Promise.resolve();
  const cl = x => x === undefined ? undefined : structuredClone(x);
  const snap = path => ({ id: path.split('/').pop(), exists: rows.has(path), data: () => cl(rows.get(path)) });
  const query = (path, filters = [], max = Infinity) => ({
    where: (f, op, val) => query(path, [...filters, [f, op, val]], max), select: () => query(path, filters, max), limit: n => query(path, filters, n),
    get: async () => ({ docs: [...rows.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).sort().map(snap)
      .filter(s => filters.every(([f, op, val]) => { const x = s.data()[f]; return typeof x === 'number' && (op === '>=' ? x >= val : x <= val); })).slice(0, max) }),
  });
  return {
    rows,
    doc: path => ({ path, get: async () => snap(path), set: async x => { rows.set(path, cl(x)); }, update: async x => { rows.set(path, { ...rows.get(path), ...cl(x) }); } }),
    collection: path => query(path),
    runTransaction(fn) {
      const run = queue.then(async () => {
        const pending = []; let writing = false;
        const tx = {
          async get(ref) { if (writing) throw new Error('transaction read after write'); return snap(ref.path); },
          set(ref, x) { writing = true; pending.push(['set', ref.path, cl(x)]); },
          update(ref, x) { writing = true; if (!rows.has(ref.path)) throw new Error('missing update'); pending.push(['update', ref.path, cl(x)]); },
          create(ref, x) { writing = true; if (rows.has(ref.path)) throw new Error('exists'); pending.push(['set', ref.path, cl(x)]); },
        };
        const result = await fn(tx);
        for (const [op, path, x] of pending) rows.set(path, op === 'update' ? { ...rows.get(path), ...x } : x);
        return result;
      });
      queue = run.catch(() => {}); return run;
    },
  };
}
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);
const bots = () => [{ name: 'ACE', level: 5, experience: 0, nextLevelExp: 2500, attributePoints: 0 }];
const pilot = (wins, name) => ({ buddyUnits: { light: 1, medium: 0, heavy: 0 }, rivalWins: wins, username: name, holobots: bots(), travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
function world() {
  const db = memoryFirestore();
  db.rows.set('users/me', { ...pilot(5, 'Me'), holosTokens: 0 });
  for (const [uid, name] of [['a', 'Nyx'], ['b', 'Bolt'], ['c', 'Rook']]) db.rows.set(`users/${uid}`, pilot(3, name));
  return db;
}
async function capture(fn) {
  const lines = []; const w = console.warn, i = console.info;
  console.warn = (...a) => lines.push(['warn', a.join(' ')]); console.info = (...a) => lines.push(['info', a.join(' ')]);
  try { return { result: await fn(), lines }; } finally { console.warn = w; console.info = i; }
}
const settle = (db, body, now) => transactRivalBattle(db, 'me', { schemaVersion: 'rival-battle-3', operation: 'settle', ...body }, now);
// auto-heal-1: a lost fight can leave ACE at 0 HP, and a KO'd Holobot is refused (holobot_ko) below 25 %. These pvp
// scenarios are about replay verdicts, not HP, so each new issue starts from a repaired Holobot.
const repair = db => { const u = db.rows.get('users/me'); delete u.holobotVitals; db.rows.set('users/me', u); };

test('pvp dry run: input-log issued with the global flag off; a match settles from the replay, a tamper / missing log only LOGS', async () => {
  const db = world();
  const list = await transactPvpDaily(db, 'me', { operation: 'list' }, T0, 'dry_run');
  const [o1, o2, o3] = list.opponents;
  // match
  const i1 = await transactPvpDaily(db, 'me', { operation: 'issue', opponentId: o1.opponentId, duelInputs: 'duel-inputs-2' }, T0, 'dry_run');
  assert.equal(i1.duel.mode, 'input-log');
  const rec1 = db.rows.get(`rivalBattles/me/battles/${i1.battleId}`);
  assert.equal(rec1.replayGate, 'dry_run'); assert.equal(rec1.source, 'pvp_async');
  const log1 = recordFightLog(i1.duel, smartPlayer(i1.duel));
  const s1 = await capture(() => settle(db, { battleId: i1.battleId, inputLog: log1.wire, didWin: false }, T0 + 30000));
  assert.equal(s1.result.fightReceipt.verified, true, 'a match settles from the HOST replay, not the claim');
  assert.equal(s1.result.didWin, log1.winner === 0);
  assert.ok(s1.lines.some(([k, l]) => k === 'info' && l.includes('"verdict":"match"')));
  assert.equal(db.rows.get(`rivalBattles/me/battles/${i1.battleId}`).replayDryRun.verdict, 'match');
  // tamper: never rejected; settled from the claim within the caps (Holos only); verdict logged and recorded
  repair(db);
  const i2 = await transactPvpDaily(db, 'me', { operation: 'issue', opponentId: o2.opponentId, duelInputs: 'duel-inputs-2' }, T0 + 40000, 'dry_run');
  const forged = clone(recordFightLog(i2.duel, smartPlayer(i2.duel)).wire); forged.hashes = 'f'.repeat(16) + forged.hashes.slice(16);
  const before = db.rows.get('users/me').holosTokens;
  const s2 = await capture(() => settle(db, { battleId: i2.battleId, inputLog: forged, didWin: true }, T0 + 70000));
  assert.equal(s2.result.didWin, true); assert.equal(s2.result.holosGranted, L.BATTLE_WIN_HOLOS); assert.equal(s2.result.fightReceipt, undefined);
  assert.equal(db.rows.get('users/me').holosTokens, before + L.BATTLE_WIN_HOLOS);
  const warn = s2.lines.find(([k]) => k === 'warn'); assert.ok(warn && warn[1].includes('"event":"pvp_replay_dry_run"') && warn[1].includes('"verdict":"tamper"'), JSON.stringify(s2.lines));
  assert.deepEqual(Object.keys(db.rows.get(`rivalBattles/me/battles/${i2.battleId}`).replayDryRun).sort(), ['atMs', 'bytes', 'claimedWin', 'reason', 'verdict']);
  // the claim still obeys the rival caps: a claimed win under RIVAL_MIN_WIN_MS is too_fast
  repair(db);
  const i3 = await transactPvpDaily(db, 'me', { operation: 'issue', opponentId: o3.opponentId, duelInputs: 'duel-inputs-2' }, T0 + 80000, 'dry_run');
  await capture(() => assert.rejects(settle(db, { battleId: i3.battleId, inputLogOmitted: 'too_large', didWin: true }, T0 + 81000), /too_fast/));
  // an omitted (over-cap) log: logged as missing, settled from the claim
  const s3 = await capture(() => settle(db, { battleId: i3.battleId, inputLogOmitted: 'too_large', didWin: false }, T0 + 120000));
  assert.equal(s3.result.didWin, false); assert.equal(s3.result.holosGranted, L.BATTLE_LOSS_HOLOS);
  assert.ok(s3.lines.some(([, l]) => l.includes('"verdict":"missing"')));
  // duplicate settle replays the stored ruling, no second log needed
  assert.equal((await settle(db, { battleId: i2.battleId, didWin: false }, T0 + 130000)).alreadyProcessed, true);
});

test('pvp gate: the same tampered log is refused (replay_mismatch); unset mode keeps today\'s legacy pvp battles', async () => {
  const db = world();
  const list = await transactPvpDaily(db, 'me', { operation: 'list' }, T0, 'gate');
  const i = await transactPvpDaily(db, 'me', { operation: 'issue', opponentId: list.opponents[0].opponentId, duelInputs: 'duel-inputs-2' }, T0, 'gate');
  assert.equal(i.duel.mode, 'input-log'); assert.equal(db.rows.get(`rivalBattles/me/battles/${i.battleId}`).replayGate, undefined);
  const forged = clone(recordFightLog(i.duel, smartPlayer(i.duel)).wire); forged.hashes = 'f'.repeat(16) + forged.hashes.slice(16);
  // gate mode has no dry-run fallback: an omitted log on the open battle is refused (checked first: server-rulings-1 ruling 3
  // closes the battle on the replay_mismatch below, after which a settle replays the stored no-pay ruling)
  await capture(() => assert.rejects(settle(db, { battleId: i.battleId, inputLogOmitted: 'too_large', didWin: true }, T0 + 30000), /invalid_request/));
  await capture(() => assert.rejects(settle(db, { battleId: i.battleId, inputLog: forged, didWin: true }, T0 + 30000), /replay_mismatch/));
  const closed = db.rows.get(`rivalBattles/me/battles/${i.battleId}`).settlement;
  assert.equal(closed.closedBy, 'replay_mismatch'); assert.equal(closed.didWin, false); assert.equal(closed.holosGranted, 0);
  const again = await capture(() => settle(db, { battleId: i.battleId, inputLogOmitted: 'too_large', didWin: true }, T0 + 30000));
  assert.equal(again.result.alreadyProcessed, true); assert.equal(again.result.didWin, false); assert.equal(again.result.closedBy, 'replay_mismatch');
  const fresh = world(); const offList = await transactPvpDaily(fresh, 'me', { operation: 'list' }, T0, undefined);
  const off = await transactPvpDaily(fresh, 'me', { operation: 'issue', opponentId: offList.opponents[1].opponentId, duelInputs: 'duel-inputs-2' }, T0 + 40000, undefined);
  assert.equal(off.duel.mode, 'legacy', 'mode unset: pvp follows the global flags (off in alpha)');
});
