import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildItemPurchaseUpdatesRaw, getMarketplacePrice } from "../lib/economy";
import { classifyItemRefusal, refusalError, REFUSALS } from "../lib/marketplaceRefusals";

type PurchaseItemResponse = {
  holosTokens: number;
  itemName: string;
  price: number;
};

/** Server-authoritative single-item marketplace purchase. */
export const purchaseMarketplaceItem = onCall(async (request): Promise<PurchaseItemResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to make purchases.");
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

    transaction.set(userRef, result.updates, { merge: true });

    return {
      holosTokens: Number(result.updates.holosTokens),
      itemName,
      price: result.price,
    };
  });
});
