// DECISIONS #48 wardrobe-2 domain tests (pure modules: lib/wardrobe.ts + lib/wardrobeCatalog.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../lib/lib/wardrobe.js');
const C = require('../lib/lib/wardrobeCatalog.js');
const E = require('../lib/lib/economy.js');
const SOLD = C.WARDROBE_ITEMS.filter(i => !i.starter);
const STARTERS = C.WARDROBE_ITEMS.filter(i => i.starter);
const base = () => structuredClone(W.defaultRecipe());
const equipCmd = (recipe, requestId = 'e1') => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-2', operation: 'equip', requestId, recipe });
const buyCmd = (itemId, requestId = 'b1') => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-2', operation: 'purchase', requestId, itemId });
const fresh = () => W.readWardrobeState(undefined);
const invalid = (fn, msg) => assert.throws(fn, e => e.code === 'invalid_request', msg);

test('catalog data: provisional slots, starter coverage, ~12 sold items, every price = MARKETPLACE_PART_PRICES[rarity], placeholder ids', () => {
  assert.deepEqual(C.WARDROBE_SLOTS.map(s => [s.slot, s.required]), [['hair', true], ['top', true], ['bottom', true], ['footwear', true], ['gloves', false], ['hat', false], ['faceAccessory', false], ['backAccessory', false]]);
  for (const { slot, required } of C.WARDROBE_SLOTS) assert.ok(STARTERS.filter(i => i.slot === slot).length >= (required ? 2 : 1), slot);
  assert.equal(SOLD.length, 12);
  for (const i of SOLD) { assert.equal(i.price, E.MARKETPLACE_PART_PRICES[i.rarity], i.itemId); assert.equal(i.vendorId, 'boutique'); assert.ok(['common', 'rare', 'epic'].includes(i.rarity)); }
  for (const i of STARTERS) { assert.equal(i.price, 0); assert.equal(i.vendorId, ''); assert.equal(i.rarity, 'starter'); }
  for (const i of C.WARDROBE_ITEMS) { assert.ok(i.itemId.startsWith('ph.'), i.itemId); assert.ok(C.WARDROBE_SLOTS.some(s => s.slot === i.slot)); for (const t of i.tintable) assert.ok(C.COLOR_CHANNELS.includes(t), t); }
  assert.equal(new Set(C.WARDROBE_ITEMS.map(i => i.itemId)).size, C.WARDROBE_ITEMS.length);
  assert.equal(C.WARDROBE_CATALOG_IS_PLACEHOLDER, true);
  assert.deepEqual(C.SLIDER_KEYS, ['height', 'build', 'headSize', 'shoulderWidth', 'legLength', 'eyeSize', 'eyeSpacing', 'noseSize', 'mouthWidth', 'jaw', 'cheek', 'ear']);
  assert.deepEqual(C.COLOR_CHANNELS, ['skin', 'hair', 'eyes', 'primary', 'secondary', 'accent']);
  assert.deepEqual([C.SLIDER_MIN, C.SLIDER_MAX, C.SLIDER_DEFAULT, C.MAX_RECIPE_BYTES], [-1, 1, 0, 4096]);
});

test('default recipe: first free body/face, first starter per required slot, optional slots none; validates and equips with nothing owned', () => {
  const d = W.defaultRecipe();
  assert.deepEqual(d, { schemaVersion: 'wardrobe-2', baseBody: 'ph.body.a', face: 'ph.face.01', parts: { hair: 'ph.hair.short_01', top: 'ph.top.tee_01', bottom: 'ph.bottom.pants_01', footwear: 'ph.footwear.sneakers_01', gloves: null, hat: null, faceAccessory: null, backAccessory: null }, sliders: {}, colors: {} });
  assert.deepEqual(W.validateRecipe(d), d);
});

test('starter-only equip with zero Holos is OK, never charges, stores the canonical recipe', () => {
  const r = base();
  Object.assign(r.parts, { hair: 'ph.hair.long_01', top: 'ph.top.jacket_01', gloves: 'ph.gloves.fingerless_01', hat: 'ph.hat.cap_01', faceAccessory: 'ph.faceAccessory.visor_01', backAccessory: 'ph.backAccessory.pack_01' });
  r.sliders = { ear: -1, height: 0.25 }; r.colors = { accent: '#ff00aa', skin: '#C08060' };
  const out = W.applyEquip({ holosTokens: 0 }, fresh(), equipCmd(r));
  assert.equal(out.reply.holosTokens, 0); assert.equal(out.reply.purchased, null); assert.equal(out.reply.recipeSaved, true);
  assert.deepEqual(Object.keys(out.state.recipe.sliders), ['height', 'ear'], 'canonical whitelist order');
  assert.deepEqual(out.state.recipe.colors, { skin: '#C08060', accent: '#FF00AA' }, 'canonical order, upper-case hex');
  assert.equal(W.applyEquip({}, fresh(), equipCmd(r)).reply.holosTokens, 0, 'missing Holos = 0, still fine');
});

test('equip rejects unowned (not_owned), and wrong slot / unknown ids / unknown keys / out-of-range sliders / bad hex / oversize (invalid_request)', () => {
  const withPart = (slot, id) => { const r = base(); r.parts[slot] = id; return r; };
  assert.throws(() => W.applyEquip({ holosTokens: 0 }, fresh(), equipCmd(withPart('hat', 'ph.hat.helmet_01'))), e => e.code === 'not_owned');
  assert.throws(() => W.applyEquip({ holosTokens: 9999 }, { ...fresh(), entitlements: ['ph.backAccessory.wings_01'] }, equipCmd(withPart('hat', 'ph.hat.helmet_01'))), e => e.code === 'not_owned', 'owning another item does not help');
  assert.equal(W.applyEquip({}, { ...fresh(), entitlements: ['ph.hat.helmet_01'] }, equipCmd(withPart('hat', 'ph.hat.helmet_01'))).state.recipe.parts.hat, 'ph.hat.helmet_01');
  invalid(() => equipCmd(withPart('hat', 'ph.top.tee_01')), 'starter item in the wrong slot');
  invalid(() => equipCmd(withPart('gloves', 'ph.hat.helmet_01')), 'sold item in the wrong slot');
  invalid(() => equipCmd(withPart('hair', 'ph.hair.nope')), 'unknown item');
  invalid(() => equipCmd(withPart('hair', null)), 'required slot set to none');
  invalid(() => { const r = base(); delete r.parts.top; return equipCmd(r); }, 'required slot missing');
  invalid(() => equipCmd(withPart('cape', 'ph.backAccessory.cape_01')), 'unknown slot key');
  invalid(() => equipCmd({ ...base(), extra: 1 }), 'unknown recipe key');
  invalid(() => equipCmd({ ...base(), sliders: { tail: 0.1 } }), 'unknown slider key');
  invalid(() => equipCmd({ ...base(), colors: { glow: '#FFFFFF' } }), 'unknown colour channel');
  for (const v of [1.0001, -1.5, 2, NaN, Infinity, -Infinity, '0.5', null]) invalid(() => equipCmd({ ...base(), sliders: { height: v } }), `slider ${v}`);
  for (const v of ['#FFF', 'FFFFFF', '#GGGGGG', '#FFFFFF0', ' #FFFFFF', '#ffffff ', 0xffffff, null]) invalid(() => equipCmd({ ...base(), colors: { hair: v } }), `hex ${v}`);
  for (const [k, v] of [['baseBody', 'ph.body.z'], ['face', 'ph.face.99'], ['schemaVersion', 'wardrobe-1'], ['parts', []], ['sliders', []], ['colors', 'red']]) invalid(() => equipCmd({ ...base(), [k]: v }), k);
  invalid(() => equipCmd({ ...base(), colors: { hair: '#FFFFFF', pad: 'x'.repeat(5000) } }), 'oversize');
  invalid(() => equipCmd(null)); invalid(() => equipCmd([]));
  // Exactly at the boundary values: allowed.
  assert.deepEqual(equipCmd({ ...base(), sliders: { height: -1, build: 1 } }).recipe.sliders, { height: -1, build: 1 });
});

test('oversize payloads are rejected; the largest possible valid recipe stays far under the 4 KB cap', () => {
  // The byte cap runs before any other check (bounds work on hostile payloads). Because every key is
  // whitelisted and every value is a short catalog id, a number or a 7-char hex, no VALID recipe can
  // reach 4 KB, so an oversize payload is always also invalid on its own; this is defense-in-depth.
  invalid(() => W.validateRecipe({ ...base(), colors: { hair: '#FFFFFF' }, pad: 'x'.repeat(5000) }));
  invalid(() => W.validateRecipe({ ...base(), baseBody: 'x'.repeat(5000) }));
  const big = base();
  for (const { slot } of C.WARDROBE_SLOTS) big.parts[slot] = C.WARDROBE_ITEMS.filter(i => i.slot === slot).sort((a, b) => b.itemId.length - a.itemId.length)[0].itemId;
  big.sliders = Object.fromEntries(C.SLIDER_KEYS.map(k => [k, -0.12345678901234567]));
  big.colors = Object.fromEntries(C.COLOR_CHANNELS.map(c => [c, '#ABCDEF']));
  assert.ok(Buffer.byteLength(JSON.stringify(big)) < 2048); assert.doesNotThrow(() => W.validateRecipe(big));
});

test('purchase: spends MARKETPLACE_PART_PRICES[rarity] and adds the entitlement; refusals write nothing', () => {
  const helmet = C.WARDROBE_ITEM_BY_ID.get('ph.hat.helmet_01');
  const out = W.applyPurchase({ holosTokens: 2000.5 }, fresh(), buyCmd(helmet.itemId));
  assert.equal(out.holosAfter, 500.5); assert.deepEqual(out.state.entitlements, ['ph.hat.helmet_01']);
  assert.deepEqual(out.reply.purchased, { itemId: 'ph.hat.helmet_01', price: 1500 }); assert.equal(out.reply.recipeSaved, false);
  assert.throws(() => W.applyPurchase({ holosTokens: 1499 }, fresh(), buyCmd(helmet.itemId)), e => e.code === 'not_enough_holos');
  assert.throws(() => W.applyPurchase({ holosTokens: 99999 }, out.state, buyCmd(helmet.itemId, 'b2')), e => e.code === 'already_owned', 'already_owned beats balance');
  assert.throws(() => W.applyPurchase({ holosTokens: 0 }, out.state, buyCmd(helmet.itemId, 'b3')), e => e.code === 'already_owned', 'already_owned beats not_enough_holos too');
  for (const id of ['ph.hat.cap_01', 'ph.hair.short_01', 'nope', '', 7]) invalid(() => buyCmd(id), `not for sale: ${id}`);
  for (const h of [NaN, Infinity, -1, '300', null]) assert.throws(() => W.applyPurchase({ holosTokens: h }, fresh(), buyCmd(helmet.itemId)), e => e.code === 'unavailable', String(h));
});

test('no reset trap: absent state = nothing owned; malformed or wrong-schema state fails closed; unknown-but-well-formed ids are kept', () => {
  assert.deepEqual(W.readWardrobeState(undefined), { schemaVersion: 'wardrobe-2', entitlements: [], recipe: null });
  for (const bad of [null, {}, [], 'x', { schemaVersion: 'wardrobe-1', entitlements: [], recipe: null }, { schemaVersion: 'wardrobe-2', recipe: null },
    { schemaVersion: 'wardrobe-2', entitlements: 'ph.hat.helmet_01', recipe: null }, { schemaVersion: 'wardrobe-2', entitlements: [1], recipe: null },
    { schemaVersion: 'wardrobe-2', entitlements: ['a', 'a'], recipe: null }, { schemaVersion: 'wardrobe-2', entitlements: [''], recipe: null },
    { schemaVersion: 'wardrobe-2', entitlements: [], recipe: 'x' }, { schemaVersion: 'wardrobe-2', entitlements: [] }])
    assert.throws(() => W.readWardrobeState(bad), e => e.code === 'unavailable', JSON.stringify(bad));
  const kept = W.readWardrobeState({ schemaVersion: 'wardrobe-2', entitlements: ['ph.retired.item'], recipe: null });
  const after = W.applyPurchase({ holosTokens: 300 }, kept, buyCmd('ph.top.hoodie_01'));
  assert.deepEqual(after.state.entitlements, ['ph.retired.item', 'ph.top.hoodie_01'], 'a retired id survives the next purchase');
});

test('commands and fingerprints: schemaVersion required; equivalent recipes share a fingerprint; any change alters it', () => {
  for (const raw of [null, {}, { operation: 'status' }, { schemaVersion: 'wardrobe-1', operation: 'status' }, { schemaVersion: 'wardrobe-2', operation: 'read' },
    { schemaVersion: 'wardrobe-2', operation: 'purchase', itemId: 'ph.hat.helmet_01' }, { schemaVersion: 'wardrobe-2', operation: 'purchase', itemId: 'ph.hat.helmet_01', requestId: 'a/b' },
    { schemaVersion: 'wardrobe-2', operation: 'equip', requestId: 'r' }]) invalid(() => W.validateWardrobeCommand(raw), JSON.stringify(raw));
  assert.deepEqual(W.validateWardrobeCommand({ schemaVersion: 'wardrobe-2', operation: 'status', uid: 'someone_else' }), { operation: 'status' });
  const a = base(); a.sliders = { height: 0.5, ear: -0.5 }; a.colors = { hair: '#abcdef' };
  const b = base(); b.sliders = { ear: -0.5, height: 0.5 }; b.colors = { hair: '#ABCDEF' }; delete b.parts.gloves;
  assert.equal(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(b, 'other')), 'canonical: key order, hex case, omitted optional slot');
  const c = structuredClone(a); c.sliders.height = 0.51;
  assert.notEqual(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(c)));
  assert.notEqual(W.commandFingerprint(buyCmd('ph.hat.helmet_01')), W.commandFingerprint(buyCmd('ph.top.armor_01')));
});

test('status view: entitlements, saved-or-default recipe, slots and every whitelist (so Unity hard-codes none)', () => {
  const s = W.wardrobeStatus({ holosTokens: 10 }, { schemaVersion: 'wardrobe-2', entitlements: ['ph.hat.helmet_01'], recipe: null });
  assert.equal(s.schemaVersion, 'wardrobe-2'); assert.equal(s.recipeSaved, false); assert.deepEqual(s.recipe, W.defaultRecipe()); assert.equal(s.holosTokens, 10);
  assert.deepEqual(s.catalog.slots, C.WARDROBE_SLOTS); assert.deepEqual(s.catalog.baseBodies, C.BASE_BODIES); assert.deepEqual(s.catalog.faces, C.FACES);
  assert.deepEqual(s.catalog.sliders, { keys: C.SLIDER_KEYS, min: -1, max: 1, default: 0 }); assert.deepEqual(s.catalog.colors.channels, C.COLOR_CHANNELS);
  assert.equal(s.catalog.maxRecipeBytes, 4096); assert.equal(s.catalog.placeholder, true);
  const helmet = s.catalog.items.find(i => i.itemId === 'ph.hat.helmet_01'); assert.equal(helmet.owned, true); assert.equal(helmet.usable, true);
  const wings = s.catalog.items.find(i => i.itemId === 'ph.backAccessory.wings_01'); assert.equal(wings.owned, false); assert.equal(wings.usable, false);
  assert.ok(s.catalog.items.filter(i => i.starter).every(i => i.usable && !i.owned));
});
