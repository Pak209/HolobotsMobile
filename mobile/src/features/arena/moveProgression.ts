import type { CardType } from '@/types/arena';
import type { UserHolobot, UserProfile } from '@/types/profile';
import {
  resolveMove,
  STOCK_KIT_TEMPLATE_IDS,
  validateCombatKit,
  type CombatKit,
  type MoveRank,
} from './moveKits';

// Low-level rank application lives in moveKits (the resolver needs it);
// re-exported here as the public progression surface.
export { applyMoveProgress } from './moveKits';
export type { HolobotMoveProgress, MoveRank } from './moveKits';

/**
 * Sync Point move progression (arena-card-to-move-implementation-plan.md §4).
 *
 * Each Holobot records its own rank/specialization per move template
 * (UserHolobot.moveProgress). Ranks are shallow and predictable:
 *   rank 0: stock behavior (learned by default)
 *   rank 1: small improvement
 *   rank 2: choose one of two tactical specializations
 *   rank 3: deepen the chosen specialization
 *
 * Purchases are authoritative and atomic (upgradeHolobotMove callable, with
 * the standard client fallback); loadout (kit) changes are free.
 */

export const MOVE_RANK_SP_COSTS: Record<1 | 2 | 3, number> = { 1: 25, 2: 60, 3: 120 };

export type SpecializationBranch = { id: string; name: string; description: string };

export const CATEGORY_SPECIALIZATIONS: Record<CardType, [SpecializationBranch, SpecializationBranch]> = {
  strike: [
    { id: 'strike.pressure', name: 'Pressure', description: 'Cheaper to throw: stamina cost -1.' },
    { id: 'strike.power', name: 'Power', description: 'Hits harder: +20% damage.' },
  ],
  defense: [
    { id: 'defense.safety', name: 'Safety', description: 'Easier stance: stamina cost -1.' },
    { id: 'defense.counter', name: 'Counter', description: 'Sharper reads: +0.25 speed factor.' },
  ],
  combo: [
    { id: 'combo.flow', name: 'Flow', description: 'Smoother chains: stamina cost -1.' },
    { id: 'combo.finish', name: 'Finish', description: 'Bigger payoff: +20% damage.' },
  ],
  finisher: [
    { id: 'finisher.reliable', name: 'Reliable', description: 'Leaner execution: stamina cost -1.' },
    { id: 'finisher.explosive', name: 'Explosive', description: 'All-in payoff: +25% damage.' },
  ],
};

export function isValidSpecialization(category: CardType, branchId: string): boolean {
  return CATEGORY_SPECIALIZATIONS[category].some((branch) => branch.id === branchId);
}

// ---------------------------------------------------------------------------
// Authoritative operation builders (pure; mirrored raw in
// functions/src/lib/moveProgression.ts — holobots and syncPoints use
// identical raw field names on both sides).
// ---------------------------------------------------------------------------

type MoveLabProfile = Pick<UserProfile, 'battle_cards' | 'holobots' | 'syncPoints'>;

function findHolobotIndex(holobots: UserHolobot[], holobotName: string): number {
  const normalized = holobotName.trim().toUpperCase();
  return holobots.findIndex((holobot) => String(holobot.name || '').trim().toUpperCase() === normalized);
}

function isKnownMove(profile: MoveLabProfile, templateId: string): boolean {
  if ((STOCK_KIT_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
    return true;
  }
  return Number(profile.battle_cards?.[templateId] || 0) > 0;
}

export type MoveUpgradeResult = {
  cost: number;
  nextRank: MoveRank;
  updates: { holobots: UserHolobot[]; syncPoints: number };
};

/**
 * Builds the profile updates for a Sync Point move upgrade, throwing a
 * user-readable error when the purchase is invalid. `expectedRank` is the
 * rank the caller believes the move currently has (optimistic check).
 */
export function buildMoveUpgradeUpdates(
  profile: MoveLabProfile,
  holobotName: string,
  moveTemplateId: string,
  expectedRank: number,
  branchId?: string,
): MoveUpgradeResult {
  const holobots = Array.isArray(profile.holobots) ? profile.holobots : [];
  const holobotIndex = findHolobotIndex(holobots, holobotName);
  if (holobotIndex < 0) {
    throw new Error('You do not own that Holobot.');
  }

  const baseMove = resolveMove(moveTemplateId, 'validate');
  if (!baseMove || !isKnownMove(profile, moveTemplateId)) {
    throw new Error("That move is not in this Holobot's pool.");
  }

  const holobot = holobots[holobotIndex];
  const currentProgress = holobot.moveProgress?.[moveTemplateId] ?? { rank: 0 };
  if (Number(currentProgress.rank || 0) !== expectedRank) {
    throw new Error('Move rank changed elsewhere. Reload and try again.');
  }
  if (Number(currentProgress.rank || 0) >= 3) {
    throw new Error('That move is already at max rank.');
  }

  const nextRank = (Number(currentProgress.rank || 0) + 1) as MoveRank;
  const cost = MOVE_RANK_SP_COSTS[nextRank as 1 | 2 | 3];
  const balance = Number(profile.syncPoints || 0);
  if (balance < cost) {
    throw new Error(`Not enough Sync Points (need ${cost}).`);
  }

  let specializationId = currentProgress.specializationId;
  if (nextRank === 2) {
    if (!branchId || !isValidSpecialization(baseMove.type, branchId)) {
      throw new Error('Choose a specialization branch for rank 2.');
    }
    specializationId = branchId;
  } else if (branchId && branchId !== specializationId) {
    throw new Error('Specialization can only be chosen at rank 2.');
  }

  const nextHolobot: UserHolobot = {
    ...holobot,
    moveProgress: {
      ...(holobot.moveProgress || {}),
      [moveTemplateId]: specializationId ? { rank: nextRank, specializationId } : { rank: nextRank },
    },
    moveSystemVersion: 1,
  };
  const nextHolobots = [...holobots];
  nextHolobots[holobotIndex] = nextHolobot;

  return {
    cost,
    nextRank,
    updates: { holobots: nextHolobots, syncPoints: balance - cost },
  };
}

export type KitSaveResult = {
  revision: number;
  updates: { holobots: UserHolobot[] };
};

/**
 * Builds the profile updates for saving a Holobot's combat kit (loadout
 * changes are free). Validates slot categories/uniqueness via the kit
 * validator, ownership of every move, and the optimistic revision.
 */
export function buildKitSaveUpdates(
  profile: MoveLabProfile,
  holobotName: string,
  slots: [string, string, string, string],
  expectedRevision: number,
): KitSaveResult {
  const holobots = Array.isArray(profile.holobots) ? profile.holobots : [];
  const holobotIndex = findHolobotIndex(holobots, holobotName);
  if (holobotIndex < 0) {
    throw new Error('You do not own that Holobot.');
  }

  const holobot = holobots[holobotIndex];
  const currentRevision = holobot.combatKit?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new Error('Kit changed elsewhere. Reload and try again.');
  }

  const resolved = slots.map((templateId) => {
    if (!isKnownMove(profile, templateId)) {
      throw new Error('You can only equip moves you own.');
    }
    const move = resolveMove(templateId, `save-${templateId}`);
    if (!move) {
      throw new Error('Unknown move.');
    }
    return move;
  });

  validateCombatKit({ slots: resolved as CombatKit['slots'] });

  const revision = currentRevision + 1;
  const nextHolobots = [...holobots];
  nextHolobots[holobotIndex] = {
    ...holobot,
    combatKit: { slots: [...slots] as [string, string, string, string], revision },
    moveSystemVersion: 1,
  };

  return { revision, updates: { holobots: nextHolobots } };
}
