// PR #67 item 4: producer-default populations for the two locked future zones (tide_hollow, sky_reach), recorded as INERT
// data in lib/holoZonePopulationDrafts.ts. Every gate runs a known-bad control next to its known-good: the shape rule, the
// producer ceiling, inertness (no tier row, no live row, unknown_zone, coverage unchanged), the live Neon Forest v1 / v2
// bytes, the draft JSON <-> TS agreement, and no runtime import of the drafts module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/holoZoneRuns.js');
const W = require('../lib/lib/holoZoneWire.js');
const P = require('../lib/lib/holoZonePopulation.js');
const B = require('../lib/lib/battleSettlement.js');
const D = require('../lib/lib/holoZonePopulationDrafts.js');
const ts = require('typescript');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const DRAFTS_MODULE = path.join(SRC, 'lib', 'holoZonePopulationDrafts.ts');
const DRAFT_JSON = path.join(HERE, '..', '..', 'Documentation', 'DRAFTS', '2026-10-10-future-zone-populations.json');
const POPULATION_TEST = path.join(HERE, 'test-holozone-population.mjs');

const V1 = 'holozone-run-1', V2 = 'holozone-run-2';
const DRAFT_ZONES = ['tide_hollow', 'sky_reach'];
// The four lowercase stable ids Unity's BeastSnapshot.beastId carries (HolobotsUnity StreamingAssets/Samples/encounter-payload.sample.json).
const UNITY_BEAST_IDS = ['scrapling', 'nullstalker', 'cacheback', 'wyrm'];

// The producer defaults (chair lane, 2026-10-11) as the holozone-run-2 `population` each zone would serve once live.
const timer = (delaySeconds, maxRespawns) => ({ kind: 'timer', delaySeconds, maxRespawns });
const TIDE_HOLLOW_T1 = {
  zoneId: 'tide_hollow', tier: 1,
  beasts: [{ beastId: 'cacheback', count: 3, respawn: timer(8, 14) }, { beastId: 'nullstalker', count: 2, respawn: timer(12, 6) }],
  boss: null, spawnCount: 5, maxKillsCredited: 25,
};
const SKY_REACH_T2 = {
  zoneId: 'sky_reach', tier: 2,
  beasts: [{ beastId: 'nullstalker', count: 3, respawn: timer(8, 12) }, { beastId: 'wyrm', count: 2, respawn: timer(15, 8) }],
  boss: null, spawnCount: 5, maxKillsCredited: 25,
};

// The inputs of test-holozone-population.mjs.
const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const ID = '0b9f3c1e-1d2a-4c3b-9a8f-000000000001';
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
];
const issue = () => Z.issueHoloZoneRun([], 'neonforest', ['ace', 'kuma'], ID, T0 - Z.HOLOZONE_MIN_XP_MS);
const settle = (runs) => Z.settleHoloZoneRun({ holobots: bots() }, runs, { runId: ID, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'] }, T0);

// Verbatim copies of test-holozone-population.mjs PINNED_V1 (the byte-identity test checks each is still there, verbatim).
const PINNED_V1 = {
  issue: '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}',
  status: '{"schemaVersion":"holozone-run-1","run":{"runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}}',
  settle: '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","alreadyProcessed":false,"settlement":{"kind":"beast","zoneId":"neonforest","tier":0,"kills":3,"bossDefeated":false,"fielded":["ace","kuma"],"didWin":true,"combosCompleted":3,"perfectDefenses":0,"tableExp":123,"expPerHolobot":123,"expWithheld":false,"settledAtMs":1791309600000},"progression":[{"holobotId":"ace","expGained":123,"levelBefore":4,"levelAfter":4,"attributePoints":1,"experience":1823,"nextLevelExp":2500,"rank":"Starter"},{"holobotId":"kuma","expGained":123,"levelBefore":1,"levelAfter":2,"attributePoints":1,"experience":473,"nextLevelExp":900,"rank":"Starter"}]}',
  statusAfter: '{"schemaVersion":"holozone-run-1","run":null}',
};
// The holozone-run-2 replies for the same inputs, printed by the build of 0ef98cc (before populationFromRow was extracted).
const PINNED_V2 = {
  issue: '{"schemaVersion":"holozone-run-2","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000,"population":{"zoneId":"neonforest","tier":0,"beasts":[{"beastId":"scrapling","count":3,"respawn":{"kind":"timer","delaySeconds":8,"maxRespawns":22}}],"boss":{"bossId":"root_nexus","count":1,"respawn":{"kind":"none"}},"spawnCount":3,"maxKillsCredited":25}}',
  status: '{"schemaVersion":"holozone-run-2","run":{"runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000},"population":{"zoneId":"neonforest","tier":0,"beasts":[{"beastId":"scrapling","count":3,"respawn":{"kind":"timer","delaySeconds":8,"maxRespawns":22}}],"boss":{"bossId":"root_nexus","count":1,"respawn":{"kind":"none"}},"spawnCount":3,"maxKillsCredited":25}}',
  settle: '{"schemaVersion":"holozone-run-2","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","alreadyProcessed":false,"settlement":{"kind":"beast","zoneId":"neonforest","tier":0,"kills":3,"bossDefeated":false,"fielded":["ace","kuma"],"didWin":true,"combosCompleted":3,"perfectDefenses":0,"tableExp":123,"expPerHolobot":123,"expWithheld":false,"settledAtMs":1791309600000},"progression":[{"holobotId":"ace","expGained":123,"levelBefore":4,"levelAfter":4,"attributePoints":1,"experience":1823,"nextLevelExp":2500,"rank":"Starter"},{"holobotId":"kuma","expGained":123,"levelBefore":1,"levelAfter":2,"attributePoints":1,"experience":473,"nextLevelExp":900,"rank":"Starter"}]}',
  statusAfter: '{"schemaVersion":"holozone-run-2","run":null,"population":null}',
};

const draftRows = () => Object.entries(D.HOLOZONE_POPULATION_DRAFTS).flatMap(([zoneId, rows]) => Object.entries(rows).map(([tier, row]) => ({ zoneId, tier: Number(tier), row })));
const mutated = (value, edit) => { const copy = structuredClone(value); edit(copy); return copy; };
const timerReturns = (p) => p.beasts.reduce((n, b) => n + (b.respawn.kind === 'timer' ? b.respawn.maxRespawns : 0), 0);
// The producer ceiling rule: the bodies at entry plus every timed return equal the kills the settle credits.
const ceilingHolds = (p) => p.spawnCount + timerReturns(p) === B.MAX_PERFORMANCE_EVENTS;

test('producer defaults: tide_hollow tier 1 and sky_reach tier 2 are exactly the chair rows, in the holozone-run-2 shape (derived by the live builder); known-bad: a one-value edit no longer matches', () => {
  assert.deepEqual(Object.keys(D.HOLOZONE_POPULATION_DRAFTS), DRAFT_ZONES);
  assert.deepEqual(draftRows().map(({ zoneId, tier }) => [zoneId, tier]), [['tide_hollow', 1], ['sky_reach', 2]]);
  assert.ok(Object.isFrozen(D.HOLOZONE_POPULATION_DRAFTS));
  for (const z of DRAFT_ZONES) assert.ok(Object.isFrozen(D.HOLOZONE_POPULATION_DRAFTS[z]), z);
  assert.deepEqual(D.draftZonePopulation('tide_hollow', 1), TIDE_HOLLOW_T1);
  assert.deepEqual(D.draftZonePopulation('sky_reach', 2), SKY_REACH_T2);
  // The same keys, in the same order, as the live Neon Forest population; the bytes are the live builder's.
  const liveKeys = Object.keys(P.holoZonePopulation('neonforest', 0));
  for (const { zoneId, tier, row } of draftRows()) {
    const p = D.draftZonePopulation(zoneId, tier);
    assert.deepEqual(Object.keys(p), liveKeys, zoneId);
    assert.equal(JSON.stringify(p), JSON.stringify(P.populationFromRow(zoneId, tier, row)), zoneId);
  }
  // A fresh copy each call: mutating a result never touches the drafts.
  const a = D.draftZonePopulation('tide_hollow', 1);
  a.beasts[0].count = 99; a.beasts[0].respawn.maxRespawns = 0; a.beasts.pop();
  assert.deepEqual(D.draftZonePopulation('tide_hollow', 1), TIDE_HOLLOW_T1);
  // No draft for the live zone, another tier, or an inherited key.
  for (const [z, t] of [['neonforest', 0], ['tide_hollow', 2], ['sky_reach', 1], ['toString', 0], ['tide_hollow', 'toString']]) assert.equal(D.draftZonePopulation(z, t), null, `${z}@${t}`);
  // Known-bad: cacheback returns 14 -> 15 is caught by the same comparison.
  assert.equal(isDeepStrictEqual(D.draftZonePopulation('tide_hollow', 1), mutated(TIDE_HOLLOW_T1, (p) => { p.beasts[0].respawn.maxRespawns = 15; })), false);
});

test('shape: every draft row passes validHoloZonePopulationRow with only the four Unity beast ids and no boss; known-bad: beastId "Bad Id" and count 0 fail the rule, an invented id fails the id check', () => {
  for (const { zoneId, tier, row } of draftRows()) {
    assert.ok(P.validHoloZonePopulationRow(row), `${zoneId}@${tier}`);
    for (const b of row.beasts) assert.ok(UNITY_BEAST_IDS.includes(b.beastId), `${zoneId}: ${b.beastId}`);
    assert.equal(row.boss, null, `${zoneId}: no boss is named yet`);
  }
  const row = D.HOLOZONE_POPULATION_DRAFTS.tide_hollow[1];
  assert.equal(P.validHoloZonePopulationRow(mutated(row, (r) => { r.beasts[0].beastId = 'Bad Id'; })), false);
  assert.equal(P.validHoloZonePopulationRow(mutated(row, (r) => { r.beasts[0].count = 0; })), false);
  // Well-formed but invented: the shape rule accepts it, the Unity id check does not.
  for (const id of ['kraken', 'root_nexus']) {
    const invented = mutated(row, (r) => { r.beasts[0].beastId = id; });
    assert.ok(P.validHoloZonePopulationRow(invented), id);
    assert.equal(invented.beasts.every((b) => UNITY_BEAST_IDS.includes(b.beastId)), false, id);
  }
});

test('ceiling: spawnCount + the timed returns == MAX_PERFORMANCE_EVENTS (25) for every draft (5 + 20), the Neon Forest rule (3 + 22); known-bad: maxRespawns 15 (26) and 13 (24) fail', () => {
  assert.equal(B.MAX_PERFORMANCE_EVENTS, 25);
  assert.ok(ceilingHolds(P.holoZonePopulation('neonforest', 0)), 'the live rule');
  for (const { zoneId, tier } of draftRows()) {
    const p = D.draftZonePopulation(zoneId, tier);
    assert.ok(ceilingHolds(p), `${zoneId}@${tier}`);
    assert.deepEqual([p.spawnCount, timerReturns(p), p.maxKillsCredited], [5, 20, B.MAX_PERFORMANCE_EVENTS], zoneId);
  }
  const row = D.HOLOZONE_POPULATION_DRAFTS.tide_hollow[1];
  for (const n of [15, 13]) {
    const bad = P.populationFromRow('tide_hollow', 1, mutated(row, (r) => { r.beasts[0].respawn.maxRespawns = n; }));
    assert.equal(ceilingHolds(bad), false, `maxRespawns ${n}`);
  }
});

test('inert: neither draft zone is in HOLOZONE_ZONE_TIERS or the live table; lookups are null; issue is unknown_zone; coverage unchanged; no reply carries a draft; known-bad: a draft zone injected into a copied table is flagged', () => {
  const liveDraftZones = (tiers, table) => DRAFT_ZONES.filter((z) => Object.hasOwn(tiers, z) || Object.hasOwn(table, z));
  assert.deepEqual(liveDraftZones(Z.HOLOZONE_ZONE_TIERS, P.HOLOZONE_POPULATION_TABLE), []);
  assert.deepEqual(Object.keys(Z.HOLOZONE_ZONE_TIERS), ['neonforest']);
  assert.deepEqual(Object.keys(P.HOLOZONE_POPULATION_TABLE), ['neonforest']);
  for (const z of DRAFT_ZONES) assert.equal(Z.holoZoneTier(z), null, z);
  assert.equal(P.holoZonePopulation('tide_hollow', 1), null);
  assert.equal(P.holoZonePopulation('sky_reach', 2), null);
  const RUN = '0b9f3c1e-1d2a-4c3b-9a8f-000000000002';
  for (const z of DRAFT_ZONES) assert.throws(() => Z.issueHoloZoneRun([], z, ['ace'], RUN, T0), (e) => e instanceof Z.HoloZoneError && e.code === 'unknown_zone', z);
  // Positive control: the same call for the live zone issues, so the throw above is the zone, not the inputs.
  assert.equal(Z.issueHoloZoneRun([], 'neonforest', ['ace'], RUN, T0).reply.zoneId, 'neonforest');
  assert.deepEqual(P.holoZonePopulationCoverage(), [{ zoneId: 'neonforest', tier: 0, covered: true }]);
  // Even a reply naming a draft zone (a forged issue reply, a stored open run) serves no population.
  const i = issue();
  for (const [zoneId, tier] of [['tide_hollow', 1], ['sky_reach', 2]]) {
    assert.equal(W.holoZoneIssueReplyForVersion({ ...i.reply, zoneId, tier }, V2).population, null, zoneId);
    const status = W.holoZoneStatusReplyForVersion(Z.holoZoneStatus([{ ...i.doc.runs[0], zoneId, tier }], T0), V2);
    assert.equal(status.run.zoneId, zoneId);
    assert.equal(status.population, null, zoneId);
  }
  // Known-bad: a draft zone injected into a COPY of either table is flagged (the real tables are never touched) ...
  assert.deepEqual(liveDraftZones({ ...Z.HOLOZONE_ZONE_TIERS, tide_hollow: 1 }, P.HOLOZONE_POPULATION_TABLE), ['tide_hollow']);
  assert.deepEqual(liveDraftZones(Z.HOLOZONE_ZONE_TIERS, { ...P.HOLOZONE_POPULATION_TABLE, sky_reach: D.HOLOZONE_POPULATION_DRAFTS.sky_reach }), ['sky_reach']);
  // ... and a half flip (a tier row without its population row) shows as uncovered, which the live coverage pin refuses.
  const coverageOf = (tiers, table) => Object.entries(tiers).map(([zoneId, tier]) => ({ zoneId, tier, covered: Object.hasOwn(table, zoneId) && Object.hasOwn(table[zoneId], tier) }));
  assert.deepEqual(coverageOf(Z.HOLOZONE_ZONE_TIERS, P.HOLOZONE_POPULATION_TABLE), P.holoZonePopulationCoverage());
  assert.deepEqual(coverageOf({ ...Z.HOLOZONE_ZONE_TIERS, tide_hollow: 1 }, P.HOLOZONE_POPULATION_TABLE).at(-1), { zoneId: 'tide_hollow', tier: 1, covered: false });
  assert.deepEqual(Object.keys(Z.HOLOZONE_ZONE_TIERS), ['neonforest'], 'the copies left the real table alone');
});

test('live Neon Forest: v1 and v2 issue / status / settle replies are byte-identical to the pins (v1 = test-holozone-population.mjs, v2 = the 0ef98cc build); known-bad: tide_hollow flipped live in copied tables, or one live value changed, gives different v2 bytes', () => {
  const source = readFileSync(POPULATION_TEST, 'utf8');
  for (const [k, s] of Object.entries(PINNED_V1)) assert.ok(source.includes(`'${s}'`), `PINNED_V1.${k} is a verbatim copy`);
  const replies = (V) => {
    const i = issue();
    const s = settle(i.doc.runs);
    return {
      issue: JSON.stringify(W.holoZoneIssueReplyForVersion(i.reply, V)),
      status: JSON.stringify(W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(i.doc.runs, T0), V)),
      settle: JSON.stringify(W.holoZoneSettleReplyForVersion(s.reply, V)),
      statusAfter: JSON.stringify(W.holoZoneStatusReplyForVersion(Z.holoZoneStatus(s.doc.runs, T0), V)),
    };
  };
  assert.deepEqual(replies(V1), PINNED_V1);
  assert.deepEqual(replies(V2), PINNED_V2);

  // The v2 issue bytes if `tiers` / `table` were the live tables: the wire's projection over copies (pure).
  const simulateIssueV2 = (tiers, table, zoneId, base) => {
    assert.ok(Object.hasOwn(tiers, zoneId), `${zoneId}: unknown_zone`);
    const tier = tiers[zoneId];
    const row = Object.hasOwn(table, zoneId) && Object.hasOwn(table[zoneId], tier) ? table[zoneId][tier] : null;
    return JSON.stringify({ ...base, zoneId, tier, schemaVersion: V2, population: row ? P.populationFromRow(zoneId, tier, row) : null });
  };
  const base = issue().reply;
  // Fidelity: over the real tables the simulation is exactly the pinned wire bytes.
  assert.equal(simulateIssueV2(Z.HOLOZONE_ZONE_TIERS, P.HOLOZONE_POPULATION_TABLE, 'neonforest', base), PINNED_V2.issue);
  // Known-bad 1: tide_hollow flipped live in COPIES (tier row + table row together) -> different v2 bytes carrying the draft ...
  const tiers = { ...Z.HOLOZONE_ZONE_TIERS, tide_hollow: 1 };
  const table = { ...P.HOLOZONE_POPULATION_TABLE, tide_hollow: D.HOLOZONE_POPULATION_DRAFTS.tide_hollow };
  const flipped = simulateIssueV2(tiers, table, 'tide_hollow', base);
  assert.notEqual(flipped, PINNED_V2.issue);
  assert.deepEqual(JSON.parse(flipped).population, TIDE_HOLLOW_T1);
  // ... while the Neon Forest bytes stay the pin with the draft zone beside it.
  assert.equal(simulateIssueV2(tiers, table, 'neonforest', base), PINNED_V2.issue);
  // Known-bad 2: one live value changed in a COPY (22 -> 21 returns) -> different bytes.
  const nf = P.HOLOZONE_POPULATION_TABLE.neonforest[0];
  const changed = { ...P.HOLOZONE_POPULATION_TABLE, neonforest: { 0: mutated(nf, (r) => { r.beasts[0].respawn.maxRespawns = 21; }) } };
  assert.notEqual(simulateIssueV2(Z.HOLOZONE_ZONE_TIERS, changed, 'neonforest', base), PINNED_V2.issue);
  // Known-bad 3: a pin with one value changed is not found in the source test.
  assert.equal(source.includes(`'${PINNED_V1.issue.replace('"tier":0', '"tier":1')}'`), false);
});

test('draft JSON <-> TS: the rows agree per zone and tier (deep-equal of the derived populations) and the JSON stays inert; known-bad: each in-memory edit of the JSON is caught', () => {
  const doc = JSON.parse(readFileSync(DRAFT_JSON, 'utf8'));
  const mismatches = (d) => {
    const out = [];
    const jsonKeys = d.rows.map((r) => `${r.zoneId}@${r.tier}`).sort();
    const tsKeys = draftRows().map(({ zoneId, tier }) => `${zoneId}@${tier}`).sort();
    if (!isDeepStrictEqual(jsonKeys, tsKeys)) out.push(`zone@tier: json [${jsonKeys}] vs ts [${tsKeys}]`);
    for (const r of d.rows) {
      const fromJson = { zoneId: r.zoneId, tier: r.tier, beasts: r.beasts, boss: r.boss, spawnCount: r.spawnCount, maxKillsCredited: r.maxKillsCredited };
      if (!isDeepStrictEqual(fromJson, D.draftZonePopulation(r.zoneId, r.tier))) out.push(`${r.zoneId}@${r.tier}`);
    }
    return out;
  };
  assert.deepEqual(mismatches(doc), []);
  assert.equal(doc.draftVersion, 2);
  assert.equal(doc.runtimeEnabled, false);
  assert.deepEqual(doc.approvedRuntimeZones, ['neonforest']);
  for (const r of doc.rows) assert.deepEqual([r.state, r.approved, r.sceneName], ['PRODUCER_DEFAULT', false, null], r.zoneId);
  const edits = {
    'returns 14 -> 15': (d) => { d.rows[0].beasts[0].respawn.maxRespawns = 15; },
    'spawnCount 5 -> 6': (d) => { d.rows[0].spawnCount = 6; },
    'maxKillsCredited 25 -> 24': (d) => { d.rows[0].maxKillsCredited = 24; },
    'a boss invented': (d) => { d.rows[0].boss = { bossId: 'root_nexus', count: 1, respawn: { kind: 'none' } }; },
    'tier 2 -> 1': (d) => { d.rows[1].tier = 1; },
    'wyrm -> scrapling': (d) => { d.rows[1].beasts[1].beastId = 'scrapling'; },
    'delay 15 -> 16': (d) => { d.rows[1].beasts[1].respawn.delaySeconds = 16; },
    'a row dropped': (d) => { d.rows.pop(); },
  };
  for (const [name, edit] of Object.entries(edits)) assert.notDeepEqual(mismatches(mutated(doc, edit)), [], name);
});

test('no runtime import: no file under functions/src but the drafts module itself imports it (the TypeScript import scanner); known-bad: the import line in any form is caught by the same scan', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const sources = walk(SRC).filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f));
  const specifiers = (text) => ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
  const importsDrafts = (text) => specifiers(text).some((s) => /(^|\/)holoZonePopulationDrafts(\.[cm]?[jt]s)?$/.test(s));
  assert.ok(sources.includes(DRAFTS_MODULE));
  assert.ok(sources.length >= 60, `scanned ${sources.length} files`);
  assert.deepEqual(sources.filter((f) => f !== DRAFTS_MODULE && importsDrafts(readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f)), []);
  // Positive control: the scanner sees real imports (the wire and the drafts both import the live population module).
  const wire = readFileSync(path.join(SRC, 'lib', 'holoZoneWire.ts'), 'utf8');
  assert.ok(specifiers(wire).includes('./holoZonePopulation'));
  assert.ok(specifiers(readFileSync(DRAFTS_MODULE, 'utf8')).includes('./holoZonePopulation'));
  // Known-bad: the import line, in every form, added to a runtime file's text is caught ...
  for (const line of [
    'import { HOLOZONE_POPULATION_DRAFTS } from "./holoZonePopulationDrafts";',
    "import type { HoloZonePopulationRow } from '../lib/holoZonePopulationDrafts';",
    'export { draftZonePopulation } from "./holoZonePopulationDrafts";',
    'import "./holoZonePopulationDrafts.js";',
    'const D = require("./holoZonePopulationDrafts");',
    'const load = () => import("./holoZonePopulationDrafts");',
  ]) assert.ok(importsDrafts(`${wire}\n${line}\n`), line);
  // ... while a comment or a plain string naming it is not an import.
  assert.equal(importsDrafts(`${wire}\n// lib/holoZonePopulationDrafts.ts is tests-only\nconst note = "holoZonePopulationDrafts";\n`), false);
});
