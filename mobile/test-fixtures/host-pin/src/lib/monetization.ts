/**
 * RevenueCat IAP catalog + webhook event logic (server-authoritative — all
 * purchase fulfillment happens in revenuecatWebhook; clients never write
 * economy fields). Product and entitlement constants are mirrored in
 * mobile/src/lib/monetization.ts and parity-tested. Pure module: no
 * firebase imports, so mobile tests can import it directly.
 * See mobile/docs/revenuecat-setup.md.
 */

// App Store Connect product ids (app 6762533312, bundle fun.holobots.mobile).
export const IAP_PRODUCT_GENESIS_SQUAD = "genesis_squad_499";
export const IAP_PRODUCT_GENESIS_SQUAD_EARLY = "genesis_squad_early_199";
export const IAP_PRODUCT_BATTLE_PASS_MONTHLY = "battle_pass_monthly";

export const GENESIS_IAP_PRODUCT_IDS = [
  IAP_PRODUCT_GENESIS_SQUAD,
  IAP_PRODUCT_GENESIS_SQUAD_EARLY,
] as const;

// RevenueCat entitlement ids.
export const ENTITLEMENT_GENESIS_SQUAD = "genesis_squad";
export const ENTITLEMENT_BATTLE_PASS = "battle_pass";

export function isGenesisIapProduct(productId: string): boolean {
  return (GENESIS_IAP_PRODUCT_IDS as readonly string[]).includes(productId);
}

/** Non-consumables arrive as NON_RENEWING_PURCHASE; keep INITIAL_PURCHASE
    too so a RevenueCat classification change cannot drop a paid grant. */
export const GENESIS_PURCHASE_EVENT_TYPES = [
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
] as const;

/** Events that (re)activate the battle pass. EXPIRATION and CANCELLATION are
    deliberately absent: the pass lapses naturally via battlePassActiveUntil. */
export const BATTLE_PASS_ACTIVATION_EVENT_TYPES = [
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
] as const;

export type RevenueCatEvent = {
  type: string;
  /** RevenueCat app_user_id — the Firebase uid (initPurchases logs in with it). */
  appUserId: string;
  productId: string;
  /** Subscription lapse time (ms epoch); null for non-expiring products. */
  expirationAtMs: number | null;
};

/**
 * Structural parse of a RevenueCat webhook body ({ api_version, event }).
 * Returns null for anything that can never be fulfilled (missing fields,
 * an app_user_id that is not a valid Firestore doc id) — the webhook
 * answers 200 for those so RevenueCat does not retry-loop on them.
 */
export function parseRevenueCatEvent(body: unknown): RevenueCatEvent | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const event = (body as { event?: unknown }).event;
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const raw = event as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  const appUserId = typeof raw.app_user_id === "string" ? raw.app_user_id.trim() : "";
  const productId = typeof raw.product_id === "string" ? raw.product_id.trim() : "";

  if (!type || !appUserId || !productId || appUserId.includes("/")) {
    return null;
  }

  const expirationAtMs =
    typeof raw.expiration_at_ms === "number" && Number.isFinite(raw.expiration_at_ms)
      ? raw.expiration_at_ms
      : null;

  return { type, appUserId, productId, expirationAtMs };
}

type RawUser = Record<string, unknown>;

export type BattlePassUpdate = {
  /** ms epoch; server-written only. The client treats now < this as active. */
  battlePassActiveUntil: number;
};

/**
 * Battle-pass fulfillment builder: activation events push the lapse time out
 * to the event's expiration. Monotonic (never moves battlePassActiveUntil
 * backwards), which also makes RevenueCat's retries idempotent. Returns null
 * when the event needs no write.
 */
export function buildBattlePassUpdate(
  userData: RawUser,
  event: RevenueCatEvent,
): BattlePassUpdate | null {
  if (event.productId !== IAP_PRODUCT_BATTLE_PASS_MONTHLY) {
    return null;
  }
  if (!(BATTLE_PASS_ACTIVATION_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return null;
  }
  if (event.expirationAtMs === null || event.expirationAtMs <= 0) {
    return null;
  }

  const current = Number(userData.battlePassActiveUntil || 0);
  if (event.expirationAtMs <= current) {
    return null;
  }

  return { battlePassActiveUntil: event.expirationAtMs };
}
