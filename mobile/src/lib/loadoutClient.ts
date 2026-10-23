import { functions, httpsCallable } from "@/config/firebase";
import { toServerActionError } from "@/lib/callables";

/**
 * holobots-write-lockdown-1 (Pak 2026-10-23): the last profile writes the app
 * used to make directly to users/{uid}. firestore.rules now freezes holobots,
 * equippedParts and the starter-deck fields, so these go through callables
 * (functions/src/lib/holobotLoadout.ts). Each is a "set to" on the host, so a
 * retried tap writes nothing new. The profile listener picks up the result.
 */

export type PartSlot = "head" | "torso" | "arms" | "legs" | "core";

const equipSyncAbilityCallable = httpsCallable<
  { holobotName: string; abilityId: string },
  { equipped: true; changed: boolean; abilityId: string }
>(functions, "equipSyncAbility");

const equipHolobotPartCallable = httpsCallable<
  { holobotName: string; slot: PartSlot; partId: string },
  { equipped: true; changed: boolean }
>(functions, "equipHolobotPart");

const claimStarterDeckCallable = httpsCallable<Record<string, never>, { granted: boolean }>(
  functions,
  "claimStarterDeck",
);

const createGenesisProfileCallable = httpsCallable<
  { starterHolobot: string; username: string },
  { schemaVersion: "genesis-profile-1"; created: boolean }
>(functions, "createGenesisProfile");

export async function equipSyncAbilityAuthoritative(holobotName: string, abilityId: string): Promise<void> {
  try {
    await equipSyncAbilityCallable({ abilityId, holobotName });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function equipHolobotPartAuthoritative(holobotName: string, slot: PartSlot, partId: string): Promise<void> {
  try {
    await equipHolobotPartCallable({ holobotName, partId, slot });
  } catch (error) {
    throw toServerActionError(error);
  }
}

/** Legacy accounts with no battle cards: the one-time Genesis starter deck. */
export async function claimStarterDeckAuthoritative(): Promise<{ granted: boolean }> {
  try {
    const result = await claimStarterDeckCallable({});
    return { granted: Boolean(result.data?.granted) };
  } catch (error) {
    throw toServerActionError(error);
  }
}

/**
 * Sign-up profile (mobile and HoloCity desktop): the host writes the Genesis
 * profile (functions/src/lib/genesisSignup.ts). Idempotent: an existing
 * profile is left untouched (created: false).
 */
export async function createGenesisProfileAuthoritative(starterHolobot: string, username: string): Promise<{ created: boolean }> {
  try {
    const result = await createGenesisProfileCallable({ starterHolobot, username });
    return { created: Boolean(result.data?.created) };
  } catch (error) {
    throw toServerActionError(error);
  }
}
