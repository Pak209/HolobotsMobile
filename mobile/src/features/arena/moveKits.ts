import type { ActionCard, CardRequirement, ResolvedSignatureFinisher } from '@/types/arena';
import { createActionCardFromTemplate, STARTER_DECK_BALANCED_IDS } from '@/lib/battleCards/catalog';

/**
 * Canonical combat-kit resolver (arena-card-to-move-implementation-plan.md,
 * with the revised finisher design below).
 *
 * A fighter battles with a fixed kit of four moves — no deck, hand, draw,
 * cycle, or duplicate-copy rules — always one of each category, in order:
 *   slot 1: Strike   slot 2: Defend   slot 3: Combo   slot 4: Finisher
 *
 * The special meter reads as 7 segments and powers BOTH finishers:
 *   - the equipped slot-4 Finisher unlocks at 4/7 of the meter and CONSUMES
 *     the meter when used — the early, lower-damage cash-out;
 *   - the innate Signature Finisher (derived from Holobot identity, never
 *     equipped) unlocks at 7/7 and consumes the full meter — the
 *     full-strength option for players who hold the charge.
 *
 * Moves are resolved from the frozen legacy card catalog for now (Phase 1
 * compatibility layer); the canonical semantics — such as the finisher's
 * 4/7 meter gate — are applied here.
 */

export type CombatKit = {
  /** [strike, defend, combo, finisher] — always 4 unique moves. */
  slots: [ActionCard, ActionCard, ActionCard, ActionCard];
};

/** The special meter is presented as 7 segments (like the stamina bar). */
export const SPECIAL_METER_SEGMENTS = 7;
/** Segments needed to unlock the equipped slot-4 finisher. */
export const FINISHER_UNLOCK_SEGMENTS = 4;
/**
 * Internal meter (0-100) value at which the 4th segment is reached:
 * floor(m * 7 / 100) >= 4 first holds at m = 58.
 */
export const FINISHER_METER_REQUIREMENT = Math.ceil((100 * FINISHER_UNLOCK_SEGMENTS) / SPECIAL_METER_SEGMENTS);

export function getSpecialMeterSegments(specialMeter: number): number {
  return Math.max(
    0,
    Math.min(SPECIAL_METER_SEGMENTS, Math.floor((specialMeter * SPECIAL_METER_SEGMENTS) / 100)),
  );
}

// The equipped finisher is the early meter cash-out: playable from 4/7 of
// the special meter (it consumes the meter on use — see resolveFinisher).
const KIT_FINISHER_REQUIREMENTS: CardRequirement[] = [
  { type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT },
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
    return { ...card, requirements: KIT_FINISHER_REQUIREMENTS };
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

const KIT_SLOT_TYPES = ['strike', 'defense', 'combo', 'finisher'] as const;

/**
 * Builds a valid kit from what the player saved and owns: one move of each
 * category — the first Strike, Defend, Combo, and Finisher found in
 * saved-loadout order (then owned cards), with any gap filled from the
 * universal stock kit. Always returns a kit that passes validateCombatKit.
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

  const chosen: Partial<Record<(typeof KIT_SLOT_TYPES)[number], ActionCard>> = {};

  for (const templateId of orderedCandidates) {
    const move = resolveMove(templateId, nextId());
    if (!move || chosen[move.type]) {
      continue;
    }
    chosen[move.type] = move;
    if (KIT_SLOT_TYPES.every((slotType) => chosen[slotType])) {
      break;
    }
  }

  // The stock kit is part of the candidate list (one move per category), so
  // every category is guaranteed as long as the stock templates exist.
  const slots = KIT_SLOT_TYPES.map((slotType) => {
    const move = chosen[slotType];
    if (!move) {
      throw new Error(`Stock ${slotType} template is missing from the battle catalog.`);
    }
    return move;
  }) as CombatKit['slots'];

  const kit: CombatKit = { slots };
  validateCombatKit(kit);
  return kit;
}

/** Enforces the kit invariants. Throws on violation. */
export function validateCombatKit(kit: CombatKit): void {
  if (kit.slots.length !== 4) {
    throw new Error('A combat kit must contain exactly four moves.');
  }

  const templateIds = new Set(kit.slots.map((move) => move.templateId));
  if (templateIds.size !== 4) {
    throw new Error('A combat kit must contain four unique moves.');
  }

  KIT_SLOT_TYPES.forEach((slotType, index) => {
    if (kit.slots[index].type !== slotType) {
      throw new Error(`Kit slot ${index + 1} must hold a ${slotType} move.`);
    }
  });

  const finisher = kit.slots[3];
  if (
    !finisher.requirements.some(
      (requirement) =>
        requirement.type === 'special_meter' &&
        requirement.operator === 'gte' &&
        Number(requirement.value) === FINISHER_METER_REQUIREMENT,
    )
  ) {
    throw new Error('The kit finisher must carry the 4/7 special-meter gate.');
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
