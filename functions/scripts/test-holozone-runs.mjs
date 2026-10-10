// DECISIONS #53 amendment 1 domain tests: HoloZone (Error Beast) runs — server-issued run ids, the zone → tier
// table, the beast mappings onto the one battle table, once-per-runId settlement, the anti-farm rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/holoZoneRuns.js');
const B = require('../lib/lib/battleSettlement.js');
const P = require('../lib/lib/progression.js');

const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
let k = 0;
const uuid = () => `0b9f3c1e-1d2a-4c3b-9a8f-${String(++k).padStart(12, '0')}`;
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
  { name: 'WOLF', level: 12, experience: 16000, nextLevelExp: 16900, attributePoints: 4 },
];
const profile = (extra = {}) => ({ holobots: bots(), ...extra });
const issue = (runs, squad = ['ace', 'kuma'], now = T0 - Z.HOLOZONE_MIN_XP_MS, zoneId = 'neonforest') => Z.issueHoloZoneRun(runs, zoneId, squad, uuid(), now);
const settle = (p, runs, runId, kills, bossDefeated, fielded, now = T0) => { const s = Z.settleHoloZoneRun(p, runs, { runId, kills, bossDefeated, fielded }, now); Object.assign(p, s.userUpdates); return s; };
const RUN_KEYS = ['expiresAtMs', 'issuedAtMs', 'runId', 'squad', 'tier', 'zoneId'];
const SETTLEMENT_KEYS = ['bossDefeated', 'combosCompleted', 'didWin', 'expPerHolobot', 'expWithheld', 'fielded', 'kills', 'kind', 'perfectDefenses', 'settledAtMs', 'tableExp', 'tier', 'zoneId'];

test('requests: status / issue{zoneId} / settle{runId, kills, bossDefeated, fielded}; everything else invalid_request', () => {
  const id = uuid();
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'status' }), { operation: 'status', schemaVersion: 'holozone-run-1' });
  assert.deepEqual(Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-1', operation: 'issue', zoneId: 'neonforest' }), { operation: 'issue', zoneId: 'neonforest', schemaVersion: 'holozone-run-1' });
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'settle', runId: id, kills: 3, bossDefeated: false, fielded: ['ace'] }), { operation: 'settle', runId: id, kills: 3, bossDefeated: false, fielded: ['ace'], schemaVersion: 'holozone-run-1' });
  const settleOf = (over) => ({ operation: 'settle', runId: id, kills: 0, bossDefeated: false, fielded: [], ...over });
  for (const bad of [null, [], 'status', { operation: 'grant' }, { operation: 'status', schemaVersion: 'holozone-run-3' }, { operation: 'issue' }, { operation: 'issue', zoneId: 'Neon Forest' }, { operation: 'issue', zoneId: 7 },
    settleOf({ runId: 'rb_1' }), settleOf({ runId: id.toUpperCase() }), settleOf({ kills: -1 }), settleOf({ kills: 1.5 }), settleOf({ kills: '3' }), settleOf({ kills: 2 ** 53 }), settleOf({ bossDefeated: 1 }),
    settleOf({ fielded: undefined }), settleOf({ fielded: 'ace' }), settleOf({ fielded: ['ace', 'ace'] }), settleOf({ fielded: ['ACE'] }), settleOf({ fielded: ['ace', 'kuma', 'wolf', 'hare'] })]) {
    assert.throws(() => Z.validateHoloZoneCommand(bad), /invalid_request/, JSON.stringify(bad));
  }
});

test('zone → tier table is server data: neonforest = 0; an unlisted zone is unknown_zone', () => {
  assert.deepEqual({ ...Z.HOLOZONE_ZONE_TIERS }, { neonforest: 0 });
  assert.equal(Z.holoZoneTier('neonforest'), 0); assert.equal(Z.holoZoneTier('toString'), null); assert.equal(Z.holoZoneTier('crystalcaves'), null);
  assert.throws(() => issue([], ['ace'], T0, 'crystalcaves'), /unknown_zone/);
  assert.ok(Object.isFrozen(Z.HOLOZONE_ZONE_TIERS));
});

test('mappings: didWin = kills >= 1 || boss; combos = min(kills, 25); perfectDefenses = boss ? 5 : 0; the one battle table', () => {
  assert.deepEqual(Z.beastSettlementInput(0, 0, false), { kind: 'beast', tier: 0, didWin: false, combosCompleted: 0, perfectDefenses: 0 });
  assert.deepEqual(Z.beastSettlementInput(0, 1, false), { kind: 'beast', tier: 0, didWin: true, combosCompleted: 1, perfectDefenses: 0 });
  assert.deepEqual(Z.beastSettlementInput(2, 40, true), { kind: 'beast', tier: 2, didWin: true, combosCompleted: 25, perfectDefenses: 5 });
  assert.deepEqual(Z.beastSettlementInput(0, 0, true), { kind: 'beast', tier: 0, didWin: true, combosCompleted: 0, perfectDefenses: 5 });
  // Tier 0 numbers: loss 28, 3 kills 123, boss only 118, 25+ kills + boss 356.
  for (const [kills, boss, exp] of [[0, false, 28], [1, false, 104], [3, false, 123], [0, true, 118], [25, true, 356], [999, true, 356]]) {
    assert.equal(B.computeBattleSettlement(Z.beastSettlementInput(0, kills, boss)).exp, exp, `${kills}/${boss}`);
  }
});

test('issue → settle → replay: every fielded bot gets the table EXP once; the replay returns the stored ruling and writes nothing', () => {
  const p = profile();
  const i = issue([]);
  assert.deepEqual(Object.keys(i.reply).sort(), ['schemaVersion', ...RUN_KEYS].sort());
  assert.equal(i.reply.schemaVersion, 'holozone-run-1'); assert.equal(i.reply.zoneId, 'neonforest'); assert.equal(i.reply.tier, 0);
  assert.deepEqual(i.reply.squad, ['ace', 'kuma']); assert.equal(i.reply.expiresAtMs - i.reply.issuedAtMs, Z.HOLOZONE_RUN_TTL_MS);
  assert.deepEqual(Z.holoZoneStatus(i.doc.runs, T0).run, { runId: i.reply.runId, zoneId: 'neonforest', tier: 0, squad: ['ace', 'kuma'], issuedAtMs: i.reply.issuedAtMs, expiresAtMs: i.reply.expiresAtMs });
  const s = settle(p, i.doc.runs, i.reply.runId, 3, false, ['ace', 'kuma']);
  assert.equal(s.reply.alreadyProcessed, false);
  assert.deepEqual(Object.keys(s.reply).sort(), ['alreadyProcessed', 'progression', 'runId', 'schemaVersion', 'settlement']);
  assert.deepEqual(Object.keys(s.reply.settlement).sort(), SETTLEMENT_KEYS);
  assert.deepEqual(s.reply.settlement, { kind: 'beast', zoneId: 'neonforest', tier: 0, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'], didWin: true, combosCompleted: 3, perfectDefenses: 0, tableExp: 123, expPerHolobot: 123, expWithheld: false, settledAtMs: T0 });
  assert.deepEqual(s.reply.progression, [
    { holobotId: 'ace', expGained: 123, levelBefore: 4, levelAfter: 4, attributePoints: 1, experience: 1823, nextLevelExp: 2500, rank: 'Starter' },
    { holobotId: 'kuma', expGained: 123, levelBefore: 1, levelAfter: 2, attributePoints: 1, experience: 473, nextLevelExp: 900, rank: 'Starter' },
  ]);
  assert.deepEqual(p.holobots[0], P.applyHolobotExperience(bots()[0], 123)); assert.deepEqual(p.holobots[0].career, { workouts: 2 }); assert.deepEqual(p.holobots[2], bots()[2]);
  assert.equal(Z.holoZoneStatus(s.doc.runs, T0).run, null, 'a settled run is not open');
  const d = settle(p, s.doc.runs, i.reply.runId, 25, true, ['ace'], T0 + 5000);
  assert.equal(d.reply.alreadyProcessed, true); assert.equal(d.doc, null); assert.deepEqual(d.userUpdates, {});
  assert.deepEqual(d.reply.settlement, s.reply.settlement); assert.deepEqual(d.reply.progression, s.reply.progression);
  // A settled run replays even after its expiry.
  assert.equal(settle(p, s.doc.runs, i.reply.runId, 0, false, [], T0 + Z.HOLOZONE_RUN_TTL_MS * 2).reply.alreadyProcessed, true);
});

test('zero kills, no boss = the loss amount; a boss kill wins with 5 perfect defenses', () => {
  const p = profile();
  const i = issue([], ['ace']);
  const s = settle(p, i.doc.runs, i.reply.runId, 0, false, ['ace']);
  assert.equal(s.reply.settlement.didWin, false); assert.equal(s.reply.settlement.tableExp, 28); assert.equal(s.reply.progression[0].expGained, 28); assert.equal(p.holobots[0].experience, 1728);
  const q = profile();
  const j = issue([], ['ace']);
  const b = settle(q, j.doc.runs, j.reply.runId, 0, true, ['ace']);
  assert.equal(b.reply.settlement.didWin, true); assert.equal(b.reply.settlement.perfectDefenses, 5); assert.equal(b.reply.progression[0].expGained, 118);
});

test('anti-farm: a run settled < 20 s after issue settles but earns 0; EXP Booster doubles otherwise', () => {
  const p = profile();
  const i = issue([], ['ace'], T0 - Z.HOLOZONE_MIN_XP_MS + 1);
  const s = settle(p, i.doc.runs, i.reply.runId, 25, true, ['ace']);
  assert.equal(s.reply.alreadyProcessed, false); assert.equal(s.reply.settlement.expWithheld, true); assert.equal(s.reply.settlement.expPerHolobot, 0); assert.equal(s.reply.settlement.tableExp, 356);
  assert.deepEqual(s.reply.progression, [{ holobotId: 'ace', expGained: 0, levelBefore: 4, levelAfter: 4, attributePoints: 1, experience: 1700, nextLevelExp: 2500, rank: 'Starter' }]);
  assert.deepEqual(s.userUpdates, {}); assert.deepEqual(p.holobots, bots());
  assert.equal(Z.holoZoneStatus(s.doc.runs, T0).run, null, 'the withheld run is settled (no second try)');
  const q = profile({ expBoosterActiveUntil: T0 + 1 });
  const j = issue([], ['ace']);
  assert.equal(settle(q, j.doc.runs, j.reply.runId, 3, false, ['ace']).reply.progression[0].expGained, 246);
  const r = profile({ expBoosterActiveUntil: T0 });
  const h = issue([], ['ace']);
  assert.equal(settle(r, h.doc.runs, h.reply.runId, 3, false, ['ace']).reply.progression[0].expGained, 123);
});

test('refusals write nothing: unknown run, expired, superseded, fielded outside the squad, fielded bot no longer owned', () => {
  const p = profile();
  const i = issue([], ['ace', 'kuma']);
  assert.throws(() => settle(p, i.doc.runs, uuid(), 1, false, ['ace']), /unknown_run/);
  assert.throws(() => settle(p, i.doc.runs, i.reply.runId, 1, false, ['ace'], i.reply.expiresAtMs + 1), /run_expired/);
  assert.equal(settle(structuredClone(p), i.doc.runs, i.reply.runId, 1, false, ['ace'], i.reply.expiresAtMs).reply.alreadyProcessed, false, 'expiresAtMs itself still settles');
  assert.throws(() => settle(p, i.doc.runs, i.reply.runId, 1, false, ['wolf']), /invalid_request/, 'owned but not in the run squad');
  assert.throws(() => settle(p, i.doc.runs, i.reply.runId, 1, false, ['ace', 'hare']), /invalid_request/);
  assert.throws(() => settle({ holobots: [bots()[1]] }, i.doc.runs, i.reply.runId, 1, false, ['ace']), /unavailable/, 'ACE left the profile');
  assert.deepEqual(p.holobots, bots());
  // A second issue supersedes the open run: it can no longer settle; status shows the new one.
  const j = issue(i.doc.runs, ['ace'], T0 - 1000);
  assert.equal(j.doc.runs.length, 2); assert.equal(j.doc.runs[0].closedAtMs, T0 - 1000);
  assert.throws(() => settle(p, j.doc.runs, i.reply.runId, 1, false, ['ace']), /run_closed/);
  assert.equal(Z.holoZoneStatus(j.doc.runs, T0).run.runId, j.reply.runId);
  assert.equal(Z.holoZoneStatus(j.doc.runs, j.reply.expiresAtMs + 1).run, null, 'expired = not open');
  // An empty fielded list settles the run with no XP.
  const e = settle(p, j.doc.runs, j.reply.runId, 4, false, []);
  assert.deepEqual(e.reply.progression, []); assert.equal(e.reply.settlement.expPerHolobot, 0); assert.deepEqual(e.userUpdates, {});
});

test('storage keeps the last 10 runs; a malformed stored doc fails closed', () => {
  let runs = [];
  const ids = [];
  for (let t = 0; t < 14; t++) { const i = issue(runs, ['ace'], T0 + t); runs = i.doc.runs; ids.push(i.reply.runId); }
  assert.equal(runs.length, Z.HOLOZONE_MAX_STORED_RUNS); assert.deepEqual(runs.map(r => r.runId), ids.slice(-10));
  assert.equal(runs.filter(r => r.closedAtMs === null).length, 1, 'at most one open run');
  assert.deepEqual(Z.readHoloZoneRuns(undefined), []);
  assert.deepEqual(Z.readHoloZoneRuns({ schemaVersion: 'holozone-runs-1', runs }), runs);
  for (const bad of [{}, { schemaVersion: 'holozone-runs-1' }, { schemaVersion: 'holozone-runs-1', runs: [{ runId: 1 }] }, { schemaVersion: 'x', runs: [] }]) assert.throws(() => Z.readHoloZoneRuns(bad), /unavailable/);
  assert.throws(() => Z.issueHoloZoneRun(runs, 'neonforest', ['ace'], 'not-a-uuid', T0), /unavailable/);
  assert.throws(() => Z.issueHoloZoneRun(runs, 'neonforest', ['ace'], ids.at(-1), T0), /unavailable/, 'a run id is never reused');
});
