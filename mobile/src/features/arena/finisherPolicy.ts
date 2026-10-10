/** Shared command semantics; resource decisions remain in the existing mobile combat engine. */
export type FinisherPower = 'half' | 'full';
export const FINISHER_POLICY = Object.freeze({
  half: Object.freeze({ stamina: 2, sync: 50, effect: 0.5 }),
  full: Object.freeze({ stamina: 4, sync: 100, effect: 1 }),
});
export const FINISHER_RECOVERY_MS = 350;
export type FinisherUnavailable = 'invalid_power' | 'inactive' | 'invalid_target' | 'busy' | 'stamina' | 'special_meter';
export type FinisherEligibility = { playable: boolean; reason?: FinisherUnavailable; staminaCost: number; syncCost: number; effectScale: number };
export function evaluateFinisher(input: {
  active: boolean; actorHealth: number; targetHealth: number; stamina: number; sync: number;
  lockedUntil: number; now: number; power: FinisherPower;
}): FinisherEligibility {
  if (input.power !== 'half' && input.power !== 'full')
    return { playable: false, reason: 'invalid_power', staminaCost: 0, syncCost: 0, effectScale: 0 };
  const policy = FINISHER_POLICY[input.power];
  const result = { playable: false, staminaCost: policy.stamina, syncCost: policy.sync, effectScale: policy.effect };
  if (!input.active) return { ...result, reason: 'inactive' };
  if (![input.actorHealth, input.targetHealth].every(Number.isFinite) || input.actorHealth <= 0 || input.targetHealth <= 0)
    return { ...result, reason: 'invalid_target' };
  if (!Number.isFinite(input.now) || !Number.isFinite(input.lockedUntil) || input.lockedUntil > input.now) return { ...result, reason: 'busy' };
  if (!Number.isFinite(input.stamina) || input.stamina < policy.stamina) return { ...result, reason: 'stamina' };
  if (!Number.isFinite(input.sync) || input.sync < policy.sync) return { ...result, reason: 'special_meter' };
  return { ...result, playable: true };
}
