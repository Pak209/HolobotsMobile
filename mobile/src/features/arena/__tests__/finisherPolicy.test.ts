import { describe, expect, it } from 'vitest';
import { evaluateFinisher, FINISHER_POLICY } from '../finisherPolicy';
const valid = { active: true, actorHealth: 100, targetHealth: 100, stamina: 4, sync: 100, lockedUntil: 0, now: 1000, power: 'full' as const };
describe('half/full finisher eligibility', () => {
  it('requires both resources at exact boundaries', () => {
    expect(evaluateFinisher(valid).playable).toBe(true);
    expect(evaluateFinisher({ ...valid, stamina: 3.999 }).reason).toBe('stamina');
    expect(evaluateFinisher({ ...valid, sync: 99.999 }).reason).toBe('special_meter');
    expect(evaluateFinisher({ ...valid, power: 'half', stamina: 2, sync: 50 }).playable).toBe(true);
    expect(evaluateFinisher({ ...valid, power: 'half', sync: 49.999 }).reason).toBe('special_meter');
  });
  it('allows the player to choose half even with a full meter', () => {
    expect(evaluateFinisher({ ...valid, power: 'half' })).toMatchObject({ playable: true, staminaCost: 2, syncCost: 50, effectScale: 0.5 });
    expect(FINISHER_POLICY.full.effect).toBe(1);
  });
  it('refuses invalid fighters, inactive battles and locks before any spending', () => {
    expect(evaluateFinisher({ ...valid, active: false }).reason).toBe('inactive');
    expect(evaluateFinisher({ ...valid, actorHealth: 0 }).reason).toBe('invalid_target');
    expect(evaluateFinisher({ ...valid, targetHealth: 0 }).reason).toBe('invalid_target');
    expect(evaluateFinisher({ ...valid, lockedUntil: 1001 }).reason).toBe('busy');
    expect(evaluateFinisher({ ...valid, sync: NaN }).playable).toBe(false);
    expect(evaluateFinisher({ ...valid, stamina: NaN }).playable).toBe(false);
    expect(evaluateFinisher({ ...valid, now: NaN }).reason).toBe('busy');
    expect(evaluateFinisher({ ...valid, power: {} as never }).reason).toBe('invalid_power');
  });
});
