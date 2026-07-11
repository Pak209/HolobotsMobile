import { describe, expect, it } from 'vitest';

import { HOLOBOT_NAMES } from '@/lib/progression';
import { getSignatureFinisher } from '../moveKits';
import { fireAbility, getAbility, HOLOBOT_ABILITIES } from '../abilities';
import type { AbilityDefinition, ArenaFighter } from '@/types/arena';

const ALLOWED_TRIGGERS = ['battle_start', 'after_hit', 'after_defend', 'on_counter', 'on_damaged'];
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

  it('all abilities use shared triggers and bounded typed effects', () => {
    for (const ability of Object.values(HOLOBOT_ABILITIES)) {
      expect(ALLOWED_TRIGGERS).toContain(ability.trigger);
      expect(ability.effects.length).toBeGreaterThan(0);
      expect(ability.description.length).toBeGreaterThan(10);

      for (const effect of ability.effects) {
        expect(ALLOWED_EFFECTS).toContain(effect.type);
        expect(effect.value).toBeGreaterThan(0);
        expect(effect.value).toBeLessThanOrEqual(EFFECT_CAPS[effect.type]);
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
  it('once_per_battle fires exactly once (ACE)', () => {
    const fighter = makeFighter(getAbility('ACE'));

    expect(fireAbility(fighter, 'after_hit', { turnNumber: 1, damage: 10, comboCount: 1 })?.id).toBe('ability.ace');
    expect(fighter.specialMeter).toBe(12);
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 2, damage: 10, comboCount: 2 })).toBeNull();
    expect(fighter.specialMeter).toBe(12);
  });

  it('conditions gate firing (KURAI heals only below 40% HP, once)', () => {
    const fighter = makeFighter(getAbility('KURAI'), { currentHP: 80 });

    expect(fireAbility(fighter, 'on_damaged', { turnNumber: 1, damage: 20 })).toBeNull();

    fighter.currentHP = 30;
    expect(fireAbility(fighter, 'on_damaged', { turnNumber: 2, damage: 20 })?.id).toBe('ability.kurai');
    expect(fighter.currentHP).toBe(38);

    fighter.currentHP = 10;
    expect(fireAbility(fighter, 'on_damaged', { turnNumber: 3, damage: 20 })).toBeNull();
  });

  it('cooldown charges respect the action window (WOLF)', () => {
    const fighter = makeFighter(getAbility('WOLF'), { stamina: 2 });

    expect(fireAbility(fighter, 'after_hit', { turnNumber: 5, damage: 8 })?.id).toBe('ability.wolf');
    expect(fighter.stamina).toBe(3);

    fighter.stamina = 2;
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 6, damage: 8 })).toBeNull();
    expect(fireAbility(fighter, 'after_hit', { turnNumber: 7, damage: 8 })?.id).toBe('ability.wolf');
  });

  it('wrong trigger and unmet conditions are no-ops', () => {
    const wake = makeFighter(getAbility('WAKE'), { stamina: 3 });

    expect(fireAbility(wake, 'after_defend', { turnNumber: 1 })).toBeNull();
    // WAKE requires stamina >= 5 when the hit lands.
    expect(fireAbility(wake, 'after_hit', { turnNumber: 1, damage: 10 })).toBeNull();
    wake.stamina = 6;
    expect(fireAbility(wake, 'after_hit', { turnNumber: 2, damage: 10 })?.id).toBe('ability.wake');
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
    const era = makeFighter(getAbility('ERA'), { specialMeter: 90 });
    fireAbility(era, 'battle_start', { turnNumber: 0 });
    expect(era.specialMeter).toBe(100);

    const gama = makeFighter(getAbility('GAMA'), { stamina: 7 });
    fireAbility(gama, 'on_damaged', { turnNumber: 1, damage: 20 });
    expect(gama.stamina).toBe(7);
  });
});
