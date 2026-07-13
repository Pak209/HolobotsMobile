import { functions, httpsCallable } from "@/config/firebase";
import { toServerActionError } from "@/lib/callables";
import { type GachaGrantedItem, type GachaPackId } from "@/lib/gacha";
import { type BoosterGrantSummary, type MarketplaceBoosterId } from "@/lib/marketplace";
import type { UserProfile } from "@/types/profile";

/**
 * Server-authoritative gacha/marketplace/mission actions. The legacy
 * client-side fallbacks were removed on 2026-07-12 together with the rules
 * freeze on economy fields (SECURITY_AUDIT.md C2/C3): the server is the
 * only writer of currency, items, and loot.
 */

type UpdateProfileFn = (updates: Record<string, unknown>) => Promise<void>;

const openGachaPackCallable = httpsCallable<
  { packId: GachaPackId },
  { gachaTickets: number; items: GachaGrantedItem[] }
>(functions, "openGachaPack");

const purchaseItemCallable = httpsCallable<
  { itemName: string },
  { holosTokens: number; itemName: string; price: number }
>(functions, "purchaseMarketplaceItem");

const purchasePartCallable = httpsCallable<
  { partId: string },
  {
    holosTokens: number;
    part: { name: string; rarity: string; slot: string };
    price: number;
  }
>(functions, "purchaseMarketplacePart");

const purchaseBoosterCallable = httpsCallable<
  { packId: MarketplaceBoosterId },
  {
    // God-pack fields are optional so responses from a not-yet-redeployed
    // callable still parse; the wrapper below normalizes them.
    granted: {
      battleCardId: string;
      battleCardIds?: string[];
      godPack?: boolean;
      itemName: string;
      itemQuantity?: number;
      part: { name: string; slot: string };
      parts?: Array<{ name: string; slot: string }>;
    };
    holosTokens: number;
    price: number;
  }
>(functions, "purchaseMarketplaceBooster");

const claimDailyMissionCallable = httpsCallable<
  { missionId: string },
  { gachaTickets: number; holosTokens: number; missionId: string }
>(functions, "claimDailyMission");

export async function openGachaPackAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  packId: GachaPackId,
): Promise<{ items: GachaGrantedItem[] }> {
  try {
    const result = await openGachaPackCallable({ packId });
    return { items: result.data.items };
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function purchaseMarketplaceItemAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  itemName: string,
): Promise<void> {
  try {
    await purchaseItemCallable({ itemName });
  } catch (error) {
    throw toServerActionError(error);
  }
}

export async function purchaseMarketplacePartAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  partId: string,
): Promise<{ name: string; rarity: string; slot: string }> {
  try {
    const result = await purchasePartCallable({ partId });
    return result.data.part;
  } catch (error) {
    throw toServerActionError(error);
  }
}

export type { BoosterGrantSummary } from "@/lib/marketplace";

export async function purchaseMarketplaceBoosterAuthoritative(
  _profile: UserProfile,
  _updateProfile: UpdateProfileFn,
  packId: MarketplaceBoosterId,
): Promise<BoosterGrantSummary> {
  try {
    const result = await purchaseBoosterCallable({ packId });
    const granted = result.data.granted;
    return {
      ...granted,
      battleCardIds: granted.battleCardIds ?? [granted.battleCardId],
      godPack: granted.godPack ?? false,
      itemName: granted.itemName as BoosterGrantSummary["itemName"],
      itemQuantity: granted.itemQuantity ?? 1,
      parts: granted.parts ?? [granted.part],
    };
  } catch (error) {
    throw toServerActionError(error);
  }
}

/** Daily mission claims pay from the server-side table; the progress
    counters they validate against are themselves server-incremented. */
export async function claimDailyMissionAuthoritative(
  missionId: string,
): Promise<{ gachaTickets: number; holosTokens: number }> {
  try {
    const result = await claimDailyMissionCallable({ missionId });
    return { gachaTickets: result.data.gachaTickets, holosTokens: result.data.holosTokens };
  } catch (error) {
    throw toServerActionError(error);
  }
}
