import { describe, expect, it } from 'vitest';

import type { ActionCard } from '@/types/arena';
import { CardPoolGenerator } from '../card-generator';

function makeCard(id: string, type: ActionCard['type'] = 'strike'): ActionCard {
  return {
    id,
    templateId: `template-${id}`,
    name: id,
    type,
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

describe('CardPoolGenerator.surfaceFinisher', () => {
  it('surfaces a buried finisher to the tray when the meter is ready', () => {
    const hand = [
      ...Array.from({ length: 7 }, (_, index) => makeCard(`strike-${index}`)),
      makeCard('my-finisher', 'finisher'),
    ];

    const surfaced = CardPoolGenerator.surfaceFinisher(hand, true);

    expect(surfaced[0].id).toBe('my-finisher');
    expect(surfaced).toHaveLength(hand.length);
  });

  it('leaves the hand alone when a finisher is already visible or the meter is not ready', () => {
    const visible = [makeCard('my-finisher', 'finisher'), makeCard('a'), makeCard('b'), makeCard('c')];
    expect(CardPoolGenerator.surfaceFinisher(visible, true)).toBe(visible);

    const noMeter = [makeCard('a'), makeCard('b')];
    expect(CardPoolGenerator.surfaceFinisher(noMeter, false)).toBe(noMeter);
  });

  it('lends a default finisher to a deck without one and takes it back when the meter empties', () => {
    const hand = Array.from({ length: 5 }, (_, index) => makeCard(`strike-${index}`));

    const lent = CardPoolGenerator.surfaceFinisher(hand, true);
    expect(lent[0].type).toBe('finisher');
    expect(lent[0].id.startsWith(CardPoolGenerator.BONUS_FINISHER_ID_PREFIX)).toBe(true);
    expect(lent).toHaveLength(hand.length + 1);

    const reclaimed = CardPoolGenerator.surfaceFinisher(lent, false);
    expect(reclaimed).toHaveLength(hand.length);
    expect(reclaimed.some((card) => card.type === 'finisher')).toBe(false);
  });
});
