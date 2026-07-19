/**
 * RevenueCat client configuration.
 *
 * The iOS SDK key is the PUBLIC "Apple App Store" key from RevenueCat →
 * Project settings → API keys (it starts with `appl_`). Public SDK keys are
 * safe to commit — they can only talk to the purchases SDK on-device, never
 * read account data or grant entitlements (all fulfillment happens in the
 * revenuecatWebhook Cloud Function with its own secret).
 *
 * Leave empty until Season 1: an empty key keeps the entire purchases layer
 * dormant (mobile/src/lib/purchases.ts no-ops). Paste-in step documented in
 * mobile/docs/revenuecat-setup.md.
 */
export const REVENUECAT_IOS_API_KEY = "appl_dWSuhbvwnFotFCPaGYTxQzUnEVv";
