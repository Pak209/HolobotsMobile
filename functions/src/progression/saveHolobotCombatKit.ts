import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildKitSaveUpdatesRaw } from "../lib/moveProgression";

/**
 * Server-authoritative combat-kit save: validates slot categories,
 * uniqueness, move ownership, and the optimistic revision. Loadout changes
 * are free (no currency debit).
 */
export const saveHolobotCombatKit = onCall(async (request): Promise<{ revision: number }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to save a kit.");
  }

  const data = (request.data ?? {}) as {
    expectedRevision?: unknown;
    holobotName?: unknown;
    slots?: unknown;
  };
  const holobotName = typeof data.holobotName === "string" ? data.holobotName : "";
  const expectedRevision = Number(data.expectedRevision);
  const slots = Array.isArray(data.slots) ? data.slots.map(String) : [];

  if (!holobotName.trim() || slots.length !== 4 || !Number.isInteger(expectedRevision)) {
    throw new HttpsError(
      "invalid-argument",
      "A holobot name, four kit slots, and the current revision are required.",
    );
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    try {
      const result = buildKitSaveUpdatesRaw(snapshot.data() ?? {}, holobotName, slots, expectedRevision);
      transaction.set(userRef, result.updates, { merge: true });
      return { revision: result.revision };
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Kit save rejected.",
      );
    }
  });
});
