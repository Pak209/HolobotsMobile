// DECISIONS #43 Firestore-emulator tests: rival host transactions + the starter-Unit grant across every new-pilot path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-rival-tests';
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { rivalBattleHost } = require('../lib/rival/rivalBattleHost.js');
const { createGenesisProfile } = require('../lib/account/createGenesisProfile.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const { transactWildEncounter } = require('../lib/acquisition/wildEncounterStore.js');
const L = require('../lib/lib/rivalLadder.js');
const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
let serial = 0;
const newUid = tag => `${tag}_${Date.now()}_${serial++}`;
const setup = async (fields = { buddyUnits: 0 }) => { const uid = newUid('rival'); await db.doc(`users/${uid}`).set({ holobots: [], holosTokens: 7, ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const rival = (uid, data, now = T0) => transactRivalBattle(db, uid, data, now);

test('issue returns a server lineup and persists the battle outside user-writable paths', async () => {
  const uid = await setup({ buddyUnits: 0, rivalWins: 25 });
  const r = await rival(uid, { operation: 'issue' });
  assert.equal(r.schemaVersion, 'rival-battle-1'); assert.match(r.battleId, /^rb_[0-9a-f]{24}$/); assert.equal(r.tier, 2);
  assert.equal(r.encounter.encounterId, r.battleId); assert.equal(r.encounter.opponentSquad.length, 2); assert.equal(r.encounter.opponentPilot.tier, 'challenger');
  const stored = (await db.doc(`rivalBattles/${uid}/battles/${r.battleId}`).get()).data();
  assert.equal(stored.settlement, null); assert.deepEqual(stored.lineup.opponentSquad, r.encounter.opponentSquad); assert.equal(stored.expiresAtMs, T0 + L.RIVAL_BATTLE_TTL_MS);
});

test('first win of the day grants a Unit; the second does not; next UTC day does; loss counts nothing', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const play = async (didWin, now) => { const i = await rival(uid, { operation: 'issue' }, now); return rival(uid, { operation: 'settle', battleId: i.battleId, didWin }, now); };
  let s = await play(true, T0); assert.equal(s.buddyUnitsGranted, 1); assert.equal(s.status.buddyUnits, 1); assert.equal(s.status.dailyRewardAvailable, false);
  s = await play(true, T0 + 60000); assert.equal(s.buddyUnitsGranted, 0); assert.equal(s.status.buddyUnits, 1);
  s = await play(false, T0 + 120000); assert.equal(s.buddyUnitsGranted, 0); assert.equal(s.status.rivalWins, 2);
  s = await play(true, T0 + 86400000); assert.equal(s.buddyUnitsGranted, 1);
  const p = await user(uid); assert.equal(p.buddyUnits, 2); assert.equal(p.rivalWins, 3); assert.equal(p.rivalRewardDay, '2026-10-01'); assert.equal(p.holosTokens, 7);
  const st = await rival(uid, { operation: 'status' }, T0 + 86400000); assert.deepEqual(st.status, { tier: 0, tierLabel: 'rookie', rivalWins: 3, winsToNextTier: 7, rivalsThisTier: 1, dailyRewardAvailable: false, buddyUnits: 2 });
});

test('parallel duplicate settles grant once and count one win', async () => {
  const uid = await setup({ buddyUnits: 0, rivalWins: 9 });
  const i = await rival(uid, { operation: 'issue' });
  const rs = await Promise.all(Array.from({ length: 8 }, () => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true })));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1);
  for (const r of rs) { assert.equal(r.buddyUnitsGranted, 1); assert.equal(r.tierBefore, 0); assert.equal(r.tierAfter, 1); }
  const p = await user(uid); assert.equal(p.rivalWins, 10); assert.equal(p.buddyUnits, 1);
});

test('foreign, unknown and expired battle ids are rejected with nothing written', async () => {
  const alice = await setup(), bob = await setup();
  const i = await rival(alice, { operation: 'issue' });
  const before = await user(bob);
  await assert.rejects(() => rival(bob, { operation: 'settle', battleId: i.battleId, didWin: true }), /unknown_battle/);
  await assert.rejects(() => rival(bob, { operation: 'settle', battleId: 'rb_invented', didWin: true }), /unknown_battle/);
  assert.deepEqual(await user(bob), before);
  await assert.rejects(() => rival(alice, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_BATTLE_TTL_MS + 1), /battle_expired/);
  assert.equal((await db.doc(`rivalBattles/${alice}/battles/${i.battleId}`).get()).data().settlement, null);
  await assert.rejects(() => rival(alice, { operation: 'settle', battleId: '../x', didWin: true }), /invalid_request/);
});

test('callable maps rejections to typed codes and requires auth', async () => {
  const uid = await setup();
  await assert.rejects(() => rivalBattleHost.run({ data: { operation: 'status' } }), e => e.code === 'unauthenticated');
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid }, data: { operation: 'settle', battleId: 'rb_nope', didWin: true } }), e => e.code === 'not-found' && e.details.rejectionCode === 'unknown_battle');
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid }, data: { operation: 'grant' } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  const s = await rivalBattleHost.run({ auth: { uid }, data: { operation: 'status' } }); assert.equal(s.status.buddyUnits, 0);
});

test('starter Unit exactly once: createGenesisProfile, then desktop snapshot, wild refresh and rival status never re-grant', async () => {
  const uid = newUid('genesis');
  const created = await createGenesisProfile.run({ auth: { uid }, data: { starterHolobot: 'ACE', username: 'Pilot One' } });
  assert.equal(created.created, true); assert.equal((await user(uid)).buddyUnits, 1);
  assert.equal((await createGenesisProfile.run({ auth: { uid }, data: { starterHolobot: 'KUMA', username: 'Pilot One' } })).created, false);
  const snap = await desktopAccountSnapshot.run({ auth: { uid } }); assert.equal(snap.buddyUnits, 1); assert.equal(snap.schemaVersion, 'desktop-account-1');
  assert.equal((await transactWildEncounter(db, uid, { operation: 'refresh' }, 0)).buddyUnits, 1);
  assert.equal((await rival(uid, { operation: 'status' })).status.buddyUnits, 1);
  assert.equal((await user(uid)).buddyUnits, 1);
});

test('starter Unit exactly once for a mobile-created profile reached first by parallel desktop/rival reads', async () => {
  const uid = newUid('mobile'); await db.doc(`users/${uid}`).set({ holobots: [{ name: 'ACE' }] });
  const rs = await Promise.all([
    desktopAccountSnapshot.run({ auth: { uid } }), desktopAccountSnapshot.run({ auth: { uid } }),
    rival(uid, { operation: 'status' }), rival(uid, { operation: 'status' }),
    transactWildEncounter(db, uid, { operation: 'refresh' }, 0),
  ]);
  assert.deepEqual(rs.map(r => r.buddyUnits ?? r.status.buddyUnits), [1, 1, 1, 1, 1]);
  assert.equal((await user(uid)).buddyUnits, 1);
  const spent = newUid('spent'); await db.doc(`users/${spent}`).set({ holobots: [], buddyUnits: 0 });
  assert.equal((await desktopAccountSnapshot.run({ auth: { uid: spent } })).buddyUnits, 0);
  assert.equal((await user(spent)).buddyUnits, 0);
});
