/**
 * IAP catalog: product + entitlement ids, client mirror of
 * functions/src/lib/monetization.ts (parity-tested). Fulfillment is
 * server-ONLY — the RevenueCat webhook grants everything; the client never
 * writes economy fields. Purchases stay dormant until Season 1 flips
 * config/monetization.iapEnabled (see mobile/docs/revenuecat-setup.md).
 */

// App Store Connect product ids (bundle fun.holobots.mobile).
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

export type EntitlementGrantDescription = {
  entitlementId: string;
  title: string;
  description: string;
};

/** What owning an entitlement means in-game (display copy for store UI). */
export function describeEntitlementGrant(entitlementId: string): EntitlementGrantDescription | null {
  switch (entitlementId) {
    case ENTITLEMENT_GENESIS_SQUAD:
      return {
        entitlementId,
        title: "Genesis Squad",
        description:
          "KUMA + SHADOW (owned bots convert to blueprints), the celebration pack, and the permanent GENESIS badge. Granted once per account by the server.",
      };
    case ENTITLEMENT_BATTLE_PASS:
      return {
        entitlementId,
        title: "Battle Pass",
        description:
          "Monthly battle pass. Active while the server-tracked expiration is in the future; renewals extend it automatically.",
      };
    default:
      return null;
  }
}
