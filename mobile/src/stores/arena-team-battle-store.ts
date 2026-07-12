import { create } from 'zustand';

import { ArenaCombatEngine } from '@/features/arena/combatEngine';
import type { ArenaCardAvailability } from '@/features/arena/arenaCards';
import {
  applyBenchRegen,
  applyDuelResolution,
  autoPickIndex,
  canAct,
  canSwitch,
  createTeamBattle,
  getActiveMoves,
  selectAISendIn,
  selectAISwitch,
  sendIn,
  switchActive,
  type TeamBattle,
  type TeamFighterEntry,
} from '@/features/arena/teamBattle';
import { SEND_IN_DEADLINE_MS } from '@/features/arena/teamBattle';
import type { ActionCard, ArenaBattleConfig, BattleAction } from '@/types/arena';

// ============================================================================
// Arena 3v3 Team Battle Store (docs/arena-3v3-mode-plan.md, Phase A)
// ============================================================================
//
// The 1v1 store stays untouched; this store drives the team layer. All
// combat still resolves through ArenaCombatEngine on the current duel.

const STAMINA_REGEN_INTERVAL_MS = 2000;
const AI_ACTION_INTERVAL_MS = 950;
const AI_SEND_IN_THINK_MS = 1200;

interface ArenaTeamBattleStore {
  team: TeamBattle | null;
  isAnimating: boolean;
  paused: boolean;
  lastAction: BattleAction | null;
  /** Set once when the match completes: which side won. */
  teamResult: { winnerSide: 'player' | 'opponent' } | null;
  gameLoopIntervalId: ReturnType<typeof setInterval> | null;
  lastAIActionTime: number;

  startTeamBattle: (
    playerEntries: TeamFighterEntry[],
    opponentEntries: TeamFighterEntry[],
    config?: Partial<ArenaBattleConfig>,
  ) => void;
  useMove: (moveId: string) => void;
  useSignatureFinisher: () => void;
  switchTo: (index: number) => void;
  chooseSendIn: (index: number) => void;
  endBattle: () => void;
  setPaused: (paused: boolean) => void;

  getPlayableMoves: () => ActionCard[];
  canUseMove: (moveId: string) => boolean;
  canUseSignature: () => boolean;
  getMoveAvailabilityMap: () => Record<string, ArenaCardAvailability>;
}

export const useArenaTeamBattleStore = create<ArenaTeamBattleStore>((set, get) => {
  const commitTeam = (team: TeamBattle, extra: Partial<ArenaTeamBattleStore> = {}) => {
    const lastAction = team.duel.actionHistory[team.duel.actionHistory.length - 1] ?? null;

    set({
      team,
      lastAction: lastAction ?? get().lastAction,
      isAnimating: true,
      ...extra,
    });

    if (team.phase === 'completed' && team.winnerSide) {
      set({ teamResult: { winnerSide: team.winnerSide }, isAnimating: false });
    } else {
      setTimeout(() => set({ isAnimating: false }), 350);
    }
  };

  // Matches the 1v1 store: player taps are gated by pause/phase/entry lock
  // only — the animation flag paces the CPU, it does not swallow inputs.
  const playerGuard = (): TeamBattle | null => {
    const { team, paused } = get();
    if (!team || paused || team.phase !== 'active') return null;
    if (!canAct(team, 'player')) return null;
    return team;
  };

  return {
    team: null,
    isAnimating: false,
    paused: false,
    lastAction: null,
    teamResult: null,
    gameLoopIntervalId: null,
    lastAIActionTime: 0,

    startTeamBattle: (playerEntries, opponentEntries, config) => {
      const existing = get().gameLoopIntervalId;
      if (existing) clearInterval(existing);

      const team = createTeamBattle(playerEntries, opponentEntries, config);
      set({
        team,
        isAnimating: false,
        paused: false,
        lastAction: null,
        teamResult: null,
        lastAIActionTime: Date.now(),
      });

      let lastRegenAt = Date.now();

      const intervalId = setInterval(() => {
        const { team: current, isAnimating, lastAIActionTime, paused } = get();
        if (!current || current.phase === 'completed') return;

        const now = Date.now();
        if (paused) {
          lastRegenAt = now;
          return;
        }

        // Send-in deadline: auto-pick for whichever side stalls. The CPU
        // "thinks" briefly, the player gets the full window.
        if (current.phase === 'awaiting_send_in') {
          const deadline = current.sendInDeadline ?? now;
          if (current.pendingSendInSide === 'opponent') {
            // The CPU "thinks" briefly, then picks its counter.
            const pickAt = deadline - SEND_IN_DEADLINE_MS + AI_SEND_IN_THINK_MS;
            if (now >= pickAt) {
              commitTeam(sendIn(current, 'opponent', selectAISendIn(current), now), {
                lastAIActionTime: now,
              });
            }
          } else if (now >= deadline) {
            // Player stalled past the window: auto-pick the next in order.
            const pick = autoPickIndex(current.player);
            if (pick >= 0) {
              commitTeam(sendIn(current, 'player', pick, now));
            }
          }
          return;
        }

        // Stamina: actives via the engine, bench via the team layer.
        if (now - lastRegenAt >= STAMINA_REGEN_INTERVAL_MS) {
          lastRegenAt = now;
          let regenerated = applyBenchRegen(current);
          regenerated = { ...regenerated, duel: ArenaCombatEngine.regenerateStamina(regenerated.duel) };
          // Keep slots in sync with the regenerated duel fighters.
          regenerated = applyDuelResolution(regenerated, regenerated.duel, now);
          set({ team: regenerated });
        }

        const battle = get().team;
        if (!battle || battle.phase !== 'active' || isAnimating) return;
        if (!canAct(battle, 'opponent', now)) return;
        if (now - lastAIActionTime <= AI_ACTION_INTERVAL_MS) return;

        // CPU rotation first, then normal duel AI.
        const switchIndex = selectAISwitch(battle, now);
        if (switchIndex !== null) {
          commitTeam(switchActive(battle, 'opponent', switchIndex, now), { lastAIActionTime: now });
          return;
        }

        const command = ArenaCombatEngine.selectAICommand(battle.duel, getActiveMoves(battle, 'opponent'));
        if (!command) {
          set({ lastAIActionTime: now });
          return;
        }

        const nextDuel =
          command.kind === 'signature'
            ? ArenaCombatEngine.resolveSignatureFinisher(battle.duel, battle.duel.opponent.holobotId)
            : ArenaCombatEngine.resolveAction(battle.duel, command.card, battle.duel.opponent.holobotId);
        if (nextDuel === battle.duel) {
          set({ lastAIActionTime: now });
          return;
        }

        commitTeam(applyDuelResolution(battle, nextDuel, now), { lastAIActionTime: now });
      }, 180);

      set({ gameLoopIntervalId: intervalId });
    },

    useMove: (moveId) => {
      const team = playerGuard();
      if (!team) return;

      const move = getActiveMoves(team, 'player').find((candidate) => candidate.id === moveId);
      if (!move) return;
      if (!ArenaCombatEngine.canPlayCard(team.duel, 'player', move)) return;

      const nextDuel = ArenaCombatEngine.resolveAction(team.duel, move, team.duel.player.holobotId);
      if (nextDuel === team.duel) return;
      commitTeam(applyDuelResolution(team, nextDuel));
    },

    useSignatureFinisher: () => {
      const team = playerGuard();
      if (!team) return;
      if (!ArenaCombatEngine.canUseSignatureFinisher(team.duel, 'player')) return;

      const nextDuel = ArenaCombatEngine.resolveSignatureFinisher(team.duel, team.duel.player.holobotId);
      if (nextDuel === team.duel) return;
      commitTeam(applyDuelResolution(team, nextDuel));
    },

    switchTo: (index) => {
      const { team, paused } = get();
      if (!team || paused) return;
      if (canSwitch(team, 'player', index)) return;
      commitTeam(switchActive(team, 'player', index));
    },

    chooseSendIn: (index) => {
      const { team } = get();
      if (!team || team.phase !== 'awaiting_send_in' || team.pendingSendInSide !== 'player') return;
      commitTeam(sendIn(team, 'player', index));
    },

    endBattle: () => {
      const existing = get().gameLoopIntervalId;
      if (existing) clearInterval(existing);
      set({
        team: null,
        isAnimating: false,
        paused: false,
        lastAction: null,
        teamResult: null,
        gameLoopIntervalId: null,
      });
    },

    setPaused: (paused) => set({ paused, ...(paused ? {} : { lastAIActionTime: Date.now() }) }),

    getPlayableMoves: () => {
      const { team } = get();
      if (!team || team.phase !== 'active' || !canAct(team, 'player')) return [];
      return ArenaCombatEngine.getPlayableCards(team.duel, 'player', getActiveMoves(team, 'player'));
    },

    canUseMove: (moveId) => {
      const { team } = get();
      if (!team || team.phase !== 'active' || !canAct(team, 'player')) return false;
      const move = getActiveMoves(team, 'player').find((candidate) => candidate.id === moveId);
      return move ? ArenaCombatEngine.canPlayCard(team.duel, 'player', move) : false;
    },

    canUseSignature: () => {
      const { team } = get();
      if (!team || team.phase !== 'active' || !canAct(team, 'player')) return false;
      return ArenaCombatEngine.canUseSignatureFinisher(team.duel, 'player');
    },

    getMoveAvailabilityMap: () => {
      const { team } = get();
      if (!team) return {};
      return getActiveMoves(team, 'player').reduce<Record<string, ArenaCardAvailability>>((result, move) => {
        result[move.id] = ArenaCombatEngine.getCardAvailability(team.duel, 'player', move);
        return result;
      }, {});
    },
  };
});
