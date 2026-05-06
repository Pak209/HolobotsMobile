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
    if (!ArenaCombatEngine.canPlayCard(currentBattle.player, card, currentBattle, true)) {
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

  // Trigger defense by actually playing a defense card through the shared engine
  toggleDefenseMode: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle || currentBattle.status !== 'active') return;

    const defenseCard = ArenaCombatEngine.getPlayableCards(
      playerCards,
      currentBattle.player,
      currentBattle.opponent,
      currentBattle,
      true,
    ).find((card) => card.type === 'defense');

    if (!defenseCard) return;
    get().playCard(defenseCard.id);
  },

  // Process AI turn
  processAITurn: () => {
    const { currentBattle, ai, opponentCards } = get();
    if (!currentBattle || !ai) return;
    if (currentBattle.status !== "active") return;

    set({ isAnimating: true });

    const aiPlayableCards = ArenaCombatEngine.getPlayableCards(
      opponentCards,
      currentBattle.opponent,
      currentBattle.player,
      currentBattle,
      false,
    );

    const decision = ai.selectAction(currentBattle, aiPlayableCards);

    if (!decision.selectedCard) {
      set({
        isAnimating: false,
        lastAIActionTime: Date.now(),
      });
      return;
    }

    const action: BattleAction = {
      id: `action_${Date.now()}`,
      turnNumber: currentBattle.turnNumber,
      actorId: currentBattle.opponent.holobotId,
      targetId: currentBattle.player.holobotId,
      card: decision.selectedCard,
      timestamp: Date.now(),
      outcome: "hit",
      damageDealt: 0,
      staminaChange: 0,
      specialMeterChange: 0,
      wasCountered: false,
      triggeredCombo: false,
      perfectDefense: false,
    };

    if (!ArenaCombatEngine.canPlayCard(currentBattle.opponent, decision.selectedCard, currentBattle, false)) {
      set({
        isAnimating: false,
        lastAIActionTime: Date.now(),
      });
      return;
    }

    const newState = ArenaCombatEngine.resolveAction(currentBattle, action);
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
      const { currentBattle, ai, lastAIActionTime } = get();
      if (!currentBattle || currentBattle.status !== 'active') {
        return;
      }

      const regeneratedBattle = ArenaCombatEngine.regenerateStamina(currentBattle);
      if (regeneratedBattle !== currentBattle) {
        set({ currentBattle: regeneratedBattle });
      }

      if (!ai) {
        return;
      }

      const enoughDelayPassed = Date.now() - lastAIActionTime > 700;

      if (enoughDelayPassed) {
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
    return ArenaCombatEngine.getPlayableCards(
      playerCards,
      currentBattle.player,
      currentBattle.opponent,
      currentBattle,
      true,
    );
  },

  // Helper: Check if specific card can be played
  canPlayCard: (cardId) => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return false;
    const card = playerCards.find(c => c.id === cardId);
    if (!card) return false;
    return ArenaCombatEngine.canPlayCard(currentBattle.player, card, currentBattle, true);
  },
}));
