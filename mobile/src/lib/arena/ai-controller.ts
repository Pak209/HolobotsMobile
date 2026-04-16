import type {
  ArenaFighter,
  BattleState,
  ActionCard,
  AIDecision,
  AIPersonality,
} from '../../types/arena';
import { CardPoolGenerator } from './card-generator';

// ============================================================================
// Arena AI Controller
// ============================================================================

export class ArenaAI {
  private personality: AIPersonality;
  private difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  private cardPool: ActionCard[];

  constructor(difficulty: 'easy' | 'medium' | 'hard' | 'expert' = 'medium') {
    this.difficulty = difficulty;
    this.personality = this.generatePersonality(difficulty);
    this.cardPool = [];
  }

  initializeCardPool(fighter: ArenaFighter, ownedBattleCards?: Record<string, number>): void {
    this.cardPool = CardPoolGenerator.generateBattleHand(fighter, ownedBattleCards);
  }

  getCardPool(): ActionCard[] {
    return this.cardPool;
  }

  private generatePersonality(difficulty: string): AIPersonality {
    switch (difficulty) {
      case 'easy':
        return {
          aggression: 0.7,
          patience: 0.2,
          riskTolerance: 0.8,
          adaptability: 0.2,
        };
      case 'medium':
        return {
          aggression: 0.5,
          patience: 0.5,
          riskTolerance: 0.5,
          adaptability: 0.5,
        };
      case 'hard':
        return {
          aggression: 0.4,
          patience: 0.7,
          riskTolerance: 0.3,
          adaptability: 0.8,
        };
      case 'expert':
        return {
          aggression: 0.3,
          patience: 0.9,
          riskTolerance: 0.2,
          adaptability: 0.95,
        };
      default:
        return {
          aggression: 0.5,
          patience: 0.5,
          riskTolerance: 0.5,
          adaptability: 0.5,
        };
    }
  }

  selectAction(state: BattleState): AIDecision {
    const self = state.opponent;
    const opponent = state.player;

    // Get playable cards
    const playableCards = CardPoolGenerator.getPlayableCards(this.cardPool, self);

    if (playableCards.length === 0) {
      // No cards available - must pass or use lowest cost option
      const lowestCostCard = this.cardPool.reduce((min, card) =>
        card.staminaCost < min.staminaCost ? card : min
      );
      return {
        selectedCard: lowestCostCard,
        confidence: 0.1,
        reasoning: 'No playable cards, forced action',
        enterDefenseMode: true,
      };
    }

    // Decision making based on situation
    const situation = this.analyzeSituation(self, opponent, state);

    // Should we defend?
    if (this.shouldDefend(situation)) {
      const defenseCards = playableCards.filter(c => c.type === 'defense');
      if (defenseCards.length > 0) {
        const selectedDefense = this.selectBestDefense(defenseCards, situation);
        return {
          selectedCard: selectedDefense,
          confidence: 0.8,
          reasoning: 'Defensive play - protecting HP or recovering stamina',
          enterDefenseMode: true,
        };
      }
    }

    // Can we use a finisher?
    if (self.specialMeter >= 100) {
      const finishers = playableCards.filter(c => c.type === 'finisher');
      if (finishers.length > 0 && (opponent.staminaState === 'gassed' || opponent.staminaState === 'exhausted')) {
        return {
          selectedCard: finishers[0],
          confidence: 0.95,
          reasoning: 'Finisher opportunity - opponent is vulnerable',
          enterDefenseMode: false,
        };
      }
    }

    // Can we combo?
    if (self.comboCounter >= 2) {
      const combos = playableCards.filter(c => c.type === 'combo');
      if (combos.length > 0) {
        return {
          selectedCard: this.selectBestCombo(combos, situation),
          confidence: 0.7,
          reasoning: 'Continuing combo chain',
          enterDefenseMode: false,
        };
      }
    }

    // Standard attack selection
    const strikes = playableCards.filter(c => c.type === 'strike');
    if (strikes.length > 0) {
      return {
        selectedCard: this.selectBestStrike(strikes, situation),
        confidence: 0.6,
        reasoning: 'Standard offensive play',
        enterDefenseMode: false,
      };
    }

    // Fallback to any playable card
    return {
      selectedCard: playableCards[0],
      confidence: 0.3,
      reasoning: 'Fallback selection',
      enterDefenseMode: false,
    };
  }

  private analyzeSituation(
    self: ArenaFighter,
    opponent: ArenaFighter,
    _state: BattleState
  ): SituationAnalysis {
    const hpPercent = self.currentHP / self.maxHP;
    const opponentHpPercent = opponent.currentHP / opponent.maxHP;
    const staminaPercent = self.stamina / self.maxStamina;

    return {
      isWinning: hpPercent > opponentHpPercent,
      isLowHP: hpPercent < 0.3,
      isLowStamina: staminaPercent < 0.3,
      opponentLowHP: opponentHpPercent < 0.3,
      opponentLowStamina: opponent.stamina / opponent.maxStamina < 0.3,
      opponentInDefense: opponent.isInDefenseMode,
      hasFinisherReady: self.specialMeter >= 100,
      comboActive: self.comboCounter >= 2,
    };
  }

  private shouldDefend(situation: SituationAnalysis): boolean {
    // Always consider defending if low HP
    if (situation.isLowHP && Math.random() < 0.7) return true;

    // Consider stamina recovery
    if (situation.isLowStamina && Math.random() < 0.5) return true;

    // Personality-based decision
    if (Math.random() > this.personality.aggression) {
      if (Math.random() < this.personality.patience) return true;
    }

    return false;
  }

  private selectBestDefense(defenseCards: ActionCard[], situation: SituationAnalysis): ActionCard {
    // If low stamina, prefer parry for recovery
    if (situation.isLowStamina) {
      const parry = defenseCards.find(c => c.templateId === 'parry');
      if (parry) return parry;
    }

    // If opponent has combo, prefer roll for longer defense
    if (situation.comboActive) {
      const roll = defenseCards.find(c => c.templateId === 'roll');
      if (roll) return roll;
    }

    // Otherwise slip for counter opportunity
    const slip = defenseCards.find(c => c.templateId === 'slip');
    if (slip) return slip;

    return defenseCards[0];
  }

  private selectBestStrike(strikes: ActionCard[], situation: SituationAnalysis): ActionCard {
    // If opponent is low, go for high damage
    if (situation.opponentLowHP) {
      return strikes.reduce((best, card) =>
        card.baseDamage > best.baseDamage ? card : best
      );
    }

    // If we're low on stamina, prefer efficient strikes
    if (situation.isLowStamina) {
      return strikes.reduce((best, card) =>
        (card.baseDamage / card.staminaCost) > (best.baseDamage / best.staminaCost) ? card : best
      );
    }

    // Balanced selection with some randomness
    const scores = strikes.map(card => ({
      card,
      score: this.scoreCard(card, situation),
    }));

    scores.sort((a, b) => b.score - a.score);

    // Pick from top 2 with some randomness
    const topCards = scores.slice(0, Math.min(2, scores.length));
    return topCards[Math.floor(Math.random() * topCards.length)].card;
  }

  private selectBestCombo(combos: ActionCard[], _situation: SituationAnalysis): ActionCard {
    // Prefer higher damage combos when available
    return combos.reduce((best, card) =>
      card.baseDamage > best.baseDamage ? card : best
    );
  }

  private scoreCard(card: ActionCard, situation: SituationAnalysis): number {
    let score = card.baseDamage;

    // Efficiency bonus
    score += (card.baseDamage / card.staminaCost) * 5;

    // Speed bonus (faster cards harder to defend)
    score += card.speedModifier * 10;

    // Situation adjustments
    if (situation.opponentLowHP) {
      score += card.baseDamage * 0.5; // Favor high damage
    }

    if (situation.isLowStamina) {
      score -= card.staminaCost * 3; // Penalize high cost
    }

    // Add some randomness based on difficulty
    const randomness = (1 - this.personality.adaptability) * 20;
    score += (Math.random() - 0.5) * randomness;

    return score;
  }
}

interface SituationAnalysis {
  isWinning: boolean;
  isLowHP: boolean;
  isLowStamina: boolean;
  opponentLowHP: boolean;
  opponentLowStamina: boolean;
  opponentInDefense: boolean;
  hasFinisherReady: boolean;
  comboActive: boolean;
}
