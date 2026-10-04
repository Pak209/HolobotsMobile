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
const equipCmd = (recipe, requestId = 'e1') => W.validateWardrobeCommand({ schemaVersion: 'wardrobe-3', operation: 'equip', requestId, recipe });
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
  assert.equal(out.reply.holosTokens, 0); assert.equal(out.reply.purchased, null); assert.equal(out.state.recipe.parts.hairBack, 'hairback_shinryucut');
  assert.deepEqual(out.state.recipe.shapes, { Belly: 0, Muscle: 37.5, EarsElf: 12, Roundness: 100 }, 'canonical order: body keys, then face keys');
  const withPart = (slot, v) => { const x = base(); x.parts[slot] = v; return x; };
  assert.throws(() => W.applyEquip({ holosTokens: 9999 }, fresh(), equipCmd(withPart('hat', id('Hat_Fedora')))), e => e.code === 'not_owned');
  assert.throws(() => W.applyEquip({}, fresh(), equipCmd(Object.assign(base(), { parts: { ...base().parts, top: id('Top_Overall'), bottom: null } }))), e => e.code === 'not_owned');
  assert.equal(W.applyEquip({}, { ...fresh(), entitlements: [id('Hat_Fedora')] }, equipCmd(withPart('hat', id('Hat_Fedora')))).state.recipe.parts.hat, 'hat_fedora');
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
  assert.deepEqual(W.readWardrobeState(undefined), { schemaVersion: 'wardrobe-3', entitlements: [], recipe: null });
  for (const bad of [null, {}, [], { schemaVersion: 'wardrobe-2', entitlements: [], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: 'x', recipe: null },
    { schemaVersion: 'wardrobe-3', entitlements: [1], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: ['a', 'a'], recipe: null }, { schemaVersion: 'wardrobe-3', entitlements: [], recipe: 'x' }])
    assert.throws(() => W.readWardrobeState(bad), e => e.code === 'unavailable', JSON.stringify(bad));
  const kept = W.readWardrobeState({ schemaVersion: 'wardrobe-3', entitlements: ['top_retired'], recipe: null });
  assert.deepEqual(W.applyPurchase({ holosTokens: 300 }, kept, buyCmd(id('Neck_RibbonBow'))).state.entitlements, ['neck_ribbonbow', 'top_retired']);
});

test('fingerprints: equivalent recipes share one (key order, hex case, omitted optional slots/layers); any change alters it', () => {
  const a = base(); a.shapes = { Weight: 50, Sharpness: 25 }; a.colors = { hair: '#abcdef', top: ['#010203'] };
  const b = base(); b.shapes = { Sharpness: 25, Weight: 50 }; b.colors = { top: ['#010203'], hair: '#ABCDEF' }; delete b.parts.gloves; delete b.faceLayers.makeUpEyes;
  assert.equal(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(b, 'x')));
  const c = structuredClone(a); c.faceLayers.pupil = 'Pupil_StarPupil';
  assert.notEqual(W.commandFingerprint(equipCmd(a)), W.commandFingerprint(equipCmd(c)));
  assert.notEqual(W.commandFingerprint(buyCmd(id('Hat_Fedora'))), W.commandFingerprint(buyCmd(id('Hat_Beanie'))));
  for (const raw of [{ operation: 'status' }, { schemaVersion: 'wardrobe-2', operation: 'status' }, { schemaVersion: 'wardrobe-3', operation: 'purchase', itemId: 'hat_fedora' }])
    invalid(() => W.validateWardrobeCommand(raw));
});

test('status view: slots, face-layer whitelists, shapes, colour rules and all 120 items (so Unity hard-codes none)', () => {
  const s = W.wardrobeStatus({ holosTokens: 10 }, { schemaVersion: 'wardrobe-3', entitlements: ['hat_fedora'], recipe: null });
  assert.equal(s.schemaVersion, 'wardrobe-3'); assert.equal(s.recipeSaved, false); assert.deepEqual(s.recipe, W.defaultRecipe());
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
