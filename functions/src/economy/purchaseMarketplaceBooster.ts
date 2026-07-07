import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildBoosterPurchaseUpdatesRaw,
  MARKETPLACE_BOOSTER_PRICES,
  type MarketplaceBoosterId,
} from "../lib/economy";

type PurchaseBoosterResponse = {
  granted: {
    battleCardId: string;
    itemName: string;
    part: { name: string; slot: string };
  };
  holosTokens: number;
  price: number;
};

/** Server-authoritative booster purchase: server rolls part + battle card. */
export const purchaseMarketplaceBooster = onCall(
  async (request): Promise<PurchaseBoosterResponse> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to make purchases.");
    }

    const packId = (request.data as { packId?: unknown } | undefined)?.packId;
    if (typeof packId !== "string" || !(packId in MARKETPLACE_BOOSTER_PRICES)) {
      throw new HttpsError("invalid-argument", "Unknown booster pack.");
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const userData = snapshot.data() ?? {};
      const result = buildBoosterPurchaseUpdatesRaw(userData, packId as MarketplaceBoosterId);

      if (!result) {
        throw new HttpsError("failed-precondition", "Not enough Holos.");
      }

      transaction.set(userRef, result.updates, { merge: true });

      return {
        granted: result.granted,
        holosTokens: Number(result.updates.holosTokens),
        price: result.price,
      };
    });
  },
);
