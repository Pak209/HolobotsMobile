// desktop-items-quantity-1 (HolobotsUnity DECISIONS #72.32) Firestore-emulator tests: the desktopItemsHost quantity buy of a
// healing item (buy, the one receipt, replay, conflict, refusals that write nothing, the zone between-battles rule, onboarding,
// account deletion), the callable's error details, every frozen fixture case replayed through Firestore, and the legacy
// one-per-buy request unchanged beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-desktop-items-quantity-tests';
delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;
const { db } = require('../lib/admin.js');
const { desktopItemsHost, transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const I = require('../lib/lib/desktopItems.js');
const H = require('../lib/lib/repairItems.js');
const fixture = require('./fixtures/desktop-items-2-quantity/cases.json');
const { digest, sha256 } = await import('./generate-desktop-items-quantity-fixture.mjs');

let serial = 0;
const newUid = tag => `${tag}_${Date.now()}_${serial++}`;
const setup = async fields => { const uid = newUid('diq'); await db.doc(`users/${uid}`).set(fields); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const receipts = async uid => (await db.collection(`itemInventories/${uid}/receipts`).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const call = (uid, data) => desktopItemsHost.run({ auth: { uid }, data });
const buy = (itemId, quantity, requestId, extra = {}) => ({ schemaVersion: 'desktop-items-2', operation: 'buy', itemId, requestId, ...(quantity === undefined ? {} : { quantity }), ...extra });
const refused = (p, rejectionCode, details) => assert.rejects(p, e => {
  assert.equal(e.code, 'failed-precondition', rejectionCode); assert.equal(e.message, rejectionCode); assert.equal(e.details?.rejectionCode, rejectionCode);
  if (details) assert.equal(JSON.stringify(e.details), JSON.stringify({ ...details, rejectionCode }), 'details exactly');
  return true;
});
const atStep = step => ({ onboarding: { step, skipped: false, stepAt: 1 } });

test('lifecycle: buy 5 kits = one debit of 5 x 250, stock + 5, ONE receipt; retry replays; another quantity / item / the legacy shape under that id conflicts', async () => {
  const uid = await setup({ holosTokens: 2000, emergencyPatches: 1, itemStocks: { repair_kit: 2, full_restore: 0 } });
  const before = Date.now();
  const r = await call(uid, buy('item.repair_kit', 5, 'buy_1'));
  assert.deepEqual(r.result, { kind: 'buy', itemId: 'item.repair_kit', quantity: 5, unitPrice: 250, price: 1250, owned: 7 });
  assert.equal(r.holosTokens, 750); assert.equal(r.schemaVersion, 'desktop-items-2'); assert.equal(r.alreadyProcessed, undefined);
  assert.equal(r.items.find(i => i.listingId === 'item.repair_kit').owned, 7);
  const p = await user(uid);
  assert.deepEqual(p, { holosTokens: 750, emergencyPatches: 1, itemStocks: { repair_kit: 7, full_restore: 0 } });
  const entries = await receipts(uid);
  assert.equal(entries.length, 1, 'one receipt for five units');
  assert.equal(entries[0].id, 'buy_1');
  assert.equal(entries[0].identity, '{"schemaVersion":"desktop-items-2","operation":"buy","itemId":"item.repair_kit","requestId":"buy_1","quantity":5}');
  assert.deepEqual(entries[0].reply, r);
  assert.ok(entries[0].createdAtMs >= before && entries[0].createdAtMs <= Date.now());

  const again = await call(uid, buy('item.repair_kit', 5, 'buy_1'));
  assert.deepEqual(again, { ...r, alreadyProcessed: true });
  assert.deepEqual(await user(uid), p, 'a replay writes nothing'); assert.equal((await receipts(uid)).length, 1);

  for (const data of [buy('item.repair_kit', 6, 'buy_1'), buy('item.full_restore', 5, 'buy_1'), buy('item.repair_kit', undefined, 'buy_1'), buy('item.repair_kit', 1, 'buy_1')])
    await refused(call(uid, data), 'sequence_conflict', {});
  assert.deepEqual(await user(uid), p, 'a conflict writes nothing'); assert.equal((await receipts(uid)).length, 1);

  const f = await call(uid, buy('item.full_restore', 1, 'buy_2'));
  assert.equal(f.holosTokens, 150); assert.equal(f.result.owned, 1);
  assert.deepEqual((await receipts(uid)).map(e => e.id).sort(), ['buy_1', 'buy_2']);
  assert.deepEqual((await db.doc(`itemInventories/${uid}`).get()).data(), { schemaVersion: 'desktop-items-2', favoriteId: null });
});

test('double-tap: the same request sent twice at once buys once (one debit, one receipt, the other a replay)', async () => {
  const uid = await setup({ holosTokens: 1200, emergencyPatches: 0 });
  const req = buy('item.emergency_patch', 12, 'tap_1');
  const replies = await Promise.all([call(uid, req), call(uid, req)]);
  assert.deepEqual(replies.map(x => x.alreadyProcessed === true).sort(), [false, true]);
  const p = await user(uid);
  assert.equal(p.holosTokens, 0); assert.equal(p.emergencyPatches, 12); assert.equal((await receipts(uid)).length, 1);
});

test('refusals carry the code and host numbers and write nothing; an over-cap request succeeds later under the same requestId', async () => {
  const uid = await setup({ holosTokens: 1000, emergencyPatches: 995, itemStocks: { repair_kit: 0, full_restore: 0 } });
  const before = await user(uid);
  await refused(call(uid, buy('item.emergency_patch', 5, 'r1')), 'over_cap', { cap: 999, owned: 995, maxQuantity: 4 });
  await refused(call(uid, buy('item.full_restore', 2, 'r2')), 'not_enough_holos', { price: 1200, holosTokens: 1000, shortfall: 200 });
  for (const data of [buy('item.repair_kit', 0, 'r3'), buy('item.repair_kit', 100, 'r3'), buy('item.repair_kit', 2.5, 'r3'), buy('item.repair_kit', null, 'r3'), buy('item.energy_refill', 2, 'r3'),
    buy('item.energy_refill', 1, 'r3'), { ...buy('item.repair_kit', 2, 'r3'), operation: 'use', holobotId: 'ace' }, buy('item.repair_kit', 2, 'r3', { price: 1 }), buy('item.repair_kit', 2, 'r3', { holobotId: 'ace' }),
    (({ requestId, ...rest }) => rest)(buy('item.repair_kit', 2, 'x'))])
    await refused(call(uid, data), 'invalid_request', {});
  assert.deepEqual(await user(uid), before, 'refusals write nothing');
  assert.equal((await receipts(uid)).length, 0, 'no receipt for a refusal');
  assert.equal((await db.doc(`itemInventories/${uid}`).get()).exists, false);
  // over_cap is checked before funds: a pilot at the cap with no Holos hears over_cap.
  const capped = await setup({ holosTokens: 0, itemStocks: { repair_kit: 999 } });
  await refused(call(capped, buy('item.repair_kit', 1, 'c1')), 'over_cap', { cap: 999, owned: 999, maxQuantity: 0 });
  // The refused request stored nothing, so the same requestId succeeds once it fits.
  const fits = await call(uid, buy('item.emergency_patch', 4, 'r1'));
  assert.equal(fits.result.owned, 999); assert.equal(fits.holosTokens, 600);
  // Missing profile / malformed balance / malformed stock / signed out.
  const ghost = newUid('ghost');
  await refused(call(ghost, buy('item.repair_kit', 2, 'g1')), 'unavailable', {});
  assert.equal((await db.doc(`users/${ghost}`).get()).exists, false);
  for (const fields of [{ holosTokens: '5000' }, { holosTokens: 5000, itemStocks: { repair_kit: 1.5 } }, { holosTokens: 5000, emergencyPatches: -1 }]) {
    const bad = await setup(fields);
    await refused(call(bad, buy(fields.emergencyPatches === -1 ? 'item.emergency_patch' : 'item.repair_kit', 2, 'b1')), 'unavailable', {});
    assert.deepEqual(await user(bad), fields);
  }
  await assert.rejects(desktopItemsHost.run({ data: buy('item.repair_kit', 2, 'u1') }), e => e.code === 'unauthenticated');
});

test('between battles: an open zone expedition refuses a quantity buy before cap and funds, writes nothing, and still replays an earlier receipt', async () => {
  const uid = await setup({ holosTokens: 1000, itemStocks: { repair_kit: 999 }, emergencyPatches: 0 });
  const earlier = await call(uid, buy('item.emergency_patch', 2, 'pre_1'));
  await db.doc(`holoZoneRuns/${uid}`).set({ expedition: { runId: 'exp_1', open: true } });
  const before = await user(uid);
  await refused(call(uid, buy('item.repair_kit', 5, 'z1')), 'between_battles_only', {});
  await refused(call(uid, buy('item.emergency_patch', 2, 'z2')), 'between_battles_only', {});
  assert.deepEqual(await user(uid), before); assert.equal((await receipts(uid)).length, 1);
  assert.deepEqual(await call(uid, buy('item.emergency_patch', 2, 'pre_1')), { ...earlier, alreadyProcessed: true }, 'the receipt check comes first, as for every desktopItemsHost request');
  await refused(call(uid, buy('item.emergency_patch', 3, 'pre_1')), 'sequence_conflict', {});
});

test('onboarding: a quantity buy completes the market beat once (4 -> 5), like any vendor purchase; a refused one does not', async () => {
  const uid = await setup({ holosTokens: 1000, ...atStep(4) });
  await call(uid, buy('item.repair_kit', 3, 'ob1'));
  const p = await user(uid);
  assert.equal(p.onboarding.step, 5); assert.deepEqual(p.itemStocks, { repair_kit: 3 });
  const poor = await setup({ holosTokens: 10, ...atStep(4) });
  await refused(call(poor, buy('item.repair_kit', 3, 'ob2')), 'not_enough_holos', { price: 750, holosTokens: 10, shortfall: 740 });
  assert.equal((await user(poor)).onboarding.step, 4, 'a refused purchase does not advance onboarding');
});

test('legacy request beside it: no quantity keeps the {kind, itemId} result, the receipt identity and refusal details {rejectionCode}', async () => {
  const uid = await setup({ holosTokens: 1000, emergencyPatches: 999 });
  const r = await call(uid, buy('item.emergency_patch', undefined, 'lg_1'));
  assert.deepEqual(r.result, { kind: 'buy', itemId: 'item.emergency_patch' });
  assert.equal((await user(uid)).emergencyPatches, 1000, 'the legacy buy stays uncapped');
  assert.equal((await receipts(uid))[0].identity, '{"schemaVersion":"desktop-items-2","operation":"buy","itemId":"item.emergency_patch","requestId":"lg_1"}');
  const poor = await setup({ holosTokens: 10 });
  await assert.rejects(call(poor, buy('item.repair_kit', undefined, 'lg_2')), e => e.code === 'failed-precondition' && e.message === 'not_enough_holos' && JSON.stringify(e.details) === '{"rejectionCode":"not_enough_holos"}');
});

test('every frozen fixture case replays through Firestore with the same reply, write and receipt (or the same refusal and no write)', async () => {
  const { nowMs } = fixture;
  for (const [name, c] of Object.entries({ ...fixture.cases, ...fixture.legacyCases })) {
    const uid = await setup(c.profile);
    if (c.storedReceiptOf) { await transactDesktopItems(db, uid, fixture.cases[c.storedReceiptOf].request, nowMs); await db.doc(`users/${uid}`).set(c.profile); }
    const before = await user(uid), stored = (await receipts(uid)).length;
    try {
      const reply = await transactDesktopItems(db, uid, c.request, nowMs);
      assert.ok(c.reply, `${name}: fixture expects a refusal`);
      assert.deepEqual(digest(reply), c.reply, name);
      if (c.storedReceiptOf) { assert.deepEqual(await user(uid), before, `${name}: replay writes nothing`); assert.equal((await receipts(uid)).length, 1); continue; }
      assert.equal(sha256(reply), c.replySha256, `${name}: whole reply`);
      assert.deepEqual(await user(uid), { ...c.profile, ...c.updates }, `${name}: users/{uid}`);
      const entries = await receipts(uid);
      assert.equal(entries.length, 1, name);
      const { id, reply: storedReply, ...entry } = entries[0];
      assert.equal(id, c.request.requestId); assert.deepEqual(entry, c.receipt, `${name}: receipt`); assert.deepEqual(storedReply, reply, `${name}: receipt reply`);
    } catch (e) {
      if (!(e instanceof I.ItemError || e instanceof H.RepairError)) throw e;
      assert.ok(c.refusal, `${name}: unexpected refusal ${e.code}`);
      assert.deepEqual({ code: 'failed-precondition', message: e.code, details: { ...(e instanceof I.ItemError ? e.extra : undefined), rejectionCode: e.code } }, c.refusal, name);
      assert.deepEqual(await user(uid), before, `${name}: refusal writes nothing`);
      assert.equal((await receipts(uid)).length, stored, name);
    }
  }
});

test('account deletion removes the quantity receipts with the inventory; another pilot keeps theirs', async () => {
  const uid = await setup({ holosTokens: 2000 }), other = await setup({ holosTokens: 2000 });
  for (const u of [uid, other]) await call(u, buy('item.repair_kit', 2, 'del_1'));
  await deleteUserData(db, uid);
  assert.equal((await db.doc(`itemInventories/${uid}/receipts/del_1`).get()).exists, false);
  assert.equal((await db.doc(`itemInventories/${uid}`).get()).exists, false);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  assert.equal((await db.doc(`itemInventories/${other}/receipts/del_1`).get()).exists, true);
});
