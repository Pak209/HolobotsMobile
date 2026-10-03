// DECISIONS #48 wardrobe-2 Firestore-emulator tests: wardrobeHost transactions, boutique catalog (vendor-3), deletion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-wardrobe-tests';
const { db } = require('../lib/admin.js');
const { wardrobeHost } = require('../lib/vendors/wardrobeHost.js');
const { vendorCatalogHost } = require('../lib/vendors/vendorCatalogHost.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const W = require('../lib/lib/wardrobe.js');
const C = require('../lib/lib/wardrobeCatalog.js');
const E = require('../lib/lib/economy.js');

const fixtureDir = new URL('../../Documentation/QA/2026-10-03-pilot-wardrobe/fixtures/', import.meta.url);
async function exportFixture(name, reply) {
  const text = JSON.stringify(reply, null, 2) + '\n';
  if (/"(?:uid|token|secret|fingerprint)"\s*:/.test(text)) throw new Error('Unexpected internal field in public reply');
  await mkdir(fixtureDir, { recursive: true }); await writeFile(new URL(name + '.json', fixtureDir), text);
}
let serial = 0;
const setup = async (fields = {}) => { const uid = `w_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots: [], holosTokens: 0, ...fields }); return uid; };
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const wardrobe = async uid => (await db.doc(`wardrobes/${uid}`).get()).data();
const receipt = async (uid, id) => (await db.doc(`wardrobes/${uid}/receipts/${id}`).get()).exists;
const host = (uid, data) => wardrobeHost.run({ auth: { uid }, data: { schemaVersion: 'wardrobe-2', ...data } });
const buy = (uid, itemId, requestId) => host(uid, { operation: 'purchase', itemId, requestId });
const equip = (uid, recipe, requestId) => host(uid, { operation: 'equip', recipe, requestId });
const rejects = (p, code, http) => assert.rejects(p, e => e.details?.rejectionCode === code && (!http || e.code === http));
const base = () => structuredClone(W.defaultRecipe());

test('status writes nothing and grants nothing: no wardrobe doc, untouched user, default recipe, every whitelist', async () => {
  const uid = await setup({ holosTokens: 42, buddyUnits: 3 });
  const before = await user(uid);
  const s = await host(uid, { operation: 'status' });
  assert.equal(s.schemaVersion, 'wardrobe-2'); assert.deepEqual(s.entitlements, []); assert.equal(s.recipeSaved, false); assert.deepEqual(s.recipe, W.defaultRecipe());
  assert.equal(s.holosTokens, 42); assert.deepEqual(s.catalog.slots, C.WARDROBE_SLOTS); assert.deepEqual(s.catalog.sliders.keys, C.SLIDER_KEYS); assert.deepEqual(s.catalog.colors.channels, C.COLOR_CHANNELS);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, false); assert.deepEqual(await user(uid), before);
  assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 0);
  await exportFixture('wardrobe-2_status_fresh', s);
  await assert.rejects(() => wardrobeHost.run({ data: { schemaVersion: 'wardrobe-2', operation: 'status' } }), e => e.code === 'unauthenticated');
  await rejects(host(`nouser_${Date.now()}`, { operation: 'status' }), 'unavailable', 'unavailable');
  await rejects(wardrobeHost.run({ auth: { uid }, data: { operation: 'status' } }), 'invalid_request', 'invalid-argument');
});

test('purchase success: Holos spend + entitlement + receipt in one transaction; refusal (not_enough_holos) writes nothing', async () => {
  const uid = await setup({ holosTokens: 1000 });
  const r = await buy(uid, 'ph.top.hoodie_01', 'p1');
  assert.deepEqual([r.operation, r.alreadyProcessed, r.holosTokens, r.entitlements], ['purchase', false, 700, ['ph.top.hoodie_01']]);
  assert.deepEqual(r.purchased, { itemId: 'ph.top.hoodie_01', price: E.MARKETPLACE_PART_PRICES.common });
  assert.equal((await user(uid)).holosTokens, 700); assert.deepEqual((await wardrobe(uid)).entitlements, ['ph.top.hoodie_01']); assert.ok(await receipt(uid, 'p1'));
  await exportFixture('wardrobe-2_purchase', r);
  const before = { u: await user(uid), w: await wardrobe(uid) };
  await assert.rejects(buy(uid, 'ph.hat.helmet_01', 'p2'), e => e.code === 'failed-precondition' && e.message === 'Not enough Holos.' && e.details.rejectionCode === 'not_enough_holos');
  assert.deepEqual({ u: await user(uid), w: await wardrobe(uid) }, before); assert.equal(await receipt(uid, 'p2'), false);
  await db.doc(`users/${uid}`).update({ holosTokens: 1500 });
  assert.equal((await buy(uid, 'ph.hat.helmet_01', 'p2')).holosTokens, 0, 'the refused requestId succeeds once affordable');
  for (const itemId of ['ph.hat.cap_01', 'ph.nope', '']) await rejects(buy(uid, itemId, 'p3'), 'invalid_request', 'invalid-argument');
});

test('idempotent retry: parallel and later retries charge once; same requestId with a different command is sequence_conflict', async () => {
  const uid = await setup({ holosTokens: 5000 });
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => buy(uid, 'ph.backAccessory.wings_01', 'once')));
  assert.deepEqual(settled.filter(r => r.status === 'rejected').map(r => `${r.reason?.code} ${r.reason?.message}`), [], 'no retry may fail');
  const rs = settled.map(r => r.value);
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1); for (const r of rs) { assert.equal(r.holosTokens, 3500); assert.deepEqual(r.entitlements, ['ph.backAccessory.wings_01']); }
  assert.equal((await user(uid)).holosTokens, 3500);
  const later = await buy(uid, 'ph.backAccessory.wings_01', 'once'); assert.equal(later.alreadyProcessed, true); assert.equal(later.holosTokens, 3500);
  await rejects(buy(uid, 'ph.top.armor_01', 'once'), 'sequence_conflict', 'already-exists');
  await rejects(equip(uid, base(), 'once'), 'sequence_conflict', 'already-exists');
  assert.equal((await user(uid)).holosTokens, 3500); assert.deepEqual((await wardrobe(uid)).entitlements, ['ph.backAccessory.wings_01']);
  // Equip retries replay too: a re-sent equip doesn't overwrite a newer saved recipe.
  const r1 = base(); r1.colors = { hair: '#112233' };
  await equip(uid, r1, 'eq1');
  const r2 = base(); r2.colors = { hair: '#445566' };
  await equip(uid, r2, 'eq2');
  assert.equal((await equip(uid, r1, 'eq1')).alreadyProcessed, true);
  assert.equal((await wardrobe(uid)).recipe.colors.hair, '#445566');
});

test('already_owned: a new requestId for an owned item is refused with no charge and no receipt', async () => {
  const uid = await setup({ holosTokens: 3000 });
  await buy(uid, 'ph.top.armor_01', 'a1');
  const before = { u: await user(uid), w: await wardrobe(uid) };
  await rejects(buy(uid, 'ph.top.armor_01', 'a2'), 'already_owned', 'already-exists');
  assert.deepEqual({ u: await user(uid), w: await wardrobe(uid) }, before); assert.equal(await receipt(uid, 'a2'), false);
  const parallel = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => buy(uid, 'ph.hair.mohawk_01', `m${k}`)));
  assert.equal(parallel.filter(p => p.status === 'fulfilled').length, 1, 'racing new requestIds buy once');
  for (const p of parallel.filter(p => p.status === 'rejected')) assert.equal(p.reason.details?.rejectionCode, 'already_owned', `unexpected rejection: ${p.reason?.code} ${p.reason?.message}`);
  assert.equal((await user(uid)).holosTokens, 1500 - 750);
});

test('equip: starter-only with zero Holos is OK; unowned / wrong slot / unknown keys / bad sliders / bad hex / oversize are rejected with nothing stored', async () => {
  const uid = await setup({ holosTokens: 0 });
  const r = base(); Object.assign(r.parts, { top: 'ph.top.jacket_01', hat: 'ph.hat.cap_01' }); r.sliders = { height: 0.4, jaw: -1 }; r.colors = { skin: '#c08060', primary: '#1F8FFF' };
  const ok = await equip(uid, r, 's1');
  assert.equal(ok.recipeSaved, true); assert.equal(ok.holosTokens, 0); assert.equal(ok.recipe.colors.skin, '#C08060');
  assert.deepEqual((await wardrobe(uid)).recipe, ok.recipe); assert.equal((await user(uid)).holosTokens, 0);
  const st = await host(uid, { operation: 'status' }); assert.equal(st.recipeSaved, true); assert.deepEqual(st.recipe, ok.recipe);
  await exportFixture('wardrobe-2_equip', ok);
  const stored = await wardrobe(uid);
  const withPart = (slot, id) => { const x = base(); x.parts[slot] = id; return x; };
  await rejects(equip(uid, withPart('hat', 'ph.hat.helmet_01'), 'x1'), 'not_owned', 'failed-precondition');
  for (const [i, bad] of [withPart('hat', 'ph.top.tee_01'), withPart('hair', 'ph.hair.ghost'), withPart('hair', null), { ...base(), extra: true }, withPart('wings', 'ph.backAccessory.pack_01'),
    { ...base(), sliders: { height: 1.5 } }, { ...base(), sliders: { tail: 0 } }, { ...base(), colors: { hair: '#12345' } }, { ...base(), colors: { glow: '#123456' } },
    { ...base(), colors: { hair: '#123456' }, pad: 'x'.repeat(5000) }].entries())
    await rejects(equip(uid, bad, `x${i + 2}`), 'invalid_request', 'invalid-argument');
  assert.deepEqual(await wardrobe(uid), stored);
  assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 1, 'only the successful equip left a receipt');
  // Owning it makes the same recipe valid.
  await db.doc(`users/${uid}`).update({ holosTokens: 1500 }); await buy(uid, 'ph.hat.helmet_01', 'b1');
  assert.equal((await equip(uid, withPart('hat', 'ph.hat.helmet_01'), 'x99')).recipe.parts.hat, 'ph.hat.helmet_01');
});

test('no reset trap: a malformed or wrong-schema wardrobe fails closed and is never overwritten by a purchase', async () => {
  for (const bad of [{ entitlements: 'ph.hat.helmet_01' }, { schemaVersion: 'wardrobe-1', entitlements: ['ph.hat.helmet_01'], recipe: null }, { schemaVersion: 'wardrobe-2', entitlements: [3], recipe: null }]) {
    const uid = await setup({ holosTokens: 5000 });
    await db.doc(`wardrobes/${uid}`).set(bad);
    for (const data of [{ operation: 'status' }, { operation: 'purchase', itemId: 'ph.top.hoodie_01', requestId: 'r' }, { operation: 'equip', recipe: base(), requestId: 'e' }])
      await rejects(host(uid, data), 'unavailable', 'unavailable');
    assert.deepEqual(await wardrobe(uid), bad); assert.equal((await user(uid)).holosTokens, 5000);
    await rejects(vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'boutique' } }), 'unavailable', 'unavailable');
  }
});

test('boutique catalog (vendor-3): prices equal the economy table; owned flags follow purchases; purchase descriptor drives wardrobeHost', async () => {
  const uid = await setup({ holosTokens: 2000 });
  const c0 = await vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'boutique' } });
  assert.equal(c0.schemaVersion, 'vendor-3');
  for (const l of c0.listings) assert.equal(l.price, E.MARKETPLACE_PART_PRICES[C.WARDROBE_ITEM_BY_ID.get(l.details.itemId).rarity]);
  const listing = c0.listings.find(l => l.listingId === 'clothing.ph.bottom.armor_01');
  const bought = await wardrobeHost.run({ auth: { uid }, data: { ...listing.purchase.request, requestId: 'from-catalog' } });
  assert.equal(bought.purchased.price, listing.price);
  const c1 = await vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'boutique' } });
  const after = c1.listings.find(l => l.listingId === listing.listingId); assert.equal(after.owned, 1); assert.equal(after.available, false);
  assert.equal(c1.holosTokens, 2000 - listing.price);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, true);
  await exportFixture('vendor-3_catalog_boutique', c1);
  const m = await vendorCatalogHost.run({ auth: { uid }, data: { operation: 'catalog', vendorId: 'marketplace' } });
  assert.equal(m.schemaVersion, 'vendor-3'); assert.equal(m.listings.some(l => l.kind === 'clothing'), false);
});

test('account deletion removes the whole wardrobe tree (doc + receipts); other pilots untouched', async () => {
  const uid = await setup({ holosTokens: 1000 }), other = await setup({ holosTokens: 1000 });
  for (const u of [uid, other]) { await buy(u, 'ph.top.hoodie_01', 'd1'); await equip(u, base(), 'd2'); }
  await deleteUserData(db, uid);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, false); assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 0);
  assert.equal((await db.doc(`wardrobes/${other}`).get()).exists, true); assert.equal((await db.collection(`wardrobes/${other}/receipts`).get()).size, 2);
});
