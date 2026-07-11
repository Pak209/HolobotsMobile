import { describe, expect, it } from 'vitest';

import type { ActionCard } from '@/types/arena';
import { CardPoolGenerator } from '../card-generator';

function makeCard(id: string): ActionCard {
  return {
    id,
    templateId: `template-${id}`,
    name: id,
    type: 'strike',
    staminaCost: 1,
    requirements: [],
    baseDamage: 10,
    speedModifier: 1,
    effects: [],
    animationId: 'test',
    description: 'test card',
  };
}

describe('CardPoolGenerator.cycleHand', () => {
  it('moves a played card out of the visible tray into the back half of the queue', () => {
    const hand = Array.from({ length: 10 }, (_, index) => makeCard(`card-${index}`));

    const cycled = CardPoolGenerator.cycleHand(hand, 'card-0');

    expect(cycled).toHaveLength(hand.length);
    // The played card leaves the front half (the tray shows the first 4).
    const frontHalf = cycled.slice(0, Math.ceil((cycled.length - 1) / 2)).map((card) => card.id);
    expect(frontHalf).not.toContain('card-0');
    // Nothing is lost or duplicated.
    expect(new Set(cycled.map((card) => card.id)).size).toBe(hand.length);
  });

  it('keeps the hand intact when the played card is not found', () => {
    const hand = Array.from({ length: 4 }, (_, index) => makeCard(`card-${index}`));

    expect(CardPoolGenerator.cycleHand(hand, 'missing')).toBe(hand);
  });
});
