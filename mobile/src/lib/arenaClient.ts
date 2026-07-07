import { db, doc, functions, httpsCallable, updateDoc } from "@/config/firebase";
import {
  buildArenaEntryUpdates,
  buildArenaSettlementUpdates,
  type ArenaEntryMethod,
  type ArenaSettlementInput,
} from "@/lib/arenaEconomy";
import { shouldFallBackToLocal } from "@/lib/callables";
import type { UserProfile } from "@/types/profile";

/**
 * Callable-first arena entry/settlement with the legacy client-side write
 * as an availability-only fallback (offline, or functions not yet
 * deployed). Same removal schedule as the other economy fallbacks.
 */

const chargeArenaEntryCallable = httpsCallable<
  { paymentMethod: ArenaEntryMethod; tierId: string },
  { arenaPasses: number; holosTokens: number }
>(functions, "chargeArenaEntry");

const settleArenaBattleCallable = httpsCallable<
  ArenaSettlementInput & { battleId: string; holobotName: string },
  { alreadyProcessed: boolean }
>(functions, "settleArenaBattle");

export async function chargeArenaEntryAuthoritative(
  profile: UserProfile,
  uid: string,
  tierId: string,
  paymentMethod: ArenaEntryMethod,
): Promise<void> {
  try {
    await chargeArenaEntryCallable({ paymentMethod, tierId });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const updates = buildArenaEntryUpdates(profile, tierId, paymentMethod);
  if (!updates) {
    throw new Error(paymentMethod === "pass" ? "No Arena Passes available." : "Not enough Holos.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches profile.ts updateDoc idiom
  await updateDoc(doc(db, "users", uid), updates as any);
}

export async function settleArenaBattleAuthoritative(
  profile: UserProfile,
  uid: string,
  holobotName: string,
  battleId: string,
  input: ArenaSettlementInput,
): Promise<void> {
  try {
    await settleArenaBattleCallable({ ...input, battleId, holobotName });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildArenaSettlementUpdates(profile, holobotName, input);
  if (!result) {
    throw new Error("Unknown arena tier.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches profile.ts updateDoc idiom
  await updateDoc(doc(db, "users", uid), result.updates as any);
}
