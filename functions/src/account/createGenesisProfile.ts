import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildGenesisSignupUserDoc, validateGenesisSignup } from "../lib/genesisSignup";

type CreateGenesisProfileResponse = { schemaVersion: "genesis-profile-1"; created: boolean };

/**
 * Creates the signed-in user's Genesis profile — the same users/{uid}
 * document a mobile sign-up writes (see lib/genesisSignup.ts). Used by the
 * HoloCity desktop sign-up, which must not write profile data from the
 * client.
 *
 * Idempotent and never destructive: an existing profile is left untouched
 * and reported as created=false (the mobile "email already has a Holobots
 * account" branch). A missing profile is created (the mobile "recover
 * setup" branch).
 */
export const createGenesisProfile = onCall(async (request): Promise<CreateGenesisProfileResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to create your Holobots profile.");
  }

  const data = (request.data ?? {}) as { starterHolobot?: unknown; username?: unknown };
  const valid = validateGenesisSignup(data.starterHolobot, data.username);
  if (!valid.ok) {
    throw new HttpsError("invalid-argument", valid.reason, { rejectionCode: valid.reason.replace("-", "_") });
  }

  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (snapshot.exists) {
      return { schemaVersion: "genesis-profile-1", created: false };
    }
    transaction.create(userRef, buildGenesisSignupUserDoc(valid.starter, valid.username, FieldValue.serverTimestamp()));
    return { schemaVersion: "genesis-profile-1", created: true };
  });
});
