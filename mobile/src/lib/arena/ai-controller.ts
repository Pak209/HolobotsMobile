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
          aggression: 0.85,
          patience: 0.2,
          riskTolerance: 0.8,
          adaptability: 0.2,
        };
      case 'medium':
        return {
          aggression: 0.78,
          patience: 0.35,
          riskTolerance: 0.5,
          adaptability: 0.5,
        };
      case 'hard':
        return {
          aggression: 0.72,
          patience: 0.45,
          riskTolerance: 0.45,
          adaptability: 0.8,
        };
      case 'expert':
        return {
          aggression: 0.68,
          patience: 0.55,
          riskTolerance: 0.4,
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

  selectAction(state: BattleState, playableCardsArg?: ActionCard[]): AIDecision {
    const self = state.opponent;
    const opponent = state.player;

    const playableCards = playableCardsArg ?? [];

    if (playableCards.length === 0) {
      return {
        selectedCard: null,
        confidence: 0.1,
        reasoning: 'No playable cards available, passing turn',
        enterDefenseMode: false,
      };
    }

    // Decision making based on situation
    const situation = this.analyzeSituation(self, opponent, state);

    const defenseCards = playableCards.filter(c => c.type === 'defense');
    const strikeCards = playableCards.filter(c => c.type === 'strike');
    const comboCards = playableCards.filter(c => c.type === 'combo');
    const finisherCards = playableCards.filter(c => c.type === 'finisher');
    const attackCards = [...strikeCards, ...comboCards];

    // Should we defend?
    if (this.shouldDefend(situation, attackCards.length > 0)) {
      if (defenseCards.length > 0) {
        const selectedDefense = this.selectBestDefense(defenseCards, situation);
        return {
          selectedCard: selectedDefense,
          confidence: 0.8,
          reasoning: 'Defensive play - protecting HP or recovering stamina',
          enterDefenseMode: false,
        };
      }
    }

    // Can we use a finisher?
    if (self.specialMeter >= 100) {
      if (
        finisherCards.length > 0 &&
        !opponent.armedDefenseTrap &&
        (
          opponent.staminaState === 'working' ||
          opponent.staminaState === 'gassed' ||
          opponent.staminaState === 'exhausted' ||
          situation.opponentLowHP
        )
      ) {
        return {
          selectedCard: finisherCards[0],
          confidence: 0.95,
          reasoning: 'Finisher opportunity - opponent is vulnerable',
          enterDefenseMode: false,
        };
      }
    }

    // Can we combo?
    if (self.comboCounter >= 1) {
      if (comboCards.length > 0) {
        return {
          selectedCard: this.selectBestCombo(comboCards, situation),
          confidence: 0.7,
          reasoning: 'Continuing combo chain',
          enterDefenseMode: false,
        };
      }
    }

    // Standard attack selection
    if (strikeCards.length > 0) {
      const highPressureStrike = strikeCards.find((card) => card.staminaCost <= self.stamina && card.baseDamage >= 15);
      if (highPressureStrike && !situation.isLowStamina) {
        return {
          selectedCard: highPressureStrike,
          confidence: 0.8,
          reasoning: 'High-pressure offensive play',
          enterDefenseMode: false,
        };
      }

      return {
        selectedCard: this.selectBestStrike(strikeCards, situation),
        confidence: 0.6,
        reasoning: 'Standard offensive play',
        enterDefenseMode: false,
      };
    }

    if (comboCards.length > 0) {
      return {
        selectedCard: this.selectBestCombo(comboCards, situation),
        confidence: 0.65,
        reasoning: 'Available combo pressure',
        enterDefenseMode: false,
      };
    }

    if (defenseCards.length > 0) {
      return {
        selectedCard: this.selectBestDefense(defenseCards, situation),
        confidence: 0.45,
        reasoning: 'Fallback defense to recover stamina and arm trap',
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
      opponentInDefense: Boolean(opponent.armedDefenseTrap),
      hasFinisherReady: self.specialMeter >= 100,
      comboActive: self.comboCounter >= 2,
    };
  }

  private shouldDefend(situation: SituationAnalysis, hasPlayableAttack: boolean): boolean {
    if (!situation.isLowHP && !situation.isLowStamina) return false;
    if (situation.opponentLowHP && situation.isWinning) return false;

    if (situation.isLowHP && Math.random() < (hasPlayableAttack ? 0.45 : 0.8)) return true;

    if (situation.isLowStamina && Math.random() < (hasPlayableAttack ? 0.45 : 0.9)) return true;

    if (!situation.isWinning && situation.opponentLowHP) return false;

    // Personality-based decision
    if (Math.random() > this.personality.aggression + 0.18) {
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

    const highestDamage = strikes.reduce((best, card) =>
      card.baseDamage > best.baseDamage ? card : best
    );

    if (!situation.isLowStamina && Math.random() < this.personality.aggression) {
      return highestDamage;
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
