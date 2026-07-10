import type {
  ActionCard,
  ArenaFighter,
  ArmedDefenseTrap,
  BattleState,
  DefenseTrapEffect,
  DefenseTrapTier,
} from '@/types/arena';

export type ArenaCardDisabledReason =
  | 'cooldown'
  | 'stamina'
  | 'combo'
  | 'special_meter'
  | 'opponent_state'
  | 'defense_lock';

export interface ArenaCardAvailability {
  playable: boolean;
  reason?: ArenaCardDisabledReason;
  cooldownTurns?: number;
}

export interface DefenseTrapCardDefinition {
  id: string;
  aliases?: string[];
  name: string;
  type: 'defense';
  tier: DefenseTrapTier;
  staminaCost: number;
  cooldownTurns: number;
  defenseEffect: DefenseTrapEffect;
  damageReduction: number;
  evadeChance: number;
  counterDamageMultiplier: number;
  staminaGain: number;
  specialMeterGain: number;
}

export const DEFENSE_TRAP_CARDS: DefenseTrapCardDefinition[] = [
  {
    id: 'block',
    aliases: ['defense.guardUp', 'defense.coolantFlush', 'defense.safetyProtocol'],
    name: 'Guard Protocol',
    type: 'defense',
    tier: 'common',
    staminaCost: 1,
    cooldownTurns: 2,
    defenseEffect: 'guard',
    damageReduction: 0.5,
    evadeChance: 0,
    counterDamageMultiplier: 0,
    staminaGain: 2,
    specialMeterGain: 6,
  },
  {
    id: 'slip',
    aliases: ['defense.parryWindow', 'defense.reinforcePlating'],
    name: 'Evasion Step',
    type: 'defense',
    tier: 'rare',
    staminaCost: 2,
    cooldownTurns: 3,
    defenseEffect: 'evade',
    damageReduction: 0.5,
    evadeChance: 0.45,
    counterDamageMultiplier: 0,
    staminaGain: 2,
    specialMeterGain: 8,
  },
  {
    id: 'parry',
    aliases: ['defense.firewall'],
    name: 'Counter Guard',
    type: 'defense',
    tier: 'epic',
    staminaCost: 3,
    cooldownTurns: 3,
    defenseEffect: 'counter',
    damageReduction: 0.6,
    evadeChance: 0.25,
    counterDamageMultiplier: 0.55,
    staminaGain: 3,
    specialMeterGain: 10,
  },
  {
    id: 'roll',
    name: 'Perfect Reversal',
    type: 'defense',
    tier: 'legendary',
    staminaCost: 4,
    cooldownTurns: 4,
    defenseEffect: 'perfect_reversal',
    damageReduction: 1,
    evadeChance: 1,
    counterDamageMultiplier: 0.8,
    staminaGain: 4,
    specialMeterGain: 12,
  },
];

const DEFENSE_TRAP_CARD_MAP = Object.fromEntries(
  DEFENSE_TRAP_CARDS.flatMap((card) => [
    [card.id, card] as const,
    ...((card.aliases ?? []).map((alias) => [alias, card] as const)),
  ]),
) as Record<string, DefenseTrapCardDefinition>;

const CARD_COOLDOWN_TURNS: Record<string, number> = {
  flurry: 1,
  ultimate_combo: 1,
};

export function getDefenseTrapCard(card: Pick<ActionCard, 'templateId' | 'type'>): DefenseTrapCardDefinition | null {
  if (card.type !== 'defense') {
    return null;
  }

  return DEFENSE_TRAP_CARD_MAP[card.templateId] ?? null;
}

export function createArmedDefenseTrap(card: ActionCard): ArmedDefenseTrap | null {
  const definition = getDefenseTrapCard(card);
  if (!definition) {
    return null;
  }

  return {
    cardId: card.id,
    templateId: card.templateId,
    name: definition.name,
    tier: definition.tier,
    effect: definition.defenseEffect,
    damageReduction: definition.damageReduction,
    evadeChance: definition.evadeChance,
    counterDamageMultiplier: definition.counterDamageMultiplier,
    cooldownTurns: definition.cooldownTurns,
  };
}

export function getCardCooldownTurns(card: Pick<ActionCard, 'templateId' | 'type'>): number {
  const defenseCard = getDefenseTrapCard(card);
  if (defenseCard) {
    return defenseCard.cooldownTurns;
  }

  if (typeof CARD_COOLDOWN_TURNS[card.templateId] === 'number') {
    return CARD_COOLDOWN_TURNS[card.templateId];
  }

  return card.type === 'defense' ? 2 : 0;
}

export function getRoleCardCooldowns(
  state: BattleState,
  role: 'player' | 'opponent',
): Record<string, number> {
  return role === 'player'
    ? (state.playerCardCooldowns ?? {})
    : (state.opponentCardCooldowns ?? {});
}

export function evaluateCardAvailability(
  state: BattleState,
  role: 'player' | 'opponent',
  card: ActionCard,
): ArenaCardAvailability {
  const fighter = role === 'player' ? state.player : state.opponent;
  const target = role === 'player' ? state.opponent : state.player;
  const cooldownTurns = getRoleCardCooldowns(state, role)[card.templateId] ?? 0;

  if (cooldownTurns > 0) {
    return { playable: false, reason: 'cooldown', cooldownTurns };
  }

  // While a trap is armed only ADDITIONAL defense plays are locked (no
  // stacking). Attacks stay available — resolveAction drops the actor's own
  // trap when they attack. Locking every card here used to deadlock the
  // battle: once both fighters armed traps, neither side had a playable
  // card and the trap could never be consumed.
  if (card.type === 'defense' && fighter.armedDefenseTrap) {
    return { playable: false, reason: 'defense_lock' };
  }

  if (fighter.stamina < card.staminaCost) {
    return { playable: false, reason: 'stamina' };
  }

  for (const requirement of card.requirements) {
    switch (requirement.type) {
      case 'combo':
        if (requirement.operator === 'gte' && fighter.comboCounter < Number(requirement.value)) {
          return { playable: false, reason: 'combo' };
        }
        break;
      case 'special_meter':
        if (requirement.operator === 'gte' && fighter.specialMeter < Number(requirement.value)) {
          return { playable: false, reason: 'special_meter' };
        }
        break;
      case 'stamina':
        if (requirement.operator === 'gte' && fighter.stamina < Number(requirement.value)) {
          return { playable: false, reason: 'stamina' };
        }
        if (requirement.operator === 'lte' && fighter.stamina > Number(requirement.value)) {
          return { playable: false, reason: 'stamina' };
        }
        break;
      case 'opponent_state':
        if (requirement.operator === 'equals' && target.staminaState !== requirement.value) {
          return { playable: false, reason: 'opponent_state' };
        }
        break;
    }
  }

  return { playable: true };
}

export function getPlayableCards(
  state: BattleState,
  role: 'player' | 'opponent',
  cards: ActionCard[],
): ActionCard[] {
  return cards.filter((card) => evaluateCardAvailability(state, role, card).playable);
}

export function tickCooldownMap(cooldowns: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};

  Object.entries(cooldowns).forEach(([templateId, turns]) => {
    const remaining = Math.max(0, turns - 1);
    if (remaining > 0) {
      next[templateId] = remaining;
    }
  });

  return next;
}

export function getCardEfficiency(card: Pick<ActionCard, 'baseDamage' | 'staminaCost'>): number {
  return card.staminaCost > 0 ? card.baseDamage / card.staminaCost : card.baseDamage;
}

export function getFighterHealthPercent(fighter: Pick<ArenaFighter, 'currentHP' | 'maxHP'>): number {
  return fighter.maxHP > 0 ? fighter.currentHP / fighter.maxHP : 0;
}
