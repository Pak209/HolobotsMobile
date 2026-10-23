import { LiveDuelStage } from '../duel/LiveDuelStage';
import { FAST_RENDER_QUALITY } from '../../lib/bots/stagePerf';
import { hostFighterLevel } from '../../lib/bots/hostFighterLevel';
import type { FinisherPower } from '../../../features/arena/finisherPolicy';
import type { ActionCard, BattleState } from '../../types/arena';

/** Presentation of the existing resolved battle state; no combat decisions here. The stage itself is shared with the
 * CPU Arena (LiveDuelStage); this wrapper keeps the city rival props and its issue-based level lookup.
 * lite-2305-1 (DECISIONS #72.63): the city duel plays the lite VFX pack and the special camera beat like the Arena round.
 * lite-sim-fixes-1: it also renders with the Arena round's fast mix (FAST_RENDER_QUALITY: msaa0 + halfRes + anim30); at
 * production quality it drew 402x788 and ran 7-10 fps on the sim vs 24-33 for the Arena round. Presentation cost only. */
export function CityLiveBattleView({ battle, moves, onPlay, onSignature, onLeave, pending, preview, hostIssue, accountSnapshot, vfx = true, specialCamera = true }: {
  hostIssue?: unknown; accountSnapshot?: unknown; battle: BattleState; moves: ActionCard[]; onPlay: (id: string) => void;
  onSignature: (power?: FinisherPower) => void; onLeave: () => void; pending: boolean; preview: boolean;
  /** QA witness only: false = today's city duel (no VFX / no camera beat). */
  vfx?: boolean; specialCamera?: boolean;
}) {
  return <LiveDuelStage battle={battle} moves={moves} onPlay={onPlay} onSignature={onSignature} onLeave={onLeave} pending={pending}
    caption={preview ? 'OFFLINE PREVIEW · NO REWARDS' : 'HOLOCITY / PARK ARENA'} leaveLabel="LEAVE" vfx={vfx} specialCamera={specialCamera} renderQuality={FAST_RENDER_QUALITY}
    levels={{ player: hostFighterLevel(hostIssue, 'player', battle.player.name, accountSnapshot), rival: hostFighterLevel(hostIssue, 'rival', battle.opponent.name) }} />;
}
