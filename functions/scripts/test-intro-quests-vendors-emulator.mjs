// DECISIONS #46 / #47 Firestore-emulator tests: intro quest transactions (real capture + rival flows), vendor catalog, Buddy Unit purchases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-quests-tests';
const { db } = require('../lib/admin.js');
const { transactIntroQuest } = require('../lib/quests/introQuestStore.js');
const { introQuestHost } = require('../lib/quests/introQuestHost.js');
const { vendorCatalogHost, purchaseBuddyUnit } = require('../lib/vendors/vendorCatalogHost.js');
const { transactWildEncounter } = require('../lib/acquisition/wildEncounterStore.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const Q = require('../lib/lib/introQuests.js');
const E = require('../lib/lib/economy.js');
const L = require('../lib/lib/rivalLadder.js');

const fixtureDir = new URL('../../Documentation/QA/2026-10-03-intro-quests-vendors/fixtures/', import.meta.url);
async function exportFixture(name, reply) {
  const text = JSON.stringify(reply, null, 2) + '\n';
  if (/"(?:uid|token|secret|rollSeed|claims|rivalWinsAtStepStart)"\s*:/.test(text)) throw new Error('Unexpected internal field in public reply');
  await mkdir(fixtureDir, { recursive: true }); await writeFile(new URL(name + '.json', fixtureDir), text);
}
const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const inv = (light = 0, medium = 0, heavy = 0) => ({ light, medium, heavy });
let serial = 0;
const newUid = tag => `${tag}_${Date.now()}_${serial++}`;
const setup = async (fields = {}) => { const uid = newUid('q'); await db.doc(`users/${uid}`).set({ holobots: [], holosTokens: 0, gachaTickets: 0, buddyUnits: inv(0), ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const questDoc = async uid => (await db.doc(`introQuests/${uid}`).get()).data();
const DEST = Object.fromEntries(Q.INTRO_QUEST_STEPS.map(s => [s.stepId, s.destinationId]));
const claim = (uid, stepId, requestId = `req_${stepId}`, now = T0) => transactIntroQuest(db, uid, { operation: 'claim', stepId, requestId, destinationId: DEST[stepId] || undefined }, now);
const visits = async (uid, ids) => { for (const id of ids) await claim(uid, id); };
const SEED = 'ab'.repeat(32);
const hareSession = (entries = []) => ({ enabled: true, rollSeed: SEED, revision: 1, rosterRevision: 1, entries, encounters: [{ encounterId: 'harbor_hare_001', holobotId: 'hare', affinityTier: 0, affinityMax: 1, captureOpen: true, chanceByAffinity: [.3, .65], ended: false, items: [{ itemId: 'unit', kind: 'buddy_unit', displayName: 'Unit', modelKey: 'unit', remaining: 1, useAllowed: true, affinityGain: 0 }] }] });
const captureHare = uid => transactWildEncounter(db, uid, { operation: 'capture', intent: { schemaVersion: 'acquisition-2', requestId: 'cap_hare', encounterId: 'harbor_hare_001', toyId: 'buddy_heavy', observedHealth01: 0 } });
const winRival = async (uid, now) => { const i = await transactRivalBattle(db, uid, { operation: 'issue' }, now); return transactRivalBattle(db, uid, { operation: 'settle', battleId: i.battleId, didWin: true }, now + L.RIVAL_MIN_WIN_MS); };

// ---- Intro quests ----
test('full chain through the real capture and rival flows pays exactly 600 Holos, 3 Gacha Tickets, 1 Light Unit', async () => {
  const uid = await setup({ holosTokens: 25, gachaTickets: 1, buddyUnits: inv(0, 0, 1) });
  await db.doc(`wildEncounterSessions/${uid}`).set(hareSession());
  const st0 = await introQuestHost.run({ auth: { uid }, data: { operation: 'status' } });
  assert.equal(st0.status.currentStepId, 'visit_mission_board'); assert.equal((await db.doc(`introQuests/${uid}`).get()).exists, false, 'status writes nothing');
  await exportFixture('intro-quest-1_status_fresh', st0);
  await visits(uid, ['visit_mission_board', 'visit_marketplace', 'visit_workshop']);
  await assert.rejects(() => claim(uid, 'capture_buddy'), /not_met/);
  await captureHare(uid);
  const cap = await claim(uid, 'capture_buddy');
  assert.deepEqual(cap.reward, { holos: 100, gachaTickets: 0, buddyUnitsLight: 1 });
  await exportFixture('intro-quest-1_claim_capture_buddy', cap);
  await assert.rejects(() => claim(uid, 'win_rival_battle'), /not_met/);
  await winRival(uid, T0 + 1000);
  await claim(uid, 'win_rival_battle'); await claim(uid, 'visit_portal');
  const done = await claim(uid, 'chain_complete');
  assert.equal(done.status.complete, true); assert.equal(done.status.currentStepId, '');
  const p = await user(uid);
  // The rival win also paid the #43 daily Light Unit; the Heavy capture spent the Heavy.
  assert.equal(p.holosTokens, 625); assert.equal(p.gachaTickets, 4); assert.deepEqual(p.buddyUnits, inv(2, 0, 0));
  assert.deepEqual(done.balances, { holosTokens: 625, gachaTickets: 4, buddyUnits: inv(2, 0, 0) });
  await exportFixture('intro-quest-1_claim_chain_complete', done);
});

test('ordering and once-only through the callable: typed rejection codes, nothing written on rejection', async () => {
  const uid = await setup();
  const host = data => introQuestHost.run({ auth: { uid }, data });
  const code = (data, want, http) => assert.rejects(() => host(data), e => e.details?.rejectionCode === want && e.code === http);
  await code({ operation: 'claim', stepId: 'visit_workshop', requestId: 'r1', destinationId: 'workshop' }, 'out_of_order', 'failed-precondition');
  await code({ operation: 'claim', stepId: 'chain_complete', requestId: 'r1' }, 'out_of_order', 'failed-precondition');
  await code({ operation: 'claim', stepId: 'visit_mission_board', requestId: 'r1', destinationId: 'portal_neon_forest' }, 'invalid_request', 'invalid-argument');
  await code({ operation: 'claim', stepId: 'visit_mission_board' }, 'invalid_request', 'invalid-argument');
  assert.equal((await db.doc(`introQuests/${uid}`).get()).exists, false); assert.equal((await user(uid)).holosTokens, 0);
  await host({ operation: 'claim', stepId: 'visit_mission_board', requestId: 'r1', destinationId: 'mission_board' });
  await code({ operation: 'claim', stepId: 'visit_mission_board', requestId: 'r2', destinationId: 'mission_board' }, 'already_claimed', 'already-exists');
  await visits(uid, ['visit_marketplace', 'visit_workshop']);
  await code({ operation: 'claim', stepId: 'capture_buddy', requestId: 'r3' }, 'not_met', 'failed-precondition');
  await assert.rejects(() => introQuestHost.run({ data: { operation: 'status' } }), e => e.code === 'unauthenticated');
  assert.equal((await user(uid)).holosTokens, 175);
});

test('idempotent retries: parallel same-requestId claims pay once; parallel different requestIds pay once', async () => {
  const uid = await setup();
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => claim(uid, 'visit_mission_board', 'same')));
  assert.deepEqual(settled.filter(r => r.status === 'rejected').map(r => `${r.reason?.code} ${r.reason?.message}`), [], 'no retry may fail');
  const rs = settled.map(r => r.value);
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1); for (const r of rs) assert.equal(r.reward.holos, 50);
  assert.equal((await user(uid)).holosTokens, 50);
  const mixed = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => claim(uid, 'visit_marketplace', `m${k}`)));
  assert.equal(mixed.filter(r => r.status === 'fulfilled').length, 1);
  // Diagnostic message: if a loser ever fails for another reason (e.g. transaction contention), show it.
  for (const r of mixed.filter(r => r.status === 'rejected')) assert.match(String(r.reason), /already_claimed/, `unexpected rejection: ${r.reason?.code} ${r.reason?.message}`);
  const p = await user(uid); assert.equal(p.holosTokens, 100); assert.equal(p.gachaTickets, 1);
  // A later retry of the first request replays its original ruling.
  const later = await claim(uid, 'visit_mission_board', 'same'); assert.equal(later.alreadyProcessed, true); assert.equal((await user(uid)).holosTokens, 100);
});

test('capture verification uses server-only sources: a client-written HARE in holobots does not count; a capture receipt does', async () => {
  const forged = await setup({ holobots: [{ name: 'HARE', level: 1 }], buddyUnits: inv(0, 0, 1) });
  await visits(forged, ['visit_mission_board', 'visit_marketplace', 'visit_workshop']);
  await assert.rejects(() => claim(forged, 'capture_buddy'), /not_met/, 'no session');
  await db.doc(`wildEncounterSessions/${forged}`).set(hareSession([{ holobotId: 'hare', availability: 'owned', source: 'story', copies: 1 }]));
  await assert.rejects(() => claim(forged, 'capture_buddy'), /not_met/, 'owned from another source, never captured');
  // Capturing a HARE already owned from another source leaves the roster entry's source as-is: the receipt proves it.
  const r = await captureHare(forged); assert.equal(r.captureResult.captured, true);
  assert.equal((await db.doc(`wildEncounterSessions/${forged}`).get()).data().entries[0].source, 'story');
  assert.equal((await claim(forged, 'capture_buddy')).reward.buddyUnitsLight, 1);
});

test('rival verification uses a baseline: wins from before the step became current do not count', async () => {
  const uid = await setup({ buddyUnits: inv(0, 0, 1) });
  await db.doc(`wildEncounterSessions/${uid}`).set(hareSession());
  await winRival(uid, T0);
  await visits(uid, ['visit_mission_board', 'visit_marketplace', 'visit_workshop']);
  await captureHare(uid); await claim(uid, 'capture_buddy');
  assert.equal((await questDoc(uid)).rivalWinsAtStepStart, 1);
  await assert.rejects(() => claim(uid, 'win_rival_battle'), /not_met/);
  await winRival(uid, T0 + 60000);
  assert.equal((await claim(uid, 'win_rival_battle')).reward.holos, 100);
});

test('no starter farm: a malformed quest doc fails closed (never reset, never re-paid); the doc survives every client path', async () => {
  const uid = await setup();
  await visits(uid, ['visit_mission_board']);
  await db.doc(`introQuests/${uid}`).update({ currentIndex: 0 });
  const before = await user(uid);
  for (const data of [{ operation: 'status' }, { operation: 'claim', stepId: 'visit_mission_board', requestId: 'again', destinationId: 'mission_board' }])
    await assert.rejects(() => introQuestHost.run({ auth: { uid }, data }), e => e.details?.rejectionCode === 'unavailable');
  assert.deepEqual(await user(uid), before);
  const nouser = newUid('nouser');
  await assert.rejects(() => transactIntroQuest(db, nouser, { operation: 'status' }), /unavailable/);
});

// ---- Vendors ----
test('vendorCatalogHost: catalog prices match the economy module; Holos and inventory reported; never writes', async () => {
  const uid = await setup({ holosTokens: 420, buddyUnits: 2, arenaPassses: 3, parts: [{ name: 'Void Mask', slot: 'head' }] });
  const before = await user(uid);
  const m = await vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'marketplace' } });
  assert.equal(m.schemaVersion, 'vendor-3'); assert.equal(m.holosTokens, 420);
  for (const l of m.listings.filter(l => l.kind === 'item')) assert.equal(l.price, E.getMarketplacePrice(l.displayName));
  for (const l of m.listings.filter(l => l.kind === 'booster')) assert.equal(l.price, E.MARKETPLACE_BOOSTER_PRICES[l.details.packId]);
  assert.deepEqual(m.listings.filter(l => l.kind === 'buddy_unit').map(l => [l.details.tierId, l.price, l.affordable]), [['buddy_medium', 300, true], ['buddy_heavy', 1500, false]]);
  assert.equal(m.inventory.arenaPasses, 3); assert.deepEqual(m.inventory.buddyUnits, inv(2));
  const w = await vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'workshop' } });
  assert.deepEqual(w.listings.map(l => [l.listingId, l.price]), E.MARKETPLACE_PART_CATALOG.map(o => [o.id, o.price]));
  assert.equal(w.listings.find(l => l.listingId === 'part.voidMask').owned, 1);
  assert.deepEqual(await user(uid), before, 'read callable: the #43 integer is reported migrated but not written');
  await assert.rejects(() => vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'arena' } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  await assert.rejects(() => vendorCatalogHost.run({ data: { operation: 'catalog', vendorId: 'marketplace' } }), e => e.code === 'unauthenticated');
  await exportFixture('vendor-3_catalog_marketplace', m); await exportFixture('vendor-3_catalog_workshop', w);
});

test('purchaseBuddyUnit: Medium and Heavy spend Holos and add the tier in one transaction; not enough Holos refuses with nothing written', async () => {
  const uid = await setup({ holosTokens: 2000, buddyUnits: inv(1) });
  const buy = (tierId, requestId) => purchaseBuddyUnit.run({ auth: { uid }, data: { tierId, requestId } });
  const m = await buy('buddy_medium', 'b1');
  assert.deepEqual(m, { schemaVersion: 'vendor-3', requestId: 'b1', tierId: 'buddy_medium', price: 300, holosTokens: 1700, buddyUnits: inv(1, 1, 0), alreadyProcessed: false });
  const h = await buy('buddy_heavy', 'b2'); assert.equal(h.holosTokens, 200); assert.deepEqual(h.buddyUnits, inv(1, 1, 1));
  await exportFixture('vendor-3_purchase_buddy_heavy', h);
  const before = await user(uid);
  await assert.rejects(() => buy('buddy_medium', 'b3'), e => e.code === 'failed-precondition' && e.message === 'Not enough Holos.' && e.details.rejectionCode === 'not_enough_holos');
  assert.deepEqual(await user(uid), before); assert.equal((await db.doc(`vendorPurchases/${uid}/receipts/b3`).get()).exists, false);
  await db.doc(`users/${uid}`).update({ holosTokens: 300 });
  assert.equal((await buy('buddy_medium', 'b3')).holosTokens, 0, 'the refused requestId succeeds once affordable');
  for (const data of [{ tierId: 'buddy_light', requestId: 'x' }, { tierId: 'buddy_heavy' }, { tierId: 'heavy', requestId: 'x' }])
    await assert.rejects(() => purchaseBuddyUnit.run({ auth: { uid }, data }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  // The bought Heavy is spendable by the #44 capture path.
  await db.doc(`wildEncounterSessions/${uid}`).set(hareSession());
  assert.equal((await captureHare(uid)).captureResult.outcome, 'captured'); assert.deepEqual((await user(uid)).buddyUnits, inv(1, 2, 0));
});

test('double-buy on retry: parallel and later retries of one requestId buy once; the same requestId for another tier is sequence_conflict', async () => {
  const uid = await setup({ holosTokens: 5000, buddyUnits: 3 });
  const rs = await Promise.all(Array.from({ length: 8 }, () => purchaseBuddyUnit.run({ auth: { uid }, data: { tierId: 'buddy_heavy', requestId: 'once' } })));
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1); for (const r of rs) { assert.equal(r.holosTokens, 3500); assert.deepEqual(r.buddyUnits, inv(3, 0, 1)); }
  let p = await user(uid); assert.equal(p.holosTokens, 3500); assert.deepEqual(p.buddyUnits, inv(3, 0, 1));
  const later = await purchaseBuddyUnit.run({ auth: { uid }, data: { tierId: 'buddy_heavy', requestId: 'once' } }); assert.equal(later.alreadyProcessed, true);
  await assert.rejects(() => purchaseBuddyUnit.run({ auth: { uid }, data: { tierId: 'buddy_medium', requestId: 'once' } }), e => e.code === 'already-exists' && e.details.rejectionCode === 'sequence_conflict');
  p = await user(uid); assert.equal(p.holosTokens, 3500); assert.deepEqual(p.buddyUnits, inv(3, 0, 1));
});

test('account deletion covers the new trees: introQuests/{uid} and vendorPurchases/{uid}/receipts', async () => {
  const uid = await setup({ holosTokens: 400 }), other = await setup({ holosTokens: 400 });
  for (const u of [uid, other]) { await claim(u, 'visit_mission_board'); await purchaseBuddyUnit.run({ auth: { uid: u }, data: { tierId: 'buddy_medium', requestId: 'd1' } }); }
  await deleteUserData(db, uid);
  for (const path of [`users/${uid}`, `introQuests/${uid}`, `vendorPurchases/${uid}/receipts/d1`]) assert.equal((await db.doc(path).get()).exists, false, path);
  assert.equal((await db.collection(`vendorPurchases/${uid}/receipts`).get()).size, 0);
  for (const path of [`users/${other}`, `introQuests/${other}`, `vendorPurchases/${other}/receipts/d1`]) assert.equal((await db.doc(path).get()).exists, true, path);
});
