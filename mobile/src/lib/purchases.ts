import { Platform } from "react-native";
import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from "react-native-purchases";

import { REVENUECAT_IOS_API_KEY } from "@/config/revenuecat";
import { getMonetizationConfig } from "@/lib/monetizationConfig";

/**
 * Thin, dormant-by-default wrapper around react-native-purchases.
 *
 * Every entry point no-ops (returns null / false, never crashes, never
 * prompts) unless ALL gates pass:
 *   - platform is iOS,
 *   - the RevenueCat public SDK key is pasted in (config/revenuecat.ts),
 *   - `config/monetization.iapEnabled` is true (Season 1 kill switch).
 *
 * The SDK is require()d lazily behind those gates, so beta builds — where
 * the pod may not even be installed — can never crash on import. Purchase
 * FULFILLMENT is server-only: the RevenueCat webhook grants entitlements;
 * this wrapper only drives the StoreKit sheet and reads offerings.
 */

type PurchasesModule = (typeof import("react-native-purchases"))["default"];

let configuredUserId: string | null = null;

function loadPurchasesModule(): PurchasesModule | null {
  try {
    const loaded = require("react-native-purchases") as
      | { default?: PurchasesModule }
      | PurchasesModule;
    return (loaded as { default?: PurchasesModule }).default ?? (loaded as PurchasesModule);
  } catch {
    // Native module absent (pod not installed): stay dormant.
    return null;
  }
}

/** True only when every dormancy gate passes. Never throws. */
export async function isIapEnabled(): Promise<boolean> {
  if (Platform.OS !== "ios" || !REVENUECAT_IOS_API_KEY) {
    return false;
  }

  const { iapEnabled } = await getMonetizationConfig();
  return iapEnabled;
}

/**
 * Configures the SDK for the signed-in pilot (RevenueCat app_user_id =
 * Firebase uid — the webhook resolves users/{app_user_id} from it). Safe to
 * call on every sign-in; it no-ops while purchases are dormant.
 */
export async function initPurchases(userId: string): Promise<void> {
  if (!userId || !(await isIapEnabled())) {
    return;
  }

  const Purchases = loadPurchasesModule();
  if (!Purchases) {
    return;
  }

  try {
    if (configuredUserId === userId) {
      return;
    }

    if (configuredUserId === null) {
      Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY, appUserID: userId });
    } else {
      await Purchases.logIn(userId);
    }
    configuredUserId = userId;
  } catch (error) {
    console.warn("[Purchases] init skipped", error);
  }
}

async function getReadyPurchases(): Promise<PurchasesModule | null> {
  if (configuredUserId === null || !(await isIapEnabled())) {
    return null;
  }
  return loadPurchasesModule();
}

/** Current offerings (the store catalog), or null while dormant/offline. */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  const Purchases = await getReadyPurchases();
  if (!Purchases) {
    return null;
  }

  try {
    return await Purchases.getOfferings();
  } catch (error) {
    console.warn("[Purchases] getOfferings failed", error);
    return null;
  }
}

/**
 * Runs the StoreKit purchase flow for a package. Returns the resulting
 * CustomerInfo, or null when dormant or the pilot cancelled the sheet.
 * Real failures rethrow so store UI can surface them. Entitlement
 * FULFILLMENT arrives via the webhook, not this return value.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  const Purchases = await getReadyPurchases();
  if (!Purchases) {
    return null;
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (error) {
    const cancelled =
      typeof error === "object" && error !== null && "userCancelled" in error
        ? Boolean((error as { userCancelled?: boolean | null }).userCancelled)
        : false;
    if (cancelled) {
      return null;
    }
    throw error;
  }
}

/**
 * Re-syncs App Store transactions with RevenueCat (Apple-required button
 * once IAP ships). Returns the refreshed CustomerInfo, or null while
 * dormant. Failures rethrow so the Settings row can show a readable error.
 */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  const Purchases = await getReadyPurchases();
  if (!Purchases) {
    return null;
  }

  return Purchases.restorePurchases();
}
