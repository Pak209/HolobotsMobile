// DECISIONS #48 wardrobe-3 Firestore-emulator tests: wardrobeHost transactions, boutique catalog (vendor-3), deletion.
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
const host = (uid, data) => wardrobeHost.run({ auth: { uid }, data: { schemaVersion: 'wardrobe-3', ...data } });
const buy = (uid, itemId, requestId) => host(uid, { operation: 'purchase', itemId, requestId });
const equip = (uid, recipe, requestId) => host(uid, { operation: 'equip', recipe, requestId });
const rejects = (p, code, http) => assert.rejects(p, e => e.details?.rejectionCode === code && (!http || e.code === http));
const base = () => structuredClone(W.defaultRecipe());

test('status writes nothing and grants nothing: no wardrobe doc, untouched user, default recipe, every whitelist', async () => {
  const uid = await setup({ holosTokens: 42, buddyUnits: 3 });
  const before = await user(uid);
  const s = await host(uid, { operation: 'status' });
  assert.equal(s.schemaVersion, 'wardrobe-3'); assert.deepEqual(s.entitlements, []); assert.equal(s.recipeSaved, false); assert.deepEqual(s.recipe, W.defaultRecipe());
  assert.equal(s.holosTokens, 42); assert.deepEqual(s.catalog, W.wardrobeCatalogView([])); assert.equal(s.catalog.items.length, 120); assert.equal(s.catalog.placeholder, false);
  assert.deepEqual(s.catalog.slots.map(x => x.slot), C.WARDROBE_SLOTS.map(x => x.slot)); assert.deepEqual([...s.catalog.shapes.body, ...s.catalog.shapes.face], C.SHAPE_KEYS); assert.deepEqual(s.catalog.colors.globalChannels, C.GLOBAL_COLOR_CHANNELS);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, false); assert.deepEqual(await user(uid), before);
  assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 0);
  await exportFixture('wardrobe-3_status_fresh', s);
  await assert.rejects(() => wardrobeHost.run({ data: { schemaVersion: 'wardrobe-3', operation: 'status' } }), e => e.code === 'unauthenticated');
  await rejects(host(`nouser_${Date.now()}`, { operation: 'status' }), 'unavailable', 'unavailable');
  await rejects(wardrobeHost.run({ auth: { uid }, data: { operation: 'status' } }), 'invalid_request', 'invalid-argument');
});

test('purchase success: Holos spend + entitlement + receipt in one transaction; refusal (not_enough_holos) writes nothing', async () => {
  const uid = await setup({ holosTokens: 1000 });
  const r = await buy(uid, 'top_openhoodie', 'p1');
  assert.deepEqual([r.operation, r.alreadyProcessed, r.holosTokens, r.entitlements], ['purchase', false, 700, ['top_openhoodie']]);
  assert.deepEqual(r.purchased, { itemId: 'top_openhoodie', price: E.MARKETPLACE_PART_PRICES.common });
  assert.equal((await user(uid)).holosTokens, 700); assert.deepEqual((await wardrobe(uid)).entitlements, ['top_openhoodie']); assert.ok(await receipt(uid, 'p1'));
  await exportFixture('wardrobe-3_purchase', r);
  const before = { u: await user(uid), w: await wardrobe(uid) };
  await assert.rejects(buy(uid, 'top_fullsuit', 'p2'), e => e.code === 'failed-precondition' && e.message === 'Not enough Holos.' && e.details.rejectionCode === 'not_enough_holos');
  assert.deepEqual({ u: await user(uid), w: await wardrobe(uid) }, before); assert.equal(await receipt(uid, 'p2'), false);
  await db.doc(`users/${uid}`).update({ holosTokens: 1500 });
  assert.equal((await buy(uid, 'top_fullsuit', 'p2')).holosTokens, 0, 'the refused requestId succeeds once affordable');
  for (const itemId of ['top_tshirt', 'hairfront_asymmetricalfringe', 'upperface_roundglasseslens', 'Top_FullSuit', 'nope', '']) await rejects(buy(uid, itemId, 'p3'), 'invalid_request', 'invalid-argument');
});

test('idempotent retry: parallel and later retries charge once; same requestId with a different command is sequence_conflict', async () => {
  const uid = await setup({ holosTokens: 5000 });
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => buy(uid, 'headacc_kittyears', 'once')));
  assert.deepEqual(settled.filter(r => r.status === 'rejected').map(r => `${r.reason?.code} ${r.reason?.message}`), [], 'no retry may fail');
  const rs = settled.map(r => r.value);
  assert.equal(rs.filter(r => !r.alreadyProcessed).length, 1); for (const r of rs) { assert.equal(r.holosTokens, 3500); assert.deepEqual(r.entitlements, ['headacc_kittyears']); }
  assert.equal((await user(uid)).holosTokens, 3500);
  const later = await buy(uid, 'headacc_kittyears', 'once'); assert.equal(later.alreadyProcessed, true); assert.equal(later.holosTokens, 3500);
  await rejects(buy(uid, 'top_hardjacket', 'once'), 'sequence_conflict', 'already-exists');
  await rejects(equip(uid, base(), 'once'), 'sequence_conflict', 'already-exists');
  assert.equal((await user(uid)).holosTokens, 3500); assert.deepEqual((await wardrobe(uid)).entitlements, ['headacc_kittyears']);
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
  await buy(uid, 'top_hardjacket', 'a1');
  const before = { u: await user(uid), w: await wardrobe(uid) };
  await rejects(buy(uid, 'top_hardjacket', 'a2'), 'already_owned', 'already-exists');
  assert.deepEqual({ u: await user(uid), w: await wardrobe(uid) }, before); assert.equal(await receipt(uid, 'a2'), false);
  const parallel = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => buy(uid, 'hat_fedora', `m${k}`)));
  assert.equal(parallel.filter(p => p.status === 'fulfilled').length, 1, 'racing new requestIds buy once');
  for (const p of parallel.filter(p => p.status === 'rejected')) assert.equal(p.reason.details?.rejectionCode, 'already_owned', `unexpected rejection: ${p.reason?.code} ${p.reason?.message}`);
  assert.equal((await user(uid)).holosTokens, 3000 - 750 - 750);
});

test('equip: starter-only with zero Holos is OK; unowned / wrong slot / hide rule / faceLayer / colour cap / unknown keys / bad shapes / bad hex / oversize are rejected with nothing stored', async () => {
  const uid = await setup({ holosTokens: 0 });
  const r = base(); Object.assign(r.parts, { top: 'top_tshirt', socks: 'socks_basicsocks', hairBack: 'hairback_casualflow' });
  Object.assign(r.faceLayers, { head: 'Head_SharpHead', faceDetails: 'FaceDetail_Freakles', underLower: 'Underlower_ShortSpats' });
  r.shapes = { Weight: 40, Muscle: 100, Stern: 0 }; r.colors = { skin: '#c08060', top: ['#1f8fff', '#000000'], socks: [] };
  const ok = await equip(uid, r, 's1');
  assert.equal(ok.recipeSaved, true); assert.equal(ok.holosTokens, 0); assert.equal(ok.recipe.colors.skin, '#C08060');
  assert.deepEqual(ok.recipe.colors.top, ['#1F8FFF', '#000000']); assert.equal('socks' in ok.recipe.colors, false, 'empty slot arrays are dropped');
  assert.deepEqual((await wardrobe(uid)).recipe, ok.recipe); assert.equal((await user(uid)).holosTokens, 0);
  const st = await host(uid, { operation: 'status' }); assert.equal(st.recipeSaved, true); assert.deepEqual(st.recipe, ok.recipe);
  await exportFixture('wardrobe-3_equip', ok);
  const stored = await wardrobe(uid);
  const withPart = (slot, id) => { const x = base(); x.parts[slot] = id; return x; };
  const withLayer = (layer, v) => { const x = base(); x.faceLayers[layer] = v; return x; };
  await rejects(equip(uid, withPart('top', 'top_fullsuit'), 'x1'), 'not_owned', 'failed-precondition');
  await rejects(equip(uid, withPart('hat', 'hat_fedora'), 'x1b'), 'not_owned', 'failed-precondition');
  for (const [i, bad] of [withPart('hat', 'top_tshirt'), withPart('hairFront', 'hairfront_ghost'), withPart('hairFront', null), withPart('bottom', null), withPart('upperFace', 'upperface_roundglasseslens'),
    { ...base(), extra: true }, withPart('wings', 'top_tshirt'), withLayer('head', 'Head_Ghost'), withLayer('eyes', null), withLayer('tail', 'Tail_Long'),
    { ...base(), shapes: { Weight: 100.5 } }, { ...base(), shapes: { Weight: -1 } }, { ...base(), shapes: { height: 10 } }, { ...base(), sliders: { height: 0.4 } }, { ...base(), colors: { hair: '#12345' } }, { ...base(), colors: { glow: '#123456' } },
    { ...base(), colors: { top: ['#111111', '#222222', '#333333'] } }, { ...base(), colors: { hat: ['#111111'] } },
    { ...base(), colors: { hair: '#123456' }, pad: 'x'.repeat(5000) }].entries())
    await rejects(equip(uid, bad, `x${i + 2}`), 'invalid_request', 'invalid-argument');
  assert.deepEqual(await wardrobe(uid), stored);
  assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 1, 'only the successful equip left a receipt');
  // Owning it makes the same recipe valid.
  await db.doc(`users/${uid}`).update({ holosTokens: 3000 }); await buy(uid, 'top_fullsuit', 'b1');
  assert.equal((await equip(uid, withPart('top', 'top_fullsuit'), 'x99')).recipe.parts.top, 'top_fullsuit');
  // Hide rule, both directions: a Bottom-hiding top requires bottom === null.
  await buy(uid, 'top_sundress', 'b2');
  await rejects(equip(uid, withPart('top', 'top_sundress'), 'h1'), 'invalid_request', 'invalid-argument');
  const dress = withPart('top', 'top_sundress'); dress.parts.bottom = null;
  const hidden = await equip(uid, dress, 'h2'); assert.equal(hidden.recipe.parts.bottom, null); assert.equal(hidden.recipe.parts.top, 'top_sundress');
  await exportFixture('wardrobe-3_equip_hidden_bottom', hidden);
});

test('no reset trap: a malformed or wrong-schema wardrobe fails closed and is never overwritten by a purchase', async () => {
  for (const bad of [{ entitlements: 'top_fullsuit' }, { schemaVersion: 'wardrobe-2', entitlements: ['ph.hat.helmet_01'], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: [3], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: 'top_fullsuit', recipe: null }]) {
    const uid = await setup({ holosTokens: 5000 });
    await db.doc(`wardrobes/${uid}`).set(bad);
    for (const data of [{ operation: 'status' }, { operation: 'purchase', itemId: 'top_openhoodie', requestId: 'r' }, { operation: 'equip', recipe: base(), requestId: 'e' }])
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
  const listing = c0.listings.find(l => l.listingId === 'clothing.bottom_basichakma');
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
  for (const u of [uid, other]) { await buy(u, 'top_openhoodie', 'd1'); await equip(u, base(), 'd2'); }
  await deleteUserData(db, uid);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, false); assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 0);
  assert.equal((await db.doc(`wardrobes/${other}`).get()).exists, true); assert.equal((await db.collection(`wardrobes/${other}/receipts`).get()).size, 2);
});
