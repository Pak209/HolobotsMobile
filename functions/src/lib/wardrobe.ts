/**
 * Pak DECISIONS #48 (2026-10-03): pilot wardrobe rules, wardrobe-3. The server owns prices,
 * entitlements and the saved appearance recipe; Unity sends a recipe, the server validates and
 * stores it, Unity renders what the server returns. All data lives in lib/wardrobeCatalog.ts.
 *
 * Pure module: no firebase imports (node:crypto only), safe to import from tests.
 */
import { createHash } from "node:crypto";
import {
  FACE_LAYERS, GLOBAL_COLOR_CHANNELS, GLOBAL_COLOR_DEFAULTS, MAX_RECIPE_BYTES, BODY_SHAPE_KEYS, FACE_SHAPE_KEYS, FACE_SHAPES_BY_HEAD, SHAPE_BLENDSHAPE_PREFIX, SHAPE_DEFAULT, SHAPE_KEYS, SHAPE_MAX, SHAPE_MIN,
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
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// ---- Recipe -----------------------------------------------------------------

export type Recipe = {
  schemaVersion: typeof WARDROBE_SCHEMA;
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
const RECIPE_KEYS = new Set(["schemaVersion", "faceLayers", "parts", "shapes", "colors"]);

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
  return { schemaVersion: WARDROBE_SCHEMA, faceLayers, parts, shapes, colors };
}

/**
 * A pilot with no saved recipe: first option per required face layer (optional layers none), first
 * starter item (manifest order) per required slot not hidden by another, optional slots none. Never written by status.
 */
export function defaultRecipe(): Recipe {
  const faceLayers: Record<string, string | null> = {};
  for (const { layer, required, options } of FACE_LAYERS) faceLayers[layer] = required ? options[0] : null;
  const parts: Record<string, string | null> = {};
  for (const { slot, required } of WARDROBE_SLOTS) {
    parts[slot] = required ? WARDROBE_ITEMS.find((i) => i.starter && i.equippable && i.slot === slot && i.hidesSlots.length === 0)!.itemId : null;
  }
  return { schemaVersion: WARDROBE_SCHEMA, faceLayers, parts, shapes: {}, colors: {} };
}

// ---- Stored state: wardrobes/{uid} (server-only) ------------------------------

/**
 * Pak ruling 2026-10-04: two saved outfits, City (casual, HoloCity) and Field (Error Beast zones; Unity swaps).
 * Body / face / shapes / global colours are pilot IDENTITY, shared by both loadouts; each loadout keeps only
 * its parts and per-slot colours. Equip takes a full recipe plus `loadout` and the server splits it.
 */
export const LOADOUTS = ["city", "field"] as const;
export type LoadoutId = (typeof LOADOUTS)[number];
/** Shared across loadouts: every face layer, the set shapes, the global colour channels. */
export type Identity = { faceLayers: Record<string, string | null>; shapes: Record<string, number>; colors: Record<string, string> };
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
  return { identity: { faceLayers: { ...r.faceLayers }, shapes: { ...r.shapes }, colors: globals }, outfit: { parts: { ...r.parts }, colors: slotColors } };
}

/** Identity + outfit → a full canonical recipe (colours: global channels first, then slots, as validateRecipe orders them). */
export function composeRecipe(identity: Identity, outfit: Outfit): Recipe {
  return { schemaVersion: WARDROBE_SCHEMA, faceLayers: { ...identity.faceLayers }, parts: { ...outfit.parts }, shapes: { ...identity.shapes }, colors: { ...identity.colors, ...outfit.colors } };
}

/** What each loadout reads as: city = saved or default outfit; field = saved, else a copy of city (a read; nothing is written). */
export function loadoutRecipes(state: WardrobeState): Record<LoadoutId, Recipe> {
  const d = splitRecipe(defaultRecipe());
  const identity = state.identity ?? d.identity;
  const city = composeRecipe(identity, state.loadouts.city ?? d.outfit);
  const field = state.loadouts.field ? composeRecipe(identity, state.loadouts.field) : structuredClone(city);
  return { city, field };
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
  const okIdentity = identity === null || (isPlainObject(identity) && isPlainObject(identity.faceLayers) && isPlainObject(identity.shapes) && isPlainObject(identity.colors));
  const lo = raw.loadouts;
  const okOutfit = (o: unknown) => o === null || (isPlainObject(o) && isPlainObject(o.parts) && isPlainObject(o.colors));
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
  holosTokens: number;
};
function view(state: WardrobeState, holos: number): WardrobeView {
  return { entitlements: [...state.entitlements], loadouts: loadoutRecipes(state), saved: { city: state.loadouts.city !== null, field: state.loadouts.field !== null }, holosTokens: holos };
}

export type ItemView = WardrobeItem & { owned: boolean; usable: boolean };
export function wardrobeCatalogView(owned: readonly string[]) {
  return {
    placeholder: WARDROBE_CATALOG_IS_PLACEHOLDER,
    source: WARDROBE_CATALOG_SOURCE,
    slots: WARDROBE_SLOTS.map(({ slot, type, required }) => ({ slot, type, required })),
    faceLayers: FACE_LAYERS.map((l) => ({ layer: l.layer, required: l.required, options: [...l.options] })),
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
