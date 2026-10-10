// rival-health-1 on the zone, Firestore-emulator tests: holoZoneHost through the real transaction and callable on the ONE
// host-owned ledger users/{uid}.holobotVitals the deployed rival host (and the repair item) write — issued with the flag,
// written on issue and on settle (downward only), carried to and from the rival host, never touched without the flag, and
// the repair item's "between battles only" rule seeing an open zone run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-health-tests';
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { holoZoneHost } = require('../lib/holozone/holoZoneHost.js');
const { transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const L = require('../lib/lib/rivalLadder.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const FLAG = 'rival-health-1';
const light = (n, medium = 0, heavy = 0) => ({ light: n, medium, heavy });
let serial = 0;
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
];
const squad = (ids, revision = 1) => ({ schemaVersion: 'travel-squad-1', revision, holobotIds: ids });
const setup = async (extra = {}) => { const uid = `zh_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots: bots(), travelSquad: squad(['ace', 'kuma']), buddyUnits: light(0), rivalWins: 0, holosTokens: 0, emergencyPatches: 1, ...extra }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const runsDoc = async uid => (await db.doc(`holoZoneRuns/${uid}`).get()).data();
const rival = (uid, data, now = T0) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now);
const zone = (uid, data, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-1', ...data }, now);
const ISSUED = T0 - Z.HOLOZONE_MIN_XP_MS;
const ACE_MAX = 192, KUMA_MAX = 200;

test('zone: a flagged issue serves playerCombatants with currentHealth and writes the ledger; the settle writes the reports with the ruling; replays and plain requests never touch it', async () => {
  const uid = await setup();
  const i = await zone(uid, { operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG }, ISSUED);
  assert.deepEqual(i.playerCombatants.map(c => [c.holobotId, c.currentHealth, c.maxHealth]), [['ace', ACE_MAX, ACE_MAX], ['kuma', KUMA_MAX, KUMA_MAX]]);
  assert.deepEqual((await user(uid)).holobotVitals, { ace: { currentHealth: ACE_MAX, maxHealth: ACE_MAX }, kuma: { currentHealth: KUMA_MAX, maxHealth: KUMA_MAX } }, 'issue writes the ledger (the rival issue\'s rule)');
  const stored = (await runsDoc(uid)).runs[0];
  assert.equal(stored.healthSchema, FLAG); assert.deepEqual(stored.issuedVitals, (await user(uid)).holobotVitals);
  const plainStatus = await zone(uid, { operation: 'status' });
  assert.deepEqual(Object.keys(plainStatus), ['schemaVersion', 'run']);
  const results = await Promise.all(Array.from({ length: 4 }, () => zone(uid, { operation: 'settle', runId: i.runId, kills: 3, bossDefeated: false, fielded: ['ace', 'kuma'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 30 }, { holobotId: 'kuma', currentHealth: 160 }] })));
  assert.equal(results.filter(r => !r.alreadyProcessed).length, 1, 'exactly one first settle');
  for (const r of results) { assert.equal('health' in r, false); assert.equal('health' in r.settlement, false); }
  const u = await user(uid);
  assert.deepEqual(u.holobotVitals, { ace: { currentHealth: 30, maxHealth: ACE_MAX }, kuma: { currentHealth: 160, maxHealth: KUMA_MAX } });
  assert.equal(u.holobots[1].level, 2, 'XP landed in the same update');
  const replay = await holoZoneHost.run({ auth: { uid }, data: { operation: 'settle', runId: i.runId, kills: 0, bossDefeated: false, fielded: [], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 0 }] } });
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(await user(uid), u, 'a replay writes nothing');
  // The next flagged issue (through the callable, real clock) serves what was kept and re-writes the ledger with each bot's
  // CURRENT max (issueVitals: KUMA levelled to 2 in the settle, 200 → 210; the current 160 carries); a plain issue serves no
  // combatants and leaves the ledger alone.
  const next = await holoZoneHost.run({ auth: { uid }, data: { operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG } });
  assert.deepEqual(next.playerCombatants.map(c => [c.holobotId, c.currentHealth, c.maxHealth]), [['ace', 30, ACE_MAX], ['kuma', 160, 210]]);
  const refreshed = (await user(uid)).holobotVitals;
  assert.deepEqual(refreshed, { ace: { currentHealth: 30, maxHealth: ACE_MAX }, kuma: { currentHealth: 160, maxHealth: 210 } });
  const plain = await holoZoneHost.run({ auth: { uid }, data: { operation: 'issue', zoneId: 'neonforest' } });
  assert.equal('playerCombatants' in plain, false); assert.deepEqual((await user(uid)).holobotVitals, refreshed);
});

test('zone: inflated / foreign reports, reports on an unflagged run, and a tampered ledger refuse with nothing written', async () => {
  const uid = await setup();
  const i = await zone(uid, { operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG }, ISSUED);
  const before = [await user(uid), await runsDoc(uid)];
  for (const health of [[{ holobotId: 'ace', currentHealth: ACE_MAX + 1 }], [{ holobotId: 'wolf', currentHealth: 2 }], [{ holobotId: 'ace', currentHealth: NaN }]]) {
    await assert.rejects(() => zone(uid, { operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'], healthSchema: FLAG, health }), /invalid_request/);
  }
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'], health: [{ holobotId: 'ace', currentHealth: 1 }] } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  assert.deepEqual([await user(uid), await runsDoc(uid)], before, 'refusals write nothing');
  const uid2 = await setup();
  const i2 = await zone(uid2, { operation: 'issue', zoneId: 'neonforest' }, ISSUED);
  const before2 = [await user(uid2), await runsDoc(uid2)];
  await assert.rejects(() => zone(uid2, { operation: 'settle', runId: i2.runId, kills: 1, bossDefeated: false, fielded: ['ace'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 1 }] }), /invalid_request/);
  assert.deepEqual([await user(uid2), await runsDoc(uid2)], before2);
  const uid3 = await setup({ holobotVitals: { ace: { currentHealth: 9999, maxHealth: ACE_MAX } } });
  await assert.rejects(() => holoZoneHost.run({ auth: { uid: uid3 }, data: { operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG } }), e => e.code === 'unavailable' && e.details.rejectionCode === 'unavailable');
  assert.equal((await runsDoc(uid3)), undefined, 'the refused issue stored no run');
  assert.match((await holoZoneHost.run({ auth: { uid: uid3 }, data: { operation: 'issue', zoneId: 'neonforest' } })).runId, Z.HOLOZONE_RUN_ID, 'a plain issue ignores the ledger');
});

test('one ledger: the rival host\'s settle is what the zone issue serves; the zone settle is what the rival issue serves; a repair is refused while the zone run is open', async () => {
  const uid = await setup();
  const r = await rival(uid, { operation: 'issue', healthSchema: FLAG }, ISSUED);
  assert.deepEqual(r.playerCombatants.map(c => c.currentHealth), [ACE_MAX, KUMA_MAX]);
  await rival(uid, { operation: 'settle', battleId: r.battleId, didWin: false, fielded: ['ace'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 30 }] });
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 30);
  const i = await zone(uid, { operation: 'issue', zoneId: 'neonforest', healthSchema: FLAG }, ISSUED + 1);
  assert.deepEqual(i.playerCombatants.map(c => c.currentHealth), [30, KUMA_MAX], 'the zone serves the rival host\'s value');
  // The repair item (deployed) refuses while the zone run is open: the same run ledger both see.
  await assert.rejects(() => transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.emergency_patch', requestId: 'patch_zone_1', holobotId: 'ace' }, T0), /between_battles_only/);
  await zone(uid, { operation: 'settle', runId: i.runId, kills: 2, bossDefeated: true, fielded: ['ace', 'kuma'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 12 }] }, T0 + 1);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 12);
  const r2 = await rival(uid, { operation: 'issue', healthSchema: FLAG }, T0 + 2);
  assert.deepEqual(r2.playerCombatants.map(c => c.currentHealth), [12, KUMA_MAX], 'the rival host serves the zone\'s value');
  await assert.rejects(() => rival(uid, { operation: 'settle', battleId: r2.battleId, didWin: false, fielded: ['ace'], healthSchema: FLAG, health: [{ holobotId: 'ace', currentHealth: 13 }] }, T0 + 3), /invalid_request/, 'the rival host refuses a report above what it issued');
});
