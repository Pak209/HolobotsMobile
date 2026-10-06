import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildAttributeBoostRaw,
  validateAttributeBoostRequest,
  type AttributeBoostReply,
} from "../lib/progressionEconomy";

/**
 * DECISIONS #53-2 (Pak, 2026-10-06): server-authoritative attribute boost.
 * Request {holobotName, attribute: attack|defense|speed|health, requestId}.
 * Spends one attribute point: +1 attack/defense/speed or +10 HP (the mobile
 * InventoryScreen math, lib/progression.ts applyAttributeBoost). "special" is
 * refused (applied:false, reason attribute_not_boostable) — SPECIAL is tied to
 * the SYNC stat and is not boostable with points. Idempotent per requestId
 * (users/{uid}.attributeBoostRequestIds keeps the last 20 applied ids; a replay
 * returns applied:false, reason already_processed, and writes nothing).
 * Callers: mobile InventoryScreen, Unity HoloCity dashboard (HOLOBOT STATS).
 */
export const boostHolobotAttribute = onCall(async (request): Promise<AttributeBoostReply> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to boost Holobots.");
  }

  const command = validateAttributeBoostRequest(request.data);
  if (!command) {
    throw new HttpsError(
      "invalid-argument",
      "A holobot name, an attribute (attack, defense, speed or health) and a request id are required.",
      { rejectionCode: "invalid_request" },
    );
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.", { rejectionCode: "unavailable" });
    }

    const outcome = buildAttributeBoostRaw(snapshot.data() ?? {}, command);
    if (outcome === "not_owned") {
      throw new HttpsError("failed-precondition", "You do not own that Holobot.", { rejectionCode: "not_owned" });
    }

    if (outcome.updates) {
      transaction.set(userRef, outcome.updates, { merge: true });
    }
    return outcome.reply;
  });
});
