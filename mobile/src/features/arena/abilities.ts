import type {
  AbilityCondition,
  AbilityDefinition,
  AbilityRuleBend,
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
    description: "ACE's first attack into an armed trap pierces it clean — the trap neither triggers nor breaks.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'once_per_battle' },
    ruleBend: { kind: 'pierce_traps_first_attack' },
    aiHints: ['open_aggressively', 'ignore_first_trap'],
  },
  KUMA: {
    id: 'ability.kuma',
    holobotName: 'KUMA',
    name: 'Sharp Claws',
    description: "KUMA's combo chain survives blocked hits — only counters and evades can break it.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'chain_survives_block' },
    aiHints: ['extend_chains', 'chain_through_guards'],
  },
  SHADOW: {
    id: 'ability.shadow',
    holobotName: 'SHADOW',
    name: 'Shadow Recovery',
    description: 'SHADOW keeps its armed trap through the first attack after arming it — pressure while the trap still waits.',
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'guard_holds_through_first_attack' },
    aiHints: ['favor_counter_traps', 'attack_while_guarded'],
  },
  ERA: {
    id: 'ability.era',
    holobotName: 'ERA',
    name: 'Time Warp',
    description: "ERA's special meter never drops below 25 — battles start there, and every finisher resets to 25 instead of 0.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'meter_floor', value: 25 },
    aiHints: ['rush_finisher'],
  },
  HARE: {
    id: 'ability.hare',
    holobotName: 'HARE',
    name: 'Counter Claw',
    description: "HARE's defense traps trigger twice before they are spent — one stance covers two incoming hits.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'trap_extra_charge' },
    aiHints: ['favor_counter_traps'],
  },
  TORA: {
    id: 'ability.tora',
    holobotName: 'TORA',
    name: 'Stalk',
    description: "TORA's kit finisher consumes only the 4/7 meter it requires — the rest stays banked toward the signature.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'finisher_costs_requirement_only' },
    aiHints: ['patient_defense', 'meter_efficiency'],
  },
  WAKE: {
    id: 'ability.wake',
    holobotName: 'WAKE',
    name: 'Torrent',
    description: 'At full stamina, WAKE\'s next move costs 1 less — overflow pressure from a full tank.',
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'full_stamina_discount', value: 1 },
    aiHints: ['press_while_fresh'],
  },
  GAMA: {
    id: 'ability.gama',
    holobotName: 'GAMA',
    name: 'Heavy Leap',
    description: 'GAMA never takes more than 20% of its max HP from a single hit — burst damage splashes off it.',
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'max_hit_percent_cap', value: 0.2 },
    aiHints: ['tank_trades', 'ignore_enemy_finishers'],
  },
  KEN: {
    id: 'ability.ken',
    holobotName: 'KEN',
    name: 'Blade Storm',
    description: "KEN's combo chain survives cashing a combo — the multiplier keeps climbing until a hit is stopped.",
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'chain_survives_combo_cash' },
    aiHints: ['extend_chains'],
  },
  KURAI: {
    id: 'ability.kurai',
    holobotName: 'KURAI',
    name: 'Dark Veil',
    description: 'Below 40% HP, KURAI heals a quarter of the damage it deals (up to 30 HP per battle).',
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'lifesteal_below_percent', threshold: 0.4, ratio: 0.25, battleCap: 30 },
    aiHints: ['clutch_survivor', 'press_when_hurt'],
  },
  TSUIN: {
    id: 'ability.tsuin',
    holobotName: 'TSUIN',
    name: 'Twin Rhythm',
    description: 'Landed hits grant bonus special meter equal to half the damage dealt.',
    trigger: 'after_hit',
    conditions: [],
    effects: [{ type: 'special_meter_from_damage', value: 0.5 }],
    charges: { kind: 'unlimited' },
    aiHints: ['steady_pressure', 'press_damage'],
  },
  WOLF: {
    id: 'ability.wolf',
    holobotName: 'WOLF',
    name: 'Lunar Howl',
    description: 'WOLF ignores gassed and exhausted damage penalties — it hits at full power on an empty tank.',
    trigger: 'passive',
    conditions: [],
    effects: [],
    charges: { kind: 'unlimited' },
    ruleBend: { kind: 'ignore_stamina_damage_penalty' },
    aiHints: ['second_wind', 'spend_freely'],
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

/** Returns the fighter's rule bend of the given kind, if any. */
export function getRuleBend<K extends AbilityRuleBend['kind']>(
  fighter: Pick<ArenaFighter, 'ability'>,
  kind: K,
): Extract<AbilityRuleBend, { kind: K }> | null {
  const bend = fighter.ability?.ruleBend;
  return bend && bend.kind === kind ? (bend as Extract<AbilityRuleBend, { kind: K }>) : null;
}

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

// The meter economy is flat everywhere else (+10 strike / +14 combo), so a
// damage-proportional ability proc is bounded to keep one identity from
// breaking the pacing.
const SPECIAL_METER_DAMAGE_PROC_CAP = 12;

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
      case 'special_meter_from_damage': {
        const bonus = Math.min(
          SPECIAL_METER_DAMAGE_PROC_CAP,
          Math.floor((context.damage ?? 0) * effect.value),
        );
        fighter.specialMeter = Math.max(0, Math.min(100, fighter.specialMeter + bonus));
        break;
      }
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
