import { functions, httpsCallable } from "@/config/firebase";
import { type ArenaEntryMethod, type ArenaSettlementInput } from "@/lib/arenaEconomy";
import { toServerActionError } from "@/lib/callables";
import type { UserProfile } from "@/types/profile";

/**
 * Server-authoritative arena entry/settlement. The legacy client-side
 * writes were removed once the callables baked in production — Firestore
 * rules now freeze the economy fields, so only the server can pay.
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
  _profile: UserProfile,
  _uid: string,
  tierId: string,
  paymentMethod: ArenaEntryMethod,
): Promise<void> {
  try {
    await chargeArenaEntryCallable({ paymentMethod, tierId });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function settleArenaBattleAuthoritative(
  _profile: UserProfile,
  _uid: string,
  holobotName: string,
  battleId: string,
  input: ArenaSettlementInput,
): Promise<void> {
  try {
    await settleArenaBattleCallable({ ...input, battleId, holobotName });
  } catch (error) {
    throw toServerActionError(error);
  }
}
