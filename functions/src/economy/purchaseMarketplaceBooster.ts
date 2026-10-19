import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildBoosterPurchaseUpdatesRaw,
  dailyMissionCounterUpdates,
  MARKETPLACE_BOOSTER_PRICES,
  type MarketplaceBoosterId,
} from "../lib/economy";
import { refusalError, REFUSALS } from "../lib/marketplaceRefusals";
import { onboardingAfterEvent } from "../lib/onboarding";

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
      throw refusalError(REFUSALS.unknownBooster);
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw refusalError(REFUSALS.profileMissing);
      }

      const userData = snapshot.data() ?? {};
      const now = new Date();
      const result = buildBoosterPurchaseUpdatesRaw(userData, packId as MarketplaceBoosterId, { now });

      if (!result) {
        throw refusalError(REFUSALS.notEnoughHolos);
      }

      // S2: the server-only daily-mission ledger is bumped with the display mirror.
      // onboarding-host-1 (#72.3–#72.5): the first vendor purchase completes the market beat.
      transaction.set(userRef, { ...result.updates, ...dailyMissionCounterUpdates(userData, "boosterPacksToday", now), ...onboardingAfterEvent(userData, "vendor_purchase", now.getTime()) }, { merge: true });

      return {
        granted: result.granted,
        holosTokens: Number(result.updates.holosTokens),
        price: result.price,
      };
    });
  },
);
