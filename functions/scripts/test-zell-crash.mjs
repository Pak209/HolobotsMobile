// zell-crash-1: the Zell crash story event + the two can't-lose catch-duels (in-memory transaction model; no emulator).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { memoryFirestore } from './zell-memory-firestore.mjs';
import { F, recordFightLog, smartPlayer, scriptedPlayer, clone, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT ||= 'demo-holobots-zell-crash';
if (!process.env.GCLOUD_PROJECT.startsWith('demo-')) throw new Error('Demo project required');
const Z = require('../lib/story/zellCrash.js');
const C = require('../lib/story/zellCatch.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const { calculateExperience } = require('../lib/lib/progression.js');

const T = Date.UTC(2026, 9, 23, 18, 0);
const S = 'zell-crash-1';
const bot = (name, level = 6) => ({ name, level, experience: 0, nextLevelExp: calculateExperience(level + 1), attributePoints: 0, boostedAttributes: {} });
let seq = 0;
async function setup(db, { won = 3, squad = ['ace'], holoZones = false } = {}) {
  const uid = `zc_${seq++}`;
  await db.doc(`users/${uid}`).set({
    holobots: [bot('ACE'), bot('KUMA')], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: squad },
    buddyUnits: { light: 0, medium: 0, heavy: 0 }, holosTokens: 500, rivalWins: 0,
    holobotVitals: { ace: { currentHealth: 7, maxHealth: 480 } },
    storyFlags: { arenaGatheringSeen: true, tournamentsWon: won, arenaArcBuilt: won === 3, holoZonesArcBuilt: holoZones },
  });
  return uid;
}
const call = (db, uid, data, now = T, enabled = true) => Z.transactZellCrash(db, uid, { schemaVersion: S, ...data }, now, { enabled });
const user = async (db, uid) => (await db.doc(`users/${uid}`).get()).data();
const arc = async (db, uid) => (await db.doc(Z.ZELL_CRASH_PATH(uid)).get()).data();
const issueCatch = (db, uid, catchIndex) => call(db, uid, { operation: 'issueCatch', catchIndex, duelInputs: 'duel-inputs-2' });
const escapeOf = r => (core => C.catchEscapeHit(core, r.escape) !== null);
/** The client side (Unity's recorder twin): the log of the issued duel up to the issued escape tick. */
const clientLog = (r, player = smartPlayer(r.duel)) => recordFightLog(r.duel, player, 30, escapeOf(r));
const settle = (db, uid, r, inputLog) => call(db, uid, { operation: 'settleCatch', catchIndex: r.catchIndex, catchId: r.catchId, inputLog });

test('default OFF: every operation refuses unavailable and writes nothing', async () => {
  const db = memoryFirestore(), uid = await setup(db), before = await user(db, uid);
  for (const op of ['status', 'crash']) await assert.rejects(() => call(db, uid, { operation: op }, T, false), /unavailable/);
  await assert.rejects(() => Z.transactZellCrash(db, uid, { schemaVersion: S, operation: 'crash' }, T), /unavailable/);
  assert.deepEqual(await user(db, uid), before); assert.equal(await arc(db, uid), undefined);
});

test('strict requests: unknown op, extra key, missing capability, bad catch id', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  for (const bad of [{ operation: 'win' }, { operation: 'crash', holoZonesArcBuilt: true }, { operation: 'issueCatch', catchIndex: 0 },
    { operation: 'issueCatch', catchIndex: 2, duelInputs: 'duel-inputs-2' }, { operation: 'settleCatch', catchIndex: 0, catchId: 'rb_x', inputLog: {} }])
    await assert.rejects(() => call(db, uid, bad), /invalid_request/);
  await assert.rejects(() => Z.transactZellCrash(db, uid, { schemaVersion: 'zell-crash-0', operation: 'status' }, T, { enabled: true }), /invalid_request/);
});

test('crash refuses before the third tournament win; nothing written', async () => {
  const db = memoryFirestore(), uid = await setup(db, { won: 2 }), before = await user(db, uid);
  await assert.rejects(() => call(db, uid, { operation: 'crash' }), /arena_arc_required/);
  assert.deepEqual(await user(db, uid), before); assert.equal(await arc(db, uid), undefined);
  const s = await call(db, uid, { operation: 'status' });
  assert.equal(s.zellCrash.seen, false); assert.equal(s.zellCrash.catches[0].state, 'locked');
});

test('crash: one idempotent host event sets seen + holoZonesArcBuilt + trophy stolen + meets Zell', async () => {
  const db = memoryFirestore(), uid = await setup(db), before = await user(db, uid);
  const r = await call(db, uid, { operation: 'crash' });
  assert.equal(r.alreadySeen, false); assert.equal(r.storyFlags.holoZonesArcBuilt, true);
  assert.deepEqual(Object.keys(r.storyFlags).sort(), ['arenaArcBuilt', 'arenaGatheringSeen', 'holoZonesArcBuilt', 'tournamentsWon'], 'storyFlags keeps its four keys');
  assert.deepEqual(r.zellCrash, { seen: true, trophy: 'stolen', catches: [{ catchIndex: 0, state: 'ready', cause: null }, { catchIndex: 1, state: 'locked', cause: null }] });
  assert.equal(r.zellPhase, 'rival'); assert.equal(r.roster.length, 8);
  const after = await user(db, uid);
  assert.deepEqual({ ...after, storyFlags: undefined }, { ...before, storyFlags: undefined }, 'only storyFlags changes on the profile');
  assert.equal(after.storyFlags.holoZonesArcBuilt, true);
  assert.equal((await db.doc(`storyProgress/${uid}`).get()).data().phase, 'rival');
  const stored = await arc(db, uid);
  const again = await call(db, uid, { operation: 'crash' }, T + 99999);
  assert.equal(again.alreadySeen, true); assert.deepEqual(await arc(db, uid), stored, 'repeat writes nothing'); assert.equal(stored.seenAtMs, T);
});

test('catch order: no catch before the crash, catch 2 locked until catch 1 escaped, re-issue returns the same duel', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  await assert.rejects(() => issueCatch(db, uid, 0), /crash_required/);
  await call(db, uid, { operation: 'crash' });
  await assert.rejects(() => issueCatch(db, uid, 1), /catch_locked/);
  const a = await issueCatch(db, uid, 0), b = await issueCatch(db, uid, 0);
  assert.equal(a.alreadyIssued, false); assert.equal(b.alreadyIssued, true);
  assert.equal(b.catchId, a.catchId); assert.deepEqual(b.duel, a.duel);
  assert.equal(a.duel.rules.schemaVersion, 'duel-rules-4'); assert.equal(a.duel.rulesId, `duel-rules-4:${a.catchId}`);
  assert.deepEqual(a.duel.cpu.roster.map(x => x.holobotId), ['jusan']);
  assert.equal(a.duel.cpu.profile.aggressionPmPerSec, 300, 'runner-biased issued profile');
  const ace = a.duel.rules.fighters.find(f => f.side === 0);
  assert.equal(ace.hp, ace.maxHp, 'catch-duels fight at full HP; town HP (7) is not read');
  assert.deepEqual(a.escape, C.ZELL_CATCHES[0].escape);
});

test('squad required', async () => {
  const db = memoryFirestore(), uid = await setup(db, { squad: [] });
  await call(db, uid, { operation: 'crash' });
  await assert.rejects(() => issueCatch(db, uid, 0), /squad_required/);
});

async function playBoth(db, uid) {
  await call(db, uid, { operation: 'crash' });
  const out = [];
  for (const i of [0, 1]) {
    const r = await issueCatch(db, uid, i);
    const log = clientLog(r);
    out.push({ r, log, s: await settle(db, uid, r, log.wire) });
  }
  return out;
}

test('both catches settle `escaped` from the host replay; nothing is granted, charged or healed', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  await call(db, uid, { operation: 'crash' });
  const before = await user(db, uid);
  const db2 = db;
  for (const i of [0, 1]) {
    const r = await issueCatch(db2, uid, i);
    const log = clientLog(r);
    const s = await settle(db2, uid, r, log.wire);
    assert.equal(s.outcome, 'escaped'); assert.equal(s.alreadyProcessed, false);
    assert.ok(C.CATCH_ESCAPE_CAUSES.includes(s.cause), s.cause);
    assert.equal(s.catchReceipt.schemaVersion, 'zell-catch-receipt-1'); assert.equal(s.catchReceipt.outcome, 'escaped');
    assert.equal(s.catchReceipt.endTick, log.endTick); assert.equal(s.catchReceipt.verified, true);
    if (!['player_ko', 'runner_ko'].includes(s.cause)) assert.equal(s.catchReceipt.reason, 'escaped');
    assert.equal(s.zellCrash.catches[i].state, 'escaped');
    const replay = await settle(db2, uid, r, log.wire);
    assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.catchReceipt, s.catchReceipt);
    await assert.rejects(() => issueCatch(db2, uid, i), /catch_settled/);
    console.log(`catch ${i}: cause=${s.cause} endTick=${s.catchReceipt.endTick} caught=${log.endTick}`);
  }
  assert.deepEqual(await user(db, uid), before, 'no Holos / XP / HP / rank / reward writes');
});

test('an idle player still ends escaped (the chase cannot be lost)', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  await call(db, uid, { operation: 'crash' });
  const r = await issueCatch(db, uid, 0);
  const s = await settle(db, uid, r, clientLog(r, scriptedPlayer([{ t: 0, move: [0, 0] }])).wire);
  assert.equal(s.outcome, 'escaped'); assert.ok(['time', 'player_ko', 'runner_hp', 'caught'].includes(s.cause));
});

test('known-bad: a log past the escape tick, an unfinished log, a tampered log and a foreign catch id all refuse', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  await call(db, uid, { operation: 'crash' });
  const r = await issueCatch(db, uid, 0);
  const full = recordFightLog(r.duel, smartPlayer(r.duel));   // ignores the escape: runs to the KO
  const good = clientLog(r);
  assert.ok(full.endTick > good.endTick, `the escape fires before the fight's own end (${good.endTick} < ${full.endTick})`);
  await assert.rejects(() => settle(db, uid, r, full.wire), /replay_mismatch/);
  const early = recordFightLog(r.duel, smartPlayer(r.duel), 30, core => core.tick + 1 >= Math.max(31, good.endTick - 40));
  await assert.rejects(() => settle(db, uid, r, early.wire), /replay_mismatch/);
  const bad = clone(good.wire); bad.seed = '0'.repeat(64);
  await assert.rejects(() => settle(db, uid, r, bad), /replay_mismatch|invalid_log/);
  await assert.rejects(() => call(db, uid, { operation: 'settleCatch', catchIndex: 0, catchId: 'zc_' + 'f'.repeat(24), inputLog: good.wire }), /unknown_catch/);
  assert.equal((await arc(db, uid)).catches['0'].settlement, null, 'no refusal settles');
  const ok = await settle(db, uid, r, good.wire); assert.equal(ok.outcome, 'escaped');
});

test('escape predicate: each threshold fires on its own (unit)', () => {
  const r = { catchIndex: 0 };
  const core = { chaseState: [{}, { caught: 0, ringStops: 0 }], roster: [[], [{ hp: 1000, maxHp: 1000 }]], active: [0, 0], tick: 10, ended: false, winner: -1 };
  const e = { schemaVersion: 'catch-escape-1', caughtPulls: 2, ringStops: 1, runnerHpPm: 400, maxTicks: 100 };
  assert.equal(C.catchEscapeHit(core, e), null);
  assert.equal(C.catchEscapeHit({ ...core, chaseState: [{}, { caught: 2, ringStops: 0 }] }, e), 'caught');
  assert.equal(C.catchEscapeHit({ ...core, chaseState: [{}, { caught: 0, ringStops: 1 }] }, e), 'ring_stop');
  assert.equal(C.catchEscapeHit({ ...core, roster: [[], [{ hp: 400, maxHp: 1000 }]] }, e), 'runner_hp');
  assert.equal(C.catchEscapeHit({ ...core, tick: 99 }, e), 'time');
  assert.equal(C.catchEscapeHit({ ...core, chaseState: [{}, { caught: 9, ringStops: 9 }] }, { ...e, caughtPulls: 0, ringStops: 0 }), null, '0 disables');
  assert.throws(() => C.readCatchEscape({ ...e, extra: 1 }), /invalid_escape/);
  assert.throws(() => C.readCatchEscape({ ...e, maxTicks: 10 }), /invalid_escape/);
  void r;
});

test('deleteUserData removes the arc record', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  await call(db, uid, { operation: 'crash' });
  await deleteUserData(db, uid).catch(() => {});
  assert.equal(await arc(db, uid), undefined);
});

test('cross-repo fixture: the frozen catch-duel vector (issue + escape + client log + host receipt)', async () => {
  const db = memoryFirestore(), uid = await setup(db);
  const [first] = await playBoth(db, uid);
  const path = new URL('./fixtures/zell-crash-1/catch-0.fixture.json', import.meta.url);
  // the ids/seed are random per run; the frozen vector re-verifies a pinned issue instead
  if (process.env.ZELL_CRASH_REGEN === '1' || !existsSync(path)) {
    writeFileSync(path, JSON.stringify({ issue: first.r.duel, escape: first.r.escape, catchId: first.r.catchId, inputLog: first.log.wire, receipt: first.s.catchReceipt, cause: first.s.cause }, null, 1) + '\n');
  }
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  let hit = null;
  const v = verifyFightReplay(fx.issue, fx.inputLog, { battleId: fx.catchId, stopWhen: core => (hit = C.catchEscapeHit(core, fx.escape)) !== null });
  const cause = v.stopped && hit ? hit : v.winner === 1 ? 'player_ko' : v.winner === 0 ? 'runner_ko' : 'time';
  assert.equal(cause, fx.cause); assert.equal(v.receipt.endTick, fx.receipt.endTick); assert.equal(v.receipt.inputsHash, fx.receipt.inputsHash);
  assert.equal(v.receipt.checkpoints.finalHash, fx.receipt.checkpoints.finalHash);
});

test('every reply validates against Schemas/zell-crash-1.json (and the requests do too)', async () => {
  const Ajv2020 = require('ajv/dist/2020').default;
  const schema = JSON.parse(readFileSync(new URL('../../Schemas/zell-crash-1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const reply = ajv.compile(schema), request = ajv.compile({ $ref: 'zell-crash-1#/$defs/request' });
  const db = memoryFirestore(), uid = await setup(db);
  const ok = (v, x) => assert.ok(v(x), JSON.stringify(v.errors));
  ok(reply, await call(db, uid, { operation: 'status' }));
  ok(reply, await call(db, uid, { operation: 'crash' }));
  const i = await issueCatch(db, uid, 0); ok(reply, i);
  const log = clientLog(i); const s = await settle(db, uid, i, log.wire); ok(reply, s);
  for (const r of [{ operation: 'crash' }, { operation: 'issueCatch', catchIndex: 0, duelInputs: 'duel-inputs-2' }, { operation: 'settleCatch', catchIndex: 0, catchId: i.catchId, inputLog: log.wire }])
    ok(request, { schemaVersion: S, ...r });
  assert.equal(request({ schemaVersion: S, operation: 'crash', extra: 1 }), false, 'known-bad request');
});

test('cross-repo fixture: one account\'s replies (status, crash, issueCatch, settleCatch) validate and are frozen for the Unity mirror', async () => {
  const path = new URL('./fixtures/zell-crash-1/replies.fixture.json', import.meta.url);
  if (process.env.ZELL_CRASH_REGEN === '1' || !existsSync(path)) {
    const db = memoryFirestore(), uid = await setup(db);
    const status = await call(db, uid, { operation: 'status' }), crash = await call(db, uid, { operation: 'crash' });
    const issue = await issueCatch(db, uid, 0), settled = await settle(db, uid, issue, clientLog(issue).wire);
    writeFileSync(path, JSON.stringify({ status, crash, issueCatch: issue, settleCatch: settled }, null, 1) + '\n');
  }
  const Ajv2020 = require('ajv/dist/2020').default;
  const schema = JSON.parse(readFileSync(new URL('../../Schemas/zell-crash-1.json', import.meta.url), 'utf8'));
  const v = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  for (const k of ['status', 'crash', 'issueCatch', 'settleCatch']) assert.ok(v(fx[k]), k + ' ' + JSON.stringify(v.errors));
  assert.equal(fx.settleCatch.catchId, fx.issueCatch.catchId); assert.equal(fx.settleCatch.outcome, 'escaped');
});
