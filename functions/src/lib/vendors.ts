/**
 * Pak DECISIONS #47 (2026-10-03): vendor catalogs. Every listing and price is built from the
 * EXISTING economy module (lib/economy.ts) plus the Buddy Unit price table (lib/buddyUnits.ts),
 * so Unity never hard-codes a price. Each listing names the exact callable + request that buys it.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import {
  BOOSTER_ITEM_AWARD_MAP,
  getMarketplacePrice,
  MARKETPLACE_BOOSTER_PRICES,
  MARKETPLACE_ITEM_NAMES,
  MARKETPLACE_PART_CATALOG,
  WILDCARD_PACK_AMOUNT,
  WILDCARD_PACK_COOLDOWN_MS,
  type MarketplaceBoosterId,
} from "./economy";
import { BUDDY_UNIT_PRICES_HOLOS, BUDDY_UNIT_TIERS, BUDDY_UNITS_FIELD, BuddyInventory, BuddyTierId, readBuddyInventory, tierById, withTierDelta } from "./buddyUnits";
import { WARDROBE_ITEMS } from "./wardrobeCatalog";
import { WARDROBE_SCHEMA } from "./wardrobe";

/** vendor-3 (DECISIONS #48): adds the `boutique` vendor and `clothing` listings (details.hidesSlots is a string[]). */
export const VENDOR_SCHEMA = "vendor-3";
export const VENDOR_IDS = ["marketplace", "workshop", "boutique"] as const;
export type VendorId = (typeof VENDOR_IDS)[number];

export type ListingKind = "item" | "booster" | "buddy_unit" | "part" | "clothing";
export type PurchaseCall = { callable: string; request: Record<string, unknown> };
export type Listing = {
  listingId: string;
  kind: ListingKind;
  displayName: string;
  price: number;
  currency: "holos";
  /** Units one purchase grants (Wildcard Blueprints: 5). */
  quantity: number;
  /** How many the player holds now (parts: copies of that part). */
  owned: number;
  affordable: boolean;
  /** false only for the weekly Wildcard pack inside its cooldown. */
  available: boolean;
  /** Epoch ms when an unavailable listing reopens; 0 when available. */
  availableAtMs: number;
  /** Extra per-kind facts (part rarity/slot, booster bonus item, buddy tier id, clothing itemId/bozoPart/slot/rarity/colorChannels/hidesSlots). */
  details: Record<string, string | string[]>;
  /** Exactly what Unity sends to buy it. `requestId` placeholders are client-generated per purchase attempt. */
  purchase: PurchaseCall;
};
export type Inventory = {
  arenaPasses: number;
  gachaTickets: number;
  energyRefills: number;
  expBoosters: number;
  rankSkips: number;
  wildcardBlueprints: number;
  parts: number;
  buddyUnits: BuddyInventory;
};
export type CatalogReply = { schemaVersion: string; vendorId: VendorId; holosTokens: number; inventory: Inventory; listings: Listing[] };

export class VendorError extends Error {
  constructor(public code: "invalid_request" | "unavailable" | "not_enough_holos" | "sequence_conflict") {
    super(code);
  }
}

export function validateCatalogCommand(raw: unknown): { operation: "catalog"; vendorId: VendorId } {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!c || c.operation !== "catalog" || !VENDOR_IDS.includes(c.vendorId as VendorId)) throw new VendorError("invalid_request");
  return { operation: "catalog", vendorId: c.vendorId as VendorId };
}

/** The same lenient read the purchase builders use (Number(x || 0)); a non-finite value reads as 0 for display. */
const num = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

/** Profile field each single item increments (see buildItemPurchaseUpdatesRaw). */
export const ITEM_INVENTORY_FIELD: Record<string, string> = {
  "Arena Pass": "arenaPassses",
  "Gacha Ticket": "gachaTickets",
  "Energy Refill": "energyRefills",
  "EXP Booster": "expBoosters",
  "Rank Skip": "rankSkips",
  "Wildcard Blueprints": "wildcardBlueprints",
};

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

/**
 * A pure read: a missing / #43-integer buddyUnits is reported as the inventory the next server write
 * will persist (starter Light / migrated), without writing. Malformed → unavailable.
 */
/** `wardrobeEntitlements`: owned clothing ids (wardrobes/{uid}.entitlements), only read for the boutique. */
export function buildCatalog(profile: Record<string, unknown>, vendorId: VendorId, nowMs: number, wardrobeEntitlements: readonly string[] = []): CatalogReply {
  const inv = readBuddyInventory(profile);
  if (!inv) throw new VendorError("unavailable");
  const holos = num(profile.holosTokens);
  const parts = Array.isArray(profile.parts) ? (profile.parts as Array<Record<string, unknown>>) : [];
  const inventory: Inventory = {
    arenaPasses: num(profile.arenaPassses),
    gachaTickets: num(profile.gachaTickets),
    energyRefills: num(profile.energyRefills),
    expBoosters: num(profile.expBoosters),
    rankSkips: num(profile.rankSkips),
    wildcardBlueprints: num(profile.wildcardBlueprints),
    parts: parts.length,
    buddyUnits: inv.units,
  };
  const listing = (l: Omit<Listing, "currency" | "affordable" | "available" | "availableAtMs" | "quantity"> & Partial<Pick<Listing, "available" | "availableAtMs" | "quantity">>): Listing => ({
    currency: "holos", quantity: 1, available: true, availableAtMs: 0, ...l, affordable: holos >= l.price,
  });
  const listings: Listing[] = [];
  if (vendorId === "marketplace") {
    for (const itemName of MARKETPLACE_ITEM_NAMES) {
      const wildcard = itemName === "Wildcard Blueprints";
      const reopensAt = wildcard ? num(profile.lastWildcardPackAt) + WILDCARD_PACK_COOLDOWN_MS : 0;
      const open = !wildcard || nowMs >= reopensAt;
      listings.push(listing({
        listingId: `item.${slug(itemName)}`, kind: "item", displayName: itemName, price: getMarketplacePrice(itemName),
        quantity: wildcard ? WILDCARD_PACK_AMOUNT : 1, owned: num(profile[ITEM_INVENTORY_FIELD[itemName]]),
        available: open, availableAtMs: open ? 0 : reopensAt, details: {},
        purchase: { callable: "purchaseMarketplaceItem", request: { itemName } },
      }));
    }
    for (const packId of Object.keys(MARKETPLACE_BOOSTER_PRICES) as MarketplaceBoosterId[]) {
      listings.push(listing({
        listingId: `booster.${packId}`, kind: "booster", displayName: `${packId[0].toUpperCase()}${packId.slice(1)} Booster`,
        price: MARKETPLACE_BOOSTER_PRICES[packId], owned: 0, details: { packId, bonusItem: BOOSTER_ITEM_AWARD_MAP[packId] },
        purchase: { callable: "purchaseMarketplaceBooster", request: { packId } },
      }));
    }
    for (const tier of BUDDY_UNIT_TIERS) {
      const price = BUDDY_UNIT_PRICES_HOLOS[tier.key];
      if (price === undefined) continue;
      listings.push(listing({
        listingId: `buddy.${tier.key}`, kind: "buddy_unit", displayName: tier.displayName, price, owned: inv.units[tier.key],
        details: { tierId: tier.id, modelKey: tier.modelKey },
        purchase: { callable: "purchaseBuddyUnit", request: { tierId: tier.id, requestId: "<client-generated>" } },
      }));
    }
  } else if (vendorId === "boutique") {
    // DECISIONS #48 clothing: sellable wardrobe items only (starter items are free; non-sellable overrides never listed).
    for (const item of WARDROBE_ITEMS) {
      if (!item.sellable || item.vendorId !== "boutique") continue;
      const owned = wardrobeEntitlements.includes(item.itemId);
      listings.push(listing({
        listingId: `clothing.${item.itemId}`, kind: "clothing", displayName: item.displayName, price: item.price,
        owned: owned ? 1 : 0, available: !owned,
        details: { itemId: item.itemId, bozoPart: item.bozoPart, slot: item.slot, rarity: item.rarity, colorChannels: String(item.colorChannels), hidesSlots: [...item.hidesSlots] },
        purchase: { callable: "wardrobeHost", request: { schemaVersion: WARDROBE_SCHEMA, operation: "purchase", itemId: item.itemId, requestId: "<client-generated>" } },
      }));
    }
  } else {
    for (const offer of MARKETPLACE_PART_CATALOG) {
      listings.push(listing({
        listingId: offer.id, kind: "part", displayName: offer.name, price: offer.price,
        owned: parts.filter((p) => p && p.name === offer.name).length, details: { rarity: offer.rarity, slot: offer.slot },
        purchase: { callable: "purchaseMarketplacePart", request: { partId: offer.id } },
      }));
    }
  }
  return { schemaVersion: VENDOR_SCHEMA, vendorId, holosTokens: holos, inventory, listings };
}

// ---- Medium / Heavy Buddy Unit purchase (purchaseBuddyUnit) ----

export const PURCHASE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export type BuddyPurchaseCommand = { tierId: BuddyTierId; requestId: string };
export type BuddyPurchaseReply = { schemaVersion: string; requestId: string; tierId: BuddyTierId; price: number; holosTokens: number; buddyUnits: BuddyInventory; alreadyProcessed: boolean };

export function validateBuddyPurchase(raw: unknown): BuddyPurchaseCommand {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const tier = c ? tierById(c.tierId) : undefined;
  if (!c || !tier || BUDDY_UNIT_PRICES_HOLOS[tier.key] === undefined) throw new VendorError("invalid_request");
  if (typeof c.requestId !== "string" || !PURCHASE_REQUEST_ID.test(c.requestId)) throw new VendorError("invalid_request");
  return { tierId: tier.id, requestId: c.requestId };
}

/** Spend the tier's price and add one Unit of that tier in the same update. Not enough Holos → not_enough_holos (nothing written). */
export function buildBuddyUnitPurchase(profile: Record<string, unknown>, cmd: BuddyPurchaseCommand): { updates: Record<string, unknown>; reply: BuddyPurchaseReply } {
  const tier = tierById(cmd.tierId)!;
  const price = BUDDY_UNIT_PRICES_HOLOS[tier.key]!;
  const inv = readBuddyInventory(profile);
  const holos = Number(profile.holosTokens || 0);
  if (!inv || !Number.isFinite(holos)) throw new VendorError("unavailable");
  if (holos < price) throw new VendorError("not_enough_holos");
  const units = withTierDelta(inv.units, tier.key, 1);
  const holosAfter = holos - price;
  return {
    updates: { holosTokens: holosAfter, [BUDDY_UNITS_FIELD]: { ...units } },
    reply: { schemaVersion: VENDOR_SCHEMA, requestId: cmd.requestId, tierId: tier.id, price, holosTokens: holosAfter, buddyUnits: units, alreadyProcessed: false },
  };
}
