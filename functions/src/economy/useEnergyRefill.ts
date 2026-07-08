import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildEnergyRefillUpdates } from "../lib/mintingEconomy";

/** Server-authoritative energy-refill consumption. */
export const useEnergyRefill = onCall(
  async (request): Promise<{ dailyEnergy: number; energyRefills: number }> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to use refills.");
    }

    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const updates = buildEnergyRefillUpdates(snapshot.data() ?? {});
      if (!updates) {
        throw new HttpsError("failed-precondition", "No Energy Refills available.");
      }

      transaction.set(userRef, updates, { merge: true });

      return {
        dailyEnergy: Number(updates.dailyEnergy),
        energyRefills: Number(updates.energyRefills),
      };
    });
  },
);
