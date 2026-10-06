// DECISIONS #53 Firestore-emulator tests: rival-battle-3 through the real transaction and callable —
// player combatants from the travel squad, Holobot XP written once per battleId, v2 replies unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-rival-progression-tests';
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { rivalBattleHost } = require('../lib/rival/rivalBattleHost.js');
const L = require('../lib/lib/rivalLadder.js');
const P = require('../lib/lib/progression.js');
const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);
const light = (n, medium = 0, heavy = 0) => ({ light: n, medium, heavy });
let serial = 0;
const bots = () => [
  { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 }, career: { workouts: 2 } },
  { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 },
  { name: 'WOLF', level: 12, experience: 16000, nextLevelExp: 16900, attributePoints: 4 },
];
const squad = (ids, revision = 1) => ({ schemaVersion: 'travel-squad-1', revision, holobotIds: ids });
const setup = async (fields = {}) => { const uid = `rprog_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ buddyUnits: light(0), holobots: bots(), travelSquad: squad(['ace', 'kuma']), ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const v3 = (uid, data, now = T0) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now);

test('v3 issue serves the travel squad as playerCombatants and snapshots it into the record', async () => {
  const uid = await setup({ rivalWins: 25 });
  const i = await v3(uid, { operation: 'issue' });
  assert.equal(i.schemaVersion, 'rival-battle-3'); assert.equal(i.tier, 2);
  assert.deepEqual(i.playerCombatants.map(c => c.holobotId), ['ace', 'kuma']);
  assert.equal(i.playerCombatants[0].attack, L.playerCombatant('ace', bots()[0]).attack);
  for (const c of i.encounter.opponentSquad) { assert.equal(c.speed, 50); assert.equal(c.intelligence, 40); }
  const stored = (await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).get()).data();
  assert.deepEqual(stored.playerSquadIds, ['ace', 'kuma']);
  assert.equal('speed' in stored.lineup.opponentSquad[0], false, 'stored lineup keeps the #43 record format');
});

test('v3 settle{fielded} writes Holobot XP once; duplicates replay the progression and write nothing', async () => {
  const uid = await setup({ rivalWins: 25 });
  const i = await v3(uid, { operation: 'issue' }, T0 - L.RIVAL_MIN_WIN_MS);
  const s = await v3(uid, { operation: 'settle', battleId: i.battleId, didWin: true, fielded: ['ace', 'kuma'] });
  assert.equal(s.schemaVersion, 'rival-battle-3'); assert.equal(s.alreadyProcessed, false); assert.equal(s.tierAfter, 2);
  assert.deepEqual(s.progression.map(r => [r.holobotId, r.expGained, r.levelBefore, r.levelAfter]), [['ace', 180, 4, 4], ['kuma', 180, 1, 2]]);
  let u = await user(uid);
  assert.deepEqual(u.holobots[0], P.applyHolobotExperience(bots()[0], 180)); assert.equal(u.holobots[1].level, 2); assert.equal(u.holobots[1].attributePoints, 1);
  assert.deepEqual(u.holobots[2], bots()[2]); assert.equal(u.rivalWins, 26); assert.deepEqual(u.buddyUnits, light(1));
  const dupes = await Promise.all(Array.from({ length: 4 }, () => v3(uid, { operation: 'settle', battleId: i.battleId, didWin: true, fielded: ['ace', 'kuma'] }, T0 + 1000)));
  for (const d of dupes) { assert.equal(d.alreadyProcessed, true); assert.deepEqual(d.progression, s.progression); }
  assert.deepEqual(await user(uid), u, 'no second XP write');
  const record = (await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).get()).data();
  assert.deepEqual(record.settlement.progression, s.progression); assert.deepEqual(record.settlement.fielded, ['ace', 'kuma']);
});

test('parallel first settles award XP exactly once', async () => {
  const uid = await setup();
  const i = await v3(uid, { operation: 'issue' }, T0 - L.RIVAL_MIN_WIN_MS);
  const rs = await Promise.all(Array.from({ length: 6 }, () => v3(uid, { operation: 'settle', battleId: i.battleId, didWin: true, fielded: ['ace'] })));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1);
  assert.equal((await user(uid)).holobots[0].experience, 1700 + 95);
});

test('fielded outside the travel squad is invalid_request (nothing written); v2 callers see the #44 shapes', async () => {
  const uid = await setup();
  const i = await v3(uid, { operation: 'issue' }, T0 - L.RIVAL_MIN_WIN_MS);
  const before = await user(uid);
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid }, data: { schemaVersion: 'rival-battle-3', operation: 'settle', battleId: i.battleId, didWin: true, fielded: ['wolf'] } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  assert.deepEqual(await user(uid), before);
  const i2 = await rivalBattleHost.run({ auth: { uid }, data: { schemaVersion: 'rival-battle-2', operation: 'issue' } });
  assert.equal(i2.schemaVersion, 'rival-battle-2'); assert.equal('playerCombatants' in i2, false);
  for (const c of i2.encounter.opponentSquad) { assert.equal('speed' in c, false); assert.equal('intelligence' in c, false); }
  const s2 = await rivalBattleHost.run({ auth: { uid }, data: { schemaVersion: 'rival-battle-2', operation: 'settle', battleId: i.battleId, didWin: false } });
  assert.equal(s2.schemaVersion, 'rival-battle-2'); assert.equal('progression' in s2, false);
  assert.deepEqual((await user(uid)).holobots, bots(), 'a v2 settle without fielded awards no XP');
});

test('a malformed travel squad never breaks issue/settle: playerCombatants [] and fielded refused', async () => {
  const uid = await setup({ travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['NOT_A_BOT'] } });
  const i = await v3(uid, { operation: 'issue' }, T0 - L.RIVAL_MIN_WIN_MS);
  assert.deepEqual(i.playerCombatants, []);
  await assert.rejects(() => v3(uid, { operation: 'settle', battleId: i.battleId, didWin: true, fielded: ['ace'] }), /invalid_request/);
  const s = await v3(uid, { operation: 'settle', battleId: i.battleId, didWin: true });
  assert.equal(s.alreadyProcessed, false); assert.deepEqual(s.progression, []);
});
