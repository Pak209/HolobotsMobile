import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildGenesisHostGrants, buildGenesisSignupUserDoc, validateGenesisSignup } from "../lib/genesisSignup";
import { genesisOnboarding, ONBOARDING_FIELD } from "../lib/onboarding";
import { projectFirstTravelHolobot } from '../acquisition/captureOwnership';
import { BUDDY_UNITS_FIELD, starterInventory } from "../lib/buddyUnits";
import { ARENA_STARTER_ENTRY_DOC, arenaStarterEntryGrant } from "../arena/arenaMatchStore";

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
 *
 * early-progression-1 (Pak 2026-11-12): a created profile starts with 300 Holos (buildGenesisHostGrants) and one free Arena
 * entry (the server-only arenaMatches/{uid}/ledger/starterEntry doc, arena/arenaMatchStore.ts). Existing profiles get neither.
 */
export async function transactCreateGenesisProfile(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now(), timestamp: unknown = FieldValue.serverTimestamp()): Promise<CreateGenesisProfileResponse> {
  const data = (raw ?? {}) as { starterHolobot?: unknown; username?: unknown };
  const valid = validateGenesisSignup(data.starterHolobot, data.username);
  if (!valid.ok) {
    throw new HttpsError("invalid-argument", valid.reason, { rejectionCode: valid.reason.replace("-", "_") });
  }

  const userRef = firestore.doc(`users/${uid}`);
  const starterEntryRef = firestore.doc(`arenaMatches/${uid}/ledger/${ARENA_STARTER_ENTRY_DOC}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (snapshot.exists) {
      return { schemaVersion: "genesis-profile-1", created: false };
    }
    // DECISIONS #43/#44 starter Buddy Unit (one Light), granted here so the lazy grant in the
    // wild / desktop / rival hosts (missing field only) never adds a second one.
    const profile = buildGenesisSignupUserDoc(valid.starter, valid.username, timestamp);
    transaction.create(userRef, {
      ...profile,
      pilotRank: 0,
      ...projectFirstTravelHolobot(profile).updates,
      [BUDDY_UNITS_FIELD]: starterInventory(),
      // DECISIONS #72.5 (D3): one Repair Kit + early-progression-1 starter Holos. #72.3–#72.5: the onboarding spine at step 0.
      ...buildGenesisHostGrants(),
      [ONBOARDING_FIELD]: genesisOnboarding(nowMs),
    });
    // set, not create: a profile deleted and re-created keeps at most one free entry, never an error.
    transaction.set(starterEntryRef, arenaStarterEntryGrant(nowMs));
    return { schemaVersion: "genesis-profile-1", created: true };
  });
}

export const createGenesisProfile = onCall(async (request): Promise<CreateGenesisProfileResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to create your Holobots profile.");
  }
  return transactCreateGenesisProfile(db, uid, request.data);
});
