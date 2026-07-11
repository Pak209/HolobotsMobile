import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildPartPurchaseUpdatesRaw,
  getMarketplacePartOffer,
} from "../lib/economy";

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
    throw new HttpsError("invalid-argument", "A part id is required.");
  }

  if (!getMarketplacePartOffer(partId)) {
    throw new HttpsError("invalid-argument", "Unknown marketplace part.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const result = buildPartPurchaseUpdatesRaw(snapshot.data() ?? {}, partId);
    if (!result) {
      throw new HttpsError("failed-precondition", "Not enough Holos.");
    }

    transaction.set(userRef, result.updates, { merge: true });

    return {
      holosTokens: Number(result.updates.holosTokens),
      part: result.part,
      price: result.price,
    };
  });
});
