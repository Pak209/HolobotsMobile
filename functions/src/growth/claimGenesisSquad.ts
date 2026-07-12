import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildGenesisSquadGrantRaw, GENESIS_REFERRALS_REQUIRED } from "../lib/referrals";

type ClaimResponse = {
  granted: string[];
  converted: Array<{ name: string; blueprints: number }>;
};

/**
 * Claims the Genesis Squad via the referral path: requires 3 qualified
 * referrals and a never-claimed entitlement. (The purchase path will reuse
 * buildGenesisSquadGrantRaw with source "purchase" in Phase 2.)
 */
export const claimGenesisSquad = onCall(async (request): Promise<ClaimResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to claim the Genesis Squad.");
  }

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const qualified = Number((userData.referrals as { qualified?: number } | undefined)?.qualified || 0);
    if (qualified < GENESIS_REFERRALS_REQUIRED) {
      throw new HttpsError(
        "failed-precondition",
        `You need ${GENESIS_REFERRALS_REQUIRED} qualified referrals (friends who completed a workout).`,
      );
    }

    const grant = buildGenesisSquadGrantRaw(userData, "referral");
    if (!grant) {
      throw new HttpsError("failed-precondition", "The Genesis Squad was already claimed on this account.");
    }

    transaction.set(userRef, grant.updates, { merge: true });
    return { granted: grant.granted, converted: grant.converted };
  });
});
