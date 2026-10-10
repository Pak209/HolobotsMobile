// DECISIONS #54 plan §P1 item 2 domain tests: the zone's beast roster / spawn counts / respawn rule served by zone and
// tier on holozone-run-2 (issue + status), v1 replies byte-identical to the deployed shape, the table's data rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/holoZoneRuns.js');
const W = require('../lib/lib/holoZoneWire.js');
const P = require('../lib/lib/holoZonePopulation.js');
const B = require('../lib/lib/battleSettlement.js');

const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const ID = '0b9f3c1e-1d2a-4c3b-9a8f-000000000001';
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
];
const issue = () => Z.issueHoloZoneRun([], 'neonforest', ['ace', 'kuma'], ID, T0 - Z.HOLOZONE_MIN_XP_MS);
const settle = (runs) => Z.settleHoloZoneRun({ holobots: bots() }, runs, { runId: ID, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'] }, T0);
const V1 = 'holozone-run-1', V2 = 'holozone-run-2';

// The deployed holozone-run-1 replies for the inputs above, as main d5ad1de's rule functions print them (key order included).
const PINNED_V1 = {
  issue: '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}',
  status: '{"schemaVersion":"holozone-run-1","run":{"runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}}',
  settle: '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","alreadyProcessed":false,"settlement":{"kind":"beast","zoneId":"neonforest","tier":0,"kills":3,"bossDefeated":false,"fielded":["ace","kuma"],"didWin":true,"combosCompleted":3,"perfectDefenses":0,"tableExp":123,"expPerHolobot":123,"expWithheld":false,"settledAtMs":1791309600000},"progression":[{"holobotId":"ace","expGained":123,"levelBefore":4,"levelAfter":4,"attributePoints":1,"experience":1823,"nextLevelExp":2500,"rank":"Starter"},{"holobotId":"kuma","expGained":123,"levelBefore":1,"levelAfter":2,"attributePoints":1,"experience":473,"nextLevelExp":900,"rank":"Starter"}]}',
  statusAfter: '{"schemaVersion":"holozone-run-1","run":null}',
};
const NEONFOREST_T0 = {
  zoneId: 'neonforest', tier: 0,
  beasts: [{ beastId: 'scrapling', count: 3, respawn: { kind: 'timer', delaySeconds: 8, maxRespawns: 22 } }],
  boss: { bossId: 'root_nexus', count: 1, respawn: { kind: 'none' } },
  spawnCount: 3, maxKillsCredited: 25,
};

test('table: every zone in HOLOZONE_ZONE_TIERS has a population row for its tier; every row is well-formed; the table is frozen', () => {
  const coverage = P.holoZonePopulationCoverage();
  assert.deepEqual(coverage, Object.entries(Z.HOLOZONE_ZONE_TIERS).map(([zoneId, tier]) => ({ zoneId, tier, covered: true })));
  for (const [zoneId, rows] of Object.entries(P.HOLOZONE_POPULATION_TABLE)) {
    assert.ok(Object.isFrozen(rows), zoneId);
    for (const [tier, row] of Object.entries(rows)) assert.ok(P.validHoloZonePopulationRow(row), `${zoneId} tier ${tier}`);
  }
  assert.ok(Object.isFrozen(P.HOLOZONE_POPULATION_TABLE));
});

test('producer defaults: the Neon Forest at tier 0 fields three Scraplings (8 s, 22 returns: 3 + 22 = the 25 credited kills) and the Root Nexus once', () => {
  const p = P.holoZonePopulation('neonforest', 0);
  assert.deepEqual(p, NEONFOREST_T0);
  assert.equal(p.maxKillsCredited, B.MAX_PERFORMANCE_EVENTS);
  assert.equal(p.spawnCount + p.beasts.reduce((n, b) => n + (b.respawn.kind === 'timer' ? b.respawn.maxRespawns : 0), 0), p.maxKillsCredited, 'the roster never promises more Scrapling kills than the host credits');
  assert.equal(p.beasts[0].beastId, 'scrapling'); assert.equal(p.boss.respawn.kind, 'none');
  // Every beast / boss id obeys the lowercase stable-id rule Unity's BeastSnapshot.beastId uses.
  for (const id of [...p.beasts.map(b => b.beastId), p.boss.bossId]) assert.match(id, P.HOLOZONE_BEAST_ID);
});

test('lookup: a fresh copy each call (mutating a reply never touches the table); unknown zone / tier → null', () => {
  const a = P.holoZonePopulation('neonforest', 0);
  a.beasts[0].count = 99; a.beasts[0].respawn.delaySeconds = 0; a.boss.count = 5; a.beasts.push({ beastId: 'wyrm', count: 1, respawn: { kind: 'none' } });
  assert.deepEqual(P.holoZonePopulation('neonforest', 0), NEONFOREST_T0);
  assert.equal(P.holoZonePopulation('neonforest', 1), null);
  assert.equal(P.holoZonePopulation('crystalcaves', 0), null);
  assert.equal(P.holoZonePopulation('toString', 0), null);
  assert.equal(P.holoZonePopulation('neonforest', 'toString'), null);
});

test('known-bad rows are rejected by the shape rule (the control for the table test)', () => {
  const ok = { beasts: [{ beastId: 'scrapling', count: 1, respawn: { kind: 'timer', delaySeconds: 8, maxRespawns: 24 } }], boss: null };
  assert.ok(P.validHoloZonePopulationRow(ok));
  const bad = [
    { ...ok, beasts: [] },
    { ...ok, beasts: [ok.beasts[0], { ...ok.beasts[0] }] },
    { ...ok, beasts: [{ ...ok.beasts[0], beastId: 'Scrapling' }] },
    { ...ok, beasts: [{ ...ok.beasts[0], beastId: 'has space' }] },
    { ...ok, beasts: [{ ...ok.beasts[0], count: 0 }] },
    { ...ok, beasts: [{ ...ok.beasts[0], count: 1.5 }] },
    { ...ok, beasts: [{ ...ok.beasts[0], respawn: { kind: 'timer', delaySeconds: -1, maxRespawns: 24 } }] },
    { ...ok, beasts: [{ ...ok.beasts[0], respawn: { kind: 'timer', delaySeconds: 8, maxRespawns: 2.5 } }] },
    { ...ok, beasts: [{ ...ok.beasts[0], respawn: { kind: 'timer', delaySeconds: 8, maxRespawns: -1 } }] },
    { ...ok, beasts: [{ ...ok.beasts[0], respawn: { kind: 'random' } }] },
    { ...ok, boss: { bossId: 'ROOT', count: 1, respawn: { kind: 'none' } } },
    { ...ok, boss: { bossId: 'root_nexus', count: 0, respawn: { kind: 'none' } } },
  ];
  for (const row of bad) assert.equal(P.validHoloZonePopulationRow(row), false, JSON.stringify(row));
});

test('requests: holozone-run-2 is accepted and carried on the command; missing = v1; any other version is invalid_request', () => {
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'status' }), { operation: 'status', schemaVersion: V1 });
  assert.deepEqual(Z.validateHoloZoneCommand({ schemaVersion: V2, operation: 'status' }), { operation: 'status', schemaVersion: V2 });
  assert.deepEqual(Z.validateHoloZoneCommand({ schemaVersion: V2, operation: 'issue', zoneId: 'neonforest' }), { operation: 'issue', zoneId: 'neonforest', schemaVersion: V2 });
  assert.equal(Z.validateHoloZoneCommand({ schemaVersion: V2, operation: 'settle', runId: ID, kills: 1, bossDefeated: false, fielded: [] }).schemaVersion, V2);
  for (const v of ['holozone-run-3', 'holozone-run-0', 'rival-battle-3', 2, null, '']) {
    assert.throws(() => Z.validateHoloZoneCommand({ schemaVersion: v, operation: 'status' }), /invalid_request/, JSON.stringify(v));
  }
});

test('v1 replies are byte-identical to the deployed holozone-run-1 shape (pinned strings, key order included)', () => {
  const i = issue();
  assert.equal(JSON.stringify(W.holoZoneIssueReplyForVersion(i.reply, V1)), PINNED_V1.issue);
  assert.equal(JSON.stringify(W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(i.doc.runs, T0), V1)), PINNED_V1.status);
  const s = settle(i.doc.runs);
  assert.equal(JSON.stringify(W.holoZoneSettleReplyForVersion(s.reply, V1)), PINNED_V1.settle);
  assert.equal(JSON.stringify(W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(s.doc.runs, T0), V1)), PINNED_V1.statusAfter);
  // v1 is the identity: the very object the rules produced, no copy, no added key.
  assert.equal(W.holoZoneIssueReplyForVersion(i.reply, V1), i.reply);
  assert.equal('population' in W.holoZoneIssueReplyForVersion(i.reply, V1), false);
});

test('v2: issue adds population (= the table for the issued zone and tier); status adds the open run\'s population, null once settled; settle is the v1 reply under v2', () => {
  const i = issue();
  const v2 = W.holoZoneIssueReplyForVersion(i.reply, V2);
  assert.equal(v2.schemaVersion, V2);
  assert.deepEqual(Object.keys(v2), [...Object.keys(i.reply), 'population']);
  assert.deepEqual(v2.population, P.holoZonePopulation('neonforest', 0));
  assert.deepEqual(v2.population, NEONFOREST_T0);
  const st = W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(i.doc.runs, T0), V2);
  assert.equal(st.schemaVersion, V2); assert.deepEqual(st.run, i.reply.run ?? Z.viewOf(i.doc.runs[0])); assert.deepEqual(st.population, NEONFOREST_T0);
  const s = settle(i.doc.runs);
  const sv2 = W.holoZoneSettleReplyForVersion(s.reply, V2);
  assert.deepEqual(sv2, { ...s.reply, schemaVersion: V2 });
  assert.equal('population' in sv2, false);
  const after = W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(s.doc.runs, T0), V2);
  assert.deepEqual(after, { schemaVersion: V2, run: null, population: null });
  // Expired / no open run: population null, never a throw.
  assert.deepEqual(W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(i.doc.runs, T0 + Z.HOLOZONE_RUN_TTL_MS * 2), V2), { schemaVersion: V2, run: null, population: null });
});

test('control: the v2 bytes differ from the pinned v1 only by the version and the added population (strip them → the v1 bytes)', () => {
  const i = issue();
  const v2 = W.holoZoneIssueReplyForVersion(i.reply, V2);
  const text = JSON.stringify(v2);
  assert.notEqual(text, PINNED_V1.issue);
  const { population: _p, ...rest } = v2;
  assert.equal(JSON.stringify({ ...rest, schemaVersion: V1 }), PINNED_V1.issue);
  assert.deepEqual(W.HOLOZONE_V2_REPLY_FIELDS, ['population']);
  // A key-order-only change to the v1 reply would be caught by the pin (known-bad).
  const reordered = { runId: i.reply.runId, schemaVersion: i.reply.schemaVersion, zoneId: i.reply.zoneId, tier: i.reply.tier, squad: i.reply.squad, issuedAtMs: i.reply.issuedAtMs, expiresAtMs: i.reply.expiresAtMs };
  assert.notEqual(JSON.stringify(reordered), PINNED_V1.issue);
});

test('a zone with no population row still issues (population null), the run is otherwise the same', () => {
  const saved = P.HOLOZONE_POPULATION_TABLE;
  const i = issue();
  const reply = { ...i.reply, zoneId: 'neonforest', tier: 7 }; // a tier the table has no row for (the zone tier table says 0; simulate a re-tiered zone)
  const v2 = W.holoZoneIssueReplyForVersion(reply, V2);
  assert.equal(v2.population, null);
  assert.deepEqual({ ...v2, population: undefined, schemaVersion: V1 }, { ...reply, population: undefined });
  assert.equal(P.HOLOZONE_POPULATION_TABLE, saved);
});
