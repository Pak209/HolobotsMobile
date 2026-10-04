// DECISIONS #48 wardrobe-3 domain tests: BoZo manifest → generated catalog, recipe rules, purchase / equip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const W = require('../lib/lib/wardrobe.js');
const C = require('../lib/lib/wardrobeCatalog.js');
const E = require('../lib/lib/economy.js');
const MANIFEST = JSON.parse(readFileSync(new URL('../src/lib/data/bozoWardrobeManifest.json', import.meta.url), 'utf8'));
const ITEMS = C.WARDROBE_ITEMS;
const byPart = p => ITEMS.find(i => i.bozoPart === p);
const id = p => byPart(p).itemId;
const base = () => structuredClone(W.defaultRecipe());
const equipCmd = (recipe, requestId = 'e1', loadout = 'city') => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-3', operation: 'equip', requestId, loadout, recipe });
const cityOf = st => W.loadoutRecipes(st).city;
const buyCmd = (itemId, requestId = 'b1') => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-3', operation: 'purchase', requestId, itemId });
const fresh = () => W.readWardrobeState(undefined);
const invalid = (fn, msg) => assert.throws(fn, e => e.code === 'invalid_request', msg);
const valid = (r, msg) => assert.doesNotThrow(() => W.validateRecipe(r), msg);
/** Hiders are DERIVED from the manifest's hides field, never hard-coded. */
const HIDERS = MANIFEST.filter(e => e.hides.length > 0).map(e => e.bozoPart);

test('manifest: 120 entries, per-type counts, shape, verbatim vendor spellings, unique lower-case ids', () => {
  assert.equal(MANIFEST.length, 120);
  const counts = {}; for (const e of MANIFEST) counts[e.type] = (counts[e.type] || 0) + 1;
  assert.deepEqual(counts, { Bottom: 16, Feet: 13, Gloves: 8, HairBack: 19, HairFront: 11, Hat: 9, HeadAcc: 4, Leggings: 1, LowerFace: 3, Neck: 1, Socks: 6, Top: 24, UpperFace: 5 });
  for (const s of C.WARDROBE_SLOTS) assert.equal(counts[s.type], s.expectedCount, s.type);
  for (const e of MANIFEST) {
    assert.deepEqual(Object.keys(e).sort(), ['bozoPart', 'colorChannels', 'hides', 'incompatible', 'type']);
    assert.ok(Number.isSafeInteger(e.colorChannels) && e.colorChannels >= 0); assert.deepEqual(e.incompatible, []);
  }
  for (const quirk of ['Hairback_ShinryuCut', 'HairBack_LongStreight', 'HairBack_SweaptDreads', 'HeadAcc_AlienAttena', 'Feet_TobiSandles', 'Top_ComfyCartagan'])
    assert.ok(MANIFEST.some(e => e.bozoPart === quirk), quirk);
  assert.equal(new Set(MANIFEST.map(e => e.bozoPart.toLowerCase())).size, 120);
  assert.deepEqual(HIDERS.sort(), ['Top_Overall', 'Top_SimpleKimono', 'Top_SmartDress', 'Top_Sundress']);
  for (const p of HIDERS) assert.deepEqual(MANIFEST.find(e => e.bozoPart === p).hides, ['Bottom']);
});

test('generated catalog: itemId = lower-cased bozoPart, bozoPart verbatim, slot from type, colorChannels and hides carried over', () => {
  assert.equal(ITEMS.length, 120); assert.equal(C.WARDROBE_CATALOG_IS_PLACEHOLDER, false);
  MANIFEST.forEach((e, k) => {
    const i = ITEMS[k];
    assert.equal(i.itemId, e.bozoPart.toLowerCase()); assert.equal(i.bozoPart, e.bozoPart); assert.equal(i.type, e.type);
    assert.equal(i.slot, C.WARDROBE_SLOTS.find(s => s.type === e.type).slot); assert.equal(i.colorChannels, e.colorChannels);
    assert.deepEqual(i.hidesSlots, e.hides.map(t => C.WARDROBE_SLOTS.find(s => s.type === t).slot));
  });
  assert.equal(id('Hairback_ShinryuCut'), 'hairback_shinryucut'); assert.equal(id('Top_HardJacket'), 'top_hardjacket');
  assert.equal(byPart('Top_HardJacket').displayName, 'Hard Jacket');
  assert.deepEqual(C.WARDROBE_SLOTS.map(s => [s.slot, s.required]), [['hairFront', true], ['hairBack', true], ['top', true], ['bottom', true], ['feet', true], ['gloves', false], ['hat', false], ['headAcc', false], ['upperFace', false], ['lowerFace', false], ['neck', false], ['leggings', false], ['socks', false]]);
});

test('producer split: exact starter set; sold priced by MARKETPLACE_PART_PRICES[rarity]; epic / rare buckets; lens not sold or equipped', () => {
  const starters = ITEMS.filter(i => i.starter).map(i => i.bozoPart).sort();
  const expected = [...MANIFEST.filter(e => e.type === 'HairFront' || e.type === 'HairBack').map(e => e.bozoPart),
    'Top_Tshirt', 'Top_SimpleHoodie', 'Top_TankTop', 'Bottom_SimpleShorts', 'Bottom_SkinnyJeans', 'Bottom_BaggyPants', 'Feet_SimpleSneakers', 'Feet_AthleticMidTop', 'Socks_BasicSocks'].sort();
  assert.deepEqual(starters, expected); assert.equal(starters.length, 39);
  for (const i of ITEMS.filter(i => i.starter)) { assert.equal(i.price, 0); assert.equal(i.sellable, false); assert.equal(i.rarity, 'starter'); assert.equal(i.vendorId, ''); }
  const sold = ITEMS.filter(i => i.sellable);
  assert.equal(sold.length, 80);
  for (const i of sold) { assert.equal(i.price, E.MARKETPLACE_PART_PRICES[i.rarity], i.bozoPart); assert.equal(i.vendorId, 'boutique'); }
  const ofRarity = r => sold.filter(i => i.rarity === r).map(i => i.bozoPart).sort();
  assert.deepEqual(ofRarity('epic'), ['Bottom_BasicHakma', 'HeadAcc_AlienAttena', 'HeadAcc_DevilHorns', 'HeadAcc_FlufflessKittyEars', 'HeadAcc_KittyEars', 'Top_FullSuit', 'Top_Nagagi', 'Top_SimpleKimono', 'Top_SmartDress']);
  const rare = ofRarity('rare');
  for (const p of ['Top_HardJacket', 'Top_SchoolBoyJacket', 'Feet_WorkBoots', 'UpperFace_RoundGlasses', 'UpperFace_SimpleGlasses', 'UpperFace_SimpleHalfMoon']) assert.ok(rare.includes(p), p);
  for (const i of ITEMS.filter(i => i.type === 'Hat' || i.type === 'Gloves')) assert.equal(i.rarity, 'rare', i.bozoPart);
  assert.equal(rare.length, 23); // 2 jackets + 1 boots + 8 gloves + 9 hats + 3 glasses
  assert.equal(ofRarity('common').length, 48);
  const lens = byPart('UpperFace_RoundGlassesLens');
  assert.deepEqual([lens.sellable, lens.equippable, lens.price, lens.vendorId], [false, false, 0, '']);
});

test('generator rejects a bad manifest or decisions that no longer match it (fails the build, never ships an unknown id)', () => {
  const m = () => structuredClone(MANIFEST);
  const throws = (mm, re) => assert.throws(() => C.buildWardrobeItems(mm), re);
  throws([...m(), { bozoPart: 'Cape_Hero', type: 'Cape', hides: [], incompatible: [], colorChannels: 1 }], /unknown type Cape/);
  throws([...m(), { ...MANIFEST[0], bozoPart: MANIFEST[0].bozoPart.toUpperCase() }], /collide/);
  throws(m().map(e => e.bozoPart === 'Top_Tshirt' ? { ...e, bozoPart: 'Top_TShirtRenamed' } : e), /unknown part Top_Tshirt/);
  throws(m().map(e => e.bozoPart === 'Top_Overall' ? { ...e, hides: ['Skirt'] } : e), /unknown type Skirt/);
  throws(m().map(e => e.bozoPart === 'Top_Overall' ? { ...e, hides: ['Top'] } : e), /hides its own slot/);
  throws(m().map(e => e.bozoPart === 'Neck_RibbonBow' ? { ...e, colorChannels: -1 } : e), /colorChannels/);
  throws(m().filter(e => e.type !== 'Feet' || e.bozoPart === 'Feet_WorkBoots'), /unknown part Feet_SimpleSneakers/);
  // hides / incompatible are generalised: a new hider in a new pack audit works without code changes.
  const gen = C.buildWardrobeItems(m().map(e => e.bozoPart === 'Hat_SunHat' ? { ...e, hides: ['HairFront'], incompatible: ['HeadAcc'] } : e));
  assert.deepEqual(gen.find(i => i.bozoPart === 'Hat_SunHat').hidesSlots, ['hairFront']);
  assert.deepEqual(gen.find(i => i.bozoPart === 'Hat_SunHat').incompatibleSlots, ['headAcc']);
});

test('shape tables: exactly one face list per head option; body/face keys disjoint and bare (fails the build otherwise)', () => {
  const body = C.BODY_SHAPE_KEYS, byHead = C.FACE_SHAPES_BY_HEAD;
  assert.doesNotThrow(() => C.validateShapeTables(C.FACE_LAYERS, body, byHead));
  const { Head_Stern, ...missingHead } = byHead;
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS, body, missingHead), /exactly the head options/);
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS, body, { ...byHead, Head_Robot: ['Visor'] }), /exactly the head options/);
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS, [...body, 'Sharpness'], byHead), /overlap/);
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS, [...body, 'Belly'], byHead), /overlap/);
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS, ['Shape_Belly'], byHead), /no Shape_ prefix/);
  assert.throws(() => C.validateShapeTables(C.FACE_LAYERS.filter(l => l.layer !== 'head'), body, byHead), /no head face layer/);
});

test('hide rule, both directions, for every manifest hider: bottom MUST be null under it; otherwise bottom is required', () => {
  assert.ok(HIDERS.length >= 1);
  for (const p of HIDERS) {
    const hidden = base(); hidden.parts.top = id(p); hidden.parts.bottom = null;
    valid(hidden, `${p} with no bottom`);
    const clash = base(); clash.parts.top = id(p);
    invalid(() => W.validateRecipe(clash), `${p} with a bottom`);
    const omitted = base(); omitted.parts.top = id(p); delete omitted.parts.bottom;
    assert.equal(W.validateRecipe(omitted).parts.bottom, null, `${p}, bottom omitted → null`);
    const tinted = structuredClone(hidden); tinted.colors = { bottom: ['#FFFFFF'] };
    invalid(() => W.validateRecipe(tinted), `${p}: no colours for a hidden slot`);
  }
  for (const i of ITEMS.filter(i => i.slot === 'top' && i.hidesSlots.length === 0)) {
    const r = base(); r.parts.top = i.itemId; r.parts.bottom = null;
    invalid(() => W.validateRecipe(r), `${i.bozoPart} needs a bottom`);
    r.parts.bottom = id('Bottom_SkinnyJeans'); valid(r, `${i.bozoPart} with a bottom`);
  }
  // `incompatible` is [] for every entry in this pack, so exercise the rule on a live item (restored after).
  assert.ok(MANIFEST.every(e => e.incompatible.length === 0), 'pack audit: no incompatibilities yet');
  const fedora = W.validateRecipe({ ...base(), parts: { ...base().parts, hat: id('Hat_Fedora') } });
  const suit = byPart('Top_FullSuit');
  suit.incompatibleSlots.push('hat');
  try {
    invalid(() => W.validateRecipe({ ...fedora, parts: { ...fedora.parts, top: suit.itemId } }), 'incompatible slot must be empty');
    valid({ ...fedora, parts: { ...fedora.parts, top: suit.itemId, hat: null } }, 'incompatible slot empty');
  } finally { suit.incompatibleSlots.pop(); }
  for (const slot of ['hairFront', 'hairBack', 'top', 'feet']) { const r = base(); r.parts[slot] = null; invalid(() => W.validateRecipe(r), `${slot} required`); }
});

test('faceLayers: required layers present, optional may be null, values from each layer\'s whitelist (exact vendor spelling)', () => {
  const d = W.defaultRecipe();
  for (const l of C.FACE_LAYERS) assert.equal(d.faceLayers[l.layer], l.required ? l.options[0] : null);
  assert.deepEqual(C.FACE_LAYERS.filter(l => l.required).map(l => l.layer), ['head', 'body', 'eyes', 'pupil', 'eyeBrows', 'eyeLashes', 'teeth', 'underUpper', 'underLower']);
  const r = base(); Object.assign(r.faceLayers, { faceDetails: 'FaceDetail_Freakles', underLower: 'Underlower_ShortSpats', bodyType: 'BodyType_StylizedStrongBody', makeUpLips: 'MakeUpLips_SimpleLipstick' });
  assert.equal(W.validateRecipe(r).faceLayers.faceDetails, 'FaceDetail_Freakles');
  for (const [layer, v] of [['head', null], ['underLower', null], ['faceDetails', 'FaceDetail_Freckles'], ['underLower', 'UnderLower_ShortSpats'], ['pupil', 'pupil_round'], ['eyes', 'Pupil_Round'], ['head', 7]])
    invalid(() => W.validateRecipe({ ...base(), faceLayers: { ...base().faceLayers, [layer]: v } }), `${layer}=${v}`);
  invalid(() => W.validateRecipe({ ...base(), faceLayers: { ...base().faceLayers, horns: 'HeadAcc_DevilHorns' } }), 'unknown layer');
  invalid(() => { const x = base(); delete x.faceLayers.teeth; return W.validateRecipe(x); }, 'missing required layer');
  invalid(() => W.validateRecipe({ ...base(), faceLayers: [] }));
});

test('colours: per-slot arrays capped at the equipped item\'s colorChannels; global skin/hair/eyes strict; canonical output', () => {
  const r = base(); r.parts.top = id('Top_FullSuit'); r.parts.gloves = id('Gloves_ArmWarmers');
  const six = Array.from({ length: 6 }, (_, k) => `#00000${k}`), nine = Array.from({ length: 9 }, () => '#abcdef');
  r.colors = { gloves: nine, top: six, eyes: '#00ff00', skin: '#c08060', bottom: [] };
  const out = W.validateRecipe(r);
  assert.deepEqual(Object.keys(out.colors), ['skin', 'eyes', 'top', 'gloves'], 'channels then slots; empty arrays dropped');
  assert.equal(out.colors.gloves[0], '#ABCDEF'); assert.equal(out.colors.skin, '#C08060');
  invalid(() => W.validateRecipe({ ...r, colors: { top: [...six, '#000006'] } }), 'one beyond Top_FullSuit\'s 6');
  invalid(() => W.validateRecipe({ ...base(), colors: { hairFront: ['#111111', '#222222'] } }), 'HairFront has 1 channel');
  valid({ ...base(), colors: { hairFront: ['#111111'] } });
  invalid(() => W.validateRecipe({ ...base(), colors: { hat: ['#111111'] } }), 'no hat equipped → nothing to tint');
  for (const bad of [{ top: '#111111' }, { top: ['#11111'] }, { top: [null] }, { skin: ['#111111'] }, { skin: '#GGGGGG' }, { primary: '#111111' }, { glow: ['#111111'] }])
    invalid(() => W.validateRecipe({ ...base(), colors: bad }), JSON.stringify(bad));
  for (const i of ITEMS.filter(i => i.equippable)) assert.ok(i.colorChannels >= 0);
});

test('equip: starter-only with zero Holos OK; unowned → not_owned; wrong slot / unknown / lens / unknown keys / bad shapes / oversize → invalid_request', () => {
  const r = base(); Object.assign(r.parts, { hairFront: id('HairFront_HimeCut'), hairBack: id('Hairback_ShinryuCut'), top: id('Top_TankTop'), socks: id('Socks_BasicSocks') });
  r.shapes = { Roundness: 100, Belly: 0, Muscle: 37.5, EarsElf: 12 }; // EarsElf: not on Head_AnimeYoung, still accepted (union)
  const out = W.applyEquip({ holosTokens: 0 }, fresh(), equipCmd(r));
  assert.equal(out.reply.holosTokens, 0); assert.equal(out.reply.purchased, null); assert.equal(cityOf(out.state).parts.hairBack, 'hairback_shinryucut');
  assert.deepEqual(cityOf(out.state).shapes, { Belly: 0, Muscle: 37.5, EarsElf: 12, Roundness: 100 }, 'canonical order: body keys, then face keys');
  const withPart = (slot, v) => { const x = base(); x.parts[slot] = v; return x; };
  assert.throws(() => W.applyEquip({ holosTokens: 9999 }, fresh(), equipCmd(withPart('hat', id('Hat_Fedora')))), e => e.code === 'not_owned');
  assert.throws(() => W.applyEquip({}, fresh(), equipCmd(Object.assign(base(), { parts: { ...base().parts, top: id('Top_Overall'), bottom: null } }))), e => e.code === 'not_owned');
  assert.equal(W.applyEquip({}, { ...fresh(), entitlements: [id('Hat_Fedora')] }, equipCmd(withPart('hat', id('Hat_Fedora')))).state.loadouts.city.parts.hat, 'hat_fedora');
  invalid(() => equipCmd(withPart('upperFace', id('UpperFace_RoundGlassesLens'))), 'lens is not equippable');
  invalid(() => equipCmd(withPart('hat', id('Top_Tshirt'))), 'wrong slot');
  invalid(() => equipCmd(withPart('hat', 'Hat_Fedora')), 'ids are lower-case; the bozoPart is not an id');
  invalid(() => equipCmd(withPart('hat', 'hat_sombrero')), 'unknown id');
  invalid(() => equipCmd(withPart('cape', 'hat_fedora')), 'unknown slot');
  invalid(() => equipCmd({ ...base(), baseBody: 'Body_BasicBody' }), 'wardrobe-2 keys are unknown in wardrobe-3');
  invalid(() => equipCmd({ ...base(), schemaVersion: 'wardrobe-2' }));
  for (const v of [100.0001, -0.0001, -1, 101, NaN, Infinity, -Infinity, '50', null, [50]]) invalid(() => equipCmd({ ...base(), shapes: { Weight: v } }), `shape ${v}`);
  for (const k of ['height', 'legLength', 'Shape_Weight', 'weight', 'Tail']) invalid(() => equipCmd({ ...base(), shapes: { [k]: 10 } }), `unknown shape key ${k}`);
  for (const v of [[10], 5, null, true, '', 'Weight']) invalid(() => equipCmd({ ...base(), shapes: v }), `shapes must be an object: ${JSON.stringify(v)}`);
  invalid(() => equipCmd({ ...base(), sliders: { height: 0.5 } }), 'wardrobe-3 drafts\' sliders key is gone');
  for (const v of [0, 100, 0.5, 99.999]) assert.equal(W.validateRecipe({ ...base(), shapes: { Chest: v } }).shapes.Chest, v, `edge ${v}`);
  invalid(() => equipCmd({ ...base(), colors: { hair: '#111111' }, pad: 'x'.repeat(5000) }), 'oversize');
});

test('largest possible valid recipe stays under the 4 KB cap (the cap is defense-in-depth)', () => {
  const big = base();
  for (const l of C.FACE_LAYERS) big.faceLayers[l.layer] = [...l.options].sort((a, b) => b.length - a.length)[0];
  for (const s of C.WARDROBE_SLOTS) {
    const pool = ITEMS.filter(i => i.slot === s.slot && i.equippable && i.hidesSlots.length === 0);
    big.parts[s.slot] = pool.sort((a, b) => b.itemId.length - a.itemId.length)[0].itemId;
  }
  big.shapes = Object.fromEntries(C.SHAPE_KEYS.map(k => [k, 99.12345678901234]));
  big.colors = { ...Object.fromEntries(C.GLOBAL_COLOR_CHANNELS.map(c => [c, '#ABCDEF'])), ...Object.fromEntries(C.WARDROBE_SLOTS.map(s => [s.slot, Array(ITEMS.find(i => i.itemId === big.parts[s.slot]).colorChannels).fill('#ABCDEF')])) };
  const bytes = Buffer.byteLength(JSON.stringify(big));
  assert.ok(bytes < C.MAX_RECIPE_BYTES, `${bytes} bytes`); assert.doesNotThrow(() => W.validateRecipe(big));
});

test('purchase: price from the economy table; already_owned and not_enough_holos write nothing; starters and the lens are not for sale', () => {
  const suit = byPart('Top_FullSuit');
  const out = W.applyPurchase({ holosTokens: 2000.5 }, fresh(), buyCmd(suit.itemId));
  assert.equal(out.holosAfter, 500.5); assert.deepEqual(out.state.entitlements, ['top_fullsuit']); assert.deepEqual(out.reply.purchased, { itemId: 'top_fullsuit', price: 1500 });
  assert.throws(() => W.applyPurchase({ holosTokens: 1499 }, fresh(), buyCmd(suit.itemId)), e => e.code === 'not_enough_holos');
  assert.throws(() => W.applyPurchase({ holosTokens: 0 }, out.state, buyCmd(suit.itemId, 'b2')), e => e.code === 'already_owned');
  for (const v of [id('Top_Tshirt'), id('HairFront_Messy'), id('UpperFace_RoundGlassesLens'), 'Top_FullSuit', 'nope']) invalid(() => buyCmd(v), `not for sale: ${v}`);
  for (const h of [NaN, -1, '300', null]) assert.throws(() => W.applyPurchase({ holosTokens: h }, fresh(), buyCmd(suit.itemId)), e => e.code === 'unavailable');
});

test('no reset trap: absent = nothing owned; malformed / wardrobe-2 / bad entitlements fail closed; retired ids kept', () => {
  assert.deepEqual(W.readWardrobeState(undefined), { schemaVersion: 'wardrobe-3', entitlements: [], identity: null, loadouts: { city: null, field: null } });
  const doc = (extra = {}) => ({ schemaVersion: 'wardrobe-3', entitlements: [], identity: null, loadouts: { city: null, field: null }, ...extra });
  const ident = { faceLayers: {}, shapes: {}, colors: {} }, outfit = { parts: {}, colors: {} };
  for (const bad of [null, {}, [], { schemaVersion: 'wardrobe-2', entitlements: [], recipe: null }, doc({ entitlements: 'x' }), doc({ entitlements: [1] }), doc({ entitlements: ['a', 'a'] }),
    { schemaVersion: 'wardrobe-3', entitlements: [], recipe: null }, // the single-recipe wardrobe-3 draft shape: no loadouts → fails closed
    doc({ loadouts: undefined }), doc({ loadouts: { city: null } }), doc({ loadouts: { city: null, field: null, arena: null } }), doc({ loadouts: { city: 'x', field: null } }),
    doc({ loadouts: { city: { parts: {} }, field: null }, identity: ident }), doc({ identity: 'x' }), doc({ identity: { faceLayers: {} } }),
    doc({ loadouts: { city: outfit, field: null } }) /* outfit saved without identity */])
    assert.throws(() => W.readWardrobeState(bad), e => e.code === 'unavailable', JSON.stringify(bad));
  assert.deepEqual(W.readWardrobeState(doc({ identity: ident, loadouts: { city: null, field: outfit } })).loadouts.field, outfit, 'field saved alone is fine');
  const kept = W.readWardrobeState(doc({ entitlements: ['top_retired'] }));
  assert.deepEqual(W.applyPurchase({ holosTokens: 300 }, kept, buyCmd(id('Neck_RibbonBow'))).state.entitlements, ['neck_ribbonbow', 'top_retired']);
});

test('fingerprints: equivalent recipes share one (key order, hex case, omitted optional slots/layers); any change alters it', () => {
  const a = base(); a.shapes = { Weight: 50, Sharpness: 25 }; a.colors = { hair: '#abcdef', top: ['#010203'] };
  const b = base(); b.shapes = { Sharpness: 25, Weight: 50 }; b.colors = { top: ['#010203'], hair: '#ABCDEF' }; delete b.parts.gloves; delete b.faceLayers.makeUpEyes;
  assert.equal(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(b, 'x')));
  const c = structuredClone(a); c.faceLayers.pupil = 'Pupil_StarPupil';
  assert.notEqual(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(c)));
  assert.notEqual(W.commandFingerprint(buyCmd(id('Hat_Fedora'))), W.commandFingerprint(buyCmd(id('Hat_Beanie'))));
  assert.notEqual(W.commandFingerprint(equipCmd(a, 'e1', 'city')), W.commandFingerprint(equipCmd(a, 'e1', 'field')), 'same recipe, other loadout → other fingerprint');
  for (const raw of [{ operation: 'status' }, { schemaVersion: 'wardrobe-2', operation: 'status' }, { schemaVersion: 'wardrobe-3', operation: 'purchase', itemId: 'hat_fedora' }])
    invalid(() => W.validateWardrobeCommand(raw));
});

test('status view: slots, face-layer whitelists, shapes, colour rules and all 120 items (so Unity hard-codes none)', () => {
  const s = W.wardrobeStatus({ holosTokens: 10 }, { ...W.readWardrobeState(undefined), entitlements: ['hat_fedora'] });
  assert.equal(s.schemaVersion, 'wardrobe-3'); assert.deepEqual(s.saved, { city: false, field: false }); assert.deepEqual(s.loadouts, { city: W.defaultRecipe(), field: W.defaultRecipe() });
  assert.deepEqual(s.catalog.slots.map(x => x.slot), C.WARDROBE_SLOTS.map(x => x.slot)); assert.equal(s.catalog.faceLayers.length, 16);
  assert.deepEqual(s.catalog.colors.globalChannels, ['skin', 'hair', 'eyes']); assert.equal(s.catalog.items.length, 120); assert.equal(s.catalog.placeholder, false);
  const fedora = s.catalog.items.find(i => i.itemId === 'hat_fedora'); assert.equal(fedora.owned, true); assert.equal(fedora.usable, true); assert.equal(fedora.bozoPart, 'Hat_Fedora');
  const lens = s.catalog.items.find(i => i.itemId === 'upperface_roundglasseslens'); assert.equal(lens.usable, false);
  assert.ok(s.catalog.items.filter(i => i.starter).every(i => i.usable && !i.owned));
  assert.deepEqual(s.catalog.items.find(i => i.bozoPart === 'Top_Overall').hidesSlots, ['bottom']);
  assert.deepEqual(s.catalog.shapes, {
    blendshapePrefix: 'Shape_', min: 0, max: 100, default: 0,
    body: ['Belly', 'BodyType', 'ButtSize', 'Chest', 'Curvy', 'Muscle', 'NeckThickness', 'WaistSize', 'Weight'],
    face: [...HEAD_V2, 'EarLength', 'EyeRoundness', 'Maturity', 'MouthWidth', 'Roundness'],
    faceByHead: { Head_BasicHead: HEAD_V2, Head_SharpHead: HEAD_V2, Head_Stern: HEAD_V2, Head_YoungSharpHead: HEAD_V2,
      Head_AnimeYoung: ['EarLength', 'EyeRoundness', 'Maturity', 'MouthWidth', 'Roundness', 'Sharpness'] },
  });
  assert.equal(s.catalog.shapes.face.length, 23, '18 Head_V2 + 6 AnimeYoung, Sharpness shared');
  assert.deepEqual(Object.keys(s.catalog.shapes.faceByHead).sort(), [...C.FACE_LAYERS.find(l => l.layer === 'head').options].sort(), 'every head option has its face shapes');
  assert.equal('sliders' in s.catalog, false);
});

const HEAD_V2 = ['EarAngle', 'EarsElf', 'EyeLidHeight', 'EyesOuterCornersHigh', 'EyesOuterCornersLow', 'EyesSquare', 'IrisSize', 'LowerBrows', 'MouthThin',
  'MouthWide', 'NoseBridgeCurve', 'NoseTiltDown', 'NoseTiltUp', 'NoseWidth', 'RaiseBrows', 'Sharpness', 'Squareness', 'Stern'];

test('loadouts (Pak 2026-10-04): City and Field saved independently; identity shared; unset field reads as city; loadout required', () => {
  const owned = { ...fresh(), entitlements: [id('Top_FullSuit'), id('Hat_Fedora')] };
  // Equip city, then field, independently.
  const city = base(); Object.assign(city.parts, { top: id('Top_Tshirt'), hat: id('Hat_Fedora') }); city.colors = { skin: '#c08060', top: ['#112233'] }; city.shapes = { Weight: 30 };
  const s1 = W.applyEquip({}, owned, equipCmd(city, 'c1', 'city'));
  assert.deepEqual(s1.reply.saved, { city: true, field: false });
  assert.deepEqual(s1.reply.loadouts.field, s1.reply.loadouts.city, 'unset field reads back as a copy of city');
  assert.equal(s1.state.loadouts.field, null, 'the read wrote nothing for field');
  const field = base(); Object.assign(field.parts, { top: id('Top_FullSuit'), hat: id('Hat_Fedora') }); field.colors = { skin: '#c08060', top: ['#FF0000', '#00FF00'] }; field.shapes = { Weight: 30 };
  const s2 = W.applyEquip({}, s1.state, equipCmd(field, 'f1', 'field'));
  assert.deepEqual(s2.reply.saved, { city: true, field: true });
  assert.equal(s2.reply.loadouts.city.parts.top, 'top_tshirt'); assert.deepEqual(s2.reply.loadouts.city.colors, { skin: '#C08060', top: ['#112233'] });
  assert.equal(s2.reply.loadouts.field.parts.top, 'top_fullsuit'); assert.deepEqual(s2.reply.loadouts.field.colors, { skin: '#C08060', top: ['#FF0000', '#00FF00'] });
  // An owned item can be worn in either loadout (hat_fedora in both).
  assert.equal(s2.reply.loadouts.city.parts.hat, 'hat_fedora'); assert.equal(s2.reply.loadouts.field.parts.hat, 'hat_fedora');
  // Re-equipping city leaves field's outfit alone.
  const city2 = structuredClone(city); city2.parts.hat = null; city2.colors = { skin: '#c08060' };
  const s3 = W.applyEquip({}, s2.state, equipCmd(city2, 'c2', 'city'));
  assert.equal(s3.reply.loadouts.city.parts.hat, null); assert.equal(s3.reply.loadouts.field.parts.hat, 'hat_fedora'); assert.equal(s3.reply.loadouts.field.parts.top, 'top_fullsuit');
  // Identity (face layers, shapes, global colours) is shared: saving either loadout updates both.
  const field2 = structuredClone(field); field2.shapes = { Weight: 90, Roundness: 10 }; field2.faceLayers.head = 'Head_Stern'; field2.colors = { skin: '#000001', hair: '#ABCDEF', top: ['#FF0000'] };
  const s4 = W.applyEquip({}, s3.state, equipCmd(field2, 'f2', 'field'));
  for (const l of ['city', 'field']) {
    assert.deepEqual(s4.reply.loadouts[l].shapes, { Weight: 90, Roundness: 10 }, l);
    assert.equal(s4.reply.loadouts[l].faceLayers.head, 'Head_Stern', l);
    assert.equal(s4.reply.loadouts[l].colors.skin, '#000001', l); assert.equal(s4.reply.loadouts[l].colors.hair, '#ABCDEF', l);
  }
  assert.equal('top' in s4.reply.loadouts.city.colors, false, "city's per-slot colours stay city's"); assert.deepEqual(s4.reply.loadouts.field.colors.top, ['#FF0000']);
  // Every composed loadout is itself a valid canonical recipe.
  for (const l of ['city', 'field']) assert.deepEqual(W.validateRecipe(s4.reply.loadouts[l]), s4.reply.loadouts[l], l);
  // Field saved first: city reads as the default outfit with the shared identity.
  const fOnly = W.applyEquip({}, owned, equipCmd(field2, 'f3', 'field')).reply;
  assert.deepEqual(fOnly.saved, { city: false, field: true }); assert.deepEqual(fOnly.loadouts.city.parts, W.defaultRecipe().parts); assert.equal(fOnly.loadouts.city.faceLayers.head, 'Head_Stern');
  // Field equip validates exactly like city: ownership, hide rule, colour caps.
  const unowned = base(); unowned.parts.top = id('Top_SmartDress'); unowned.parts.bottom = null;
  assert.throws(() => W.applyEquip({}, owned, equipCmd(unowned, 'x', 'field')), e => e.code === 'not_owned');
  invalid(() => equipCmd({ ...base(), parts: { ...base().parts, top: id('Top_Sundress') } }, 'x', 'field'), 'hide rule on field');
  invalid(() => equipCmd({ ...base(), colors: { top: ['#111111', '#222222', '#333333'] } }, 'x', 'field'), 'colour cap on field');
  // loadout is required and must be city | field.
  for (const loadout of [undefined, null, '', 'City', 'arena', 'both', 0, ['city']])
    invalid(() => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-3', operation: 'equip', requestId: 'r', recipe: base(), ...(loadout === undefined ? {} : { loadout }) }), `loadout ${JSON.stringify(loadout)}`);
  // Purchases keep both saved loadouts untouched.
  const bought = W.applyPurchase({ holosTokens: 750 }, s4.state, buyCmd(id('Hat_Beanie'))).state;
  assert.deepEqual(bought.loadouts, s4.state.loadouts); assert.deepEqual(bought.identity, s4.state.identity);
});

test('identity.preset: optional, whitelisted, Zell reserved; shared by both loadouts; part of the fingerprint', () => {
  assert.deepEqual(C.PRESET_OPTIONS, ['Default_Boy', 'Kenji', 'DefaultChan', 'Default_Girl', 'Glover', 'Hana', 'Jackal', 'Jayda']);
  assert.deepEqual(C.RESERVED_PRESETS, ['Zell']);
  assert.throws(() => C.validatePresetTables([...C.PRESET_OPTIONS, 'Zell'], C.RESERVED_PRESETS), /Zell is reserved/);
  assert.throws(() => C.validatePresetTables(['Kenji', 'Kenji'], []), /unique/);
  assert.throws(() => C.validatePresetTables(['Default Boy'], []), /bare names/);
  assert.doesNotThrow(() => C.validatePresetTables(C.PRESET_OPTIONS, C.RESERVED_PRESETS));
  for (const p of C.PRESET_OPTIONS) assert.equal(W.validateRecipe({ ...base(), preset: p }).preset, p);
  assert.equal(W.validateRecipe({ ...base(), preset: null }).preset, null);
  const absent = base(); delete absent.preset; assert.equal(W.validateRecipe(absent).preset, null, 'absent → null');
  for (const p of ['Zell', 'zell', 'kenji', 'Default Boy', '', 'Nobody', 1, true, ['Kenji'], { name: 'Kenji' }]) invalid(() => W.validateRecipe({ ...base(), preset: p }), `preset ${JSON.stringify(p)}`);
  // Fingerprint: absent ≡ null; any preset change alters it.
  assert.equal(W.commandFingerprint(equipCmd(absent)), W.commandFingerprint(equipCmd({ ...base(), preset: null })));
  assert.notEqual(W.commandFingerprint(equipCmd({ ...base(), preset: 'Kenji' })), W.commandFingerprint(equipCmd({ ...base(), preset: 'Hana' })));
  assert.notEqual(W.commandFingerprint(equipCmd({ ...base(), preset: 'Kenji' })), W.commandFingerprint(equipCmd(base())));
  // Stored in identity, returned in every loadout, shared: a field save changes city's preset too.
  const s1 = W.applyEquip({}, fresh(), equipCmd({ ...base(), preset: 'Kenji' }, 'c', 'city'));
  assert.equal(s1.state.identity.preset, 'Kenji'); assert.equal(s1.reply.loadouts.city.preset, 'Kenji'); assert.equal(s1.reply.loadouts.field.preset, 'Kenji');
  const s2 = W.applyEquip({}, s1.state, equipCmd({ ...base(), preset: 'Jayda' }, 'f', 'field'));
  assert.equal(s2.reply.loadouts.city.preset, 'Jayda'); assert.equal(s2.reply.loadouts.field.preset, 'Jayda');
  assert.equal(W.wardrobeStatus({}, fresh()).loadouts.city.preset, null, 'fresh pilot: preset null');
  assert.deepEqual(W.wardrobeStatus({}, fresh()).catalog.presets, { options: C.PRESET_OPTIONS, reserved: ['Zell'], optional: true });
});

test('read-time sanitising: delisted / unowned / non-equippable items repaired against the current catalog; hide rule re-applied; nothing written', () => {
  const ident = W.splitRecipe(base()).identity;
  const stored = (city, field = null, entitlements = []) => W.readWardrobeState({ schemaVersion: 'wardrobe-3', entitlements, identity: ident, loadouts: { city, field } });
  const outfit = (parts, colors = {}) => ({ parts: { ...base().parts, ...parts }, colors });
  const backUnchanged = st => { const r = W.readLoadouts(st); for (const l of ['city', 'field']) { const cmd = equipCmd(r.loadouts[l], 'rt', l); assert.doesNotThrow(() => W.applyEquip({}, st, cmd), `${l} sends back unchanged`); } return r; };
  // Clean outfits are untouched.
  const clean = stored(outfit({ hat: 'hat_fedora' }, { hat: ['#112233'] }), null, ['hat_fedora']);
  assert.deepEqual(W.readLoadouts(clean).sanitized, { city: false, field: false });
  assert.equal(W.readLoadouts(clean).loadouts.city.parts.hat, 'hat_fedora');
  // Delisted item in an OPTIONAL slot → null, its colours dropped; the entitlement itself is kept.
  const delisted = stored(outfit({ hat: 'hat_retired' }, { hat: ['#112233'] }), null, ['hat_retired']);
  let r = backUnchanged(delisted);
  assert.equal(r.loadouts.city.parts.hat, null); assert.equal('hat' in r.loadouts.city.colors, false); assert.deepEqual(r.sanitized, { city: true, field: true }, 'mirrored field copies city');
  assert.deepEqual(delisted.entitlements, ['hat_retired']); assert.equal(delisted.loadouts.city.parts.hat, 'hat_retired', 'state object not mutated');
  // Delisted item in a REQUIRED slot → that slot's first starter (the default outfit's choice).
  r = backUnchanged(stored(outfit({ top: 'top_retired' }, { top: ['#112233'] })));
  assert.equal(r.loadouts.city.parts.top, W.defaultRecipe().parts.top); assert.equal(r.loadouts.city.parts.top, 'top_simplehoodie'); assert.equal('top' in r.loadouts.city.colors, false);
  // Unowned (e.g. after a support action) → repaired in that loadout only; the other loadout stays clean.
  r = backUnchanged(stored(outfit({ top: 'top_tshirt' }), outfit({ top: 'top_fullsuit', hat: 'hat_fedora' }, { top: ['#FF0000'] }), ['hat_fedora']));
  assert.deepEqual(r.sanitized, { city: false, field: true });
  assert.equal(r.loadouts.field.parts.top, 'top_simplehoodie'); assert.equal(r.loadouts.field.parts.hat, 'hat_fedora'); assert.equal('top' in r.loadouts.field.colors, false);
  assert.equal(r.loadouts.city.parts.top, 'top_tshirt');
  // Non-equippable (the lens) and wrong-slot ids → removed.
  r = backUnchanged(stored(outfit({ upperFace: 'upperface_roundglasseslens', gloves: 'hat_fedora', hat: 'hat_fedora', top: 'top_tshirt' }), null, ['hat_fedora', 'upperface_roundglasseslens'])); // lens owned (support grant) but still not equippable
  assert.equal(r.loadouts.city.parts.upperFace, null); assert.equal(r.loadouts.city.parts.gloves, null); assert.equal(r.sanitized.city, true);
  assert.equal(r.loadouts.city.parts.hat, 'hat_fedora', 'valid items survive (repair is per slot, not a reset)'); assert.equal(r.loadouts.city.parts.top, 'top_tshirt');
  // Hide-rule interaction 1: an unowned Bottom-hiding top is replaced by the (non-hiding) starter top, so the
  // now-required bottom is refilled with its first starter.
  r = backUnchanged(stored(outfit({ top: 'top_sundress', bottom: null })));
  assert.equal(r.loadouts.city.parts.top, 'top_simplehoodie'); assert.equal(r.loadouts.city.parts.bottom, 'bottom_baggypants');
  // Hide-rule interaction 2: the same outfit while still owned is clean (bottom stays null under the hider).
  r = backUnchanged(stored(outfit({ top: 'top_sundress', bottom: null }), null, ['top_sundress']));
  assert.equal(r.loadouts.city.parts.bottom, null); assert.equal(r.sanitized.city, false);
  // Hide-rule interaction 3: a stored bottom under a valid hider (possible after a pack audit adds `hides`) → bottom null, colours dropped.
  r = backUnchanged(stored(outfit({ top: 'top_overall', bottom: 'bottom_skinnyjeans' }, { bottom: ['#123456'] }), null, ['top_overall']));
  assert.equal(r.loadouts.city.parts.bottom, null); assert.equal('bottom' in r.loadouts.city.colors, false); assert.equal(r.sanitized.city, true);
  // Colours that no longer fit the item (colorChannels shrank, bad hex) are dropped; the item stays.
  r = backUnchanged(stored(outfit({ hat: 'hat_fedora' }, { hat: ['#111111', '#222222', '#333333'], socks: ['#111111'] }), null, ['hat_fedora']));
  assert.equal(r.loadouts.city.parts.hat, 'hat_fedora'); assert.deepEqual(r.loadouts.city.colors, {}); assert.equal(r.sanitized.city, true);
  // Identity repair: off-whitelist face option / shape / preset → reset, flags both loadouts.
  const badIdent = { ...ident, preset: 'Zell', faceLayers: { ...ident.faceLayers, head: 'Head_Retired', faceDetails: 'FaceDetail_Gone' }, shapes: { Weight: 150, Belly: 20, Tail: 3 } };
  const st = W.readWardrobeState({ schemaVersion: 'wardrobe-3', entitlements: [], identity: badIdent, loadouts: { city: outfit({}), field: outfit({}) } });
  r = backUnchanged(st);
  assert.deepEqual(r.sanitized, { city: true, field: true });
  assert.equal(r.loadouts.city.preset, null); assert.equal(r.loadouts.city.faceLayers.head, 'Head_AnimeYoung'); assert.equal(r.loadouts.city.faceLayers.faceDetails, null);
  assert.deepEqual(r.loadouts.city.shapes, { Belly: 20 });
  // A pre-preset stored identity (no preset key) is NOT a repair.
  const { preset, ...noPreset } = ident;
  assert.deepEqual(W.readLoadouts(W.readWardrobeState({ schemaVersion: 'wardrobe-3', entitlements: [], identity: noPreset, loadouts: { city: outfit({}), field: null } })).sanitized, { city: false, field: false });
  // status surfaces `sanitized`; equip persists the clean version for the loadout it saves.
  const dirty = stored(outfit({ top: 'top_tshirt' }), outfit({ hat: 'hat_retired' }), ['hat_retired']);
  const status = W.wardrobeStatus({}, dirty);
  assert.deepEqual(status.sanitized, { city: false, field: true }); assert.equal(status.loadouts.field.parts.hat, null);
  const saved = W.applyEquip({}, dirty, equipCmd(status.loadouts.field, 'fix', 'field'));
  assert.equal(saved.state.loadouts.field.parts.hat, null); assert.deepEqual(saved.reply.sanitized, { city: false, field: false });
});
