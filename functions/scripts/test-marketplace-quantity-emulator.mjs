// market-quantity-host-1 (HolobotsUnity DECISIONS #72.26, UI plan P3) Firestore-emulator tests: the purchaseMarketplaceItem
// quantity lifecycle (buy, ledger entry, replay, conflict, refusals that write nothing, onboarding beat, account deletion),
// every frozen fixture case replayed through Firestore, and the legacy single purchase unchanged beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-market-quantity-tests';
const { db } = require('../lib/admin.js');
const { purchaseMarketplaceItem } = require('../lib/economy/purchaseMarketplaceItem.js');
const { transactMarketplaceQuantityPurchase } = require('../lib/economy/marketplaceQuantityStore.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const { purchaseBuddyUnit } = require('../lib/vendors/vendorCatalogHost.js');
const Q = require('../lib/lib/marketplaceQuantity.js');
const { refusalError } = require('../lib/lib/marketplaceRefusals.js');
const fixture = require('./fixtures/marketplace-item-purchase-1/cases.json');

let serial = 0;
const newUid = tag => `${tag}_${Date.now()}_${serial++}`;
const setup = async fields => { const uid = newUid('mq'); await db.doc(`users/${uid}`).set(fields); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const ledger = async uid => (await db.collection(`vendorPurchases/${uid}/marketplaceItems`).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const call = (uid, data) => purchaseMarketplaceItem.run({ auth: { uid }, data });
const refused = (p, rejectionCode, code, details) => assert.rejects(p, e => {
  assert.equal(e.code, code, rejectionCode); assert.equal(e.details?.rejectionCode, rejectionCode);
  if (details) assert.deepEqual(e.details, { ...details, rejectionCode });
  return true;
});
const atStep = step => ({ onboarding: { step, skipped: false, stepAt: 1 } });

test('lifecycle: buy 5 = one debit of 5 x price, counter + 5, ONE ledger entry; retry replays; another quantity under that id conflicts', async () => {
  const uid = await setup({ holosTokens: 1000, arenaPassses: 2, gachaTickets: 0 });
  const before = Date.now();
  const r = await call(uid, { itemName: 'Arena Pass', quantity: 5, requestId: 'buy_1' });
  assert.deepEqual(r, { schemaVersion: 'marketplace-item-purchase-1', requestId: 'buy_1', itemName: 'Arena Pass', quantity: 5, unitPrice: 50, price: 250, holosTokens: 750, owned: 7, alreadyProcessed: false });
  const p = await user(uid);
  assert.equal(p.holosTokens, 750); assert.equal(p.arenaPassses, 7); assert.equal(p.gachaTickets, 0);
  const entries = await ledger(uid);
  assert.equal(entries.length, 1, 'one ledger entry for five units');
  assert.deepEqual({ ...entries[0], createdAtMs: 0 }, { id: 'buy_1', schemaVersion: 'marketplace-item-purchase-1', itemName: 'Arena Pass', quantity: 5, createdAtMs: 0, reply: r });
  assert.ok(entries[0].createdAtMs >= before && entries[0].createdAtMs <= Date.now());

  const again = await call(uid, { itemName: 'Arena Pass', quantity: 5, requestId: 'buy_1' });
  assert.deepEqual(again, { ...r, alreadyProcessed: true });
  assert.deepEqual(await user(uid), p, 'a replay writes nothing'); assert.equal((await ledger(uid)).length, 1);

  await refused(call(uid, { itemName: 'Arena Pass', quantity: 6, requestId: 'buy_1' }), 'sequence_conflict', 'failed-precondition', {});
  await refused(call(uid, { itemName: 'Gacha Ticket', quantity: 5, requestId: 'buy_1' }), 'sequence_conflict', 'failed-precondition', {});
  assert.deepEqual(await user(uid), p, 'a conflict writes nothing'); assert.equal((await ledger(uid)).length, 1);

  // A second purchase is its own entry.
  const g = await call(uid, { itemName: 'Gacha Ticket', quantity: 3, requestId: 'buy_2' });
  assert.equal(g.holosTokens, 450); assert.equal(g.owned, 3);
  assert.deepEqual((await ledger(uid)).map(e => e.id).sort(), ['buy_1', 'buy_2']);
});

test('double-tap: the same request sent twice at once buys once (one debit, one ledger entry, the other a replay)', async () => {
  const uid = await setup({ holosTokens: 10000, rankSkips: 0 });
  const req = { itemName: 'Rank Skip', quantity: 2, requestId: 'tap_1' };
  const replies = await Promise.all([call(uid, req), call(uid, req)]);
  assert.deepEqual(replies.map(x => x.alreadyProcessed).sort(), [false, true]);
  const p = await user(uid);
  assert.equal(p.holosTokens, 0); assert.equal(p.rankSkips, 2); assert.equal((await ledger(uid)).length, 1);
});

test('refusals carry the code, HTTPS status and host numbers, and write nothing (no debit, no counter, no ledger entry)', async () => {
  const uid = await setup({ holosTokens: 2000, gachaTickets: 995, expBoosters: 0, wildcardBlueprints: 5, lastWildcardPackAt: Date.now() - 1000 });
  const before = await user(uid);
  await refused(call(uid, { itemName: 'Gacha Ticket', quantity: 5, requestId: 'r1' }), 'over_cap', 'failed-precondition', { cap: 999, owned: 995, maxQuantity: 4 });
  await refused(call(uid, { itemName: 'EXP Booster', quantity: 3, requestId: 'r2' }), 'not_enough_holos', 'failed-precondition', { price: 2250, holosTokens: 2000, shortfall: 250 });
  await refused(call(uid, { itemName: 'Wildcard Blueprints', quantity: 2, requestId: 'r3' }), 'not_stackable', 'invalid-argument', {});
  await refused(call(uid, { itemName: 'Wildcard Blueprints', quantity: 1, requestId: 'r4' }), 'on_cooldown', 'invalid-argument', {});
  await refused(call(uid, { itemName: 'Mystery Box', quantity: 2, requestId: 'r5' }), 'unknown_item', 'invalid-argument', {});
  for (const data of [{ itemName: 'Arena Pass', quantity: 0, requestId: 'r6' }, { itemName: 'Arena Pass', quantity: 100, requestId: 'r6' },
    { itemName: 'Arena Pass', quantity: 2 }, { itemName: 'Arena Pass', quantity: 2, requestId: 'r6', price: 1 }, { quantity: 2, requestId: 'r6' }, { itemName: 'Arena Pass', quantity: null, requestId: 'r6' }])
    await refused(call(uid, data), 'invalid_request', 'invalid-argument', {});
  assert.deepEqual(await user(uid), before, 'refusals write nothing');
  assert.equal((await ledger(uid)).length, 0, 'no ledger entry for a refusal');
  // The over-cap request succeeds later under the SAME requestId once it fits (a refusal stores nothing).
  const fits = await call(uid, { itemName: 'Gacha Ticket', quantity: 4, requestId: 'r1' });
  assert.equal(fits.owned, 999);
  await refused(call(uid, { itemName: 'Gacha Ticket', quantity: 1, requestId: 'r7' }), 'over_cap', 'failed-precondition', { cap: 999, owned: 999, maxQuantity: 0 });
  // Missing profile / malformed balance / signed out.
  const ghost = newUid('ghost');
  await assert.rejects(call(ghost, { itemName: 'Arena Pass', quantity: 2, requestId: 'g1' }), e => e.code === 'not-found' && e.message === 'User profile not found.' && e.details.rejectionCode === 'unavailable');
  assert.equal((await db.doc(`users/${ghost}`).get()).exists, false);
  const bad = await setup({ holosTokens: '5000', arenaPassses: 0 });
  await refused(call(bad, { itemName: 'Arena Pass', quantity: 2, requestId: 'b1' }), 'unavailable', 'failed-precondition', {});
  assert.deepEqual(await user(bad), { holosTokens: '5000', arenaPassses: 0 });
  await assert.rejects(purchaseMarketplaceItem.run({ data: { itemName: 'Arena Pass', quantity: 2, requestId: 'u1' } }), e => e.code === 'unauthenticated');
});

test('Wildcard pack through the quantity path: quantity 1 grants 5 and stamps the cooldown; a second pack inside the week is on_cooldown', async () => {
  const uid = await setup({ holosTokens: 1000, wildcardBlueprints: 0, lastWildcardPackAt: Date.now() - 8 * 86400000 });
  const w = await call(uid, { itemName: 'Wildcard Blueprints', quantity: 1, requestId: 'w1' });
  assert.equal(w.owned, 5); assert.equal(w.price, 300);
  const p = await user(uid);
  assert.equal(p.wildcardBlueprints, 5); assert.ok(Date.now() - p.lastWildcardPackAt < 60000);
  await refused(call(uid, { itemName: 'Wildcard Blueprints', quantity: 1, requestId: 'w2' }), 'on_cooldown', 'invalid-argument', {});
});

test('onboarding: a quantity purchase completes the market beat once (4 -> 5), like any vendor purchase', async () => {
  const uid = await setup({ holosTokens: 1000, energyRefills: 0, ...atStep(4) });
  await call(uid, { itemName: 'Energy Refill', quantity: 3, requestId: 'ob1' });
  const p = await user(uid);
  assert.equal(p.onboarding.step, 5); assert.equal(p.energyRefills, 3);
  const refusedUid = await setup({ holosTokens: 10, ...atStep(4) });
  await refused(call(refusedUid, { itemName: 'Energy Refill', quantity: 3, requestId: 'ob2' }), 'not_enough_holos', 'failed-precondition');
  assert.equal((await user(refusedUid)).onboarding.step, 4, 'a refused purchase does not advance onboarding');
});

test('legacy single purchase beside it: {itemName} keeps its reply and refusals byte-identical and writes no ledger entry', async () => {
  const uid = await setup({ holosTokens: 1000, arenaPassses: 0 });
  assert.deepEqual(await call(uid, { itemName: 'Arena Pass' }), { holosTokens: 950, itemName: 'Arena Pass', price: 50 });
  assert.deepEqual(await call(uid, { itemName: 'Arena Pass', requestId: 'ignored_by_legacy' }), { holosTokens: 900, itemName: 'Arena Pass', price: 50 });
  assert.equal((await user(uid)).arenaPassses, 2); assert.equal((await ledger(uid)).length, 0);
  const poor = await setup({ holosTokens: 10 });
  await assert.rejects(call(poor, { itemName: 'Rank Skip' }), e => e.code === 'failed-precondition' && e.message === 'Not enough Holos.' && JSON.stringify(e.details) === '{"rejectionCode":"not_enough_holos"}');
});

test('every frozen fixture case replays through Firestore with the same reply, write and ledger entry (or the same refusal and no write)', async () => {
  const { nowMs, cases } = fixture;
  for (const [name, c] of Object.entries(cases)) {
    const uid = await setup(c.profile);
    if (c.storedReceipt) await db.doc(`vendorPurchases/${uid}/marketplaceItems/${c.request.requestId}`).set(c.storedReceipt);
    const before = await user(uid);
    try {
      const reply = await transactMarketplaceQuantityPurchase(db, uid, c.request, nowMs);
      assert.ok(c.reply, `${name}: fixture expects a refusal`);
      assert.deepEqual(reply, c.reply, name);
      if (c.storedReceipt) { assert.deepEqual(await user(uid), before, `${name}: replay writes nothing`); continue; }
      assert.deepEqual(await user(uid), { ...c.profile, ...c.updates }, `${name}: users/{uid}`);
      const entries = await ledger(uid);
      assert.equal(entries.length, 1, name);
      const { id, ...entry } = entries[0];
      assert.equal(id, c.request.requestId); assert.deepEqual(entry, c.receipt, `${name}: ledger entry`);
    } catch (e) {
      if (!(e instanceof Q.QuantityPurchaseRefusal)) throw e;
      assert.ok(c.refusal, `${name}: unexpected refusal ${e.refusal.rejectionCode}`);
      const h = refusalError(e.refusal, e.extra);
      assert.deepEqual({ code: h.code, message: h.message, details: h.details }, c.refusal, name);
      assert.deepEqual(await user(uid), before, `${name}: refusal writes nothing`);
      assert.equal((await ledger(uid)).length, c.storedReceipt ? 1 : 0, name);
    }
  }
});

test('account deletion removes the marketplace ledger entries with the Buddy Unit receipts; another pilot keeps theirs', async () => {
  const uid = await setup({ holosTokens: 2000, arenaPassses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 } });
  const other = await setup({ holosTokens: 2000, arenaPassses: 0 });
  for (const u of [uid, other]) await call(u, { itemName: 'Arena Pass', quantity: 2, requestId: 'del_1' });
  await purchaseBuddyUnit.run({ auth: { uid }, data: { tierId: 'buddy_medium', requestId: 'del_b' } });
  await deleteUserData(db, uid);
  assert.equal((await db.doc(`vendorPurchases/${uid}/marketplaceItems/del_1`).get()).exists, false);
  assert.equal((await db.doc(`vendorPurchases/${uid}/receipts/del_b`).get()).exists, false);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  assert.equal((await db.doc(`vendorPurchases/${other}/marketplaceItems/del_1`).get()).exists, true);
});
