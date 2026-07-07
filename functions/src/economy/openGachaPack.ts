import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildPackGrantUpdatesRaw,
  buildPackRewards,
  GACHA_PACKS,
  incrementBoosterPacksToday,
  type GachaGrantedItem,
  type GachaPackId,
} from "../lib/economy";

type OpenGachaPackResponse = {
  gachaTickets: number;
  items: GachaGrantedItem[];
};

/**
 * Server-authoritative gacha: the server rolls the loot, deducts tickets,
 * and grants every revealed item in one transaction. The client only
 * animates the returned reveal.
 */
export const openGachaPack = onCall(async (request): Promise<OpenGachaPackResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to open packs.");
  }

  const packId = (request.data as { packId?: unknown } | undefined)?.packId;
  const pack = GACHA_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) {
    throw new HttpsError("invalid-argument", "Unknown gacha pack.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const tickets = Number(userData.gachaTickets || 0);
    if (tickets < pack.price) {
      throw new HttpsError("failed-precondition", "Not enough Gacha Tickets.");
    }

    const now = new Date();
    const items = buildPackRewards(pack.id as GachaPackId);
    const grantUpdates = buildPackGrantUpdatesRaw(userData, items);
    const packHistory = Array.isArray(userData.packHistory)
      ? (userData.packHistory as Array<Record<string, unknown>>)
      : [];
    const nextTickets = tickets - pack.price;

    transaction.set(
      userRef,
      {
        ...grantUpdates,
        gachaTickets: nextTickets,
        packHistory: [
          {
            id: `gacha_${pack.id}_${now.getTime()}`,
            items: items.map((item) => ({ name: item.label, rarity: item.rarity })),
            openedAt: now.toISOString(),
            packId: pack.id,
          },
          ...packHistory,
        ].slice(0, 50),
        rewardSystem: incrementBoosterPacksToday(userData.rewardSystem, now),
      },
      { merge: true },
    );

    return { gachaTickets: nextTickets, items };
  });
});
