import type { BattleAction, BattleState } from '../../types/arena';
import { getActionSides } from '../../../components/arena/battleVisualStates';
import type { LiveDuelVfxCue } from '../../vfx/liveDuelVfx';
import type { FightKind } from './battlePace';
export type PaceSide = 'player' | 'rival';
export type ResolvedBattlePace = {
  id: string; attacker: PaceSide; target: PaceSide; kind: FightKind;
  damaged: PaceSide | null; ko: PaceSide | null; evade: boolean;
  effects?: readonly LiveDuelVfxCue[];
};
/** Reads an already-resolved action. HP/outcome/turn order are never inferred or written. */
export function resolvedBattlePace(action: BattleAction, battle: BattleState, latest = true): ResolvedBattlePace {
  const sides = getActionSides(action, battle);
  const attacker = sides.attacker === 'player' ? 'player' : 'rival';
  const damaged = sides.damaged === null ? null : sides.damaged === 'player' ? 'player' : 'rival';
  const type = action.actionType ?? action.card.type;
  const hp = damaged === 'player' ? battle.player.currentHP : battle.opponent.currentHP;
  return {
    id: action.id, attacker, target: attacker === 'player' ? 'rival' : 'player',
    kind: type === 'defense' ? 'guard' : type === 'combo' ? 'heavy' : type === 'finisher' ? 'special' : 'light',
    damaged, ko: latest && damaged !== null && hp <= 0 ? damaged : null,
    evade: action.outcome === 'dodged' || action.outcome === 'missed',
  };
}
