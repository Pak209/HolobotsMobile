import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildEquipPart, validateEquipPartRequest } from "../lib/holobotLoadout";

/**
 * holobots-write-lockdown-1: equips one owned part (users/{uid}.parts) into a
 * slot of an owned holobot (users/{uid}.equippedParts is server-only in
 * firestore.rules). Request {holobotName, slot: head|torso|arms|legs|core,
 * partId}. The stored record is copied from the owned part. Idempotent:
 * re-equipping the same part writes nothing (changed: false). Callers: mobile
 * HomeScreen part picker (main app + lite).
 */
export const equipHolobotPart = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to equip parts.");
  }
  const command = validateEquipPartRequest(request.data);
  if (!command) {
    throw new HttpsError("invalid-argument", "A holobot name, a slot (head, torso, arms, legs or core) and a part id are required.", {
      rejectionCode: "invalid_request",
    });
  }

  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.", { rejectionCode: "unavailable" });
    }
    const outcome = buildEquipPart(snapshot.data() ?? {}, command);
    if (outcome === "not_owned") {
      throw new HttpsError("failed-precondition", "You do not own that Holobot.", { rejectionCode: "not_owned" });
    }
    if (outcome === "part_not_found") {
      throw new HttpsError("failed-precondition", "That part is not in your inventory.", { rejectionCode: "part_not_found" });
    }
    if (outcome === "slot_mismatch") {
      throw new HttpsError("failed-precondition", "That part does not fit this slot.", { rejectionCode: "slot_mismatch" });
    }
    if (outcome.updates) {
      transaction.set(userRef, outcome.updates, { merge: true });
    }
    return outcome.reply;
  });
});
