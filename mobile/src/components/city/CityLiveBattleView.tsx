import { LiveDuelStage } from '../duel/LiveDuelStage';
import { hostFighterLevel } from '../../lib/bots/hostFighterLevel';
import type { FinisherPower } from '../../features/arena/finisherPolicy';
import type { ActionCard, BattleState } from '../../types/arena';

/** Presentation of the existing resolved battle state; no combat decisions here. The stage itself is shared with the
 * CPU Arena (LiveDuelStage); this wrapper keeps the city rival props and its issue-based level lookup. */
export function CityLiveBattleView({ battle, moves, onPlay, onSignature, onLeave, pending, preview, hostIssue, accountSnapshot }: {
  hostIssue?: unknown; accountSnapshot?: unknown; battle: BattleState; moves: ActionCard[]; onPlay: (id: string) => void;
  onSignature: (power?: FinisherPower) => void; onLeave: () => void; pending: boolean; preview: boolean;
}) {
  return <LiveDuelStage battle={battle} moves={moves} onPlay={onPlay} onSignature={onSignature} onLeave={onLeave} pending={pending}
    caption={preview ? 'OFFLINE PREVIEW · NO REWARDS' : 'HOLOCITY / PARK ARENA'} leaveLabel="LEAVE"
    levels={{ player: hostFighterLevel(hostIssue, 'player', battle.player.name, accountSnapshot), rival: hostFighterLevel(hostIssue, 'rival', battle.opponent.name) }} />;
}
