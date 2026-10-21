import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildItemPurchaseUpdatesRaw, getMarketplacePrice } from "../lib/economy";
import { classifyItemRefusal, refusalError, REFUSALS } from "../lib/marketplaceRefusals";
import { isQuantityPurchase, QuantityPurchaseRefusal, QuantityPurchaseReply } from "../lib/marketplaceQuantity";
import { onboardingAfterEvent } from "../lib/onboarding";
import { transactMarketplaceQuantityPurchase } from "./marketplaceQuantityStore";

type PurchaseItemResponse = {
  holosTokens: number;
  itemName: string;
  price: number;
};

/**
 * Server-authoritative marketplace item purchase. `{itemName}` is the legacy single purchase (unchanged).
 * market-quantity-host-1: `{itemName, quantity, requestId}` is a marketplace-item-purchase-1 quantity purchase
 * (Schemas/marketplace-item-purchase-1.json; lib/marketplaceQuantity.ts).
 */
export const purchaseMarketplaceItem = onCall(async (request): Promise<PurchaseItemResponse | QuantityPurchaseReply> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to make purchases.");
  }

  if (isQuantityPurchase(request.data)) {
    try {
      return await transactMarketplaceQuantityPurchase(db, uid, request.data);
    } catch (error) {
      if (error instanceof QuantityPurchaseRefusal) throw refusalError(error.refusal, error.extra);
      throw error;
    }
  }

  const itemName = (request.data as { itemName?: unknown } | undefined)?.itemName;
  if (typeof itemName !== "string" || !itemName.trim()) {
    throw refusalError(REFUSALS.itemNameRequired);
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw refusalError(REFUSALS.profileMissing);
    }

    const userData = snapshot.data() ?? {};
    const result = buildItemPurchaseUpdatesRaw(userData, itemName);

    if (!result) {
      throw refusalError(classifyItemRefusal(Number(userData.holosTokens || 0), getMarketplacePrice(itemName), itemName));
    }

    // onboarding-host-1 (#72.3–#72.5): the first vendor purchase completes the market beat.
    transaction.set(userRef, { ...result.updates, ...onboardingAfterEvent(userData, "vendor_purchase", Date.now()) }, { merge: true });

    return {
      holosTokens: Number(result.updates.holosTokens),
      itemName,
      price: result.price,
    };
  });
});
