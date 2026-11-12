// expedition-rules-8 (2026-11-12, owner: "Yes, include it now"): the realtime expedition engage (zone-run-6) takes the optional
// `fightRules` ask the rival / Arena / Guild Court live hosts take. With the ask the issue gets that host's inputs for the version
// (live, tempo on top of the rules-5 flags, guard for -7/-8, stamina for -8). Without it (Unity, older phones) the issue is
// byte-identical to before. Unknown asks are refused invalid_request before anything is read or written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { T, CONFIG, profile } from './zone-expedition-fixtures.mjs';
import { F, recordFightLog, smartPlayer } from './lib/fight-replay-helpers.mjs';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const Z = require('../lib/holozone/expedition.js');
const { transactExpedition } = require('../lib/holozone/expeditionStore.js');
const { verifyFightReplay } = require('../lib/sim/fight/replay.js');
const { buildFightReplayIssue } = require('../lib/rival/fightReplayIssue.js');

const FLAGS5 = { HOLOCITY_FIGHT_CHASE: '1', HOLOCITY_FIGHT_ATTRS: '1' };
function withEnv(env, f) {
  const keys = ['HOLOCITY_FIGHT_CHASE', 'HOLOCITY_FIGHT_ATTRS', 'HOLOCITY_READINESS_START', ...Object.keys(env)];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try { return f(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const pilot = (extraFor = () => ({})) => profile({ holobots: ['ACE', 'KUMA', 'SHADOW'].map(name => ({ name, level: 10, ...extraFor(name) })) });
function step(s, op, extra = {}, at = T + 1000, receipt) {
  const x = Z.advanceRealtimeExpedition(s.p, s.r, { schemaVersion: 'zone-run-6', operation: op, ...extra }, at, receipt);
  s.p = { ...s.p, ...x.updates }; s.r = x.run; return x;
}
function entered(p = pilot()) {
  const i = Z.issueExpedition(p, { schemaVersion: 'zone-run-6', repairKits: 2, carryExtractionCharge: true }, 'test_run', 1, T, CONFIG);
  const s = { p: { ...p, ...i.updates }, r: i.run };
  step(s, 'move', { sectorId: 'gate1' });
  step(s, 'move', { sectorId: s.r.layout.sectors.find(x => x.band === 1 && !x.safe && x.cache).id });
  return s;
}
const engage = (env, fightRules, p) => withEnv(env, () => {
  const s = entered(p);
  const c = Z.validateExpeditionCommand({ schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'r1', runId: 'test_run', duelInputs: 'duel-inputs-2', ...(fightRules ? { fightRules } : {}) });
  return { s, issue: step(s, 'engage', c).fightIssue };
});
const rid = issue => issue.rulesId.split(':')[0];

test('no ask: the expedition issue is byte-identical to the issue built with the pre-change inputs (every flag set)', () => {
  for (const env of [{}, { HOLOCITY_FIGHT_CHASE: '1' }, FLAGS5, { ...FLAGS5, HOLOCITY_READINESS_START: '1' }]) {
    const { s, issue } = engage(env, undefined);
    // The pre-change engage call, verbatim (expedition.ts before expedition-rules-8): no live / tempo / guard / stamina, hpScaleLights 19.
    const at = s.r.layout.sectors.find(x => x.id === s.r.sectorId);
    const legacy = withEnv(env, () => {
      const R = require('../lib/lib/readinessFight.js'), L = require('../lib/lib/liveMoveRanks.js'), I = require('../lib/rival/fightReplayIssue.js');
      const { playerCombatant } = require('../lib/lib/rivalLadder.js');
      const beast = Z.threat(s.r, at), cpu = playerCombatant('wolf', { name: 'WOLF', level: beast.level });
      const starts = process.env.HOLOCITY_READINESS_START === '1' ? s.r.squad.map(b => R.manualReadinessStart(s.p, b.holobotId, T + 1000)) : undefined;
      return buildFightReplayIssue({ battleId: `ef_${s.r.runId}_${at.id}`, seed: issue.seed, tier: Math.max(0, at.band - 1), mentor: false,
        player: s.r.squad.map(b => I.withLiveMoveRanks({ ...b, currentHealth: Math.floor(b.currentHealth ?? b.maxHealth) }, L.liveMoveRanksFor(s.p, b.holobotId))),
        opponent: [{ ...cpu, currentHealth: beast.currentHealth ?? beast.maxHealth }],
        chase: process.env.HOLOCITY_FIGHT_CHASE === '1', attrs: process.env.HOLOCITY_FIGHT_ATTRS === '1',
        playerStartStaminaPm: Object.fromEntries(s.r.squad.map(b => [b.holobotId, b.staminaPm ?? 1000])), hpScaleLights: 19,
        ...(starts ? { playerStartSync: Object.fromEntries(starts.map(x => [x.holobotId, x.startSync])), cpuStartSync: R.cpuStartSync('champion'), readinessStart: starts } : {}),
        encounter: { kind: 'expedition', runId: s.r.runId, sectorId: at.id, ambush: 'none' } });
    });
    assert.equal(JSON.stringify(issue), JSON.stringify(legacy), JSON.stringify(env));
    assert.ok(!['duel-rules-6', 'duel-rules-7', 'duel-rules-8'].includes(rid(issue)));
  }
  // The checked-in zone-run-6 fixture (generated before this change) still carries no fightRules on any engage request.
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/zone-run-6/realtime.json', import.meta.url)));
  assert.ok(fixture.rows.every(r => !('fightRules' in r.request)));
});

test('each ask (with the rules-5 flags) issues that rules version: rules id, tempo, guard and stamina blocks, live Special', () => {
  const none = engage(FLAGS5, undefined).issue;
  assert.equal(rid(none), 'duel-rules-5'); assert.equal(none.rules.attrs.specialOpenPm, F.defaultAttrRules().specialOpenPm);
  assert.equal(none.rules.rules.hpScaleLights, 19);
  for (const [ask, guard, stamina] of [['duel-rules-6', false, false], ['duel-rules-7', true, false], ['duel-rules-8', true, true]]) {
    const { issue } = engage(FLAGS5, ask);
    assert.equal(rid(issue), ask); assert.equal(issue.rules.schemaVersion, ask);
    assert.deepEqual(issue.rules.tempo, F.defaultTempoRules(), ask);
    assert.equal('guard' in issue.rules, guard, ask); assert.equal('stamina' in issue.rules, stamina, ask);
    if (guard) assert.deepEqual(issue.rules.guard, F.defaultGuardRules());
    if (stamina) assert.deepEqual(issue.rules.stamina, F.STAMINA_DEFAULTS);
    assert.equal(issue.rules.attrs.specialOpenPm, 2000, 'live: the unguarded Special multiplier the live hosts issue');
    assert.equal(issue.rules.rules.hpScaleLights, 17, 'duel-rules-6 TEMPO_RULE_OVERRIDES');
    // expedition specifics are kept: encounter, carried stamina, WOLF CPU, 3-bot squad
    assert.equal(issue.encounter.kind, 'expedition'); assert.equal(issue.cpu.roster[0].holobotId, 'wolf');
    assert.deepEqual(issue.player.roster.map(r => r.holobotId), ['ace', 'kuma', 'shadow']);
    assert.equal(issue.seed, none.seed);
  }
  // Without the rules-5 flags the ask falls back as on the rival / Arena hosts: no tempo, so no guard / stamina (rulesId says so).
  for (const ask of ['duel-rules-6', 'duel-rules-7', 'duel-rules-8']) {
    const off = engage({}, ask).issue, offNone = engage({}, undefined).issue;
    assert.equal(rid(off), rid(offNone)); assert.equal(off.rulesHash, offNone.rulesHash, 'no attrs issued: live changes nothing');
    assert.equal('tempo' in off.rules, false);
  }
});

test('validate: only duel-rules-6/-7/-8 are known; fightRules only on engage', () => {
  const base = { schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'r1', runId: 'test_run', duelInputs: 'duel-inputs-2' };
  for (const ask of ['duel-rules-6', 'duel-rules-7', 'duel-rules-8']) assert.equal(Z.validateExpeditionCommand({ ...base, fightRules: ask }).fightRules, ask);
  for (const bad of ['duel-rules-5', 'duel-rules-9', '', null, 8, ['duel-rules-8']]) assert.throws(() => Z.validateExpeditionCommand({ ...base, fightRules: bad }), /invalid_request/, String(bad));
  assert.throws(() => Z.validateExpeditionCommand({ schemaVersion: 'zone-run-6', operation: 'fight_settle', requestId: 'r', runId: 'test_run', fightId: 'f', inputLog: {}, fightRules: 'duel-rules-8' }), /invalid_request/);
  assert.throws(() => Z.validateExpeditionCommand({ schemaVersion: 'zone-run-6', operation: 'issue', requestId: 'r', repairKits: 0, carryExtractionCharge: false, duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }), /invalid_request/);
});

// Store-level: the real transactExpedition over the in-memory Firestore double, with real replay verification at settle.
const STORE_ENV = { HOLOZONE_EXPEDITION_REALTIME: '1', HOLOCITY_FIGHT_REPLAY: '1', ...FLAGS5 };
async function storeEnv(f) {
  const keys = ['HOLOCITY_FIGHT_CHASE', 'HOLOCITY_FIGHT_ATTRS', 'HOLOCITY_READINESS_START', 'HOLOCITY_BATTLE_IQ', ...Object.keys(STORE_ENV)];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, STORE_ENV);
  try { return await f(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
async function storeRun(p = pilot()) {
  const db = fakeDb({ now: T }), uid = 'exp_r8';
  db.docs.set(`users/${uid}`, { data: structuredClone(p), createdAtMs: T });
  const call = (raw, now) => transactExpedition(db, uid, raw, now, { config: CONFIG, newId: () => 'run_r8', seed: () => 1, signatures: false });
  const issued = await call({ schemaVersion: 'zone-run-6', operation: 'issue', requestId: 'i1', repairKits: 1, carryExtractionCharge: false, duelInputs: 'duel-inputs-2' }, T);
  const runId = issued.run.runId;
  await call({ schemaVersion: 'zone-run-6', operation: 'move', requestId: 'm1', runId, sectorId: 'gate1' }, T + 100);
  const target = issued.run.layout.sectors.find(x => x.band === 1 && !x.safe).id;
  await call({ schemaVersion: 'zone-run-6', operation: 'move', requestId: 'm2', runId, sectorId: target }, T + 200);
  return { db, call, runId };
}
const dump = db => JSON.stringify([...db.docs.entries()].sort(([a], [b]) => a.localeCompare(b)));

test('store: an unknown ask is refused invalid_request with nothing read or written; a known ask then engages', () => storeEnv(async () => {
  const { db, call, runId } = await storeRun();
  const before = dump(db);
  for (const bad of ['duel-rules-9', 'duel-rules-5']) {
    await assert.rejects(call({ schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'e_bad', runId, duelInputs: 'duel-inputs-2', fightRules: bad }, T + 300), e => e.code === 'invalid_request');
  }
  assert.equal(dump(db), before, 'no run, request, energy or user write');
  const ok = await call({ schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'e1', runId, duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }, T + 300);
  assert.equal(rid(ok.fightIssue), 'duel-rules-8');
}));

test('store: a smartPlayer log settles a duel-rules-8 expedition fight with a verified receipt; status/resume return the same issue', () => storeEnv(async () => {
  const { db, call, runId } = await storeRun();
  const eng = await call({ schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'e1', runId, duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }, T + 300);
  const issue = eng.fightIssue;
  assert.equal(rid(issue), 'duel-rules-8'); assert.deepEqual(issue.rules.stamina, F.STAMINA_DEFAULTS);
  const status = await call({ schemaVersion: 'zone-run-6', operation: 'status' }, T + 400);
  assert.deepEqual(status.fightIssue, issue, 'reconnect: status carries the pinned rules-8 issue');
  const log = recordFightLog(issue, smartPlayer(issue));
  const local = verifyFightReplay(issue, log.wire, { battleId: issue.rulesId.split(':')[1] }).receipt;
  assert.equal(local.verified, true);
  const settleAt = T + 300 + Math.ceil(local.endTick * 1000 / 30) + 1000;
  const settled = await call({ schemaVersion: 'zone-run-6', operation: 'fight_settle', requestId: 's1', runId, fightId: local.battleId, inputLog: log.wire }, settleAt);
  assert.equal(settled.fightReceipt.verified, true); assert.equal(settled.fightReceipt.rulesHash, issue.rulesHash);
  assert.equal(settled.fightReceipt.winner, local.winner);
  assert.equal(settled.encounterResult.outcome, local.winner === 'player' ? 'cleared' : 'wipe');
  const stored = db.docs.get(`holoZoneRuns/exp_r8/expeditions/${runId}`).data;
  assert.equal(stored.pendingFight, null); assert.equal(stored.lastFight.receipt.rulesHash, issue.rulesHash);
  // The receipt is on the issue's #72.80 fight-row HP scale; the run keeps its ledger scale (never above max, never above the HP
  // carried in), so the run stays readable for the next call (it used to brick with currentHealth > maxHealth).
  for (const b of stored.squad) {
    const f = settled.fightReceipt.playerFinal.find(x => x.holobotId === b.holobotId);
    assert.ok(b.currentHealth <= b.maxHealth, b.holobotId);
    assert.equal(b.currentHealth, f.currentHealth <= 0 ? 0 : f.maxHealth === b.maxHealth ? f.currentHealth : Math.min(b.maxHealth, Math.ceil(b.maxHealth * f.currentHealth / f.maxHealth)), b.holobotId);
    assert.equal(b.staminaPm, f.staminaPm);
  }
  assert.ok(stored.squad.some(b => settled.fightReceipt.playerFinal.find(x => x.holobotId === b.holobotId).maxHealth !== b.maxHealth), 'fixture exercises the rescale');
  assert.deepEqual(settled.encounterResult.carry.map(c => c.currentHealth), stored.squad.map(b => b.currentHealth));
  const after = await call({ schemaVersion: 'zone-run-6', operation: 'status' }, settleAt + 5);
  assert.equal(after.run.runId, runId);
  // idempotent replay of the settle
  const again = await call({ schemaVersion: 'zone-run-6', operation: 'fight_settle', requestId: 's1', runId, fightId: local.battleId, inputLog: log.wire }, settleAt + 10);
  assert.equal(again.alreadyProcessed, true);
  // A log recorded against a no-ask issue does not verify against the rules-8 issue (different rules hash) - covered by the hash check.
  const noAsk = engage(FLAGS5, undefined).issue;
  assert.notEqual(noAsk.rulesHash, issue.rulesHash);
}));

test('live-move ranks still apply to a rules-8 expedition issue (player side only; rules blocks unchanged)', () => {
  const LMR_FULL = { jab: 3, heavy: 3, guard: 3, dash: 3, special: 3 };
  const liveMoves = ranks => ({ schemaVersion: 'live-moves-1', ranks, carryOver: { spentSp: 0, carriedSp: 0, refundSp: 0 } });
  const before = engage(FLAGS5, 'duel-rules-8').issue;
  const ranked = engage(FLAGS5, 'duel-rules-8', pilot(name => name === 'ACE' ? { liveMoves: liveMoves(LMR_FULL) } : {})).issue;
  const fid = (issue, id) => issue.rules.fighters.find(f => f.id === id);
  const b = fid(before, 'ace'), r = fid(ranked, 'ace');
  assert.equal(r.attack, Math.max(Math.floor(b.attack * 1042 / 1000), b.attack + 2));
  assert.equal(r.defense, Math.max(Math.floor(b.defense * 1021 / 1000), b.defense + 1));
  assert.ok(r.special > b.special);
  for (const k of ['backstepMm', 'sidestepMm', 'forwardJumpMm']) assert.equal(r[k], Math.floor(b[k] * 1150 / 1000), k);
  assert.deepEqual(fid(ranked, 'kuma'), fid(before, 'kuma'));
  assert.deepEqual(fid(ranked, 'cpu-wolf'), fid(before, 'cpu-wolf'));
  const strip = d => { const { fighters, ...rest } = d.rules; return rest; };
  assert.deepEqual(strip(ranked), strip(before)); assert.equal(rid(ranked), 'duel-rules-8');
});

test('zone-run-6 schema: engage accepts the optional fightRules ask (6/7/8) and refuses any other value', async () => {
  const { ajv2020 } = await import('./lib/ajv2020.mjs');
  const ajv = ajv2020();
  for (const n of ['duel-intents-1', 'duel-receipt-1', 'duel-receipt-2', 'zone-extract-1', 'zone-run-3', 'zone-run-6']) ajv.addSchema(JSON.parse(readFileSync(new URL(`../../Schemas/${n}.json`, import.meta.url))));
  const schema = ajv.getSchema('zone-run-6');
  const base = { schemaVersion: 'zone-run-6', operation: 'engage', requestId: 'req1', runId: 'run_1', duelInputs: 'duel-inputs-2' };
  assert.equal(schema(base), true);
  for (const ask of ['duel-rules-6', 'duel-rules-7', 'duel-rules-8']) assert.equal(schema({ ...base, fightRules: ask }), true, JSON.stringify(schema.errors));
  assert.equal(schema({ ...base, fightRules: 'duel-rules-9' }), false);
  const { issue } = engage(FLAGS5, 'duel-rules-8');
  const s = entered(); withEnv(FLAGS5, () => step(s, 'engage', { duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }));
  assert.equal(schema(Z.advanceReply('zone-run-6', 'engage', s.r, { fightIssue: issue }, T + 1000)), true, JSON.stringify(schema.errors));
});
