import type { BattleAction, BattleState } from '../types/arena';
import { getActionSides } from '../components/arena/battleVisualStates';

/** lite-vfx-port-1: which pack effect a resolved battle action shows on the live duel stage. Pure (no three, no RN).
 * Presentation only: it reads the action the engine / store already resolved (outcome, damage, sides) and decides
 * nothing about the fight. Unity's mapping (CombatFxSystem + fight-wire-1's flash listener):
 *  - HEAVY (combo) hit = the attacker's kit `break_heavy`, BREAK screen pulse;
 *  - FINISHER hit = `sky_launch` (SKYBREAKER), SKY pulse;
 *  - STRIKE hit = the kit's `impactAccent` (the white ring pulse at the struck feet), no pulse;
 *  - a counter hit = the counterer's `impactAccent` on the struck attacker, SKY pulse (counter = SKY);
 *  - a guarded hit = the attack's wind-up + the shared guard impact on the guard; a whiff = the wind-up only;
 *  - DEFEND = the kit's `intercept` ring at the guard's chest. */
export type StageSide = 'player' | 'rival';
export type LiveDuelVfxCue = { kit: string | null; effect: string; caster: StageSide; target: StageSide; phases: ('windup' | 'landing')[]; flash: 'sky' | 'break' | null };

export function liveDuelVfxCues(action: BattleAction, battle: BattleState, kits: Record<StageSide, string | null>): LiveDuelVfxCue[] {
  const { attacker, damaged } = getActionSides(action, battle);
  const side: StageSide = attacker === 'player' ? 'player' : 'rival';
  const other: StageSide = side === 'player' ? 'rival' : 'player';
  const type = action.actionType ?? action.card.type;
  if (type === 'defense') return [{ kit: kits[side], effect: 'intercept', caster: side, target: side, phases: ['windup'], flash: null }];
  const effect = type === 'combo' ? 'break_heavy' : type === 'finisher' ? 'sky_launch' : 'impactAccent';
  const counter = action.outcome === 'countered' || action.outcome === 'counter';
  if (damaged && counter) return [{ kit: kits[other], effect: 'impactAccent', caster: other, target: side, phases: ['landing'], flash: 'sky' }];
  if (damaged) return [{ kit: kits[side], effect, caster: side, target: other, phases: ['windup', 'landing'], flash: type === 'finisher' ? 'sky' : type === 'combo' ? 'break' : null }];
  const windup: LiveDuelVfxCue = { kit: kits[side], effect, caster: side, target: other, phases: ['windup'], flash: null };
  if (action.outcome === 'blocked' || action.outcome === 'perfect_defense') return [windup, { kit: null, effect: 'guard', caster: side, target: other, phases: ['landing'], flash: null }];
  return effect === 'impactAccent' ? [] : [windup];
}
