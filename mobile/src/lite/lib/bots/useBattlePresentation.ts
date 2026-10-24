import { useEffect, useRef, useState } from 'react';
import type { BattleState } from '../../types/arena';
import { shouldHoldResult, type TerminalPresentation } from './koPresentation';
/** Only retain an already-visible battle. Opening an existing receipt never replays a KO. */
export function useBattlePresentation(battle: BattleState | null, live: boolean) {
  const seen = useRef<string | null>(null);
  const [complete, setComplete] = useState<string | null>(null);
  useEffect(() => { if (battle && live) seen.current = battle.battleId; }, [battle?.battleId, live]);
  const holding = !!battle && shouldHoldResult(battle.status, battle.battleId, seen.current, complete);
  const terminal: TerminalPresentation | undefined = holding && battle ? {
    id: battle.battleId,
    defeated: [...(battle.player.currentHP <= 0 ? ['player'] : []), ...(battle.opponent.currentHP <= 0 ? ['rival'] : [])],
  } : undefined;
  return { holding, terminal, onComplete: (id: string) => setComplete(id) };
}
