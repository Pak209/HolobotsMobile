import { functions, httpsCallable } from "@/config/firebase";
import { shouldFallBackToLocal } from "@/lib/callables";
import { incrementBoosterPacksToday } from "@/lib/dailyMissions";
import {
  buildPackGrantUpdates,
  buildPackRewards,
  GACHA_PACKS,
  type GachaGrantedItem,
  type GachaPackId,
} from "@/lib/gacha";
import {
  buildBoosterPurchaseUpdates,
  buildItemPurchaseUpdates,
  buildPartPurchaseUpdates,
  type BoosterGrantSummary,
  type MarketplaceBoosterId,
} from "@/lib/marketplace";
import type { UserProfile } from "@/types/profile";

/**
 * Callable-first gacha/marketplace actions with a legacy client-side
 * fallback for availability only (offline, or functions not yet deployed).
 * Once the callables bake in production, the fallbacks are scheduled for
 * removal together with the client's Firestore economy write permissions
 * (SECURITY_AUDIT.md C2/C3).
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

export async function openGachaPackAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  packId: GachaPackId,
): Promise<{ items: GachaGrantedItem[] }> {
  try {
    const result = await openGachaPackCallable({ packId });
    return { items: result.data.items };
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  // Legacy client-side path (pre-deploy / offline).
  const pack = GACHA_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) {
    throw new Error("Unknown gacha pack.");
  }
  const tickets = Number(profile.gachaTickets || 0);
  if (tickets < pack.price) {
    throw new Error("Not enough Gacha Tickets.");
  }

  const items = buildPackRewards(packId);
  const grantUpdates = buildPackGrantUpdates(profile, items);

  await updateProfile({
    ...grantUpdates,
    gachaTickets: Math.max(0, tickets - pack.price),
    pack_history: [
      {
        id: `gacha_${packId}_${Date.now()}`,
        items: items.map((item) => ({ name: item.label, rarity: item.rarity })),
        openedAt: new Date().toISOString(),
        packId,
      },
      ...(profile.pack_history || []),
    ].slice(0, 50),
    rewardSystem: incrementBoosterPacksToday(profile.rewardSystem),
  });

  return { items };
}

export async function purchaseMarketplaceItemAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  itemName: string,
): Promise<void> {
  try {
    await purchaseItemCallable({ itemName });
    return;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildItemPurchaseUpdates(profile, itemName);
  if (!result) {
    throw new Error("Not enough Holos.");
  }
  await updateProfile(result.updates);
}

export async function purchaseMarketplacePartAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
  partId: string,
): Promise<{ name: string; rarity: string; slot: string }> {
  try {
    const result = await purchasePartCallable({ partId });
    return result.data.part;
  } catch (error) {
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildPartPurchaseUpdates(profile, partId);
  if (!result) {
    throw new Error("Not enough Holos.");
  }
  await updateProfile(result.updates);
  return result.part;
}

export type { BoosterGrantSummary } from "@/lib/marketplace";

export async function purchaseMarketplaceBoosterAuthoritative(
  profile: UserProfile,
  updateProfile: UpdateProfileFn,
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
    if (!shouldFallBackToLocal(error)) {
      throw error;
    }
  }

  const result = buildBoosterPurchaseUpdates(profile, packId);
  if (!result) {
    throw new Error("Not enough Holos.");
  }
  await updateProfile(result.updates);
  return result.granted;
}
