import { describe, expect, it } from 'vitest';

import { HOLOBOT_NAMES } from '@/lib/progression';
import { getSignatureFinisher } from '../moveKits';
import { fireAbility, getAbility, HOLOBOT_ABILITIES } from '../abilities';
import type { AbilityDefinition, ArenaFighter } from '@/types/arena';

const ALLOWED_TRIGGERS = ['battle_start', 'after_hit', 'after_defend', 'on_counter', 'on_damaged', 'passive'];
const ALLOWED_BENDS = [
  'pierce_traps_first_attack',
  'chain_survives_block',
  'guard_holds_through_first_attack',
  'meter_floor',
  'trap_extra_charge',
  'finisher_costs_requirement_only',
  'full_stamina_discount',
  'max_hit_percent_cap',
  'chain_survives_combo_cash',
  'lifesteal_below_percent',
  'ignore_stamina_damage_penalty',
];
const ALLOWED_EFFECTS = ['special_meter', 'special_meter_from_damage', 'stamina_gain', 'heal'];

// Effect bounds: strong enough to shape play, never strong enough to decide
// a match on their own (plan §5). special_meter_from_damage is a multiplier
// (also bounded per proc in fireAbility).
const EFFECT_CAPS: Record<string, number> = {
  heal: 10,
  special_meter: 25,
  special_meter_from_damage: 0.5,
  stamina_gain: 2,
};

function makeFighter(ability: AbilityDefinition, overrides: Partial<ArenaFighter> = {}): ArenaFighter {
  return {
    holobotId: 'f1',
    ownerUserId: 'u1',
    name: ability.holobotName,
    avatar: 'test://avatar',
    archetype: 'balanced',
    level: 1,
    maxHP: 100,
    currentHP: 100,
    attack: 30,
    defense: 30,
    speed: 25,
    intelligence: 25,
    stamina: 6,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: 'fresh',
    isInDefenseMode: false,
    comboCounter: 0,
    lastActionTime: 0,
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    ability,
    abilityRuntime: { firedCount: 0 },
    ...overrides,
  };
}

// Phase 4 content gate: 12x validation of unique identity references and
// bounded, typed content.
describe('ability content validation (12 Holobots)', () => {
  it('every roster Holobot has exactly one ability and one signature, with unique ids', () => {
    const abilityIds = new Set<string>();
    const abilityNames = new Set<string>();

    for (const name of HOLOBOT_NAMES) {
      const ability = HOLOBOT_ABILITIES[name.toUpperCase()];
      expect(ability, `missing ability for ${name}`).toBeTruthy();
      expect(ability.holobotName).toBe(name.toUpperCase());
      abilityIds.add(ability.id);
      abilityNames.add(ability.name);

      const signature = getSignatureFinisher(name);
      expect(signature.id, `generic signature for ${name}`).not.toBe('signature.generic');
    }

    expect(abilityIds.size).toBe(HOLOBOT_NAMES.length);
    expect(abilityNames.size).toBe(HOLOBOT_NAMES.length);
  });

  it('all abilities use shared triggers and bounded typed mechanics', () => {
    for (const ability of Object.values(HOLOBOT_ABILITIES)) {
      expect(ALLOWED_TRIGGERS).toContain(ability.trigger);
      expect(ability.description.length).toBeGreaterThan(10);
      // Every ability acts through at least one shared mechanism.
      expect(ability.effects.length > 0 || Boolean(ability.ruleBend)).toBe(true);

      for (const effect of ability.effects) {
        expect(ALLOWED_EFFECTS).toContain(effect.type);
        expect(effect.value).toBeGreaterThan(0);
        expect(effect.value).toBeLessThanOrEqual(EFFECT_CAPS[effect.type]);
      }

      if (ability.ruleBend) {
        expect(ALLOWED_BENDS).toContain(ability.ruleBend.kind);
      }
    }
  });

  it('rule bends stay inside their balance bounds', () => {
    const bends = Object.values(HOLOBOT_ABILITIES)
      .map((ability) => ability.ruleBend)
      .filter((bend): bend is NonNullable<typeof bend> => Boolean(bend));

    // One bend per Holobot, no duplicated rule.
    expect(new Set(bends.map((bend) => bend.kind)).size).toBe(bends.length);

    for (const bend of bends) {
      switch (bend.kind) {
        case 'meter_floor':
          expect(bend.value).toBeLessThanOrEqual(25);
          break;
        case 'max_hit_percent_cap':
          expect(bend.value).toBeGreaterThanOrEqual(0.2);
          break;
        case 'full_stamina_discount':
          expect(bend.value).toBeLessThanOrEqual(1);
          break;
        case 'lifesteal_below_percent':
          expect(bend.ratio).toBeLessThanOrEqual(0.25);
          expect(bend.battleCap).toBeLessThanOrEqual(30);
          expect(bend.threshold).toBeLessThanOrEqual(0.5);
          break;
        default:
          break;
      }
    }
  });

  it('stamina-restoring abilities are never unlimited (no stamina loops)', () => {
    for (const ability of Object.values(HOLOBOT_ABILITIES)) {
      const restoresStamina = ability.effects.some((effect) => effect.type === 'stamina_gain');
      if (restoresStamina) {
        expect(ability.charges.kind, `${ability.id} would allow a stamina loop`).not.toBe('unlimited');
      }
    }
  });

  it('getAbility is case-insensitive and falls back safely', () => {
    expect(getAbility('ace').id).toBe('ability.ace');
    expect(getAbility(' wolf ').id).toBe('ability.wolf');
    expect(getAbility('UNKNOWN').id).toBe('ability.generic');
  });
});

describe('fireAbility', () => {
  const meterOnHit = (charges: AbilityDefinition['charges']): AbilityDefinition => ({
    id: 'ability.test',
    holobotName: 'TEST',
    name: 'Test Surge',
    description: 'Test ability that grants meter on hit.',
    trigger: 'after_hit',
    conditions: [],
    effects: [{ type: 'special_meter', value: 12 }],
    charges,
    aiHints: [],
  });

  it('once_per_battle fires exactly once', () => {
    const fighter = makeFighter(meterOnHit({ kind: 'once_per_battle' }));

    expect(fireAbility(fighter, 'after_hit', { turnNumber: 1, damage: 10 })?.id).toBe('ability.test');
    expect(fighter.specialMeter).toBe(12);
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 2, damage: 10 })).toBeNull();
    expect(fighter.specialMeter).toBe(12);
  });

  it('cooldown charges respect the action window', () => {
    const fighter = makeFighter(meterOnHit({ kind: 'cooldown_actions', actions: 2 }));

    expect(fireAbility(fighter, 'after_hit', { turnNumber: 5, damage: 8 })).not.toBeNull();
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 6, damage: 8 })).toBeNull();
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 7, damage: 8 })).not.toBeNull();
  });

  it('passive rule-bend abilities never fire as triggers', () => {
    const gama = makeFighter(getAbility('GAMA'));

    expect(fireAbility(gama, 'after_hit', { turnNumber: 1, damage: 20 })).toBeNull();
    expect(fireAbility(gama, 'on_damaged', { turnNumber: 1, damage: 20 })).toBeNull();
    expect(gama.abilityRuntime?.firedCount ?? 0).toBe(0);
  });

  it('TSUIN charges bonus meter proportional to damage, bounded per proc', () => {
    const tsuin = makeFighter(getAbility('TSUIN'));

    fireAbility(tsuin, 'after_hit', { turnNumber: 1, damage: 20 });
    expect(tsuin.specialMeter).toBe(10); // floor(20 * 0.5)

    // A monster hit is capped at +12 so one identity can't break the pacing.
    fireAbility(tsuin, 'after_hit', { turnNumber: 2, damage: 100 });
    expect(tsuin.specialMeter).toBe(22);

    // No damage context -> no gain.
    fireAbility(tsuin, 'after_hit', { turnNumber: 3 });
    expect(tsuin.specialMeter).toBe(22);
  });

  it('effects clamp to resource caps', () => {
    const fighter = makeFighter(meterOnHit({ kind: 'unlimited' }), { specialMeter: 95 });
    fireAbility(fighter, 'after_hit', { turnNumber: 1, damage: 10 });
    expect(fighter.specialMeter).toBe(100);
  });
});
