/**
 * market-quantity-host-1 (HolobotsUnity DECISIONS #72.26, UI plan P3): an optional `quantity` on
 * purchaseMarketplaceItem buys 1-99 of ONE stackable marketplace item as ONE purchase. Schema:
 * Schemas/marketplace-item-purchase-1.json.
 *
 * - Holos spent = unit price x quantity, in the same update that raises the item counter by quantity.
 * - One ledger entry per purchase: the server-only receipt vendorPurchases/{uid}/marketplaceItems/{requestId}
 *   (rules deny clients; account deletion removes it). A retry with the same requestId replays the stored reply
 *   (alreadyProcessed: true) and never buys twice; the same requestId for another item or quantity is
 *   sequence_conflict. A refusal writes nothing, so the same request can succeed later.
 * - Stackables only: every marketplace single item except the weekly Wildcard pack, which takes quantity 1.
 * - Inventory cap: a stackable's counter may not pass MARKETPLACE_STACK_CAP after the purchase (over_cap).
 *
 * A request WITHOUT `quantity` is the legacy single purchase: purchaseMarketplaceItem never sends it here and its
 * reply, refusals and writes stay byte-identical. `quantity` here is how many purchases of a listing to make; the
 * vendor-3 listing's own `quantity` is the units ONE purchase grants (1 for every stackable, 5 for the Wildcard pack).
 *
 * Pure module: no Firestore or Admin SDK access, safe to import from tests.
 */
import { getMarketplacePrice, MARKETPLACE_ITEM_NAMES, WILDCARD_PACK_AMOUNT, WILDCARD_PACK_COOLDOWN_MS } from "./economy";
import { MarketplaceRefusal, QUANTITY_REFUSALS, REFUSALS, WILDCARD_PACK_ITEM_NAME } from "./marketplaceRefusals";
import { ITEM_INVENTORY_FIELD, PURCHASE_REQUEST_ID } from "./vendors";

export const MARKETPLACE_PURCHASE_SCHEMA = "marketplace-item-purchase-1";
export const MARKETPLACE_QUANTITY_MIN = 1;
export const MARKETPLACE_QUANTITY_MAX = 99;
/** The most of one stackable item a pilot may hold after a quantity purchase. */
export const MARKETPLACE_STACK_CAP = 999;
/** Stackables: the marketplace single items a quantity above 1 may buy (all but the weekly Wildcard pack). */
export const MARKETPLACE_STACKABLE_ITEM_NAMES: readonly string[] = Object.freeze(
  MARKETPLACE_ITEM_NAMES.filter((name) => name !== WILDCARD_PACK_ITEM_NAME),
);
/** Receipt subcollection under vendorPurchases/{uid} (the Buddy Unit receipts live beside it in `receipts`). */
export const MARKETPLACE_RECEIPTS_COLLECTION = "marketplaceItems";

export type QuantityPurchaseCommand = { itemName: string; quantity: number; requestId: string };

export type QuantityPurchaseReply = {
  schemaVersion: typeof MARKETPLACE_PURCHASE_SCHEMA;
  requestId: string;
  itemName: string;
  quantity: number;
  /** Holos for one unit (getMarketplacePrice). */
  unitPrice: number;
  /** Holos spent: unitPrice x quantity. */
  price: number;
  /** Balance after the purchase. */
  holosTokens: number;
  /** The item counter after the purchase. */
  owned: number;
  alreadyProcessed: boolean;
};

/** The one ledger entry a quantity purchase writes (server-only; clients never read it). */
export type QuantityPurchaseReceipt = {
  schemaVersion: typeof MARKETPLACE_PURCHASE_SCHEMA;
  itemName: string;
  quantity: number;
  createdAtMs: number;
  reply: QuantityPurchaseReply;
};

/** A quantity-path refusal; `extra` is copied into the callable error's details next to rejectionCode. */
export class QuantityPurchaseRefusal extends Error {
  constructor(public readonly refusal: MarketplaceRefusal, public readonly extra: Readonly<Record<string, number>> = {}) {
    super(refusal.rejectionCode);
  }
}

/** True when the request opts into marketplace-item-purchase-1 by carrying `quantity` (any value, even invalid). */
export function isQuantityPurchase(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).quantity !== undefined;
}

const REQUEST_KEYS = new Set(["itemName", "quantity", "requestId"]);

/** Exactly {itemName, quantity: integer 1-99, requestId}; any other key is invalid_request. */
export function validateQuantityPurchase(raw: unknown): QuantityPurchaseCommand {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { itemName, quantity, requestId } = c;
  if (typeof itemName !== "string" || !itemName.trim()) throw new QuantityPurchaseRefusal(REFUSALS.itemNameRequired);
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < MARKETPLACE_QUANTITY_MIN || quantity > MARKETPLACE_QUANTITY_MAX)
    throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.quantityRequestInvalid);
  if (typeof requestId !== "string" || !PURCHASE_REQUEST_ID.test(requestId)) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.quantityRequestInvalid);
  if (Object.keys(c).some((key) => !REQUEST_KEYS.has(key))) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.quantityRequestInvalid);
  return { itemName, quantity, requestId };
}

/** Strict reads (the vendor-3 purchase rule): absent = 0; anything but a finite non-negative number = unavailable. */
function readAmount(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.accountUnavailable);
  return value;
}
function readCount(value: unknown): number {
  const n = readAmount(value);
  if (!Number.isSafeInteger(n)) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.accountUnavailable);
  return n;
}

/**
 * The purchase for a profile that exists, in this order: unknown_item, not_stackable (quantity above 1 on the
 * Wildcard pack), unavailable (malformed balance / counter / pack time), on_cooldown (Wildcard pack inside its
 * 7 days), over_cap (owned + quantity above the cap), not_enough_holos. Every refusal throws before any write.
 */
export function buildQuantityPurchase(
  profile: Record<string, unknown>,
  command: QuantityPurchaseCommand,
  nowMs: number,
): { updates: Record<string, unknown>; reply: QuantityPurchaseReply; receipt: QuantityPurchaseReceipt } {
  const { itemName, quantity, requestId } = command;
  if (!MARKETPLACE_ITEM_NAMES.includes(itemName)) throw new QuantityPurchaseRefusal(REFUSALS.unknownItem);
  const stackable = MARKETPLACE_STACKABLE_ITEM_NAMES.includes(itemName);
  if (!stackable && quantity > 1) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.notStackable);

  const field = ITEM_INVENTORY_FIELD[itemName];
  const holos = readAmount(profile.holosTokens);
  const owned = readCount(profile[field]);
  const unitPrice = getMarketplacePrice(itemName);
  const price = unitPrice * quantity;
  const updates: Record<string, unknown> = {};
  let ownedAfter: number;

  if (stackable) {
    if (owned + quantity > MARKETPLACE_STACK_CAP) {
      throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.overCap, {
        cap: MARKETPLACE_STACK_CAP,
        owned,
        maxQuantity: Math.max(0, MARKETPLACE_STACK_CAP - owned),
      });
    }
    ownedAfter = owned + quantity;
  } else {
    // The weekly Wildcard pack (quantity 1): the legacy cooldown and grant, read strictly.
    if (nowMs - readAmount(profile.lastWildcardPackAt) < WILDCARD_PACK_COOLDOWN_MS) throw new QuantityPurchaseRefusal(REFUSALS.wildcardCooldown);
    ownedAfter = owned + WILDCARD_PACK_AMOUNT;
    if (!Number.isSafeInteger(ownedAfter)) throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.accountUnavailable);
    updates.lastWildcardPackAt = nowMs;
  }

  if (holos < price) throw new QuantityPurchaseRefusal(REFUSALS.notEnoughHolos, { price, holosTokens: holos, shortfall: price - holos });

  updates.holosTokens = holos - price;
  updates[field] = ownedAfter;
  const reply: QuantityPurchaseReply = {
    schemaVersion: MARKETPLACE_PURCHASE_SCHEMA,
    requestId,
    itemName,
    quantity,
    unitPrice,
    price,
    holosTokens: holos - price,
    owned: ownedAfter,
    alreadyProcessed: false,
  };
  return { updates, reply, receipt: { schemaVersion: MARKETPLACE_PURCHASE_SCHEMA, itemName, quantity, createdAtMs: nowMs, reply } };
}

/** A stored receipt for this requestId: the same item and quantity replay its reply; anything else is sequence_conflict. */
export function replayQuantityPurchase(stored: unknown, command: QuantityPurchaseCommand): QuantityPurchaseReply {
  const receipt = stored as Partial<QuantityPurchaseReceipt> | undefined;
  if (!receipt || receipt.itemName !== command.itemName || receipt.quantity !== command.quantity || !receipt.reply) {
    throw new QuantityPurchaseRefusal(QUANTITY_REFUSALS.sequenceConflict);
  }
  return { ...receipt.reply, alreadyProcessed: true };
}
