import type { ActionCard, ArenaFighter, CardType } from '../../types/arena';
import {
  STARTER_DECK_BALANCED_IDS,
  createActionCardFromTemplate,
} from '@/lib/battleCards/catalog';

// ============================================================================
// Card Templates Database
// ============================================================================

const CARD_TEMPLATES: Record<string, Omit<ActionCard, 'id'>> = {
  // STRIKES
  jab: {
    templateId: 'jab',
    name: 'Jab',
    type: 'strike',
    staminaCost: 1,
    baseDamage: 8,
    speedModifier: 1.3,
    requirements: [],
    effects: [{ type: 'damage', target: 'opponent', value: 8 }],
    animationId: 'strike_jab',
    description: 'Quick straight punch. Low damage but builds pressure.',
    iconName: 'zap',
  },
  cross: {
    templateId: 'cross',
    name: 'Cross',
    type: 'strike',
    staminaCost: 2,
    baseDamage: 15,
    speedModifier: 1.0,
    requirements: [],
    effects: [{ type: 'damage', target: 'opponent', value: 15 }],
    animationId: 'strike_cross',
    description: 'Powerful straight punch from the rear hand.',
    iconName: 'target',
  },
  hook: {
    templateId: 'hook',
    name: 'Hook',
    type: 'strike',
    staminaCost: 2,
    baseDamage: 18,
    speedModifier: 0.9,
    requirements: [],
    effects: [{ type: 'damage', target: 'opponent', value: 18 }],
    animationId: 'strike_hook',
    description: 'Curved punch targeting the side of the head.',
    iconName: 'corner-down-right',
  },
  uppercut: {
    templateId: 'uppercut',
    name: 'Uppercut',
    type: 'strike',
    staminaCost: 3,
    baseDamage: 22,
    speedModifier: 0.8,
    requirements: [],
    effects: [
      { type: 'damage', target: 'opponent', value: 22 },
      { type: 'special_meter', target: 'self', value: 5 },
    ],
    animationId: 'strike_uppercut',
    description: 'Rising punch to the chin. Builds extra meter.',
    iconName: 'arrow-up',
  },
  bodyShot: {
    templateId: 'body_shot',
    name: 'Body Shot',
    type: 'strike',
    staminaCost: 2,
    baseDamage: 12,
    speedModifier: 1.0,
    requirements: [],
    effects: [
      { type: 'damage', target: 'opponent', value: 12 },
      { type: 'stamina_gain', target: 'self', value: 1 },
    ],
    animationId: 'strike_body',
    description: 'Strike to the body. Recovers stamina on hit.',
    iconName: 'circle',
  },
  spinningBackfist: {
    templateId: 'spinning_backfist',
    name: 'Spinning Backfist',
    type: 'strike',
    staminaCost: 3,
    baseDamage: 25,
    speedModifier: 0.7,
    requirements: [{ type: 'stamina', operator: 'gte', value: 3 }],
    effects: [{ type: 'damage', target: 'opponent', value: 25 }],
    animationId: 'strike_spin',
    description: 'Risky spinning strike. High damage if it lands.',
    iconName: 'rotate-cw',
  },

  // DEFENSE
  block: {
    templateId: 'block',
    name: 'Guard Protocol',
    type: 'defense',
    staminaCost: 1,
    baseDamage: 0,
    speedModifier: 1.5,
    requirements: [],
    effects: [{ type: 'status', target: 'self', value: 1, duration: 1 }],
    animationId: 'defense_block',
    description: 'Arms a guard trap that reduces the next incoming hit.',
    iconName: 'shield',
    tier: 'common',
  },
  slip: {
    templateId: 'slip',
    name: 'Evasion Step',
    type: 'defense',
    staminaCost: 2,
    baseDamage: 0,
    speedModifier: 1.4,
    requirements: [],
    effects: [
      { type: 'status', target: 'self', value: 1, duration: 1 },
      { type: 'combo_enable', target: 'self', value: 1 },
    ],
    animationId: 'defense_slip',
    description: 'Arms an evade trap with a strong chance to avoid the next attack.',
    iconName: 'move',
    tier: 'rare',
  },
  parry: {
    templateId: 'parry',
    name: 'Counter Guard',
    type: 'defense',
    staminaCost: 3,
    baseDamage: 0,
    speedModifier: 1.2,
    requirements: [],
    effects: [
      { type: 'status', target: 'self', value: 1, duration: 1 },
      { type: 'stamina_gain', target: 'self', value: 2 },
    ],
    animationId: 'defense_parry',
    description: 'Arms a counter trap that softens the hit and returns damage.',
    iconName: 'repeat',
    tier: 'epic',
  },
  roll: {
    templateId: 'roll',
    name: 'Perfect Reversal',
    type: 'defense',
    staminaCost: 4,
    baseDamage: 0,
    speedModifier: 1.1,
    requirements: [],
    effects: [{ type: 'status', target: 'self', value: 1, duration: 2 }],
    animationId: 'defense_roll',
    description: 'Arms a legendary reversal trap that fully negates and punishes the next hit.',
    iconName: 'refresh-cw',
    tier: 'legendary',
  },

  // COMBOS
  oneTwo: {
    templateId: 'one_two',
    name: 'One-Two',
    type: 'combo',
    staminaCost: 3,
    baseDamage: 20,
    speedModifier: 1.1,
    requirements: [{ type: 'combo', operator: 'gte', value: 1 }],
    effects: [
      { type: 'damage', target: 'opponent', value: 20 },
      { type: 'combo_enable', target: 'self', value: 1 },
    ],
    animationId: 'combo_onetwo',
    description: 'Classic jab-cross combination.',
    iconName: 'chevrons-right',
  },
  tripleStrike: {
    templateId: 'triple_strike',
    name: 'Triple Strike',
    type: 'combo',
    staminaCost: 4,
    baseDamage: 30,
    speedModifier: 1.0,
    requirements: [{ type: 'combo', operator: 'gte', value: 2 }],
    effects: [
      { type: 'damage', target: 'opponent', value: 30 },
      { type: 'special_meter', target: 'self', value: 10 },
    ],
    animationId: 'combo_triple',
    description: 'Three-punch combination. Builds significant meter.',
    iconName: 'layers',
  },
  flurry: {
    templateId: 'flurry',
    name: 'Flurry',
    type: 'combo',
    staminaCost: 5,
    baseDamage: 40,
    speedModifier: 0.9,
    requirements: [{ type: 'combo', operator: 'gte', value: 3 }],
    effects: [
      { type: 'damage', target: 'opponent', value: 40 },
      { type: 'special_meter', target: 'self', value: 15 },
    ],
    animationId: 'combo_flurry',
    description: 'Rapid five-hit barrage. Devastating combo finisher.',
    iconName: 'wind',
  },

  // FINISHERS
  knockoutBlow: {
    templateId: 'knockout_blow',
    name: 'Knockout Blow',
    type: 'finisher',
    staminaCost: 5,
    baseDamage: 60,
    speedModifier: 0.6,
    requirements: [
      { type: 'special_meter', operator: 'gte', value: 100 },
      { type: 'opponent_state', operator: 'equals', value: 'gassed' },
    ],
    effects: [{ type: 'damage', target: 'opponent', value: 60 }],
    animationId: 'finisher_ko',
    description: 'Devastating finishing blow. Requires full meter and weakened opponent.',
    iconName: 'zap-off',
  },
  hyperStrike: {
    templateId: 'hyper_strike',
    name: 'Hyper Strike',
    type: 'finisher',
    staminaCost: 4,
    baseDamage: 50,
    speedModifier: 0.7,
    requirements: [{ type: 'special_meter', operator: 'gte', value: 100 }],
    effects: [
      { type: 'damage', target: 'opponent', value: 50 },
      { type: 'stamina_gain', target: 'self', value: 3 },
    ],
    animationId: 'finisher_hyper',
    description: 'Signature finishing move. Recovers stamina on success.',
    iconName: 'star',
  },
  ultimateCombo: {
    templateId: 'ultimate_combo',
    name: 'Ultimate Combo',
    type: 'finisher',
    staminaCost: 6,
    baseDamage: 75,
    speedModifier: 0.5,
    requirements: [
      { type: 'special_meter', operator: 'gte', value: 100 },
      { type: 'combo', operator: 'gte', value: 4 },
    ],
    effects: [{ type: 'damage', target: 'opponent', value: 75 }],
    animationId: 'finisher_ultimate',
    description: 'The ultimate finishing combination. Maximum damage.',
    iconName: 'award',
  },
};

// ============================================================================
// Card Pool Generator
// ============================================================================

export class CardPoolGenerator {
  private static idCounter = 0;

  static generateId(): string {
    return `card_${Date.now()}_${++this.idCounter}`;
  }

  static generateBattleHand(
    _fighter: ArenaFighter,
    ownedBattleCards?: Record<string, number>,
  ): ActionCard[] {
    const ownedTemplateIds = Object.entries(ownedBattleCards || {})
      .filter(([, quantity]) => Number(quantity) > 0)
      .flatMap(([templateId, quantity]) => Array.from({ length: Math.min(Number(quantity), 3) }, () => templateId))
      .filter((templateId) => createActionCardFromTemplate(templateId, 'probe'));

    if (ownedTemplateIds.length > 0) {
      return this.buildHandFromTemplateIds(ownedTemplateIds);
    }

    return this.buildHandFromTemplateIds(STARTER_DECK_BALANCED_IDS);
  }

  static buildHandFromTemplateIds(templateIds: string[]): ActionCard[] {
    const uniqueCards = templateIds
      .map((templateId) => createActionCardFromTemplate(templateId, this.generateId()))
      .filter((card): card is ActionCard => Boolean(card));

    if (uniqueCards.length >= 6) {
      return this.shuffle(uniqueCards).slice(0, 10);
    }

    const cards: ActionCard[] = [];

    const baseCards = ['jab', 'cross', 'block', 'slip'];
    baseCards.forEach(templateId => {
      const template = CARD_TEMPLATES[templateId];
      if (template) {
        cards.push({ ...template, id: this.generateId() });
      }
    });

    return cards;
  }

  static readonly BONUS_FINISHER_ID_PREFIX = 'bonus-finisher-';

  /**
   * Keeps a finisher on the tray while the special meter is charged: a
   * finisher buried past the visible slots surfaces to the front, and a
   * fighter whose deck owns no finisher at all is lent a default one. The
   * loaner is taken back once the meter is no longer full.
   */
  static surfaceFinisher(cards: ActionCard[], meterReady: boolean, traySize = 4): ActionCard[] {
    if (!meterReady) {
      const withoutBonus = cards.filter((card) => !card.id.startsWith(this.BONUS_FINISHER_ID_PREFIX));
      return withoutBonus.length === cards.length ? cards : withoutBonus;
    }

    if (cards.slice(0, traySize).some((card) => card.type === 'finisher')) {
      return cards;
    }

    const buriedIndex = cards.findIndex((card) => card.type === 'finisher');
    if (buriedIndex >= 0) {
      const next = [...cards];
      const [finisher] = next.splice(buriedIndex, 1);
      next.unshift(finisher);
      return next;
    }

    return [
      { ...CARD_TEMPLATES.hyperStrike, id: `${this.BONUS_FINISHER_ID_PREFIX}${this.generateId()}` },
      ...cards,
    ];
  }

  /**
   * Cycles a played card out of the visible tray: it leaves its slot and is
   * reinserted at a random position in the back half of the queue, so the
   * tray keeps surfacing fresh cards from the player's full battle deck.
   */
  static cycleHand(cards: ActionCard[], playedCardId: string): ActionCard[] {
    const index = cards.findIndex((card) => card.id === playedCardId);
    if (index === -1 || cards.length <= 1) {
      return cards;
    }

    const next = [...cards];
    const [played] = next.splice(index, 1);
    const minIndex = Math.max(1, Math.ceil(next.length / 2));
    const insertAt = minIndex + Math.floor(Math.random() * (next.length - minIndex + 1));
    next.splice(insertAt, 0, played);
    return next;
  }

  private static shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  static getArchetypeCards(archetype: ArenaFighter['archetype']): string[] {
    switch (archetype) {
      case 'striker':
        return ['hook', 'uppercut', 'spinningBackfist', 'oneTwo', 'tripleStrike'];
      case 'grappler':
        return ['bodyShot', 'parry', 'roll', 'oneTwo', 'flurry'];
      case 'technical':
        return ['bodyShot', 'slip', 'parry', 'tripleStrike', 'flurry'];
      case 'balanced':
      default:
        return ['hook', 'bodyShot', 'parry', 'oneTwo', 'tripleStrike'];
    }
  }

  static getCardsByType(cards: ActionCard[], type: CardType): ActionCard[] {
    return cards.filter(card => card.type === type);
  }

  static getPlayableCards(cards: ActionCard[], fighter: ArenaFighter): ActionCard[] {
    return cards.filter(card => {
      if (fighter.stamina < card.staminaCost) return false;
      if (card.type === 'defense' && (fighter.defenseCooldownUntil || 0) > Date.now()) return false;

      for (const req of card.requirements) {
        switch (req.type) {
          case 'stamina':
            if (req.operator === 'gte' && fighter.stamina < (req.value as number)) return false;
            break;
          case 'special_meter':
            if (req.operator === 'gte' && fighter.specialMeter < (req.value as number)) return false;
            break;
          case 'combo':
            if (req.operator === 'gte' && fighter.comboCounter < (req.value as number)) return false;
            break;
          case 'opponent_state':
            // This needs opponent context - handled elsewhere
            break;
        }
      }

      return true;
    });
  }
}
