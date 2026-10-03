/**
 * Pak DECISIONS #48 (2026-10-03): pilot wardrobe catalog. THE ONE DATA MODULE for slots, free
 * creator choices (bodies, faces), slider / colour whitelists and clothing items.
 *
 * ⚠ PLACEHOLDER IDS. Every id starting with "ph." is a placeholder until Pak downloads the
 * "BoZo Anime Pack" and runs the part audit. Regenerating this file from the audit is a data-only
 * change: replace the arrays below (keep the field names), keep `vendorId` / `rarity` / `starter`
 * decisions, and leave lib/wardrobe.ts untouched. Ids are opaque strings to the server; Unity maps
 * them to prefabs / blendshapes. See Documentation/QA/2026-10-03-pilot-wardrobe/CONTRACT.md.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { MARKETPLACE_PART_PRICES, type MarketplacePartRarity } from "./economy";

/** True until the BoZo pack audit replaces the "ph." ids. Reported to Unity in `status`. */
export const WARDROBE_CATALOG_IS_PLACEHOLDER = true;
export const WARDROBE_CATALOG_SOURCE = "placeholder-2026-10-03 (awaiting BoZo Anime Pack audit)";

// ---- Slots (PROVISIONAL until the pack audit) -------------------------------

export type SlotRow = { slot: string; required: boolean };
/** Required slots must always hold an item; optional slots may be null ("none"). Order = display order. */
export const WARDROBE_SLOTS: readonly SlotRow[] = [
  { slot: "hair", required: true },
  { slot: "top", required: true },
  { slot: "bottom", required: true },
  { slot: "footwear", required: true },
  { slot: "gloves", required: false },
  { slot: "hat", required: false },
  { slot: "faceAccessory", required: false },
  { slot: "backAccessory", required: false },
];

// ---- Free creator choices (not slots, never sold) ----------------------------

export const BASE_BODIES: readonly string[] = ["ph.body.a", "ph.body.b", "ph.body.c"];
export const FACES: readonly string[] = ["ph.face.01", "ph.face.02", "ph.face.03", "ph.face.04"];

// ---- Body / face sliders and colour channels --------------------------------

export const SLIDER_KEYS: readonly string[] = [
  "height", "build", "headSize", "shoulderWidth", "legLength",
  "eyeSize", "eyeSpacing", "noseSize", "mouthWidth", "jaw", "cheek", "ear",
];
/** Inclusive range; values outside it are REJECTED (invalid_request), never clamped. Missing key = SLIDER_DEFAULT. */
export const SLIDER_MIN = -1;
export const SLIDER_MAX = 1;
export const SLIDER_DEFAULT = 0;

/** Missing channel = its default here. Values are strict #RRGGBB (stored upper-case). */
export const COLOR_DEFAULTS: Readonly<Record<string, string>> = {
  skin: "#E8B996",
  hair: "#2B2B2B",
  eyes: "#3A6EA5",
  primary: "#1F8FFF",
  secondary: "#20232A",
  accent: "#FFC83D",
};
export const COLOR_CHANNELS: readonly string[] = Object.keys(COLOR_DEFAULTS);

/** Encoded (JSON, UTF-8) size cap for one recipe. Larger → invalid_request. */
export const MAX_RECIPE_BYTES = 4096;

// ---- Items ------------------------------------------------------------------

export type WardrobeVendorId = "boutique";
export type WardrobeItem = {
  itemId: string;
  slot: string;
  displayName: string;
  rarity: "starter" | MarketplacePartRarity;
  /** Holos; 0 for starter items. Sold items are priced by MARKETPLACE_PART_PRICES[rarity] (economy module). */
  price: number;
  /** Starter items are free and always usable; they are never sold or stored as entitlements. */
  starter: boolean;
  /** Where sold items are listed ("" for starter items). DECISIONS #48: the new `boutique` vendor. */
  vendorId: WardrobeVendorId | "";
  /** Colour channels this item reads when rendered (from COLOR_CHANNELS). */
  tintable: string[];
};

const starter = (itemId: string, slot: string, displayName: string, tintable: string[] = []): WardrobeItem =>
  ({ itemId, slot, displayName, rarity: "starter", price: 0, starter: true, vendorId: "", tintable });
const sold = (itemId: string, slot: string, displayName: string, rarity: MarketplacePartRarity, tintable: string[] = []): WardrobeItem =>
  ({ itemId, slot, displayName, rarity, price: MARKETPLACE_PART_PRICES[rarity], starter: false, vendorId: "boutique", tintable });

export const WARDROBE_ITEMS: readonly WardrobeItem[] = [
  // Starter: 2 per required slot, 1 per optional slot. Free, always usable, never stored.
  starter("ph.hair.short_01", "hair", "Short Crop", ["hair"]),
  starter("ph.hair.long_01", "hair", "Long Sweep", ["hair"]),
  starter("ph.top.tee_01", "top", "Pilot Tee", ["primary"]),
  starter("ph.top.jacket_01", "top", "Flight Jacket", ["primary", "secondary"]),
  starter("ph.bottom.pants_01", "bottom", "Cargo Pants", ["secondary"]),
  starter("ph.bottom.shorts_01", "bottom", "Track Shorts", ["secondary"]),
  starter("ph.footwear.sneakers_01", "footwear", "Runner Sneakers", ["accent"]),
  starter("ph.footwear.boots_01", "footwear", "Field Boots"),
  starter("ph.gloves.fingerless_01", "gloves", "Fingerless Gloves", ["secondary"]),
  starter("ph.hat.cap_01", "hat", "Pilot Cap", ["primary"]),
  starter("ph.faceAccessory.visor_01", "faceAccessory", "Clear Visor", ["accent"]),
  starter("ph.backAccessory.pack_01", "backAccessory", "Mini Pack", ["secondary"]),
  // Sold at the boutique (12): price = MARKETPLACE_PART_PRICES[rarity].
  sold("ph.hair.mohawk_01", "hair", "Neon Mohawk", "rare", ["hair"]),
  sold("ph.hair.twintails_01", "hair", "Twin Tails", "common", ["hair"]),
  sold("ph.top.hoodie_01", "top", "Circuit Hoodie", "common", ["primary", "accent"]),
  sold("ph.top.armor_01", "top", "Harbor Armor Vest", "epic", ["primary", "secondary", "accent"]),
  sold("ph.bottom.joggers_01", "bottom", "Glow Joggers", "common", ["secondary", "accent"]),
  sold("ph.bottom.armor_01", "bottom", "Plated Greaves", "rare", ["secondary"]),
  sold("ph.footwear.hightops_01", "footwear", "Hover High-Tops", "rare", ["accent"]),
  sold("ph.gloves.gauntlets_01", "gloves", "Arc Gauntlets", "rare", ["accent"]),
  sold("ph.hat.helmet_01", "hat", "Rival Helmet", "epic", ["primary", "accent"]),
  sold("ph.faceAccessory.mask_01", "faceAccessory", "Neon Forest Mask", "common", ["accent"]),
  sold("ph.backAccessory.wings_01", "backAccessory", "Holo Wings", "epic", ["accent"]),
  sold("ph.backAccessory.cape_01", "backAccessory", "Courier Cape", "common", ["primary"]),
];

export const WARDROBE_ITEM_BY_ID: ReadonlyMap<string, WardrobeItem> = new Map(WARDROBE_ITEMS.map((i) => [i.itemId, i]));
