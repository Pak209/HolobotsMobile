// DECISIONS #53 amendment 4 + #54 amendment 2 (rival-health-1 on the zone) domain tests: the zone host on the ONE host-owned
// health ledger the deployed rival host writes (lib/rivalHealth.ts, users/{uid}.holobotVitals) — playerCombatants with
// currentHealth on a flagged issue, the issue write, reports settled at or below what was issued, replays and refusals
// writing nothing, carry between the rival host and the zone host, every reply without the flag byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/holoZoneRuns.js');
const W = require('../lib/lib/holoZoneWire.js');
const H = require('../lib/lib/rivalHealth.js');
const L = require('../lib/lib/rivalLadder.js');

const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const FLAG = 'rival-health-1';
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
];
const profile = (extra = {}) => ({ holobots: bots(), ...extra });
let k = 0;
const uuid = () => `0b9f3c1e-1d2a-4c3b-9a8f-${String(++k).padStart(12, '0')}`;
const issue = (p, flagged, runs = [], squad = ['ace', 'kuma'], now = T0 - Z.HOLOZONE_MIN_XP_MS) => { const r = Z.issueHoloZoneRun(runs, 'neonforest', squad, uuid(), now, flagged ? { profile: p } : undefined); Object.assign(p, r.userUpdates); return r; };
const settle = (p, runs, runId, kills, boss, fielded, health, now = T0) => { const s = Z.settleHoloZoneRun(p, runs, { runId, kills, bossDefeated: boss, fielded, ...(health === undefined ? {} : { health }) }, now); Object.assign(p, s.userUpdates); return s; };
const ACE_MAX = 192, KUMA_MAX = 200; // getPlayerBattleStats for the fixtures (the rival-battle-3 playerCombatants' maxHealth)
const V1_ISSUE_KEYS = ['schemaVersion', 'runId', 'zoneId', 'tier', 'squad', 'issuedAtMs', 'expiresAtMs'];

test('requests: healthSchema absent / "rival-health-1" / anything else; health[] needs the flag; the rival host\'s row rule (lib/rivalHealth.ts healthRows)', () => {
  const id = uuid();
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG }), { operation: 'issue', zoneId: 'neonforest', schemaVersion: 'holozone-run-1', healthSchema: FLAG });
  assert.deepEqual(Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-2', operation: 'status', healthSchema: FLAG }), { operation: 'status', schemaVersion: 'holozone-run-2', healthSchema: FLAG });
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'issue', zoneId: 'neonforest' }), { operation: 'issue', zoneId: 'neonforest', schemaVersion: 'holozone-run-1' });
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'settle', runId: id, kills: 1, bossDefeated: false, fielded: ['ace'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 3 }] }),
    { operation: 'settle', runId: id, kills: 1, bossDefeated: false, fielded: ['ace'], schemaVersion: 'holozone-run-1', healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 3 }] });
  assert.deepEqual(Z.validateHoloZoneCommand({ operation: 'settle', runId: id, kills: 1, bossDefeated: false, fielded: [], healthSchema: FLAG }), { operation: 'settle', runId: id, kills: 1, bossDefeated: false, fielded: [], schemaVersion: 'holozone-run-1', healthSchema: FLAG });
  const settleOf = (over) => ({ operation: 'settle', runId: id, kills: 0, bossDefeated: false, fielded: [], ...over });
  for (const bad of [
    { operation: 'status', healthSchema: 'rival-health-2' }, { operation: 'issue', zoneId: 'neonforest', healthSchema: '' }, { operation: 'issue', zoneId: 'neonforest', healthSchema: null },
    settleOf({ health: [] }), settleOf({ health: [{ holobotId: 'ace', currentHealth: 1 }] }),
    settleOf({ healthSchema: FLAG, health: 'ace' }), settleOf({ healthSchema: FLAG, health: [null] }), settleOf({ healthSchema: FLAG, health: [{ holobotId: 'ace' }] }),
    settleOf({ healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: -1 }] }), settleOf({ healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: NaN }] }),
    settleOf({ healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 1, amount: 99 }] }), settleOf({ healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 1 }, { holobotId: 'ace', currentHealth: 2 }] }),
    settleOf({ healthSchema: FLAG, health: [{ holobotId: 'a', currentHealth: 1 }, { holobotId: 'b', currentHealth: 1 }, { holobotId: 'c', currentHealth: 1 }, { holobotId: 'd', currentHealth: 1 }] }),
  ]) assert.throws(() => Z.validateHoloZoneCommand(bad), /invalid_request/, JSON.stringify(bad));
});

test('issue with the flag: playerCombatants carry currentHealth, the ledger write is exactly the rival issue\'s (issueVitals), the record keeps the issued values; without the flag nothing changes', () => {
  const p = profile();
  const plain = issue(p, false);
  assert.deepEqual(Object.keys(plain.reply), V1_ISSUE_KEYS); assert.deepEqual(plain.userUpdates, {}); assert.equal('healthSchema' in plain.doc.runs[0], false); assert.equal('holobotVitals' in p, false);
  const i = issue(p, true, plain.doc.runs);
  assert.deepEqual(Object.keys(i.reply), [...V1_ISSUE_KEYS, 'playerCombatants']);
  assert.deepEqual(i.reply.playerCombatants.map(c => [c.holobotId, c.maxHealth, c.currentHealth]), [['ace', ACE_MAX, ACE_MAX], ['kuma', KUMA_MAX, KUMA_MAX]], 'a bot never seen is at full health');
  assert.deepEqual(Object.keys(i.reply.playerCombatants[0]).sort(), ['attack', 'attributePoints', 'boostedAttributes', 'commandRules', 'currentHealth', 'defense', 'deployment', 'experience', 'holobotId', 'intelligence', 'level', 'maxHealth', 'maxStamina', 'moves', 'nextLevelExp', 'rank', 'speed', 'staminaRegen'], 'the rival-battle-3 player shape + currentHealth');
  const expectedVitals = H.issueVitals(profile(), L.buildPlayerCombatants(profile(), ['ace', 'kuma']));
  assert.deepEqual(i.userUpdates, { holobotVitals: expectedVitals }, 'the ledger write = the rival issue\'s');
  assert.deepEqual(p.holobotVitals, { ace: { currentHealth: ACE_MAX, maxHealth: ACE_MAX }, kuma: { currentHealth: KUMA_MAX, maxHealth: KUMA_MAX } });
  const rec = i.doc.runs[i.doc.runs.length - 1];
  assert.equal(rec.healthSchema, FLAG); assert.deepEqual(rec.issuedVitals, p.holobotVitals);
  assert.deepEqual(Z.readHoloZoneRuns(i.doc)[i.doc.runs.length - 1].issuedVitals, rec.issuedVitals, 'stored records with the new fields still read');
  // A ledger value is served and clamped to the current max; the host's recovery at zero (40 %) is the rival issue's policy, unchanged here.
  const q = profile({ holobotVitals: { ace: { currentHealth: 30, maxHealth: 100 }, kuma: { currentHealth: 0, maxHealth: 300 } } });
  const j = issue(q, true);
  assert.deepEqual(j.reply.playerCombatants.map(c => c.currentHealth), [30, KUMA_MAX * 0.4]);
  assert.deepEqual(j.reply.playerCombatants.map(c => c.currentHealth), [H.issueVitals(profile({ holobotVitals: { ace: { currentHealth: 30, maxHealth: 100 } } }), [{ holobotId: 'ace', maxHealth: ACE_MAX }]).ace.currentHealth, H.issueVitals(profile({ holobotVitals: { kuma: { currentHealth: 0, maxHealth: 300 } } }), [{ holobotId: 'kuma', maxHealth: KUMA_MAX }]).kuma.currentHealth]);
  // A tampered ledger fails closed on a flagged issue (unavailable) and is ignored by a plain one.
  const t = profile({ holobotVitals: { ace: { currentHealth: 9999, maxHealth: 192 } } });
  assert.throws(() => issue(t, true), /unavailable/);
  assert.deepEqual(Object.keys(issue(t, false).reply), V1_ISSUE_KEYS);
  // The v2 projection carries the combatants through and adds population; a v1 projection is the identity.
  const v2 = W.holoZoneIssueReplyForVersion(i.reply, 'holozone-run-2');
  assert.deepEqual(Object.keys(v2), [...V1_ISSUE_KEYS, 'playerCombatants', 'population']); assert.equal(W.holoZoneIssueReplyForVersion(i.reply, 'holozone-run-1'), i.reply);
});

test('settle with reports: kept at or below the issued value with the ruling; inflated / foreign / unflagged-run reports refuse the whole settle and write nothing; replays never write', () => {
  const p = profile();
  const i = issue(p, true);
  const runId = i.reply.runId;
  const before = structuredClone(p);
  for (const health of [[{ holobotId: 'ace', currentHealth: ACE_MAX + 1 }], [{ holobotId: 'wolf', currentHealth: 2 }], [{ holobotId: 'ace', currentHealth: 1 }, { holobotId: 'hare', currentHealth: 1 }]]) {
    assert.throws(() => settle(p, i.doc.runs, runId, 3, false, ['ace', 'kuma'], health), /invalid_request/, JSON.stringify(health));
  }
  assert.deepEqual(p, before, 'a refused settle writes nothing (XP included)');
  const s = settle(p, i.doc.runs, runId, 3, false, ['ace', 'kuma'], [{ holobotId: 'ace', currentHealth: 12 }, { holobotId: 'kuma', currentHealth: 160 }]);
  assert.deepEqual(s.userUpdates.holobotVitals, { ace: { currentHealth: 12, maxHealth: ACE_MAX }, kuma: { currentHealth: 160, maxHealth: KUMA_MAX } });
  assert.equal(s.userUpdates.holobots.length, 2, 'XP and health land in the same update');
  assert.equal(s.reply.settlement.expPerHolobot, 123, 'the ruling is unchanged');
  assert.deepEqual(Object.keys(s.reply).sort(), ['alreadyProcessed', 'progression', 'runId', 'schemaVersion', 'settlement'], 'nothing health-related on the reply (the rival host\'s rule)');
  assert.equal(JSON.stringify(s.doc.runs[0].settlement).includes('health'), false, 'nothing health-related on the settlement');
  // A replay (any body, with or without reports) writes nothing.
  const d = settle(p, s.doc.runs, runId, 0, false, [], [{ holobotId: 'ace', currentHealth: 0 }], T0 + 1);
  assert.equal(d.reply.alreadyProcessed, true); assert.deepEqual(d.userUpdates, {}); assert.equal(p.holobotVitals.ace.currentHealth, 12);
  // Reports only ever lower the ledger: a second settle of a NEW run at a higher value than the ledger is still bounded by the ledger (min).
  const i2 = issue(p, true, s.doc.runs, ['ace']);
  assert.equal(i2.reply.playerCombatants[0].currentHealth, 12);
  const s2 = settle(p, i2.doc.runs, i2.reply.runId, 1, false, ['ace'], [{ holobotId: 'ace', currentHealth: 12 }]);
  assert.equal(s2.userUpdates.holobotVitals.ace.currentHealth, 12);
  // Reports on a run issued WITHOUT the flag: invalid_request, nothing written.
  const i3 = issue(p, false, s2.doc.runs, ['ace']);
  const before3 = structuredClone(p);
  assert.throws(() => settle(p, i3.doc.runs, i3.reply.runId, 1, false, ['ace'], [{ holobotId: 'ace', currentHealth: 1 }]), /invalid_request/);
  assert.deepEqual(p, before3);
  // A flagged settle with no reports (the flag alone) rules as before and touches no ledger.
  const s3 = settle(p, i3.doc.runs, i3.reply.runId, 1, false, ['ace'], undefined);
  assert.equal('holobotVitals' in s3.userUpdates, false); assert.equal(s3.reply.alreadyProcessed, false);
});

test('carry across hosts through the one ledger: the rival host\'s settle is what the zone issue serves, and the zone settle is what the rival issue serves', () => {
  const p = profile();
  // Town: the deployed rival host issues (issueVitals) and settles (settleVitals) ace at 30.
  const rivalPlayers = L.buildPlayerCombatants(p, ['ace', 'kuma']);
  p.holobotVitals = H.issueVitals(p, rivalPlayers);
  const issuedByRival = Object.fromEntries(rivalPlayers.map(c => [c.holobotId, p.holobotVitals[c.holobotId]]));
  p.holobotVitals = H.settleVitals(p, issuedByRival, [{ holobotId: 'ace', currentHealth: 30 }]);
  // The zone issue serves 30, the zone settle takes ace to 12.
  const i = issue(p, true);
  assert.deepEqual(i.reply.playerCombatants.map(c => c.currentHealth), [30, KUMA_MAX]);
  settle(p, i.doc.runs, i.reply.runId, 2, true, ['ace', 'kuma'], [{ holobotId: 'ace', currentHealth: 12 }]);
  // Back in town: the rival issue (the deployed function) serves 12; a report above 12 is refused by the rival host's own rule.
  const back = H.issueVitals(p, L.buildPlayerCombatants(p, ['ace']));
  assert.equal(back.ace.currentHealth, 12);
  assert.throws(() => H.settleVitals({ ...p, holobotVitals: back }, { ace: back.ace }, [{ holobotId: 'ace', currentHealth: 13 }]), /invalid_request/);
});

test('without the flag, every zone reply is byte-identical to the deployed holozone-run-1 shape (pinned strings), and nothing health-related is stored', () => {
  k = 0; // deterministic run ids for the pins
  const p = { holobots: bots() };
  const i = Z.issueHoloZoneRun([], 'neonforest', ['ace', 'kuma'], uuid(), T0 - Z.HOLOZONE_MIN_XP_MS);
  assert.equal(JSON.stringify(i.reply), '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}');
  assert.equal(JSON.stringify(Z.holoZoneStatus(i.doc.runs, T0)), '{"schemaVersion":"holozone-run-1","run":{"runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","zoneId":"neonforest","tier":0,"squad":["ace","kuma"],"issuedAtMs":1791309580000,"expiresAtMs":1791316780000}}');
  const s = Z.settleHoloZoneRun(p, i.doc.runs, { runId: i.reply.runId, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'] }, T0);
  assert.equal(JSON.stringify(s.reply), '{"schemaVersion":"holozone-run-1","runId":"0b9f3c1e-1d2a-4c3b-9a8f-000000000001","alreadyProcessed":false,"settlement":{"kind":"beast","zoneId":"neonforest","tier":0,"kills":3,"bossDefeated":false,"fielded":["ace","kuma"],"didWin":true,"combosCompleted":3,"perfectDefenses":0,"tableExp":123,"expPerHolobot":123,"expWithheld":false,"settledAtMs":1791309600000},"progression":[{"holobotId":"ace","expGained":123,"levelBefore":4,"levelAfter":4,"attributePoints":1,"experience":1823,"nextLevelExp":2500,"rank":"Starter"},{"holobotId":"kuma","expGained":123,"levelBefore":1,"levelAfter":2,"attributePoints":1,"experience":473,"nextLevelExp":900,"rank":"Starter"}]}');
  assert.deepEqual(Object.keys(s.userUpdates), ['holobots']);
  assert.equal(JSON.stringify(s.doc).toLowerCase().includes('health'), false); assert.equal(JSON.stringify(s.doc).includes('Vitals'), false);
  // Known-bad: a key-order-only change trips the pin.
  const r = i.reply; const reordered = { runId: r.runId, schemaVersion: r.schemaVersion, zoneId: r.zoneId, tier: r.tier, squad: r.squad, issuedAtMs: r.issuedAtMs, expiresAtMs: r.expiresAtMs };
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(r));
});
