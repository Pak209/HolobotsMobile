import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildStarterDeckClaim } from "../lib/holobotLoadout";

/**
 * holobots-write-lockdown-1: the one-time Genesis starter deck for a legacy
 * account that has no battle cards and never claimed it (new sign-ups get it
 * from createGenesisProfile). battle_cards / arena_deck_template_ids /
 * starter_deck_claimed are server-only in firestore.rules. Idempotent: any
 * account that already claimed, or already owns cards, gets granted: false and
 * no write. Caller: mobile AuthContext (on profile load).
 */
export const claimStarterDeck = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim the starter deck.");
  }
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.", { rejectionCode: "unavailable" });
    }
    const outcome = buildStarterDeckClaim(snapshot.data() ?? {});
    if (outcome.updates) {
      transaction.set(userRef, outcome.updates, { merge: true });
    }
    return { granted: outcome.granted };
  });
});
