import type { ActionCard, CardRequirement, ResolvedSignatureFinisher } from '@/types/arena';
import { createActionCardFromTemplate, STARTER_DECK_BALANCED_IDS } from '@/lib/battleCards/catalog';

/**
 * Canonical combat-kit resolver (arena-card-to-move-implementation-plan.md).
 *
 * A fighter battles with a fixed kit of four moves — no deck, hand, draw,
 * cycle, or duplicate-copy rules:
 *   slots 1–3: strike / defend / combo moves
 *   slot 4:    exactly one Technique Finisher (stamina + combo gated;
 *              never requires or consumes special meter)
 * plus one innate Signature Finisher derived from Holobot identity and
 * available only at exactly 100 special meter.
 *
 * Moves are resolved from the frozen legacy card catalog for now (Phase 1
 * compatibility layer); the canonical semantics — such as technique
 * finishers replacing the meter gate with a combo gate — are applied here.
 */

export type CombatKit = {
  /** [strike/defend/combo ×3, technique finisher] — always 4 unique moves. */
  slots: [ActionCard, ActionCard, ActionCard, ActionCard];
};

// Technique Finishers cap a pressure sequence: they demand an active chain
// and stamina, and work at any special-meter value (plan §6.1).
const TECHNIQUE_FINISHER_REQUIREMENTS: CardRequirement[] = [
  { type: 'combo', operator: 'gte', value: 2 },
];

// Universal stock kit: every fighter can always form a legal kit from these
// (plan §1 invariant 7). Archetype/exclusive stock variants are Phase 4.
export const STOCK_KIT_TEMPLATE_IDS = [
  'strike.quickJab',
  'defense.guardUp',
  'combo.chainBurst',
  'finisher.tacticalOverride',
] as const;

export function resolveMove(templateId: string, instanceId: string): ActionCard | null {
  const card = createActionCardFromTemplate(templateId, instanceId);
  if (!card) {
    return null;
  }

  if (card.type === 'finisher') {
    return { ...card, requirements: TECHNIQUE_FINISHER_REQUIREMENTS };
  }

  return card;
}

export type ResolveKitOptions = {
  /** Saved loadout order (arena_deck_template_ids); highest priority. */
  deckTemplateIds?: string[] | null;
  /** Owned collection (battle_cards); fallback source after the loadout. */
  ownedBattleCards?: Record<string, number> | null;
  /** Prefix for generated move instance ids (keeps both fighters' ids distinct). */
  idPrefix?: string;
};

/**
 * Builds a valid kit from what the player saved and owns (plan §9.6–9.8):
 * slots 1–3 take the first three distinct compatible non-finisher moves in
 * saved-loadout order, slot 4 takes the first owned Technique Finisher, and
 * any gap is filled from the universal stock kit. Always returns a kit that
 * passes validateCombatKit.
 */
export function resolveCombatKit(options: ResolveKitOptions = {}): CombatKit {
  const idPrefix = options.idPrefix ?? 'kit';
  let instanceCounter = 0;
  const nextId = () => `${idPrefix}-move-${(instanceCounter += 1)}`;

  const orderedCandidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (templateId: string) => {
    if (!seen.has(templateId)) {
      seen.add(templateId);
      orderedCandidates.push(templateId);
    }
  };

  (options.deckTemplateIds || []).forEach(pushCandidate);
  Object.entries(options.ownedBattleCards || {})
    .filter(([, quantity]) => Number(quantity) > 0)
    .forEach(([templateId]) => pushCandidate(templateId));
  STOCK_KIT_TEMPLATE_IDS.forEach(pushCandidate);

  const normalSlots: ActionCard[] = [];
  let techniqueFinisher: ActionCard | null = null;

  for (const templateId of orderedCandidates) {
    const move = resolveMove(templateId, nextId());
    if (!move) {
      continue;
    }

    if (move.type === 'finisher') {
      if (!techniqueFinisher) {
        techniqueFinisher = move;
      }
      continue;
    }

    if (normalSlots.length < 3) {
      normalSlots.push(move);
    }

    if (normalSlots.length === 3 && techniqueFinisher) {
      break;
    }
  }

  // The stock kit is part of the candidate list, so both of these are
  // guaranteed as long as the stock templates exist in the catalog.
  while (normalSlots.length < 3) {
    const fallback = resolveMove(STOCK_KIT_TEMPLATE_IDS[normalSlots.length], nextId());
    if (!fallback) {
      throw new Error('Stock kit templates are missing from the battle catalog.');
    }
    normalSlots.push(fallback);
  }
  if (!techniqueFinisher) {
    throw new Error('Stock technique finisher is missing from the battle catalog.');
  }

  const kit: CombatKit = {
    slots: [normalSlots[0], normalSlots[1], normalSlots[2], techniqueFinisher],
  };
  validateCombatKit(kit);
  return kit;
}

/** Enforces the non-negotiable kit invariants (plan §1). Throws on violation. */
export function validateCombatKit(kit: CombatKit): void {
  if (kit.slots.length !== 4) {
    throw new Error('A combat kit must contain exactly four moves.');
  }

  const templateIds = new Set(kit.slots.map((move) => move.templateId));
  if (templateIds.size !== 4) {
    throw new Error('A combat kit must contain four unique moves.');
  }

  kit.slots.slice(0, 3).forEach((move) => {
    if (move.type === 'finisher') {
      throw new Error('Slots 1–3 cannot hold a Technique Finisher.');
    }
  });

  const finisher = kit.slots[3];
  if (finisher.type !== 'finisher') {
    throw new Error('Slot 4 must hold a Technique Finisher.');
  }
  if (finisher.requirements.some((requirement) => requirement.type === 'special_meter')) {
    throw new Error('A Technique Finisher must not require special meter.');
  }
}

// ---------------------------------------------------------------------------
// Signature Finishers — innate identity, never equipped or drawn (plan §6.2).
// Names come from the established Holobot special-move identities; per-bot
// damage/effect differentiation is Phase 4 content work.
// ---------------------------------------------------------------------------

const SIGNATURE_BASE_DAMAGE = 38;

const SIGNATURE_FINISHERS: Record<string, ResolvedSignatureFinisher> = {
  ACE: { id: 'signature.ace', name: '1st Strike', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  KUMA: { id: 'signature.kuma', name: 'Sharp Claws', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  SHADOW: { id: 'signature.shadow', name: 'Shadow Strike', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  ERA: { id: 'signature.era', name: 'Time Warp', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  HARE: { id: 'signature.hare', name: 'Counter Claw', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  TORA: { id: 'signature.tora', name: 'Stalk', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  WAKE: { id: 'signature.wake', name: 'Torrent', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  GAMA: { id: 'signature.gama', name: 'Heavy Leap', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  KEN: { id: 'signature.ken', name: 'Blade Storm', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  KURAI: { id: 'signature.kurai', name: 'Dark Veil', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  TSUIN: { id: 'signature.tsuin', name: 'Twin Strike', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
  WOLF: { id: 'signature.wolf', name: 'Lunar Howl', baseDamage: SIGNATURE_BASE_DAMAGE, animationId: 'finisher_signature' },
};

const FALLBACK_SIGNATURE: ResolvedSignatureFinisher = {
  id: 'signature.generic',
  name: 'Arena Burst',
  baseDamage: SIGNATURE_BASE_DAMAGE,
  animationId: 'finisher_signature',
};

export function getSignatureFinisher(holobotName: string): ResolvedSignatureFinisher {
  return SIGNATURE_FINISHERS[holobotName.trim().toUpperCase()] ?? FALLBACK_SIGNATURE;
}
