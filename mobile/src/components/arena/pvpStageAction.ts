import type { BattleAction } from '../../types/arena';
import type { PlayerRole } from '../../types/battle-room';

/**
 * lite-pvp-3d-1: the room's last action in the viewer's frame. The room maps p1 -> player on BOTH clients (so the engine
 * resolves identically everywhere) and PvpArenaModal flips the fighters for p2's display only; the action's `actorRole`
 * is still p1-frame, so p2 would see their own bot swing on the opponent's move. Display only: the room's action is not
 * changed, and an action without `actorRole` already resolves by actorId against the flipped fighters.
 */
export function pvpStageAction(action: BattleAction | null | undefined, myRole: PlayerRole): BattleAction | null {
  if (!action) return null;
  if (myRole === 'p1' || !action.actorRole) return action;
  return { ...action, actorRole: action.actorRole === 'player' ? 'opponent' : 'player' };
}
