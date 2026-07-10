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
import { CardPoolGenerator } from '../lib/arena/card-generator';

// ============================================================================
// Arena Battle Store
// ============================================================================

interface ArenaBattleStore {
  // Current Battle State
  currentBattle: BattleState | null;
  playerCards: ActionCard[];
  opponentCards: ActionCard[];

  // UI State
  isAnimating: boolean;
  selectedCardId: string | null;
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
  playCard: (cardId: string) => void;
  toggleDefenseMode: () => void;
  processAITurn: () => void;
  endBattle: () => void;
  resetBattle: () => void;
  startGameLoop: () => void;
  stopGameLoop: () => void;

  // Animation
  setAnimating: (isAnimating: boolean) => void;
  selectCard: (cardId: string | null) => void;

  // Helpers
  getPlayableCards: () => ActionCard[];
  canPlayCard: (cardId: string) => boolean;
  getCardAvailabilityMap: () => Record<string, ArenaCardAvailability>;
}

export const useArenaBattleStore = create<ArenaBattleStore>((set, get) => ({
  // Initial State
  currentBattle: null,
  playerCards: [],
  opponentCards: [],
  isAnimating: false,
  selectedCardId: null,
  lastAction: null,
  battleResult: null,
  gameLoopIntervalId: null,
  lastAIActionTime: 0,

  // Start a new battle
  startBattle: (player, opponent, config) => {
    const battle = ArenaCombatEngine.initializeBattle(player, opponent, config);
    const playerCards = CardPoolGenerator.generateBattleHand(player, config?.playerBattleCards);
    const opponentCards = CardPoolGenerator.generateBattleHand(opponent, config?.opponentBattleCards);

    set({
      currentBattle: battle,
      playerCards,
      opponentCards,
      isAnimating: false,
      selectedCardId: null,
      lastAction: null,
      battleResult: null,
      lastAIActionTime: Date.now(),
    });

    get().startGameLoop();
  },

  // Player plays a card
  playCard: (cardId) => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle || currentBattle.status !== 'active') return;
    if (currentBattle.currentActorId !== currentBattle.player.holobotId) return;

    const card = playerCards.find(c => c.id === cardId);
    if (!card) return;

    // Check if playable
    if (!ArenaCombatEngine.canPlayCard(currentBattle, 'player', card)) {
      console.warn('Cannot play card:', card.name);
      return;
    }

    const newState = ArenaCombatEngine.resolveAction(currentBattle, card, currentBattle.player.holobotId);
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    set({
      currentBattle: newState,
      lastAction: resolvedAction,
      isAnimating: true,
      selectedCardId: null,
      lastAIActionTime: Date.now(),
    });

    // Check for battle end
    const winCheck = ArenaCombatEngine.checkWinCondition(newState);
    if (winCheck.isComplete && winCheck.winnerId) {
      const rewards = ArenaCombatEngine.calculateActualRewards(newState, winCheck.winnerId);
      set({
        battleResult: { winnerId: winCheck.winnerId, rewards },
      });
    } else {
      setTimeout(() => {
        get().setAnimating(false);
      }, 350);
    }
  },

  // Toggle player defense mode
  toggleDefenseMode: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return;
    const defenseCard = ArenaCombatEngine.getPlayableCards(
      currentBattle,
      'player',
      playerCards,
    ).find((card) => card.type === 'defense');

    if (!defenseCard) {
      return;
    }
    get().playCard(defenseCard.id);
  },

  // Process AI turn
  processAITurn: () => {
    const { currentBattle, opponentCards } = get();
    if (!currentBattle) return;
    if (currentBattle.status !== 'active') return;
    if (get().isAnimating) return;
    if (currentBattle.currentActorId !== currentBattle.opponent.holobotId) return;

    set({ isAnimating: true });

    const selectedCard = ArenaCombatEngine.selectAIAction(currentBattle, opponentCards);
    if (!selectedCard) {
      // Nothing playable (stamina drained / cooldowns): pass the turn so the
      // battle keeps moving instead of the loop spinning on the AI forever.
      set({
        currentBattle: ArenaCombatEngine.passTurn(currentBattle, 'opponent'),
        isAnimating: false,
        lastAIActionTime: Date.now(),
      });
      return;
    }

    const newState = ArenaCombatEngine.resolveAction(
      currentBattle,
      selectedCard,
      currentBattle.opponent.holobotId,
    );
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    set({
      currentBattle: newState,
      lastAction: resolvedAction,
      lastAIActionTime: Date.now(),
    });

    // Check for battle end
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
  },

  // End battle and cleanup
  endBattle: () => {
    get().stopGameLoop();
    set({
      currentBattle: null,
      playerCards: [],
      opponentCards: [],
      battleResult: null,
      gameLoopIntervalId: null,
    });
  },

  // Reset for rematch
  resetBattle: () => {
    get().stopGameLoop();
    set({
      currentBattle: null,
      playerCards: [],
      opponentCards: [],
      isAnimating: false,
      selectedCardId: null,
      lastAction: null,
      battleResult: null,
      gameLoopIntervalId: null,
    });
  },

  startGameLoop: () => {
    const existing = get().gameLoopIntervalId;
    if (existing) {
      clearInterval(existing);
    }

    const intervalId = setInterval(() => {
      const { currentBattle, isAnimating, lastAIActionTime } = get();
      if (!currentBattle || currentBattle.status !== 'active') {
        return;
      }

      if (isAnimating) {
        return;
      }

      const enoughDelayPassed = Date.now() - lastAIActionTime > 950;

      if (
        currentBattle.currentActorId === currentBattle.opponent.holobotId &&
        enoughDelayPassed
      ) {
        get().processAITurn();
        return;
      }

      // Liveness guard: if it's the player's turn but they have no playable
      // card (stamina drained, cooldowns), auto-pass so per-turn regen can
      // unstick them instead of soft-locking the battle.
      if (
        currentBattle.currentActorId === currentBattle.player.holobotId &&
        enoughDelayPassed &&
        ArenaCombatEngine.getPlayableCards(currentBattle, 'player', get().playerCards).length === 0
      ) {
        set({
          currentBattle: ArenaCombatEngine.passTurn(currentBattle, 'player'),
          lastAIActionTime: Date.now(),
        });
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
  selectCard: (cardId) => set({ selectedCardId: cardId }),

  // Helper: Get currently playable cards
  getPlayableCards: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return [];
    if (currentBattle.currentActorId !== currentBattle.player.holobotId) return [];
    return ArenaCombatEngine.getPlayableCards(currentBattle, 'player', playerCards);
  },

  // Helper: Check if specific card can be played
  canPlayCard: (cardId) => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return false;
    if (currentBattle.currentActorId !== currentBattle.player.holobotId) return false;
    const card = playerCards.find(c => c.id === cardId);
    if (!card) return false;
    return ArenaCombatEngine.canPlayCard(currentBattle, 'player', card);
  },

  getCardAvailabilityMap: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return {};

    return playerCards.reduce<Record<string, ArenaCardAvailability>>((result, card) => {
      result[card.id] = ArenaCombatEngine.getCardAvailability(currentBattle, 'player', card);
      return result;
    }, {});
  },
}));
