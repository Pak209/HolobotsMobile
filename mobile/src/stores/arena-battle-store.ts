import { create } from 'zustand';
import type {
  BattleState,
  BattleAction,
  ActionCard,
  ArenaFighter,
  ArenaBattleConfig,
  BattleRewards,
} from '../types/arena';
import { ArenaCombatEngine } from '../lib/arena/combat-engine';
import { CardPoolGenerator } from '../lib/arena/card-generator';
import { ArenaAI } from '../lib/arena/ai-controller';

function rotateCardQueue(cards: ActionCard[], usedCardId: string) {
  const usedIndex = cards.findIndex((card) => card.id === usedCardId);
  if (usedIndex < 0) {
    return cards;
  }

  const nextCards = [...cards];
  const [usedCard] = nextCards.splice(usedIndex, 1);
  nextCards.push(usedCard);
  return nextCards;
}

// ============================================================================
// Arena Battle Store
// ============================================================================

interface ArenaBattleStore {
  // Current Battle State
  currentBattle: BattleState | null;
  playerCards: ActionCard[];
  opponentCards: ActionCard[];
  ai: ArenaAI | null;

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
}

export const useArenaBattleStore = create<ArenaBattleStore>((set, get) => ({
  // Initial State
  currentBattle: null,
  playerCards: [],
  opponentCards: [],
  ai: null,
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
    const ai = new ArenaAI(config?.difficulty || 'medium');
    ai.initializeCardPool(opponent, config?.opponentBattleCards);

    set({
      currentBattle: battle,
      playerCards,
      opponentCards: ai.getCardPool(),
      ai,
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
    const { currentBattle, playerCards, ai } = get();
    if (!currentBattle || currentBattle.status !== 'active') return;

    const card = playerCards.find(c => c.id === cardId);
    if (!card) return;

    // Check if playable
    if (!ArenaCombatEngine.canPlayCard(currentBattle.player, card)) {
      console.warn('Cannot play card:', card.name);
      return;
    }

    // Create action
    const action: BattleAction = {
      id: `action_${Date.now()}`,
      turnNumber: currentBattle.turnNumber,
      actorId: currentBattle.player.holobotId,
      targetId: currentBattle.opponent.holobotId,
      card,
      timestamp: Date.now(),
      outcome: 'hit',
      damageDealt: 0,
      staminaChange: 0,
      specialMeterChange: 0,
      wasCountered: false,
      triggeredCombo: false,
      perfectDefense: false,
    };

    // Resolve action
    const newState = ArenaCombatEngine.resolveAction(currentBattle, action);
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    const nextPlayerCards = rotateCardQueue(playerCards, cardId);

    set({
      currentBattle: newState,
      lastAction: resolvedAction,
      isAnimating: true,
      playerCards: nextPlayerCards,
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
    const { currentBattle } = get();
    if (!currentBattle) return;

    set({
      currentBattle: {
        ...currentBattle,
        player: {
          ...currentBattle.player,
          isInDefenseMode: !currentBattle.player.isInDefenseMode,
        },
      },
    });
  },

  // Process AI turn
  processAITurn: () => {
    const { currentBattle, ai, opponentCards } = get();
    if (!currentBattle || !ai) return;
    if (currentBattle.status !== 'active') return;
    if (get().isAnimating) return;

    set({ isAnimating: true });

    // AI decides action
    const decision = ai.selectAction(currentBattle);

    // Create action
    const action: BattleAction = {
      id: `action_${Date.now()}`,
      turnNumber: currentBattle.turnNumber,
      actorId: currentBattle.opponent.holobotId,
      targetId: currentBattle.player.holobotId,
      card: decision.selectedCard,
      timestamp: Date.now(),
      outcome: 'hit',
      damageDealt: 0,
      staminaChange: 0,
      specialMeterChange: 0,
      wasCountered: false,
      triggeredCombo: false,
      perfectDefense: false,
    };

    // Update opponent defense mode
    let battleWithDefense = currentBattle;
    if (decision.enterDefenseMode) {
      battleWithDefense = {
        ...currentBattle,
        opponent: {
          ...currentBattle.opponent,
          isInDefenseMode: true,
        },
      };
    }

    // Resolve action
    const newState = ArenaCombatEngine.resolveAction(battleWithDefense, action);
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    const nextOpponentCards = rotateCardQueue(opponentCards, decision.selectedCard.id);

    set({
      currentBattle: newState,
      lastAction: resolvedAction,
      lastAIActionTime: Date.now(),
      opponentCards: nextOpponentCards,
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
      ai: null,
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
      ai: null,
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
      const { currentBattle, ai, isAnimating, lastAIActionTime } = get();
      if (!currentBattle || currentBattle.status !== 'active') {
        return;
      }

      const regeneratedBattle = ArenaCombatEngine.regenerateStamina(currentBattle);
      if (regeneratedBattle !== currentBattle) {
        set({ currentBattle: regeneratedBattle });
      }

      if (!ai || isAnimating) {
        return;
      }

      const aiPlayableCards = CardPoolGenerator.getPlayableCards(get().opponentCards, regeneratedBattle.opponent);
      const enoughDelayPassed = Date.now() - lastAIActionTime > 950;

      if (aiPlayableCards.length > 0 && enoughDelayPassed) {
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
  selectCard: (cardId) => set({ selectedCardId: cardId }),

  // Helper: Get currently playable cards
  getPlayableCards: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return [];
    return CardPoolGenerator.getPlayableCards(playerCards, currentBattle.player);
  },

  // Helper: Check if specific card can be played
  canPlayCard: (cardId) => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return false;
    const card = playerCards.find(c => c.id === cardId);
    if (!card) return false;
    return ArenaCombatEngine.canPlayCard(currentBattle.player, card);
  },
}));
