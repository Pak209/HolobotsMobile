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

// Real-time pacing: both fighters gain +1 stamina on this interval, and the
// AI plays its next card on its own cadence (independent of the player).
const STAMINA_REGEN_INTERVAL_MS = 2000;
const AI_ACTION_INTERVAL_MS = 950;

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

  // Player plays a card (real-time: any moment stamina and requirements allow)
  playCard: (cardId) => {
    const { currentBattle, playerCards, opponentCards } = get();
    if (!currentBattle || currentBattle.status !== 'active') return;

    const card = playerCards.find(c => c.id === cardId);
    if (!card) return;

    // Check if playable
    if (!ArenaCombatEngine.canPlayCard(currentBattle, 'player', card)) {
      console.warn('Cannot play card:', card.name);
      return;
    }

    const newState = ArenaCombatEngine.resolveAction(currentBattle, card, currentBattle.player.holobotId);
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    // Either meter can fill from this action (attacking builds the actor's,
    // taking damage builds the target's) — keep a finisher surfaced for
    // whichever fighter is charged.
    set({
      currentBattle: newState,
      playerCards: CardPoolGenerator.surfaceFinisher(
        CardPoolGenerator.cycleHand(playerCards, cardId),
        newState.player.specialMeter >= 100,
      ),
      opponentCards: CardPoolGenerator.surfaceFinisher(
        opponentCards,
        newState.opponent.specialMeter >= 100,
      ),
      lastAction: resolvedAction,
      isAnimating: true,
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

  // Process an AI action (real-time: fired on a cadence by the game loop)
  processAITurn: () => {
    const { currentBattle, opponentCards } = get();
    if (!currentBattle) return;
    if (currentBattle.status !== 'active') return;
    if (get().isAnimating) return;

    const selectedCard = ArenaCombatEngine.selectAIAction(currentBattle, opponentCards);
    if (!selectedCard) {
      // Nothing playable (stamina drained / cooldowns): wait for the timed
      // stamina regen and try again on the next cadence.
      set({ lastAIActionTime: Date.now() });
      return;
    }

    set({ isAnimating: true });

    const newState = ArenaCombatEngine.resolveAction(
      currentBattle,
      selectedCard,
      currentBattle.opponent.holobotId,
    );
    const resolvedAction = newState.actionHistory[newState.actionHistory.length - 1];

    set({
      currentBattle: newState,
      opponentCards: CardPoolGenerator.surfaceFinisher(
        CardPoolGenerator.cycleHand(opponentCards, selectedCard.id),
        newState.opponent.specialMeter >= 100,
      ),
      playerCards: CardPoolGenerator.surfaceFinisher(
        get().playerCards,
        newState.player.specialMeter >= 100,
      ),
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

  // Real-time game loop: stamina regenerates for both fighters on a fixed
  // interval, and the AI acts on its own cadence whenever it has a playable
  // card — it does not wait for the player.
  startGameLoop: () => {
    const existing = get().gameLoopIntervalId;
    if (existing) {
      clearInterval(existing);
    }

    let lastRegenAt = Date.now();

    const intervalId = setInterval(() => {
      const { currentBattle, isAnimating, lastAIActionTime, opponentCards } = get();
      if (!currentBattle || currentBattle.status !== 'active') {
        return;
      }

      const now = Date.now();
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
        ArenaCombatEngine.getPlayableCards(battle, 'opponent', opponentCards).length > 0
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
  selectCard: (cardId) => set({ selectedCardId: cardId }),

  // Helper: Get currently playable cards
  getPlayableCards: () => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return [];
    return ArenaCombatEngine.getPlayableCards(currentBattle, 'player', playerCards);
  },

  // Helper: Check if specific card can be played
  canPlayCard: (cardId) => {
    const { currentBattle, playerCards } = get();
    if (!currentBattle) return false;
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
