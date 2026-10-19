import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildPartPurchaseUpdatesRaw,
  getMarketplacePartOffer,
} from "../lib/economy";
import { refusalError, REFUSALS } from "../lib/marketplaceRefusals";
import { onboardingAfterEvent } from "../lib/onboarding";

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

    // onboarding-host-1 (#72.3–#72.5): the first vendor purchase completes the market beat.
    transaction.set(userRef, { ...result.updates, ...onboardingAfterEvent(snapshot.data() ?? {}, "vendor_purchase", Date.now()) }, { merge: true });

    return {
      holosTokens: Number(result.updates.holosTokens),
      part: result.part,
      price: result.price,
    };
  });
});
