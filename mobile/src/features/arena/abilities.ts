import type {
  AbilityCondition,
  AbilityDefinition,
  AbilityTrigger,
  ArenaFighter,
} from '@/types/arena';

/**
 * Innate Abilities (arena-card-to-move-implementation-plan.md §5, Phase 4).
 *
 * One per Holobot, always active from battle start, visible to both players,
 * never equipped/drawn/purchased/ranked. Every ability is data: a shared
 * trigger, typed conditions, small bounded effects, and a charge rule. The
 * engine fires them through fireAbility below — there are no per-Holobot
 * code paths, and the content validation suite enforces the bounds
 * (abilities.test.ts).
 *
 * Guardrail: stamina-restoring abilities must not be unlimited (no
 * net-positive stamina loops) — enforced by the validation suite.
 */

export const HOLOBOT_ABILITIES: Record<string, AbilityDefinition> = {
  ACE: {
    id: 'ability.ace',
    holobotName: 'ACE',
    name: 'First Strike Protocol',
    description: 'The first landed hit of the battle grants +12 special meter.',
    trigger: 'after_hit',
    conditions: [],
    effects: [{ type: 'special_meter', value: 12 }],
    charges: { kind: 'once_per_battle' },
    aiHints: ['open_aggressively'],
  },
  KUMA: {
    id: 'ability.kuma',
    holobotName: 'KUMA',
    name: 'Sharp Claws',
    description: 'Hits landed with a chain of 2+ grant +4 special meter.',
    trigger: 'after_hit',
    conditions: [{ type: 'combo_at_least', value: 2 }],
    effects: [{ type: 'special_meter', value: 4 }],
    charges: { kind: 'unlimited' },
    aiHints: ['extend_chains'],
  },
  SHADOW: {
    id: 'ability.shadow',
    holobotName: 'SHADOW',
    name: 'Shadow Recovery',
    description: 'A successful counter restores +1 stamina (every 4 actions).',
    trigger: 'on_counter',
    conditions: [],
    effects: [{ type: 'stamina_gain', value: 1 }],
    charges: { kind: 'cooldown_actions', actions: 4 },
    aiHints: ['favor_counter_traps'],
  },
  ERA: {
    id: 'ability.era',
    holobotName: 'ERA',
    name: 'Time Warp',
    description: 'Starts every battle with +25 special meter already charged.',
    trigger: 'battle_start',
    conditions: [],
    effects: [{ type: 'special_meter', value: 25 }],
    charges: { kind: 'once_per_battle' },
    aiHints: ['rush_finisher'],
  },
  HARE: {
    id: 'ability.hare',
    holobotName: 'HARE',
    name: 'Counter Claw',
    description: 'Every successful counter or evade grants +8 special meter.',
    trigger: 'on_counter',
    conditions: [],
    effects: [{ type: 'special_meter', value: 8 }],
    charges: { kind: 'unlimited' },
    aiHints: ['favor_counter_traps'],
  },
  TORA: {
    id: 'ability.tora',
    holobotName: 'TORA',
    name: 'Stalk',
    description: 'Arming a defense grants +5 special meter.',
    trigger: 'after_defend',
    conditions: [],
    effects: [{ type: 'special_meter', value: 5 }],
    charges: { kind: 'unlimited' },
    aiHints: ['patient_defense'],
  },
  WAKE: {
    id: 'ability.wake',
    holobotName: 'WAKE',
    name: 'Torrent',
    description: 'Hits landed while fresh (5+ stamina) grant +3 special meter.',
    trigger: 'after_hit',
    conditions: [{ type: 'stamina_at_least', value: 5 }],
    effects: [{ type: 'special_meter', value: 3 }],
    charges: { kind: 'unlimited' },
    aiHints: ['press_while_fresh'],
  },
  GAMA: {
    id: 'ability.gama',
    holobotName: 'GAMA',
    name: 'Heavy Leap',
    description: 'Taking a heavy hit (15+) restores +2 stamina (every 6 actions).',
    trigger: 'on_damaged',
    conditions: [{ type: 'damage_at_least', value: 15 }],
    effects: [{ type: 'stamina_gain', value: 2 }],
    charges: { kind: 'cooldown_actions', actions: 6 },
    aiHints: ['tank_trades'],
  },
  KEN: {
    id: 'ability.ken',
    holobotName: 'KEN',
    name: 'Blade Storm',
    description: 'Hits landed with a chain of 3+ grant +6 special meter.',
    trigger: 'after_hit',
    conditions: [{ type: 'combo_at_least', value: 3 }],
    effects: [{ type: 'special_meter', value: 6 }],
    charges: { kind: 'unlimited' },
    aiHints: ['extend_chains'],
  },
  KURAI: {
    id: 'ability.kurai',
    holobotName: 'KURAI',
    name: 'Dark Veil',
    description: 'Once per battle, taking a hit below 40% HP restores 8 HP.',
    trigger: 'on_damaged',
    conditions: [{ type: 'hp_below_percent', value: 0.4 }],
    effects: [{ type: 'heal', value: 8 }],
    charges: { kind: 'once_per_battle' },
    aiHints: ['clutch_survivor'],
  },
  TSUIN: {
    id: 'ability.tsuin',
    holobotName: 'TSUIN',
    name: 'Twin Rhythm',
    description: 'Every landed hit grants +2 special meter.',
    trigger: 'after_hit',
    conditions: [],
    effects: [{ type: 'special_meter', value: 2 }],
    charges: { kind: 'unlimited' },
    aiHints: ['steady_pressure'],
  },
  WOLF: {
    id: 'ability.wolf',
    holobotName: 'WOLF',
    name: 'Lunar Howl',
    description: 'Hits landed while gassed (under 3 stamina) restore +1 stamina (every 2 actions).',
    trigger: 'after_hit',
    conditions: [{ type: 'stamina_below', value: 3 }],
    effects: [{ type: 'stamina_gain', value: 1 }],
    charges: { kind: 'cooldown_actions', actions: 2 },
    aiHints: ['second_wind'],
  },
};

const FALLBACK_ABILITY: AbilityDefinition = {
  id: 'ability.generic',
  holobotName: 'GENERIC',
  name: 'Combat Routine',
  description: 'Every landed hit grants +1 special meter.',
  trigger: 'after_hit',
  conditions: [],
  effects: [{ type: 'special_meter', value: 1 }],
  charges: { kind: 'unlimited' },
  aiHints: [],
};

export function getAbility(holobotName: string): AbilityDefinition {
  return HOLOBOT_ABILITIES[holobotName.trim().toUpperCase()] ?? FALLBACK_ABILITY;
}

// ---------------------------------------------------------------------------
// Trigger evaluation (called by ArenaCombatEngine at its trigger points).
// ---------------------------------------------------------------------------

export type AbilityTriggerContext = {
  /** Damage relevant to the trigger (dealt for after_hit, taken for on_damaged). */
  damage?: number;
  /** Chain length relevant to the trigger. */
  comboCount?: number;
  /** Global battle action counter, used for cooldown charges. */
  turnNumber: number;
};

function conditionHolds(
  condition: AbilityCondition,
  fighter: ArenaFighter,
  context: AbilityTriggerContext,
): boolean {
  switch (condition.type) {
    case 'stamina_below':
      return fighter.stamina < condition.value;
    case 'stamina_at_least':
      return fighter.stamina >= condition.value;
    case 'hp_below_percent':
      return fighter.maxHP > 0 && fighter.currentHP / fighter.maxHP < condition.value;
    case 'combo_at_least':
      return (context.comboCount ?? 0) >= condition.value;
    case 'damage_at_least':
      return (context.damage ?? 0) >= condition.value;
    default:
      return false;
  }
}

function chargesAvailable(fighter: ArenaFighter, context: AbilityTriggerContext): boolean {
  const ability = fighter.ability;
  const runtime = fighter.abilityRuntime ?? { firedCount: 0 };
  if (!ability) {
    return false;
  }

  switch (ability.charges.kind) {
    case 'unlimited':
      return true;
    case 'once_per_battle':
      return runtime.firedCount < 1;
    case 'cooldown_actions':
      return (
        runtime.lastFiredAtTurn === undefined ||
        context.turnNumber - runtime.lastFiredAtTurn >= ability.charges.actions
      );
    default:
      return false;
  }
}

/**
 * Fires the fighter's ability for a trigger if its conditions and charges
 * allow, mutating the fighter's resources and abilityRuntime in place (the
 * engine passes its already-cloned fighters). Returns the ability when it
 * fired, so callers can surface it.
 */
export function fireAbility(
  fighter: ArenaFighter,
  trigger: AbilityTrigger,
  context: AbilityTriggerContext,
): AbilityDefinition | null {
  const ability = fighter.ability;
  if (!ability || ability.trigger !== trigger) {
    return null;
  }
  if (!chargesAvailable(fighter, context)) {
    return null;
  }
  if (!ability.conditions.every((condition) => conditionHolds(condition, fighter, context))) {
    return null;
  }

  for (const effect of ability.effects) {
    switch (effect.type) {
      case 'special_meter':
        fighter.specialMeter = Math.max(0, Math.min(100, fighter.specialMeter + effect.value));
        break;
      case 'stamina_gain':
        fighter.stamina = Math.min(fighter.maxStamina, fighter.stamina + effect.value);
        break;
      case 'heal':
        fighter.currentHP = Math.min(fighter.maxHP, fighter.currentHP + effect.value);
        break;
      default:
        break;
    }
  }

  fighter.abilityRuntime = {
    firedCount: (fighter.abilityRuntime?.firedCount ?? 0) + 1,
    lastFiredAtTurn: context.turnNumber,
  };

  return ability;
}
