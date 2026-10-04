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
const equip = (uid, recipe, requestId, loadout = 'city') => host(uid, { operation: 'equip', loadout, recipe, requestId });
const rejects = (p, code, http) => assert.rejects(p, e => e.details?.rejectionCode === code && (!http || e.code === http));
const base = () => structuredClone(W.defaultRecipe());

test('status writes nothing and grants nothing: no wardrobe doc, untouched user, default recipe, every whitelist', async () => {
  const uid = await setup({ holosTokens: 42, buddyUnits: 3 });
  const before = await user(uid);
  const s = await host(uid, { operation: 'status' });
  assert.equal(s.schemaVersion, 'wardrobe-3'); assert.deepEqual(s.entitlements, []); assert.deepEqual(s.saved, { city: false, field: false }); assert.deepEqual(s.loadouts, { city: W.defaultRecipe(), field: W.defaultRecipe() });
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
  assert.equal((await wardrobe(uid)).identity.colors.hair, '#445566');
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
  assert.deepEqual(ok.saved, { city: true, field: false }); assert.equal(ok.holosTokens, 0); assert.equal(ok.loadouts.city.colors.skin, '#C08060');
  assert.deepEqual(ok.loadouts.city.colors.top, ['#1F8FFF', '#000000']); assert.equal('socks' in ok.loadouts.city.colors, false, 'empty slot arrays are dropped');
  assert.deepEqual(W.loadoutRecipes(W.readWardrobeState(await wardrobe(uid))), ok.loadouts); assert.equal((await wardrobe(uid)).loadouts.field, null); assert.equal((await user(uid)).holosTokens, 0);
  const st = await host(uid, { operation: 'status' }); assert.deepEqual(st.saved, ok.saved); assert.deepEqual(st.loadouts, ok.loadouts);
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
  assert.equal((await equip(uid, withPart('top', 'top_fullsuit'), 'x99')).loadouts.city.parts.top, 'top_fullsuit');
  // Hide rule, both directions: a Bottom-hiding top requires bottom === null.
  await buy(uid, 'top_sundress', 'b2');
  await rejects(equip(uid, withPart('top', 'top_sundress'), 'h1'), 'invalid_request', 'invalid-argument');
  const dress = withPart('top', 'top_sundress'); dress.parts.bottom = null;
  const hidden = await equip(uid, dress, 'h2'); assert.equal(hidden.loadouts.city.parts.bottom, null); assert.equal(hidden.loadouts.city.parts.top, 'top_sundress');
  await exportFixture('wardrobe-3_equip_hidden_bottom', hidden);
});

test('no reset trap: a malformed or wrong-schema wardrobe fails closed and is never overwritten by a purchase', async () => {
  for (const bad of [{ entitlements: 'top_fullsuit' }, { schemaVersion: 'wardrobe-2', entitlements: ['ph.hat.helmet_01'], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: [3], identity: null, loadouts: { city: null, field: null } }, { schemaVersion: 'wardrobe-3', entitlements: 'top_fullsuit', identity: null, loadouts: { city: null, field: null } },
    { schemaVersion: 'wardrobe-3', entitlements: ['top_fullsuit'], recipe: null } /* pre-loadouts draft shape */, { schemaVersion: 'wardrobe-3', entitlements: [], identity: null, loadouts: { city: null } }]) {
    const uid = await setup({ holosTokens: 5000 });
    await db.doc(`wardrobes/${uid}`).set(bad);
    for (const data of [{ operation: 'status' }, { operation: 'purchase', itemId: 'top_openhoodie', requestId: 'r' }, { operation: 'equip', loadout: 'city', recipe: base(), requestId: 'e' }])
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
  for (const u of [uid, other]) { await buy(u, 'top_openhoodie', 'd1'); await equip(u, base(), 'd2', 'city'); await equip(u, base(), 'd3', 'field'); }
  const before = await wardrobe(uid); assert.ok(before.loadouts.city && before.loadouts.field, 'both loadouts saved before deletion');
  await deleteUserData(db, uid);
  assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists, false); assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size, 0);
  assert.equal((await db.doc(`wardrobes/${other}`).get()).exists, true); assert.equal((await db.collection(`wardrobes/${other}/receipts`).get()).size, 3);
  const gone = await host(uid, { operation: 'status' }).catch(e => e); assert.equal(gone.details?.rejectionCode, 'unavailable', 'profile deleted too');
});

test('loadouts: City and Field equip independently; unset Field reads as City and status writes nothing; owned items in either; bad loadout rejected', async () => {
  const uid = await setup({ holosTokens: 2250 });
  await buy(uid, 'top_fullsuit', 'b1'); await buy(uid, 'hat_fedora', 'b2');
  const city = base(); Object.assign(city.parts, { top: 'top_tshirt', hat: 'hat_fedora' }); city.colors = { skin: '#C08060', top: ['#112233'] }; city.shapes = { Weight: 30 };
  const c = await equip(uid, city, 'c1', 'city');
  assert.deepEqual(c.saved, { city: true, field: false }); assert.deepEqual(c.loadouts.field, c.loadouts.city);
  const docAfterCity = await wardrobe(uid);
  const s1 = await host(uid, { operation: 'status' });
  assert.deepEqual(s1.loadouts.field, s1.loadouts.city, 'unset field reads as city'); assert.deepEqual(await wardrobe(uid), docAfterCity, 'the read wrote nothing');
  assert.equal(docAfterCity.loadouts.field, null);
  const field = base(); Object.assign(field.parts, { top: 'top_fullsuit', hat: 'hat_fedora' }); field.colors = { skin: '#C08060', top: ['#FF0000', '#00FF00'] }; field.shapes = { Weight: 30 };
  const f = await equip(uid, field, 'f1', 'field');
  assert.deepEqual(f.saved, { city: true, field: true });
  assert.equal(f.loadouts.city.parts.top, 'top_tshirt'); assert.equal(f.loadouts.field.parts.top, 'top_fullsuit');
  assert.equal(f.loadouts.city.parts.hat, 'hat_fedora'); assert.equal(f.loadouts.field.parts.hat, 'hat_fedora', 'owned hat worn in both');
  await exportFixture('wardrobe-3_equip_field', f);
  // Re-equip city: field untouched. Same requestId for the other loadout → sequence_conflict.
  const city2 = structuredClone(city); city2.parts.hat = null;
  const c2 = await equip(uid, city2, 'c2', 'city'); assert.equal(c2.loadouts.city.parts.hat, null); assert.equal(c2.loadouts.field.parts.hat, 'hat_fedora');
  await rejects(equip(uid, city2, 'c2', 'field'), 'sequence_conflict', 'already-exists');
  assert.equal((await equip(uid, city2, 'c2', 'city')).alreadyProcessed, true);
  const st = await host(uid, { operation: 'status' }); assert.deepEqual(st.loadouts, c2.loadouts); assert.deepEqual(st.saved, { city: true, field: true });
  await exportFixture('wardrobe-3_status_loadouts', st);
  // Invalid loadout names, and a missing loadout, are invalid_request with nothing written.
  const stored = await wardrobe(uid);
  for (const loadout of ['arena', 'City', '', null, 1]) await rejects(host(uid, { operation: 'equip', loadout, recipe: base(), requestId: `bad${String(loadout)}` }), 'invalid_request', 'invalid-argument');
  await rejects(host(uid, { operation: 'equip', recipe: base(), requestId: 'noloadout' }), 'invalid_request', 'invalid-argument');
  // Field equip enforces ownership like city.
  const smart = base(); smart.parts.top = 'top_smartdress'; smart.parts.bottom = null;
  await rejects(equip(uid, smart, 'f9', 'field'), 'not_owned', 'failed-precondition');
  assert.deepEqual(await wardrobe(uid), stored);
});

test('read-time sanitising on the emulator: a stored outfit with a delisted, an unowned and a hidden item is repaired in status, status writes nothing, the next equip persists it; preset round-trips', async () => {
  const uid = await setup({ holosTokens: 0 });
  const b = base();
  const ident = { preset: 'Kenji', faceLayers: b.faceLayers, shapes: { Weight: 10 }, colors: { skin: '#C08060' } };
  const doc = {
    schemaVersion: 'wardrobe-3', entitlements: ['top_overall', 'hat_retired'], identity: ident,
    loadouts: {
      city: { parts: { ...b.parts, hat: 'hat_retired', top: 'top_overall', bottom: 'bottom_skinnyjeans' }, colors: { hat: ['#111111'], bottom: ['#222222'] } }, // delisted hat; bottom under a hider
      field: { parts: { ...b.parts, top: 'top_fullsuit' }, colors: { top: ['#FF0000'] } },                                                                    // unowned top
    },
  };
  await db.doc(`wardrobes/${uid}`).set(doc);
  const before = await wardrobe(uid);
  const s = await host(uid, { operation: 'status' });
  assert.deepEqual(s.sanitized, { city: true, field: true });
  assert.equal(s.loadouts.city.parts.hat, null); assert.equal(s.loadouts.city.parts.top, 'top_overall'); assert.equal(s.loadouts.city.parts.bottom, null);
  assert.deepEqual(s.loadouts.city.colors, { skin: '#C08060' });
  assert.equal(s.loadouts.field.parts.top, 'top_simplehoodie'); assert.equal(s.loadouts.field.parts.bottom, b.parts.bottom); assert.deepEqual(s.loadouts.field.colors, { skin: '#C08060' });
  for (const l of ['city', 'field']) assert.equal(s.loadouts[l].preset, 'Kenji');
  assert.deepEqual(await wardrobe(uid), before, 'status never writes, even when it sanitised');
  await exportFixture('wardrobe-3_status_sanitized', s);
  // Sending each returned loadout back unchanged succeeds and persists the clean version.
  const c = await equip(uid, s.loadouts.city, 'fix-city', 'city');
  const f = await equip(uid, s.loadouts.field, 'fix-field', 'field');
  assert.deepEqual(f.sanitized, { city: false, field: false }); assert.deepEqual(f.loadouts, s.loadouts);
  const stored = await wardrobe(uid);
  assert.equal(stored.loadouts.city.parts.hat, null); assert.equal(stored.loadouts.field.parts.top, 'top_simplehoodie'); assert.equal(stored.identity.preset, 'Kenji');
  assert.deepEqual(stored.entitlements, ['top_overall', 'hat_retired'], 'entitlements are never touched by sanitising');
  assert.equal(c.alreadyProcessed, false);
  // Preset validation on the wire.
  await rejects(equip(uid, { ...base(), preset: 'Zell' }, 'zell', 'city'), 'invalid_request', 'invalid-argument');
  assert.equal((await equip(uid, { ...base(), preset: 'Hana' }, 'hana', 'field')).loadouts.city.preset, 'Hana');
});
