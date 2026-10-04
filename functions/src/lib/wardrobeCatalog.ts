/**
 * Pak DECISIONS #48 (2026-10-03): pilot wardrobe catalog, GENERATED from the BoZo Anime Pack
 * manifest (lib/data/bozoWardrobeManifest.json: one entry per runtime prefab, read from each
 * prefab's Outfit.Type in Unity; canonical copy in the Unity repo at
 * Documentation/QA/2026-10-03-bozo-import/bozo-wardrobe-manifest.json).
 *
 * No item id is hand-typed: itemId = bozoPart lower-cased, bozoPart kept verbatim (Unity loads the
 * prefab by that exact name, vendor spellings included: Hairback_ShinryuCut, Underlower_*, Freakles).
 * This file holds only the producer's DECISIONS on top of the manifest (slot table, starter / rarity
 * split, face-layer whitelists, overrides) and checks them against the manifest at load: a typo or
 * a renamed prefab fails the build's tests instead of shipping an unknown id.
 *
 * Regenerate after a new pack audit: replace the JSON, re-run tests; adjust the decision tables
 * below only if the producer changes them. No code in lib/wardrobe.ts / the store / the host changes.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { MARKETPLACE_PART_PRICES, type MarketplacePartRarity } from "./economy";
import MANIFEST_JSON from "./data/bozoWardrobeManifest.json";

export type ManifestEntry = { bozoPart: string; type: string; hides: string[]; incompatible: string[]; colorChannels: number };
export const BOZO_MANIFEST: readonly ManifestEntry[] = MANIFEST_JSON as ManifestEntry[];

export const WARDROBE_CATALOG_IS_PLACEHOLDER = false;
export const WARDROBE_CATALOG_SOURCE = "BoZo Anime Pack runtime prefabs (Outfit.Type), manifest 2026-10-03 (120 entries)";

// ---- Slots: pack Outfit.Type → recipe slot ---------------------------------------

/**
 * `required`: the slot must hold an item, UNLESS an equipped item's `hides` covers it (then it must
 * be null). Optional slots may be null. `expectedCount` = manifest entries of that type (asserted).
 */
export type SlotRow = { slot: string; type: string; required: boolean; expectedCount: number };
export const WARDROBE_SLOTS: readonly SlotRow[] = [
  { slot: "hairFront", type: "HairFront", required: true, expectedCount: 11 },
  { slot: "hairBack", type: "HairBack", required: true, expectedCount: 19 },
  { slot: "top", type: "Top", required: true, expectedCount: 24 },
  { slot: "bottom", type: "Bottom", required: true, expectedCount: 16 },
  { slot: "feet", type: "Feet", required: true, expectedCount: 13 },
  { slot: "gloves", type: "Gloves", required: false, expectedCount: 8 },
  { slot: "hat", type: "Hat", required: false, expectedCount: 9 },
  { slot: "headAcc", type: "HeadAcc", required: false, expectedCount: 4 },
  { slot: "upperFace", type: "UpperFace", required: false, expectedCount: 5 },
  { slot: "lowerFace", type: "LowerFace", required: false, expectedCount: 3 },
  { slot: "neck", type: "Neck", required: false, expectedCount: 1 },
  { slot: "leggings", type: "Leggings", required: false, expectedCount: 1 },
  { slot: "socks", type: "Socks", required: false, expectedCount: 6 },
];
const SLOT_BY_TYPE: ReadonlyMap<string, SlotRow> = new Map(WARDROBE_SLOTS.map((s) => [s.type, s]));

// ---- Producer split (data; Pak tunes) -----------------------------------------------

/** Free and always usable: every item of these types, plus these exact parts. */
export const STARTER_TYPES: readonly string[] = ["HairFront", "HairBack"];
export const STARTER_PARTS: readonly string[] = [
  "Top_Tshirt", "Top_SimpleHoodie", "Top_TankTop",
  "Bottom_SimpleShorts", "Bottom_SkinnyJeans", "Bottom_BaggyPants",
  "Feet_SimpleSneakers", "Feet_AthleticMidTop",
  "Socks_BasicSocks",
];

/**
 * Sold items: first matching rule wins; no match = "common" (basics).
 * epic: named premium pieces + all HeadAcc. rare: jackets, boots, hats, gloves, glasses.
 */
export type RarityRule = { rarity: MarketplacePartRarity; parts?: readonly string[]; types?: readonly string[]; pattern?: RegExp; patternTypes?: readonly string[]; note: string };
export const RARITY_RULES: readonly RarityRule[] = [
  { rarity: "epic", parts: ["Top_FullSuit", "Top_SmartDress", "Top_Nagagi", "Top_SimpleKimono", "Bottom_BasicHakma"], note: "premium pieces" },
  { rarity: "epic", types: ["HeadAcc"], note: "all HeadAcc" },
  { rarity: "rare", pattern: /Jacket/, patternTypes: ["Top"], note: "jackets" },
  { rarity: "rare", pattern: /Boot/, patternTypes: ["Feet"], note: "boots" },
  { rarity: "rare", types: ["Hat"], note: "hats" },
  { rarity: "rare", types: ["Gloves"], note: "gloves (whole Gloves type: gloves, rings, bands)" },
  { rarity: "rare", pattern: /Glasses|HalfMoon/, patternTypes: ["UpperFace"], note: "glasses" },
];

/**
 * Per-part overrides (non-sellable / non-equippable). Empty: UpperFace_RoundGlassesLens was confirmed a STANDALONE
 * item by Unity (own FBX + icon, showCharacterCreator: 1, RoundGlasses has optionalPieces: []), producer 2026-10-04,
 * so it is ordinary rare glasses. The mechanism stays for future pack audits.
 */
export const PART_OVERRIDES: Readonly<Record<string, { sellable: boolean; equippable: boolean; note: string }>> = {};

// ---- Free creator choices (not wardrobe items, never purchasable) --------------------

/** Recipe `faceLayers: { <layer>: <BoZo part name> | null }`. Vendor spellings kept exactly. */
export type FaceLayerRow = { layer: string; required: boolean; options: readonly string[] };
export const FACE_LAYERS: readonly FaceLayerRow[] = [
  { layer: "head", required: true, options: ["Head_AnimeYoung", "Head_BasicHead", "Head_SharpHead", "Head_Stern", "Head_YoungSharpHead"] },
  { layer: "body", required: true, options: ["Body_AnimeBasic", "Body_BasicBody", "Body_StrongBody"] },
  { layer: "bodyType", required: false, options: ["BodyType_StylizedLeanBody", "BodyType_StylizedStrongBody"] },
  { layer: "eyes", required: true, options: ["Eyes_AnimeBasic", "Eyes_BasicEyes", "Eyes_BasicIris"] },
  { layer: "pupil", required: true, options: ["Pupil_BasicPupil", "Pupil_Round", "Pupil_SharpPupil", "Pupil_StylizedRoundRinged", "Pupil_HeartPupil", "Pupil_Square", "Pupil_StarPupil"] },
  { layer: "eyeShine", required: false, options: ["EyeShine_DoubleRound", "EyeShine_StylizedDoubleShine"] },
  { layer: "eyeBrows", required: true, options: ["Brows_BasicBrows", "Brows_PillBrows", "Brows_ThickBrows", "Brows_ThinBrows", "EyeBrows_StylizedBasicBrows", "EyeBrows_StylizedThickBrows"] },
  { layer: "eyeLashes", required: true, options: ["EyeLashes_LongLashes", "EyeLashes_ShortLashes", "EyeLashes_StylizedLongLashes", "EyeLashes_StylizedShortLashes"] },
  { layer: "teeth", required: true, options: ["Teeth_AnimeBasicTeeth", "Teeth_StylizedBasicTeeth"] },
  { layer: "makeUpCheeks", required: false, options: ["MakeUpCheeks_BasicBlush", "MakeUpCheeks_SimpleBlush"] },
  { layer: "makeUpEyes", required: false, options: ["MakeUpEyes_BasicEyeLiner"] },
  { layer: "makeUpLips", required: false, options: ["MakeUpLips_BasicLipstick", "MakeUpLips_SimpleLipstick"] },
  { layer: "faceDetails", required: false, options: ["FaceDetail_Freakles", "FaceDetail_FullFreakles", "FaceDetails_FrecklesHeavy", "FaceDetails_FrecklesLight", "FaceDetails_FrecklesMedium"] },
  { layer: "faceTexture", required: false, options: ["FaceTexture_Wrinkles"] },
  { layer: "underUpper", required: false, options: ["UnderUpper_SimpleUnderShirt", "UnderUpper_SimpleUnderShirt2", "UnderUpper_SimpleBra"] },
  { layer: "underLower", required: true, options: ["UnderLower_SimpleBoxers", "Underlower_ShortSpats", "UnderLower_SimplePanties"] },
];

// ---- Default identity / outfit: the Default_Boy preset (CustomCharacters/Resources/Anime/Default_Boy.asset) ------
// Relayed by the producer from the Unity pack files, 2026-10-04. Validated at module load (validateDefaults).

/** Every face layer; null = none. Required layers must be non-null. */
export const DEFAULT_FACE_LAYERS: Readonly<Record<string, string | null>> = {
  head: "Head_AnimeYoung", body: "Body_AnimeBasic", bodyType: null, eyes: "Eyes_AnimeBasic", pupil: "Pupil_Round",
  eyeShine: "EyeShine_DoubleRound", eyeBrows: "Brows_ThickBrows", eyeLashes: "EyeLashes_ShortLashes", teeth: "Teeth_AnimeBasicTeeth",
  makeUpCheeks: null, makeUpEyes: null, makeUpLips: null, faceDetails: null, faceTexture: null, underUpper: null, underLower: "UnderLower_SimpleBoxers",
};
/** Default_Boy blendshape weights (others 0). BodyType/Weight/NeckThickness are body keys; the rest Head_AnimeYoung face keys. */
export const DEFAULT_SHAPES: Readonly<Record<string, number>> = { BodyType: 45, NeckThickness: 27, Weight: 15, EyeRoundness: 46, Roundness: 2, Sharpness: 85 };
/** Default City outfit (the Unity starter look), by bozoPart; slots not listed are null. */
export const DEFAULT_PARTS: Readonly<Record<string, string>> = {
  hairFront: "HairFront_LynxFringe", hairBack: "HairBack_MessyHair", top: "Top_Tshirt", bottom: "Bottom_SkinnyJeans", feet: "Feet_SimpleSneakers",
};

// ---- Starting preset ------------------------------------------------------------------

/**
 * BoZo starting presets a pilot can be created from (producer relay, 2026-10-04). Unity uses identity.preset
 * to restore preset-only data wardrobe-3 doesn't carry (bone-based proportions) on another device.
 * Optional: null / absent = none.
 */
export const PRESET_OPTIONS: readonly string[] = ["Default_Boy", "Kenji", "DefaultChan", "Default_Girl", "Glover", "Hana", "Jackal", "Jayda"];
/** Reserved presets are never accepted (rejected exactly like an unknown preset). */
export const RESERVED_PRESETS: readonly string[] = ["Zell"];
/** Town / creator default preset (Pak 2026-10-03). Its bone data lives in Unity; the server only names it. */
export const DEFAULT_PRESET = "Default_Boy";

/**
 * identity.heightScale (Pak 2026-10-03): every pilot starts at the starter height and may only choose to be SHORTER.
 * Finite number in [HEIGHT_SCALE_MIN, HEIGHT_SCALE_MAX] inclusive; absent = HEIGHT_SCALE_DEFAULT; outside → invalid_request.
 */
export const HEIGHT_SCALE_MIN = 0.9;
export const HEIGHT_SCALE_MAX = 1.0;
export const HEIGHT_SCALE_DEFAULT = 1.0;

/** Presets must be unique, bare names, and never reserved. Throws otherwise (fails the build / module load). */
export function validatePresetTables(options: readonly string[], reserved: readonly string[]): void {
  if (new Set(options).size !== options.length || options.some((p) => !/^[A-Za-z0-9_]+$/.test(p))) throw new Error("wardrobe catalog: preset options must be unique bare names");
  const clash = options.find((p) => reserved.includes(p));
  if (clash) throw new Error(`wardrobe catalog: preset ${clash} is reserved`);
}
validatePresetTables(PRESET_OPTIONS, RESERVED_PRESETS);
if (!PRESET_OPTIONS.includes(DEFAULT_PRESET)) throw new Error("wardrobe catalog: DEFAULT_PRESET must be a preset option");

// ---- Body / face shapes (BoZo blendshapes) and colours ----------------------------------

/**
 * Real BoZo blendshape keys (meshes name them `Shape_<Key>`), producer relay 2026-10-04. Values are Unity
 * blendshape weights. Height and limb proportions are bone modifiers in BoZo, not blendshapes, and are
 * out of scope for wardrobe-3.
 */
export const SHAPE_BLENDSHAPE_PREFIX = "Shape_";
/** Body mesh (BodyRig / Body_BasicBodyV2). */
export const BODY_SHAPE_KEYS: readonly string[] = ["Belly", "BodyType", "ButtSize", "Chest", "Curvy", "Muscle", "NeckThickness", "WaistSize", "Weight"];
const HEAD_V2_SHAPES = [
  "EarAngle", "EarsElf", "EyeLidHeight", "EyesOuterCornersHigh", "EyesOuterCornersLow", "EyesSquare", "IrisSize", "LowerBrows", "MouthThin",
  "MouthWide", "NoseBridgeCurve", "NoseTiltDown", "NoseTiltUp", "NoseWidth", "RaiseBrows", "Sharpness", "Squareness", "Stern",
];
/** Face blendshapes depend on the head (faceLayers.head). Every head option must be listed. */
export const FACE_SHAPES_BY_HEAD: Readonly<Record<string, readonly string[]>> = {
  Head_BasicHead: HEAD_V2_SHAPES, Head_SharpHead: HEAD_V2_SHAPES, Head_Stern: HEAD_V2_SHAPES, Head_YoungSharpHead: HEAD_V2_SHAPES, // BSMC_Head + Head_V2 meshes
  Head_AnimeYoung: ["EarLength", "EyeRoundness", "Maturity", "MouthWidth", "Roundness", "Sharpness"],
};
/**
 * Accepted face keys: the UNION over all heads. A key the chosen head lacks is harmless (Unity ignores
 * it), so a head mismatch is NOT rejected.
 */
export const FACE_SHAPE_KEYS: readonly string[] = [...new Set(Object.values(FACE_SHAPES_BY_HEAD).flat())];
/** Recipe `shapes` key order: body keys, then face keys. */
export const SHAPE_KEYS: readonly string[] = [...BODY_SHAPE_KEYS, ...FACE_SHAPE_KEYS];
/** Unity blendshape weight range, inclusive; outside → REJECTED (invalid_request), never clamped. Missing key = SHAPE_DEFAULT. */
export const SHAPE_MIN = 0;
export const SHAPE_MAX = 100;
export const SHAPE_DEFAULT = 0;

/**
 * Global channels (one #RRGGBB each; missing = default). Per-slot colours live in the same
 * `colors` map under the slot name as an array of #RRGGBB, at most the equipped item's colorChannels.
 */
/** skin = the BoZo starter's #F5CAB0 (Pak 2026-10-03), so a canonical reply never retints the starter. hair / eyes: unchanged (no pack values relayed). */
export const GLOBAL_COLOR_DEFAULTS: Readonly<Record<string, string>> = { skin: "#F5CAB0", hair: "#2B2B2B", eyes: "#3A6EA5" };
export const GLOBAL_COLOR_CHANNELS: readonly string[] = Object.keys(GLOBAL_COLOR_DEFAULTS);

/** Encoded (JSON, UTF-8) size cap for one recipe. Larger → invalid_request. */
export const MAX_RECIPE_BYTES = 4096;

// ---- Generated items ----------------------------------------------------------------

export type WardrobeItem = {
  itemId: string;
  /** Exact Unity prefab name (vendor spelling). */
  bozoPart: string;
  slot: string;
  type: string;
  displayName: string;
  rarity: "starter" | MarketplacePartRarity;
  /** Holos; 0 when not sellable (starter / override). Sold: MARKETPLACE_PART_PRICES[rarity] (economy module). */
  price: number;
  starter: boolean;
  /** Listed at the boutique and purchasable (false for starter items and overrides). */
  sellable: boolean;
  /** May appear in a recipe. */
  equippable: boolean;
  vendorId: "boutique" | "";
  /** Number of tintable colour channels (0..N): the per-slot colour array cap. */
  colorChannels: number;
  /** Slots that must be empty while this item is equipped (manifest `hides`, mapped type → slot). */
  hidesSlots: string[];
  /** Slots that must be empty while this item is equipped (manifest `incompatible`). */
  incompatibleSlots: string[];
};

const displayNameOf = (bozoPart: string) => bozoPart.slice(bozoPart.indexOf("_") + 1).replace(/([a-z0-9])([A-Z])/g, "$1 $2");

/** Shape tables must cover exactly the head options, and body / face keys must not collide. Throws otherwise. */
export function validateShapeTables(faceLayers: readonly FaceLayerRow[], body: readonly string[], byHead: Readonly<Record<string, readonly string[]>>): void {
  const fail = (msg: string): never => { throw new Error(`wardrobe catalog: ${msg}`); };
  const heads = faceLayers.find((l) => l.layer === "head")?.options ?? fail("no head face layer");
  if (heads.some((h) => !byHead[h]) || Object.keys(byHead).some((h) => !heads.includes(h))) fail("FACE_SHAPES_BY_HEAD must list exactly the head options");
  const face = new Set(Object.values(byHead).flat());
  if (new Set(body).size !== body.length || body.some((k) => face.has(k))) fail("body and face shape keys overlap");
  if ([...body, ...face].some((k) => !/^[A-Za-z]+$/.test(k))) fail("shape keys are bare BoZo names (no Shape_ prefix)");
}

/** Derives the catalog from a manifest and validates every producer decision against it. Throws on any inconsistency. */
export function buildWardrobeItems(manifest: readonly ManifestEntry[]): WardrobeItem[] {
  const fail = (msg: string): never => { throw new Error(`wardrobe catalog: ${msg}`); };
  const byPart = new Map(manifest.map((e) => [e.bozoPart, e]));
  if (byPart.size !== manifest.length) fail("duplicate bozoPart");
  if (new Set(manifest.map((e) => e.bozoPart.toLowerCase())).size !== manifest.length) fail("lower-cased ids collide");
  for (const name of [...STARTER_PARTS, ...Object.keys(PART_OVERRIDES), ...RARITY_RULES.flatMap((r) => r.parts ?? [])]) if (!byPart.has(name)) fail(`unknown part ${name}`);
  for (const t of [...STARTER_TYPES, ...RARITY_RULES.flatMap((r) => [...(r.types ?? []), ...(r.patternTypes ?? [])])]) if (!SLOT_BY_TYPE.has(t)) fail(`unknown type ${t}`);
  const items = manifest.map((e): WardrobeItem => {
    if (typeof e.bozoPart !== "string" || !/^[A-Za-z0-9_]+$/.test(e.bozoPart)) fail(`bad bozoPart ${e.bozoPart}`);
    const slot = SLOT_BY_TYPE.get(e.type) ?? fail(`${e.bozoPart}: unknown type ${e.type}`);
    if (!Number.isSafeInteger(e.colorChannels) || e.colorChannels < 0) fail(`${e.bozoPart}: bad colorChannels`);
    const toSlots = (types: unknown) => (Array.isArray(types) ? types : fail(`${e.bozoPart}: hides/incompatible not an array`)).map((t: string) => SLOT_BY_TYPE.get(t)?.slot ?? fail(`${e.bozoPart}: unknown type ${t}`));
    const hidesSlots = toSlots(e.hides), incompatibleSlots = toSlots(e.incompatible);
    if (hidesSlots.includes(slot.slot) || incompatibleSlots.includes(slot.slot)) fail(`${e.bozoPart}: hides its own slot`);
    const starter = STARTER_TYPES.includes(e.type) || STARTER_PARTS.includes(e.bozoPart);
    const override = PART_OVERRIDES[e.bozoPart];
    const rule = RARITY_RULES.find((r) => r.parts?.includes(e.bozoPart) || r.types?.includes(e.type) || (r.pattern && r.patternTypes?.includes(e.type) && r.pattern.test(e.bozoPart)));
    const rarity = starter ? "starter" : rule?.rarity ?? "common";
    const sellable = !starter && (override?.sellable ?? true);
    return {
      itemId: e.bozoPart.toLowerCase(), bozoPart: e.bozoPart, slot: slot.slot, type: e.type, displayName: displayNameOf(e.bozoPart),
      rarity, price: sellable && rarity !== "starter" ? MARKETPLACE_PART_PRICES[rarity] : 0, starter, sellable, equippable: override?.equippable ?? true,
      vendorId: sellable ? "boutique" : "", colorChannels: e.colorChannels, hidesSlots, incompatibleSlots,
    };
  });
  for (const s of WARDROBE_SLOTS) {
    if (s.required && !items.some((i) => i.slot === s.slot && i.starter && i.equippable)) fail(`required slot ${s.slot} has no starter item`);
  }
  for (const l of FACE_LAYERS) if (l.options.length === 0 || new Set(l.options).size !== l.options.length) fail(`face layer ${l.layer} options`);
  validateShapeTables(FACE_LAYERS, BODY_SHAPE_KEYS, FACE_SHAPES_BY_HEAD);
  return items;
}

export const WARDROBE_ITEMS: readonly WardrobeItem[] = buildWardrobeItems(BOZO_MANIFEST);
export const WARDROBE_ITEM_BY_ID: ReadonlyMap<string, WardrobeItem> = new Map(WARDROBE_ITEMS.map((i) => [i.itemId, i]));

/**
 * The defaults must be a valid, renderable starter look: every face layer listed and whitelisted, required layers set;
 * shapes known and in range; every required slot filled with an equippable STARTER of that slot that hides nothing
 * and conflicts with nothing (so the default can never trip the hide rule). Throws otherwise (fails the build).
 */
export function validateDefaults(items: readonly WardrobeItem[], faceLayers = DEFAULT_FACE_LAYERS, shapes = DEFAULT_SHAPES, parts = DEFAULT_PARTS): void {
  const fail = (msg: string): never => { throw new Error(`wardrobe catalog: default ${msg}`); };
  for (const l of FACE_LAYERS) {
    const v = faceLayers[l.layer];
    if (v === undefined) fail(`face layer ${l.layer} missing`);
    if (v === null ? l.required : !l.options.includes(v)) fail(`face layer ${l.layer} = ${v}`);
  }
  if (Object.keys(faceLayers).some((k) => !FACE_LAYERS.some((l) => l.layer === k))) fail("face layer unknown");
  for (const [k, n] of Object.entries(shapes)) if (!SHAPE_KEYS.includes(k) || !(n >= SHAPE_MIN && n <= SHAPE_MAX)) fail(`shape ${k}`);
  for (const s of WARDROBE_SLOTS) {
    const part = parts[s.slot];
    if (part === undefined) { if (s.required) fail(`slot ${s.slot} empty`); continue; }
    const item = items.find((i) => i.bozoPart === part);
    if (!item || item.slot !== s.slot || !item.starter || !item.equippable || item.hidesSlots.length || item.incompatibleSlots.length) fail(`part ${s.slot} = ${part}`);
  }
  if (Object.keys(parts).some((k) => !WARDROBE_SLOTS.some((s) => s.slot === k))) fail("slot unknown");
}
validateDefaults(WARDROBE_ITEMS);
