import { functions, httpsCallable } from "@/config/firebase";
import { shouldFallBackToLocal } from "@/lib/callables";
import { buildKitSaveUpdates, buildMoveUpgradeUpdates } from "@/features/arena/moveProgression";
import type { UserProfile } from "@/types/profile";

/**
 * Callable-first Move Lab operations (Sync Point move upgrades and combat-kit
 * saves) with the standard legacy client-side fallback for availability only
 * (offline, or functions not yet deployed). Same pattern as economyClient.
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
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  holobotName: string,
  moveTemplateId: string,
  expectedRank: number,
  branchId?: string,
): Promise<void> {
  try {
    await upgradeHolobotMoveCallable({ branchId, expectedRank, holobotName, moveTemplateId });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildMoveUpgradeUpdates(profile, holobotName, moveTemplateId, expectedRank, branchId);
  await updateProfile(result.updates);
}

export async function saveHolobotCombatKitAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  holobotName: string,
  slots: [string, string, string, string],
  expectedRevision: number,
): Promise<void> {
  try {
    await saveHolobotCombatKitCallable({ expectedRevision, holobotName, slots });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildKitSaveUpdates(profile, holobotName, slots, expectedRevision);
  await updateProfile(result.updates);
}
