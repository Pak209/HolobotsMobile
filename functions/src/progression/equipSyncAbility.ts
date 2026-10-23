import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildEquipSyncAbility, validateEquipSyncAbilityRequest } from "../lib/holobotLoadout";

/**
 * holobots-write-lockdown-1: equips an unlocked Sync Ability on an owned
 * holobot (users/{uid}.holobots is server-only in firestore.rules). Request
 * {holobotName, abilityId}. Idempotent: equipping the already-equipped
 * ability writes nothing (changed: false). Callers: mobile InventoryScreen
 * (main app + lite).
 */
export const equipSyncAbility = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to equip Sync Abilities.");
  }
  const command = validateEquipSyncAbilityRequest(request.data);
  if (!command) {
    throw new HttpsError("invalid-argument", "A holobot name and an ability id are required.", { rejectionCode: "invalid_request" });
  }

  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.", { rejectionCode: "unavailable" });
    }
    const outcome = buildEquipSyncAbility(snapshot.data() ?? {}, command);
    if (outcome === "not_owned") {
      throw new HttpsError("failed-precondition", "You do not own that Holobot.", { rejectionCode: "not_owned" });
    }
    if (outcome === "ability_locked") {
      throw new HttpsError("failed-precondition", "Meet the listed Sync Stat requirements before equipping this ability.", {
        rejectionCode: "ability_locked",
      });
    }
    if (outcome.updates) {
      transaction.set(userRef, outcome.updates, { merge: true });
    }
    return outcome.reply;
  });
});
