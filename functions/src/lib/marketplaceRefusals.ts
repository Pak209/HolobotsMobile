/**
 * Producer decision (PR #56 review, 2026-10-04): the three legacy marketplace purchase callables
 * add `details.rejectionCode` to every refusal. Additive only: HTTPS status and English message
 * stay byte-identical, so the mobile app (which matches on message text) is unaffected.
 */
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";

export type MarketplaceRejectionCode =
  | "not_enough_holos"
  | "unknown_item"
  | "on_cooldown"
  | "unavailable"
  | "invalid_request"
  // market-quantity-host-1 (marketplace-item-purchase-1): only a purchaseMarketplaceItem request carrying `quantity`.
  | "not_stackable"
  | "over_cap"
  | "sequence_conflict";

export type MarketplaceRefusal = { rejectionCode: MarketplaceRejectionCode; httpsCode: FunctionsErrorCode; message: string };

export const WILDCARD_PACK_ITEM_NAME = "Wildcard Blueprints";

export const REFUSALS = {
  notEnoughHolos: { rejectionCode: "not_enough_holos", httpsCode: "failed-precondition", message: "Not enough Holos." },
  profileMissing: { rejectionCode: "unavailable", httpsCode: "not-found", message: "User profile not found." },
  itemNameRequired: { rejectionCode: "invalid_request", httpsCode: "invalid-argument", message: "An item name is required." },
  unknownItem: { rejectionCode: "unknown_item", httpsCode: "invalid-argument", message: "Unknown marketplace item." },
  // Existing quirk kept: the cooldown refusal still reads "Unknown marketplace item."; only the code tells them apart.
  wildcardCooldown: { rejectionCode: "on_cooldown", httpsCode: "invalid-argument", message: "Unknown marketplace item." },
  unknownBooster: { rejectionCode: "unknown_item", httpsCode: "invalid-argument", message: "Unknown booster pack." },
  partIdRequired: { rejectionCode: "invalid_request", httpsCode: "invalid-argument", message: "A part id is required." },
  unknownPart: { rejectionCode: "unknown_item", httpsCode: "invalid-argument", message: "Unknown marketplace part." },
} as const satisfies Record<string, MarketplaceRefusal>;

/**
 * market-quantity-host-1 (marketplace-item-purchase-1, HolobotsUnity DECISIONS #72.26 P3): refusals only a
 * purchaseMarketplaceItem request carrying `quantity` can get (it also reuses REFUSALS itemNameRequired,
 * profileMissing, unknownItem, wildcardCooldown and notEnoughHolos). Kept apart so the legacy table above stays as pinned.
 */
export const QUANTITY_REFUSALS = {
  quantityRequestInvalid: { rejectionCode: "invalid_request", httpsCode: "invalid-argument", message: "A quantity purchase sends only itemName, a whole-number quantity from 1 to 99 and a request id." },
  notStackable: { rejectionCode: "not_stackable", httpsCode: "invalid-argument", message: "This item is bought one at a time." },
  overCap: { rejectionCode: "over_cap", httpsCode: "failed-precondition", message: "That would go over the most you can hold of this item." },
  sequenceConflict: { rejectionCode: "sequence_conflict", httpsCode: "failed-precondition", message: "That request id was already used for a different purchase." },
  accountUnavailable: { rejectionCode: "unavailable", httpsCode: "failed-precondition", message: "Account data is unavailable." },
} as const satisfies Record<string, MarketplaceRefusal>;

/**
 * Why `buildItemPurchaseUpdatesRaw` returned null, in the callable's existing order: short of Holos
 * first, then the Wildcard pack (only reachable null for a known item is its 7-day cooldown), else unknown.
 */
export function classifyItemRefusal(holos: number, price: number, itemName: string): MarketplaceRefusal {
  if (holos < price) return REFUSALS.notEnoughHolos;
  if (itemName === WILDCARD_PACK_ITEM_NAME) return REFUSALS.wildcardCooldown;
  return REFUSALS.unknownItem;
}

/**
 * `extra` adds host numbers to details (quantity path only: over_cap {cap, owned, maxQuantity}, not_enough_holos
 * {price, holosTokens, shortfall}); every legacy caller passes none, so its details stay exactly {rejectionCode}.
 */
export function refusalError(r: MarketplaceRefusal, extra: Readonly<Record<string, number>> = {}): HttpsError {
  return new HttpsError(r.httpsCode, r.message, { ...extra, rejectionCode: r.rejectionCode });
}
