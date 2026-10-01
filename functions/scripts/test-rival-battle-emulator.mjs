// DECISIONS #43 Firestore-emulator tests: rival host transactions + the starter-Unit grant across every new-pilot path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-rival-tests';
const { db } = require('../lib/admin.js');
const { Timestamp } = require('firebase-admin/firestore');
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
  const play = async (didWin, now) => { const i = await rival(uid, { operation: 'issue' }, now - L.RIVAL_MIN_WIN_MS); return rival(uid, { operation: 'settle', battleId: i.battleId, didWin }, now); };
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
  const rs = await Promise.all(Array.from({ length: 8 }, () => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS)));
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

test('TTL field: every issued battle carries expireAt (Timestamp) = expiry + grace; settle keeps it; replay works inside the grace window', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const i = await rival(uid, { operation: 'issue' });
  const ref = db.doc(`rivalBattles/${uid}/battles/${i.battleId}`);
  let stored = (await ref.get()).data();
  assert.ok(stored.expireAt instanceof Timestamp, 'expireAt must be a Firestore Timestamp for the TTL policy');
  assert.equal(stored.expireAt.toMillis(), T0 + L.RIVAL_BATTLE_TTL_MS + L.RIVAL_BATTLE_TTL_GRACE_MS);
  assert.equal(stored.expiresAtMs, T0 + L.RIVAL_BATTLE_TTL_MS); assert.equal(i.expiresAtMs, stored.expiresAtMs);
  assert.equal('expireAt' in i, false, 'expireAt is storage-only, not part of the rival-battle-1 reply');
  const first = await rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + 60000);
  assert.equal(first.alreadyProcessed, false); assert.equal(first.buddyUnitsGranted, 1);
  stored = (await ref.get()).data();
  assert.equal(stored.expireAt.toMillis(), T0 + L.RIVAL_BATTLE_TTL_MS + L.RIVAL_BATTLE_TTL_GRACE_MS, 'settle must not move expireAt');
  const userAfterSettle = await user(uid);
  // Six days later (past expiresAtMs, inside the grace window): the duplicate replays the original ruling and writes nothing.
  const late = T0 + 6 * 86400000;
  const dup = await rival(uid, { operation: 'settle', battleId: i.battleId, didWin: false }, late);
  assert.equal(dup.alreadyProcessed, true); assert.equal(dup.didWin, true); assert.equal(dup.buddyUnitsGranted, 1);
  assert.deepEqual(await user(uid), userAfterSettle); assert.deepEqual((await ref.get()).data(), stored);
  // An unsettled battle past expiresAtMs is still battle_expired, even though its record has not been cleaned up yet.
  const j = await rival(uid, { operation: 'issue' });
  await assert.rejects(() => rival(uid, { operation: 'settle', battleId: j.battleId, didWin: true }, T0 + L.RIVAL_BATTLE_TTL_MS + 1), /battle_expired/);
  // Simulate the TTL delete: a later duplicate settle is unknown_battle and still grants nothing.
  await ref.delete();
  await assert.rejects(() => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + 8 * 86400000), /unknown_battle/);
  assert.deepEqual(await user(uid), userAfterSettle);
});

test('parallel wins on different battles in one UTC day grant the daily Unit once and count every win', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const issued = []; for (let k = 0; k < L.RIVAL_MAX_OPEN_BATTLES; k++) issued.push(await rival(uid, { operation: 'issue' }));
  const rs = await Promise.all(issued.map(i => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS)));
  assert.equal(rs.reduce((n, r) => n + r.buddyUnitsGranted, 0), 1);
  const p = await user(uid); assert.equal(p.buddyUnits, 1); assert.equal(p.rivalWins, L.RIVAL_MAX_OPEN_BATTLES); assert.equal(p.rivalRewardDay, '2026-09-30');
});

test('max 3 open battles: a 4th issue is too_many_open (nothing written); settle or expiry frees a slot', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const ids = []; for (let k = 0; k < 3; k++) ids.push((await rival(uid, { operation: 'issue' })).battleId);
  const before = { user: await user(uid), battles: (await db.collection(`rivalBattles/${uid}/battles`).get()).size };
  await assert.rejects(() => rival(uid, { operation: 'issue' }, T0 + 1), /too_many_open/);
  assert.deepEqual(await user(uid), before.user); assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, before.battles);
  assert.deepEqual(Object.keys((await db.doc(`rivalBattles/${uid}`).get()).data().openBattles).sort(), [...ids].sort());
  // A loss settles immediately and frees a slot.
  await rival(uid, { operation: 'settle', battleId: ids[0], didWin: false }, T0 + 2);
  await rival(uid, { operation: 'issue' }, T0 + 3);
  await assert.rejects(() => rival(uid, { operation: 'issue' }, T0 + 4), /too_many_open/);
  // Expiry frees every slot (the last of the three expires at T0 + 3 + TTL); expired entries are pruned from the ledger.
  const fresh = await rival(uid, { operation: 'issue' }, T0 + 3 + L.RIVAL_BATTLE_TTL_MS + 1);
  assert.deepEqual(Object.keys((await db.doc(`rivalBattles/${uid}`).get()).data().openBattles), [fresh.battleId]);
  // The callable maps it to failed-precondition / too_many_open.
  const live = await setup({ buddyUnits: 0 });
  for (let k = 0; k < 3; k++) await rivalBattleHost.run({ auth: { uid: live }, data: { operation: 'issue' } });
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid: live }, data: { operation: 'issue' } }), e => e.code === 'failed-precondition' && e.details.rejectionCode === 'too_many_open');
});

test('parallel issues never exceed 3 open battles', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const rs = await Promise.allSettled(Array.from({ length: 8 }, () => rival(uid, { operation: 'issue' })));
  assert.equal(rs.filter(r => r.status === 'fulfilled').length, 3);
  for (const r of rs.filter(r => r.status === 'rejected')) assert.match(String(r.reason), /too_many_open/);
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 3);
  assert.equal(Object.keys((await db.doc(`rivalBattles/${uid}`).get()).data().openBattles).length, 3);
});

test('too_fast: a win under 20 s after issue is rejected with nothing written; it can settle once 20 s have passed', async () => {
  const uid = await setup({ buddyUnits: 0 });
  const i = await rival(uid, { operation: 'issue' });
  const ref = db.doc(`rivalBattles/${uid}/battles/${i.battleId}`);
  const before = { user: await user(uid), battle: (await ref.get()).data(), ledger: (await db.doc(`rivalBattles/${uid}`).get()).data() };
  await assert.rejects(() => rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS - 1), /too_fast/);
  assert.deepEqual({ user: await user(uid), battle: (await ref.get()).data(), ledger: (await db.doc(`rivalBattles/${uid}`).get()).data() }, before);
  const ok = await rival(uid, { operation: 'settle', battleId: i.battleId, didWin: true }, T0 + L.RIVAL_MIN_WIN_MS);
  assert.equal(ok.alreadyProcessed, false); assert.equal(ok.buddyUnitsGranted, 1);
  assert.deepEqual((await db.doc(`rivalBattles/${uid}`).get()).data().openBattles, {});
  const live = await setup({ buddyUnits: 0 });
  const j = await rivalBattleHost.run({ auth: { uid: live }, data: { operation: 'issue' } });
  await assert.rejects(() => rivalBattleHost.run({ auth: { uid: live }, data: { operation: 'settle', battleId: j.battleId, didWin: true } }), e => e.code === 'failed-precondition' && e.details.rejectionCode === 'too_fast');
  const loss = await rivalBattleHost.run({ auth: { uid: live }, data: { operation: 'settle', battleId: j.battleId, didWin: false } });
  assert.equal(loss.didWin, false);
});
