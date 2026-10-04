import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildPartPurchaseUpdatesRaw,
  getMarketplacePartOffer,
} from "../lib/economy";
import { refusalError, REFUSALS } from "../lib/marketplaceRefusals";

type PurchasePartResponse = {
  holosTokens: number;
  part: { name: string; rarity: string; slot: string };
  price: number;
};

/** Server-authoritative marketplace part purchase (Holos -> equipment part). */
export const purchaseMarketplacePart = onCall(async (request): Promise<PurchasePartResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to make purchases.");
  }

  const partId = (request.data as { partId?: unknown } | undefined)?.partId;
  if (typeof partId !== "string" || !partId.trim()) {
    throw refusalError(REFUSALS.partIdRequired);
  }

  if (!getMarketplacePartOffer(partId)) {
    throw refusalError(REFUSALS.unknownPart);
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw refusalError(REFUSALS.profileMissing);
    }

    const result = buildPartPurchaseUpdatesRaw(snapshot.data() ?? {}, partId);
    if (!result) {
      throw refusalError(REFUSALS.notEnoughHolos);
    }

    transaction.set(userRef, result.updates, { merge: true });

    return {
      holosTokens: Number(result.updates.holosTokens),
      part: result.part,
      price: result.price,
    };
  });
});
