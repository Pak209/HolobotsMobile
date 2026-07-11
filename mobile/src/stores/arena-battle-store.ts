import { create } from 'zustand';
import type {
  BattleState,
  BattleAction,
  ActionCard,
  ArenaFighter,
  ArenaBattleConfig,
  BattleRewards,
} from '../types/arena';
import { ArenaCombatEngine } from '../features/arena/combatEngine';
import type { ArenaCardAvailability } from '../features/arena/arenaCards';
import { resolveCombatKit } from '../features/arena/moveKits';

// ============================================================================
// Arena Battle Store
// ============================================================================
//
// Fighters battle with a fixed four-move kit (slots 1-3 + a Technique
// Finisher in slot 4) plus an innate Signature Finisher gated by a full
// special meter — no deck, hand, draw, or cycling (see
// docs/arena-card-to-move-implementation-plan.md).

// Real-time pacing: both fighters gain +1 stamina on this interval, and the
// AI acts on its own cadence (independent of the player).
const STAMINA_REGEN_INTERVAL_MS = 2000;
const AI_ACTION_INTERVAL_MS = 950;

interface ArenaBattleStore {
  // Current Battle State
  currentBattle: BattleState | null;
  playerMoves: ActionCard[];
  opponentMoves: ActionCard[];

  // UI State
  isAnimating: boolean;
  /** Pause menu open: freezes AI cadence, stamina regen, and player input. */
  paused: boolean;
  lastAction: BattleAction | null;
  battleResult: {
    winnerId: string;
    rewards: BattleRewards;
  } | null;
  gameLoopIntervalId: ReturnType<typeof setInterval> | null;
  lastAIActionTime: number;

  // Actions
  startBattle: (
    player: ArenaFighter,
    opponent: ArenaFighter,
    config?: Partial<ArenaBattleConfig>
  ) => void;
  useMove: (moveId: string) => void;
  useSignatureFinisher: () => void;
  toggleDefenseMode: () => void;
  processAITurn: () => void;
  endBattle: () => void;
  resetBattle: () => void;
  startGameLoop: () => void;
  stopGameLoop: () => void;

  // Animation
  setAnimating: (isAnimating: boolean) => void;
  setPaused: (paused: boolean) => void;

  // Helpers
  getPlayableMoves: () => ActionCard[];
  canUseMove: (moveId: string) => boolean;
  canUseSignature: () => boolean;
  getMoveAvailabilityMap: () => Record<string, ArenaCardAvailability>;
}

export const useArenaBattleStore = create<ArenaBattleStore>((set, get) => {
  // Shared post-action commit: state, ticker, animation lock, win check.
  const commitResolution = (
    newState: BattleState,
    extra: Partial<Pick<ArenaBattleStore, 'playerMoves' | 'opponentMoves' | 'lastAIActionTime'>> = {},
  ) => {
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    set({
      currentBattle: newState,
      lastAction: resolvedAction,
      isAnimating: true,
      ...extra,
    });

    const winCheck = ArenaCombatEngine.checkWinCondition(newState);
    if (winCheck.isComplete && winCheck.winnerId) {
      const rewards = ArenaCombatEngine.calculateActualRewards(newState, winCheck.winnerId);
      set({
        battleResult: { winnerId: winCheck.winnerId, rewards },
        isAnimating: false,
      });
    } else {
      setTimeout(() => {
        set({ isAnimating: false });
      }, 350);
    }
  };

  return {
    // Initial State
    currentBattle: null,
    playerMoves: [],
    opponentMoves: [],
    isAnimating: false,
    paused: false,
    lastAction: null,
    battleResult: null,
    gameLoopIntervalId: null,
    lastAIActionTime: 0,

    // Start a new battle: resolve each fighter's fixed four-move kit.
    startBattle: (player, opponent, config) => {
      const battle = ArenaCombatEngine.initializeBattle(player, opponent, config);
      const playerKit = resolveCombatKit({
        savedKitTemplateIds: config?.playerKitTemplateIds,
        deckTemplateIds: config?.playerDeckTemplateIds,
        ownedBattleCards: config?.playerBattleCards,
        moveProgress: config?.playerMoveProgress,
        idPrefix: 'player',
      });
      const opponentKit = resolveCombatKit({
        ownedBattleCards: config?.opponentBattleCards,
        idPrefix: 'opponent',
      });

      set({
        currentBattle: battle,
        playerMoves: [...playerKit.slots],
        opponentMoves: [...opponentKit.slots],
        isAnimating: false,
        paused: false,
        lastAction: null,
        battleResult: null,
        lastAIActionTime: Date.now(),
      });

      get().startGameLoop();
    },

    // Player uses a kit move (real-time: any moment stamina/requirements allow)
    useMove: (moveId) => {
      const { currentBattle, playerMoves, paused } = get();
      if (paused) return;
      if (!currentBattle || currentBattle.status !== 'active') return;

      const move = playerMoves.find((candidate) => candidate.id === moveId);
      if (!move) return;

      if (!ArenaCombatEngine.canPlayCard(currentBattle, 'player', move)) {
        console.warn('Cannot use move:', move.name);
        return;
      }

      const newState = ArenaCombatEngine.resolveAction(currentBattle, move, currentBattle.player.holobotId);
      commitResolution(newState);
    },

    // Player fires their Signature Finisher (explicit command; requires a
    // full special meter, which it consumes).
    useSignatureFinisher: () => {
      const { currentBattle, paused } = get();
      if (paused) return;
      if (!currentBattle || currentBattle.status !== 'active') return;
      if (!ArenaCombatEngine.canUseSignatureFinisher(currentBattle, 'player')) return;

      const newState = ArenaCombatEngine.resolveSignatureFinisher(
        currentBattle,
        currentBattle.player.holobotId,
      );
      if (newState === currentBattle) return;

      commitResolution(newState);
    },

    // Toggle player defense mode
    toggleDefenseMode: () => {
      const { currentBattle, playerMoves } = get();
      if (!currentBattle) return;
      const defenseMove = ArenaCombatEngine.getPlayableCards(
        currentBattle,
        'player',
        playerMoves,
      ).find((move) => move.type === 'defense');

      if (!defenseMove) {
        return;
      }
      get().useMove(defenseMove.id);
    },

    // Process an AI action (real-time: fired on a cadence by the game loop)
    processAITurn: () => {
      const { currentBattle, opponentMoves } = get();
      if (!currentBattle) return;
      if (currentBattle.status !== 'active') return;
      if (get().isAnimating) return;

      const command = ArenaCombatEngine.selectAICommand(currentBattle, opponentMoves);
      if (!command) {
        // Nothing playable (stamina drained / cooldowns): wait for the timed
        // stamina regen and try again on the next cadence.
        set({ lastAIActionTime: Date.now() });
        return;
      }

      const newState =
        command.kind === 'signature'
          ? ArenaCombatEngine.resolveSignatureFinisher(currentBattle, currentBattle.opponent.holobotId)
          : ArenaCombatEngine.resolveAction(currentBattle, command.card, currentBattle.opponent.holobotId);

      if (newState === currentBattle) {
        set({ lastAIActionTime: Date.now() });
        return;
      }

      commitResolution(newState, { lastAIActionTime: Date.now() });
    },

    // End battle and cleanup
    endBattle: () => {
      get().stopGameLoop();
      set({
        currentBattle: null,
        playerMoves: [],
        opponentMoves: [],
        battleResult: null,
        paused: false,
        gameLoopIntervalId: null,
      });
    },

    // Reset for rematch
    resetBattle: () => {
      get().stopGameLoop();
      set({
        currentBattle: null,
        playerMoves: [],
        opponentMoves: [],
        isAnimating: false,
        lastAction: null,
        battleResult: null,
        gameLoopIntervalId: null,
      });
    },

    // Real-time game loop: stamina regenerates for both fighters on a fixed
    // interval, and the AI acts on its own cadence whenever it has a playable
    // move or a charged signature — it does not wait for the player.
    startGameLoop: () => {
      const existing = get().gameLoopIntervalId;
      if (existing) {
        clearInterval(existing);
      }

      let lastRegenAt = Date.now();

      const intervalId = setInterval(() => {
        const { currentBattle, isAnimating, lastAIActionTime, opponentMoves, paused } = get();
        if (!currentBattle || currentBattle.status !== 'active') {
          return;
        }

        const now = Date.now();
        if (paused) {
          // Hold the regen/AI clocks in place while the pause menu is open.
          lastRegenAt = now;
          return;
        }
        let battle = currentBattle;
        if (now - lastRegenAt >= STAMINA_REGEN_INTERVAL_MS) {
          lastRegenAt = now;
          battle = ArenaCombatEngine.regenerateStamina(battle);
          set({ currentBattle: battle });
        }

        if (isAnimating) {
          return;
        }

        if (
          now - lastAIActionTime > AI_ACTION_INTERVAL_MS &&
          (ArenaCombatEngine.getPlayableCards(battle, 'opponent', opponentMoves).length > 0 ||
            ArenaCombatEngine.canUseSignatureFinisher(battle, 'opponent'))
        ) {
          get().processAITurn();
        }
      }, 180);

      set({ gameLoopIntervalId: intervalId });
    },

    stopGameLoop: () => {
      const existing = get().gameLoopIntervalId;
      if (existing) {
        clearInterval(existing);
      }
      set({ gameLoopIntervalId: null });
    },

    // Animation control
    setAnimating: (isAnimating) => set({ isAnimating }),
    setPaused: (paused) => set({ paused, ...(paused ? {} : { lastAIActionTime: Date.now() }) }),

    // Helper: Get currently usable kit moves
    getPlayableMoves: () => {
      const { currentBattle, playerMoves } = get();
      if (!currentBattle) return [];
      return ArenaCombatEngine.getPlayableCards(currentBattle, 'player', playerMoves);
    },

    // Helper: Check if a specific kit move can be used
    canUseMove: (moveId) => {
      const { currentBattle, playerMoves } = get();
      if (!currentBattle) return false;
      const move = playerMoves.find((candidate) => candidate.id === moveId);
      if (!move) return false;
      return ArenaCombatEngine.canPlayCard(currentBattle, 'player', move);
    },

    // Helper: Signature availability (full special meter)
    canUseSignature: () => {
      const { currentBattle } = get();
      if (!currentBattle) return false;
      return ArenaCombatEngine.canUseSignatureFinisher(currentBattle, 'player');
    },

    getMoveAvailabilityMap: () => {
      const { currentBattle, playerMoves } = get();
      if (!currentBattle) return {};

      return playerMoves.reduce<Record<string, ArenaCardAvailability>>((result, move) => {
        result[move.id] = ArenaCombatEngine.getCardAvailability(currentBattle, 'player', move);
        return result;
      }, {});
    },
  };
});
