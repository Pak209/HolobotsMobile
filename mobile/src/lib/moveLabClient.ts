import { functions, httpsCallable } from "@/config/firebase";
import { toServerActionError } from "@/lib/callables";
import type { UserProfile } from "@/types/profile";

/**
 * Server-authoritative Move Lab operations (Sync Point move upgrades and
 * combat-kit saves). The legacy client-side fallback was removed by
 * holobots-write-lockdown-1: users/{uid}.holobots and syncPoints are
 * server-only in firestore.rules, so a local write would be denied anyway.
 * Availability errors surface as the standard "needs a connection" message.
 */

type UpdateProfileFn = (updates: Record<string, unknown>) => Promise<void>;

const upgradeHolobotMoveCallable = httpsCallable<
  { branchId?: string; expectedRank: number; holobotName: string; moveTemplateId: string },
  { cost: number; nextRank: number; syncPoints: number }
>(functions, "upgradeHolobotMove");

const saveHolobotCombatKitCallable = httpsCallable<
  { expectedRevision: number; holobotName: string; slots: string[] },
  { revision: number }
>(functions, "saveHolobotCombatKit");

export async function upgradeHolobotMoveAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  moveTemplateId: string,
  expectedRank: number,
  branchId?: string,
): Promise<void> {
  try {
    await upgradeHolobotMoveCallable({ branchId, expectedRank, holobotName, moveTemplateId });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function saveHolobotCombatKitAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  holobotName: string,
  slots: [string, string, string, string],
  expectedRevision: number,
): Promise<void> {
  try {
    await saveHolobotCombatKitCallable({ expectedRevision, holobotName, slots });
  } catch (error) {
    throw toServerActionError(error);
  }
}
