/**
 * Producer decision (PR #56 review, 2026-10-04): the three legacy marketplace purchase callables
 * add `details.rejectionCode` to every refusal. Additive only: HTTPS status and English message
 * stay byte-identical, so the mobile app (which matches on message text) is unaffected.
 */
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";

export type MarketplaceRejectionCode = "not_enough_holos" | "unknown_item" | "on_cooldown" | "unavailable" | "invalid_request";

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
 * Why `buildItemPurchaseUpdatesRaw` returned null, in the callable's existing order: short of Holos
 * first, then the Wildcard pack (only reachable null for a known item is its 7-day cooldown), else unknown.
 */
export function classifyItemRefusal(holos: number, price: number, itemName: string): MarketplaceRefusal {
  if (holos < price) return REFUSALS.notEnoughHolos;
  if (itemName === WILDCARD_PACK_ITEM_NAME) return REFUSALS.wildcardCooldown;
  return REFUSALS.unknownItem;
}

export function refusalError(r: MarketplaceRefusal): HttpsError {
  return new HttpsError(r.httpsCode, r.message, { rejectionCode: r.rejectionCode });
}
