/**
 * Pak DECISIONS #48 (2026-10-03): pilot wardrobe rules, wardrobe-3. The server owns prices,
 * entitlements and the saved appearance recipe; Unity sends a recipe, the server validates and
 * stores it, Unity renders what the server returns. All data lives in lib/wardrobeCatalog.ts.
 *
 * Pure module: no firebase imports (node:crypto only), safe to import from tests.
 */
import { createHash } from "node:crypto";
import {
  FACE_LAYERS, DEFAULT_FACE_LAYERS, DEFAULT_PARTS, DEFAULT_SHAPES, PRESET_OPTIONS, RESERVED_PRESETS, DEFAULT_PRESET, HEIGHT_SCALE_DEFAULT, HEIGHT_SCALE_MAX, HEIGHT_SCALE_MIN, GLOBAL_COLOR_CHANNELS, GLOBAL_COLOR_DEFAULTS, MAX_RECIPE_BYTES, BODY_SHAPE_KEYS, FACE_SHAPE_KEYS, FACE_SHAPES_BY_HEAD, SHAPE_BLENDSHAPE_PREFIX, SHAPE_DEFAULT, SHAPE_KEYS, SHAPE_MAX, SHAPE_MIN,
  WARDROBE_CATALOG_IS_PLACEHOLDER, WARDROBE_CATALOG_SOURCE, WARDROBE_ITEM_BY_ID, WARDROBE_ITEMS, WARDROBE_SLOTS, type WardrobeItem,
} from "./wardrobeCatalog";

/** wardrobe-3: BoZo manifest slots, faceLayers, per-slot colour arrays (wardrobe-2 was never deployed). */
export const WARDROBE_SCHEMA = "wardrobe-3";
export const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export type WardrobeErrorCode = "invalid_request" | "not_owned" | "already_owned" | "not_enough_holos" | "sequence_conflict" | "unavailable";
export class WardrobeError extends Error {
  constructor(public code: WardrobeErrorCode) {
    super(code);
  }
}
const bad = (): never => { throw new WardrobeError("invalid_request"); };
const isHeightScale = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= HEIGHT_SCALE_MIN && v <= HEIGHT_SCALE_MAX;
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// ---- Recipe -----------------------------------------------------------------

export type Recipe = {
  schemaVersion: typeof WARDROBE_SCHEMA;
  /** BoZo starting preset the pilot was created from (PRESET_OPTIONS), or null. Identity: shared by both loadouts. */
  preset: string | null;
  /** Uniform height scale in [0.90, 1.00] (shorter only); absent = 1.00. Identity: shared by both loadouts. */
  heightScale: number;
  /** Free creator choices: every FACE_LAYERS layer, in order; null only for optional layers. */
  faceLayers: Record<string, string | null>;
  /** Every slot, in WARDROBE_SLOTS order; null for optional slots, and for any slot an equipped item hides. */
  parts: Record<string, string | null>;
  /** BoZo blendshape weights `Shape_<Key>` in [0, 100]: only the keys the pilot set (missing = 0), body keys then face keys. */
  shapes: Record<string, number>;
  /**
   * Global channels (skin, hair, eyes) → "#RRGGBB"; slot name → ["#RRGGBB", …] with at most the
   * equipped item's colorChannels entries. Only what the pilot set, upper-case, channels then slots in order.
   */
  colors: Record<string, string | string[]>;
};
const RECIPE_KEYS = new Set(["schemaVersion", "preset", "heightScale", "faceLayers", "parts", "shapes", "colors"]);

/**
 * Structural validation (no ownership): returns the canonical recipe or throws invalid_request for an
 * oversize payload, unknown keys, a wrong schema, a face layer outside its whitelist (or a missing
 * required layer), an unknown / non-equippable item, an item in the wrong slot, a missing required
 * slot, a filled slot that an equipped item hides (e.g. bottom under Top_Overall), a filled slot an
 * equipped item is incompatible with, an unknown shape key or a non-finite / out-of-[0, 100] shape weight (REJECTED, never clamped),
 * a colour that isn't strict #RRGGBB, or a slot colour array longer than that item's colorChannels.
 */
export function validateRecipe(raw: unknown): Recipe {
  let encoded: string;
  try { encoded = JSON.stringify(raw); } catch { return bad(); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > MAX_RECIPE_BYTES) bad();
  if (!isPlainObject(raw) || Object.keys(raw).some((k) => !RECIPE_KEYS.has(k))) bad();
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== WARDROBE_SCHEMA) bad();

  // Optional; absent and null both canonicalise to null (so they fingerprint alike). Reserved presets (Zell) are never in
  // PRESET_OPTIONS (validatePresetTables enforces it at load), so they are rejected like any unknown preset.
  if (r.preset !== undefined && r.preset !== null && (typeof r.preset !== "string" || !PRESET_OPTIONS.includes(r.preset))) bad();
  const preset = (r.preset ?? null) as string | null;
  // Optional; absent canonicalises to the default (so absent and 1.0 fingerprint alike). Never clamped.
  if (r.heightScale !== undefined && !isHeightScale(r.heightScale)) bad();
  const heightScale = (r.heightScale ?? HEIGHT_SCALE_DEFAULT) as number;

  if (!isPlainObject(r.faceLayers)) bad();
  const rawLayers = r.faceLayers as Record<string, unknown>;
  if (Object.keys(rawLayers).some((k) => !FACE_LAYERS.some((l) => l.layer === k))) bad();
  const faceLayers: Record<string, string | null> = {};
  for (const { layer, required, options } of FACE_LAYERS) {
    const v = rawLayers[layer];
    if (v === undefined || v === null) {
      if (required) bad();
      faceLayers[layer] = null;
      continue;
    }
    if (typeof v !== "string" || !options.includes(v)) bad();
    faceLayers[layer] = v as string;
  }

  if (!isPlainObject(r.parts)) bad();
  const rawParts = r.parts as Record<string, unknown>;
  if (Object.keys(rawParts).some((k) => !WARDROBE_SLOTS.some((s) => s.slot === k))) bad();
  const parts: Record<string, string | null> = {};
  for (const { slot } of WARDROBE_SLOTS) {
    const v = rawParts[slot];
    if (v === undefined || v === null) { parts[slot] = null; continue; }
    if (typeof v !== "string") bad();
    const item = WARDROBE_ITEM_BY_ID.get(v as string);
    if (!item || item.slot !== slot || !item.equippable) bad();
    parts[slot] = v as string;
  }
  // Hide / incompatibility rules, generalised from the manifest: a slot hidden by (or incompatible
  // with) any equipped item must be empty; every other required slot must be filled.
  const equipped = Object.values(parts).filter((id): id is string => id !== null).map((id) => WARDROBE_ITEM_BY_ID.get(id)!);
  const mustBeEmpty = new Set(equipped.flatMap((i) => [...i.hidesSlots, ...i.incompatibleSlots]));
  for (const { slot, required } of WARDROBE_SLOTS) {
    if (mustBeEmpty.has(slot)) { if (parts[slot] !== null) bad(); }
    else if (required && parts[slot] === null) bad();
  }

  // Face keys are checked against the union over all heads: a key the chosen head lacks is harmless (Unity ignores it).
  const shapes: Record<string, number> = {};
  if (r.shapes !== undefined) {
    if (!isPlainObject(r.shapes)) bad();
    const s = r.shapes as Record<string, unknown>;
    if (Object.keys(s).some((k) => !SHAPE_KEYS.includes(k))) bad();
    for (const key of SHAPE_KEYS) {
      if (s[key] === undefined) continue;
      const n = s[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < SHAPE_MIN || n > SHAPE_MAX) bad();
      shapes[key] = n as number;
    }
  }

  const colors: Record<string, string | string[]> = {};
  if (r.colors !== undefined) {
    if (!isPlainObject(r.colors)) bad();
    const c = r.colors as Record<string, unknown>;
    if (Object.keys(c).some((k) => !GLOBAL_COLOR_CHANNELS.includes(k) && !WARDROBE_SLOTS.some((s) => s.slot === k))) bad();
    for (const channel of GLOBAL_COLOR_CHANNELS) {
      if (c[channel] === undefined) continue;
      const hex = c[channel];
      if (typeof hex !== "string" || !HEX.test(hex)) bad();
      colors[channel] = (hex as string).toUpperCase();
    }
    for (const { slot } of WARDROBE_SLOTS) {
      if (c[slot] === undefined) continue;
      const list = c[slot];
      const id = parts[slot];
      if (!Array.isArray(list) || id === null) bad(); // no item in the slot → nothing to tint
      const cap = WARDROBE_ITEM_BY_ID.get(id as string)!.colorChannels;
      if ((list as unknown[]).length > cap || (list as unknown[]).some((h) => typeof h !== "string" || !HEX.test(h))) bad();
      if ((list as string[]).length) colors[slot] = (list as string[]).map((h) => h.toUpperCase());
    }
  }
  return { schemaVersion: WARDROBE_SCHEMA, preset, heightScale, faceLayers, parts, shapes, colors };
}

/**
 * A pilot with no saved recipe: the Default_Boy preset identity (DEFAULT_FACE_LAYERS, DEFAULT_SHAPES) and the Unity
 * starter outfit (DEFAULT_PARTS; other slots none), in canonical order. Validated at load. Never written by status.
 */
export function defaultRecipe(): Recipe {
  const faceLayers: Record<string, string | null> = {};
  for (const { layer } of FACE_LAYERS) faceLayers[layer] = DEFAULT_FACE_LAYERS[layer] ?? null;
  const parts: Record<string, string | null> = {};
  for (const { slot } of WARDROBE_SLOTS) parts[slot] = DEFAULT_PARTS[slot] ? DEFAULT_PARTS[slot].toLowerCase() : null;
  const shapes: Record<string, number> = {};
  for (const key of SHAPE_KEYS) if (DEFAULT_SHAPES[key] !== undefined) shapes[key] = DEFAULT_SHAPES[key];
  return { schemaVersion: WARDROBE_SCHEMA, preset: DEFAULT_PRESET, heightScale: HEIGHT_SCALE_DEFAULT, faceLayers, parts, shapes, colors: {} };
}

// ---- Stored state: wardrobes/{uid} (server-only) ------------------------------

/**
 * Pak ruling 2026-10-04: two saved outfits, City (casual, HoloCity) and Field (Error Beast zones; Unity swaps).
 * Body / face / shapes / global colours are pilot IDENTITY, shared by both loadouts; each loadout keeps only
 * its parts and per-slot colours. Equip takes a full recipe plus `loadout` and the server splits it.
 */
export const LOADOUTS = ["city", "field"] as const;
export type LoadoutId = (typeof LOADOUTS)[number];
/** Shared across loadouts: the starting preset, every face layer, the set shapes, the global colour channels. */
export type Identity = { preset: string | null; heightScale?: number; faceLayers: Record<string, string | null>; shapes: Record<string, number>; colors: Record<string, string> };
/** Per loadout: every slot and the per-slot colour arrays. */
export type Outfit = { parts: Record<string, string | null>; colors: Record<string, string[]> };
export type WardrobeState = {
  schemaVersion: typeof WARDROBE_SCHEMA;
  entitlements: string[];
  /** null until the first equip (either loadout). */
  identity: Identity | null;
  /** null = never saved. An unsaved field reads back as city; an unsaved city reads back as the default outfit. */
  loadouts: Record<LoadoutId, Outfit | null>;
};

export function emptyWardrobeState(): WardrobeState {
  return { schemaVersion: WARDROBE_SCHEMA, entitlements: [], identity: null, loadouts: { city: null, field: null } };
}

/** Splits a validated recipe into shared identity and the loadout's own outfit. */
export function splitRecipe(r: Recipe): { identity: Identity; outfit: Outfit } {
  const globals: Record<string, string> = {}, slotColors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(r.colors)) {
    if (typeof v === "string") globals[k] = v;
    else slotColors[k] = [...v];
  }
  return { identity: { preset: r.preset, heightScale: r.heightScale, faceLayers: { ...r.faceLayers }, shapes: { ...r.shapes }, colors: globals }, outfit: { parts: { ...r.parts }, colors: slotColors } };
}

/** Identity + outfit → a full canonical recipe (colours: global channels first, then slots, as validateRecipe orders them). */
export function composeRecipe(identity: Identity, outfit: Outfit): Recipe {
  return { schemaVersion: WARDROBE_SCHEMA, preset: identity.preset ?? null, heightScale: identity.heightScale ?? HEIGHT_SCALE_DEFAULT, faceLayers: { ...identity.faceLayers }, parts: { ...outfit.parts }, shapes: { ...identity.shapes }, colors: { ...identity.colors, ...outfit.colors } };
}

const extraKeys = (o: Record<string, unknown> | undefined, allowed: readonly string[]) => Object.keys(o ?? {}).some((k) => !allowed.includes(k));
const FACE_LAYER_NAMES = FACE_LAYERS.map((l) => l.layer);
const SLOT_NAMES = WARDROBE_SLOTS.map((s) => s.slot);

/**
 * Read-time re-validation of the stored shared identity against the CURRENT whitelists. An off-whitelist
 * face option → the layer's first option (required) or null; an unknown / out-of-range shape, a bad global
 * colour or unknown key is dropped; a preset no longer allowed → null. `changed` reports any repair.
 */
export function sanitizeIdentity(raw: Identity): { identity: Identity; changed: boolean } {
  let changed = extraKeys(raw.faceLayers, FACE_LAYER_NAMES) || extraKeys(raw.shapes, SHAPE_KEYS) || extraKeys(raw.colors, GLOBAL_COLOR_CHANNELS);
  const faceLayers: Record<string, string | null> = {};
  for (const { layer, required, options } of FACE_LAYERS) {
    const v = raw.faceLayers?.[layer];
    if (typeof v === "string" && options.includes(v)) { faceLayers[layer] = v; continue; }
    if (v !== null && v !== undefined) changed = true;
    else if (required) changed = true;
    faceLayers[layer] = required ? (DEFAULT_FACE_LAYERS[layer] ?? options[0]) : null; // required → the Default_Boy value
  }
  const shapes: Record<string, number> = {};
  for (const key of SHAPE_KEYS) {
    const n = raw.shapes?.[key];
    if (n === undefined) continue;
    if (typeof n === "number" && Number.isFinite(n) && n >= SHAPE_MIN && n <= SHAPE_MAX) shapes[key] = n;
    else changed = true;
  }
  const colors: Record<string, string> = {};
  for (const channel of GLOBAL_COLOR_CHANNELS) {
    const hex = raw.colors?.[channel];
    if (hex === undefined) continue;
    if (typeof hex === "string" && HEX.test(hex)) colors[channel] = hex.toUpperCase();
    else changed = true;
  }
  const p = raw.preset ?? null; // a pre-preset stored identity has no key: same as null, not a repair
  const preset = p !== null && typeof p === "string" && PRESET_OPTIONS.includes(p) ? p : null;
  if (preset !== p) changed = true;
  return { identity: { preset, heightScale: raw.heightScale ?? HEIGHT_SCALE_DEFAULT, faceLayers, shapes, colors }, changed }; // heightScale is type-checked on read (fail closed)
}

/**
 * Read-time re-validation of a stored outfit against the CURRENT catalog and the pilot's entitlements (the
 * server is the authority; nothing is written back — the next equip persists the clean version):
 * 1. an item that is unknown (delisted), in the wrong slot, no longer equippable, or no longer owned is removed;
 * 2. the hide / incompatibility rule is re-applied to what remains (hidden slots → null);
 * 3. a required slot left empty (and not hidden) gets its first starter item (the default outfit's choice);
 * 4. slot colours are dropped for any slot whose item changed or is empty, or that no longer fit the item's colorChannels.
 */
export function sanitizeOutfit(raw: Outfit, owned: readonly string[]): { outfit: Outfit; changed: boolean } {
  let changed = extraKeys(raw.parts, SLOT_NAMES) || extraKeys(raw.colors, SLOT_NAMES);
  const fallback = defaultRecipe().parts;
  const parts: Record<string, string | null> = {};
  for (const { slot } of WARDROBE_SLOTS) {
    const v = raw.parts?.[slot] ?? null;
    const item = typeof v === "string" ? WARDROBE_ITEM_BY_ID.get(v) : undefined;
    const ok = v === null || (!!item && item.slot === slot && item.equippable && (item.starter || owned.includes(item.itemId)));
    if (!ok) changed = true;
    parts[slot] = ok ? v : null;
  }
  const equipped = Object.values(parts).filter((id): id is string => id !== null).map((id) => WARDROBE_ITEM_BY_ID.get(id)!);
  const mustBeEmpty = new Set(equipped.flatMap((i) => [...i.hidesSlots, ...i.incompatibleSlots]));
  for (const { slot, required } of WARDROBE_SLOTS) {
    if (mustBeEmpty.has(slot)) {
      if (parts[slot] !== null) { parts[slot] = null; changed = true; }
    } else if (required && parts[slot] === null) {
      parts[slot] = fallback[slot]; changed = true; // the default starter never hides or conflicts
    }
  }
  const colors: Record<string, string[]> = {};
  for (const { slot } of WARDROBE_SLOTS) {
    const list = raw.colors?.[slot];
    if (list === undefined) continue;
    const id = parts[slot];
    const fits = id !== null && id === (raw.parts?.[slot] ?? null) && Array.isArray(list) && list.length > 0
      && list.length <= WARDROBE_ITEM_BY_ID.get(id)!.colorChannels && list.every((h) => typeof h === "string" && HEX.test(h));
    if (fits) colors[slot] = list.map((h) => h.toUpperCase());
    else changed = true;
  }
  return { outfit: { parts, colors }, changed };
}

export type LoadoutsRead = { loadouts: Record<LoadoutId, Recipe>; sanitized: Record<LoadoutId, boolean> };

/**
 * What each loadout reads as (a read: nothing is written): city = saved or default outfit; field = saved, else a
 * copy of city. Both are re-validated against the current catalog + entitlements, so every returned loadout is a
 * valid equip recipe for this pilot; `sanitized` says which ones were repaired (a mirrored field copies city's flag).
 */
export function readLoadouts(state: WardrobeState): LoadoutsRead {
  const d = splitRecipe(defaultRecipe());
  const id = sanitizeIdentity(state.identity ?? d.identity);
  const one = (outfit: Outfit): { recipe: Recipe; changed: boolean } => {
    const o = sanitizeOutfit(outfit, state.entitlements);
    const recipe = composeRecipe(id.identity, o.outfit);
    try { validateRecipe(recipe); } catch {
      return { recipe: composeRecipe(id.identity, d.outfit), changed: true }; // last-resort safety net: the default outfit
    }
    return { recipe, changed: o.changed || id.changed };
  };
  const city = one(state.loadouts.city ?? d.outfit);
  const field = state.loadouts.field ? one(state.loadouts.field) : { recipe: structuredClone(city.recipe), changed: city.changed };
  return { loadouts: { city: city.recipe, field: field.recipe }, sanitized: { city: city.changed, field: field.changed } };
}

/** The two loadout recipes alone (see readLoadouts). */
export function loadoutRecipes(state: WardrobeState): Record<LoadoutId, Recipe> {
  return readLoadouts(state).loadouts;
}



/**
 * undefined (no doc) → nothing owned, nothing saved: the only "fresh" case. A present doc must be
 * well-formed or this throws `unavailable`: a malformed / wrong-schema doc is never read as empty, so
 * it can never be overwritten by the next purchase (the PR #54 "missing = fresh" trap). Well-formed
 * entitlement ids the catalog no longer lists are KEPT (a regenerated catalog never erases ownership);
 * they just can't be equipped until the catalog lists them again.
 */
export function readWardrobeState(raw: unknown): WardrobeState {
  if (raw === undefined) return emptyWardrobeState();
  if (!isPlainObject(raw) || raw.schemaVersion !== WARDROBE_SCHEMA) throw new WardrobeError("unavailable");
  const e = raw.entitlements;
  if (!Array.isArray(e) || e.some((id) => typeof id !== "string" || !id) || new Set(e).size !== e.length) throw new WardrobeError("unavailable");
  const identity = raw.identity;
  // Nested TYPE checks (review 2026-10-04): a malformed value fails closed. A well-typed value that is merely no
  // longer valid (delisted item, retired face option, unknown face/shape key) is NOT a defect here; readLoadouts sanitises it.
  const isHex = (v: unknown) => typeof v === "string" && HEX.test(v);
  const isWeight = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= SHAPE_MIN && v <= SHAPE_MAX;
  const values = (o: Record<string, unknown>) => Object.values(o);
  const okIdentity = identity === null || (isPlainObject(identity)
    && isPlainObject(identity.faceLayers) && values(identity.faceLayers).every((v) => v === null || typeof v === "string")
    && isPlainObject(identity.shapes) && values(identity.shapes).every(isWeight)
    && isPlainObject(identity.colors) && values(identity.colors).every(isHex)
    && (identity.preset === undefined || identity.preset === null || typeof identity.preset === "string")
    && (identity.heightScale === undefined || isHeightScale(identity.heightScale)));
  const lo = raw.loadouts;
  const okOutfit = (o: unknown) => o === null || (isPlainObject(o)
    && isPlainObject(o.parts) && Object.entries(o.parts).every(([k, v]) => SLOT_NAMES.includes(k) && (v === null || typeof v === "string"))
    && isPlainObject(o.colors) && Object.entries(o.colors).every(([k, v]) => SLOT_NAMES.includes(k) && Array.isArray(v) && v.every(isHex)));
  const okLoadouts = isPlainObject(lo) && Object.keys(lo).length === LOADOUTS.length && LOADOUTS.every((k) => k in lo && okOutfit(lo[k]));
  if (!okIdentity || !okLoadouts) throw new WardrobeError("unavailable");
  const loadouts = lo as Record<LoadoutId, Outfit | null>;
  // A saved outfit implies a saved identity (equip always writes both).
  if (identity === null && LOADOUTS.some((k) => loadouts[k] !== null)) throw new WardrobeError("unavailable");
  return { schemaVersion: WARDROBE_SCHEMA, entitlements: [...(e as string[])], identity: identity as Identity | null, loadouts: { city: loadouts.city, field: loadouts.field } };
}

/** Holos: missing = 0; any finite number >= 0 (the rules' sane() allows non-integers); anything else fails closed. */
export function readHolos(profile: Record<string, unknown>): number {
  const v = profile.holosTokens;
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new WardrobeError("unavailable");
  return v;
}

// ---- Commands ---------------------------------------------------------------

export type WardrobeCommand =
  | { operation: "status" }
  | { operation: "purchase"; requestId: string; itemId: string }
  | { operation: "equip"; requestId: string; loadout: LoadoutId; recipe: Recipe };

/** Every request carries schemaVersion "wardrobe-3". */
export function validateWardrobeCommand(raw: unknown): WardrobeCommand {
  if (!isPlainObject(raw) || raw.schemaVersion !== WARDROBE_SCHEMA) bad();
  const c = raw as Record<string, unknown>;
  if (c.operation === "status") return { operation: "status" };
  if (c.operation !== "purchase" && c.operation !== "equip") bad();
  if (typeof c.requestId !== "string" || !REQUEST_ID.test(c.requestId)) bad();
  if (c.operation === "purchase") {
    const item = typeof c.itemId === "string" ? WARDROBE_ITEM_BY_ID.get(c.itemId) : undefined;
    if (!item || !item.sellable) bad(); // starter items are free; non-sellable overrides are never sold
    return { operation: "purchase", requestId: c.requestId as string, itemId: item!.itemId };
  }
  if (typeof c.loadout !== "string" || !(LOADOUTS as readonly string[]).includes(c.loadout)) bad(); // required: "city" | "field"
  return { operation: "equip", requestId: c.requestId as string, loadout: c.loadout as LoadoutId, recipe: validateRecipe(c.recipe) };
}

/** Receipt fingerprint: sha256 over the canonical command (recipes are canonicalised by validateRecipe). */
export function commandFingerprint(cmd: Exclude<WardrobeCommand, { operation: "status" }>): string {
  const canonical = cmd.operation === "purchase" ? ["purchase", cmd.itemId] : ["equip", cmd.loadout, cmd.recipe];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---- Replies ----------------------------------------------------------------

export type WardrobeView = {
  entitlements: string[];
  /** Both loadouts as full renderable recipes (shared identity + that loadout's outfit). */
  loadouts: Record<LoadoutId, Recipe>;
  /** false: never saved (city reads as the default outfit; field reads as a copy of city). */
  saved: Record<LoadoutId, boolean>;
  /** true: the stored loadout was repaired on read (delisted / non-equippable / unowned item, hide rule, colour fit). Not written back. */
  sanitized: Record<LoadoutId, boolean>;
  holosTokens: number;
};
function view(state: WardrobeState, holos: number): WardrobeView {
  const read = readLoadouts(state);
  return { entitlements: [...state.entitlements], loadouts: read.loadouts, saved: { city: state.loadouts.city !== null, field: state.loadouts.field !== null }, sanitized: read.sanitized, holosTokens: holos };
}

export type ItemView = WardrobeItem & { owned: boolean; usable: boolean };
export function wardrobeCatalogView(owned: readonly string[]) {
  return {
    placeholder: WARDROBE_CATALOG_IS_PLACEHOLDER,
    source: WARDROBE_CATALOG_SOURCE,
    slots: WARDROBE_SLOTS.map(({ slot, type, required }) => ({ slot, type, required })),
    faceLayers: FACE_LAYERS.map((l) => ({ layer: l.layer, required: l.required, options: [...l.options] })),
    presets: { options: [...PRESET_OPTIONS], reserved: [...RESERVED_PRESETS], optional: true, default: DEFAULT_PRESET },
    heightScale: { min: HEIGHT_SCALE_MIN, max: HEIGHT_SCALE_MAX, default: HEIGHT_SCALE_DEFAULT },
    shapes: {
      blendshapePrefix: SHAPE_BLENDSHAPE_PREFIX, min: SHAPE_MIN, max: SHAPE_MAX, default: SHAPE_DEFAULT,
      body: [...BODY_SHAPE_KEYS], face: [...FACE_SHAPE_KEYS],
      faceByHead: Object.fromEntries(Object.entries(FACE_SHAPES_BY_HEAD).map(([h, keys]) => [h, [...keys]])),
    },
    colors: { globalChannels: [...GLOBAL_COLOR_CHANNELS], defaults: { ...GLOBAL_COLOR_DEFAULTS }, format: "#RRGGBB", perSlot: "array of #RRGGBB, length <= the equipped item's colorChannels" },
    maxRecipeBytes: MAX_RECIPE_BYTES,
    items: WARDROBE_ITEMS.map((i): ItemView => ({ ...i, hidesSlots: [...i.hidesSlots], incompatibleSlots: [...i.incompatibleSlots], owned: owned.includes(i.itemId), usable: i.equippable && (i.starter || owned.includes(i.itemId)) })),
  };
}

export function wardrobeStatus(profile: Record<string, unknown>, state: WardrobeState) {
  return { schemaVersion: WARDROBE_SCHEMA, ...view(state, readHolos(profile)), catalog: wardrobeCatalogView(state.entitlements) };
}

export type MutationReply = WardrobeView & {
  schemaVersion: typeof WARDROBE_SCHEMA;
  operation: "purchase" | "equip";
  requestId: string;
  alreadyProcessed: boolean;
  /** purchase only: what was bought and charged. null for equip. */
  purchased: { itemId: string; price: number } | null;
};

/**
 * Purchase: an owned item is already_owned (no charge, nothing written); not enough Holos is
 * not_enough_holos (nothing written). Otherwise spend the catalog price and add the entitlement
 * (the store writes both, plus the receipt, in one transaction).
 */
export function applyPurchase(profile: Record<string, unknown>, state: WardrobeState, cmd: Extract<WardrobeCommand, { operation: "purchase" }>) {
  const item = WARDROBE_ITEM_BY_ID.get(cmd.itemId)!;
  const holos = readHolos(profile);
  if (state.entitlements.includes(item.itemId)) throw new WardrobeError("already_owned");
  if (holos < item.price) throw new WardrobeError("not_enough_holos");
  const next: WardrobeState = { ...state, entitlements: [...state.entitlements, item.itemId].sort() };
  const holosAfter = holos - item.price;
  const reply: MutationReply = { schemaVersion: WARDROBE_SCHEMA, operation: "purchase", requestId: cmd.requestId, alreadyProcessed: false, purchased: { itemId: item.itemId, price: item.price }, ...view(next, holosAfter) };
  return { state: next, holosAfter, reply };
}

/**
 * Equip one loadout: every non-null part must be a starter item or owned (slot fit, hide rule and colour caps were
 * checked by validateRecipe). Saves that loadout's outfit and the shared identity. Never charges.
 */
export function applyEquip(profile: Record<string, unknown>, state: WardrobeState, cmd: Extract<WardrobeCommand, { operation: "equip" }>) {
  for (const id of Object.values(cmd.recipe.parts)) {
    if (id === null) continue;
    const item = WARDROBE_ITEM_BY_ID.get(id)!;
    if (!item.starter && !state.entitlements.includes(id)) throw new WardrobeError("not_owned");
  }
  const { identity, outfit } = splitRecipe(cmd.recipe);
  const next: WardrobeState = { ...state, identity, loadouts: { ...state.loadouts, [cmd.loadout]: outfit } };
  const reply: MutationReply = { schemaVersion: WARDROBE_SCHEMA, operation: "equip", requestId: cmd.requestId, alreadyProcessed: false, purchased: null, ...view(next, readHolos(profile)) };
  return { state: next, reply };
}
