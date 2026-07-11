import { describe, expect, it } from 'vitest';

import {
  FINISHER_METER_REQUIREMENT,
  getSignatureFinisher,
  getSpecialMeterSegments,
  resolveCombatKit,
  validateCombatKit,
} from '../moveKits';

describe('resolveCombatKit', () => {
  it('builds a valid stock kit with one move of each category, in slot order', () => {
    const kit = resolveCombatKit();

    expect(kit.slots.map((move) => move.type)).toEqual(['strike', 'defense', 'combo', 'finisher']);
    expect(new Set(kit.slots.map((move) => move.templateId)).size).toBe(4);
  });

  it('picks the first move of each category in saved loadout order', () => {
    const kit = resolveCombatKit({
      deckTemplateIds: [
        'combo.chainBurst',
        'strike.snapShot',
        'defense.guardUp',
        'strike.quickJab',
        'combo.doubleTap',
      ],
    });

    expect(kit.slots[0].templateId).toBe('strike.snapShot');
    expect(kit.slots[1].templateId).toBe('defense.guardUp');
    expect(kit.slots[2].templateId).toBe('combo.chainBurst');
    expect(kit.slots[3].templateId).toBe('finisher.tacticalOverride');
  });

  it('takes the first owned finisher for slot 4 and fills gaps with stock', () => {
    const kit = resolveCombatKit({
      ownedBattleCards: { 'finisher.tacticalOverride': 1, 'strike.backhand': 1 },
    });

    expect(kit.slots[3].templateId).toBe('finisher.tacticalOverride');
    expect(kit.slots[0].templateId).toBe('strike.backhand');
    expect(() => validateCombatKit(kit)).not.toThrow();
  });

  it('gates the kit finisher at 4/7 of the special meter', () => {
    const finisher = resolveCombatKit().slots[3];

    expect(
      finisher.requirements.some(
        (req) =>
          req.type === 'special_meter' &&
          req.operator === 'gte' &&
          Number(req.value) === FINISHER_METER_REQUIREMENT,
      ),
    ).toBe(true);
    expect(finisher.requirements.some((req) => req.type === 'combo')).toBe(false);
  });

  it('maps internal meter values to 7 display segments consistently with the gate', () => {
    expect(getSpecialMeterSegments(0)).toBe(0);
    expect(getSpecialMeterSegments(FINISHER_METER_REQUIREMENT - 1)).toBe(3);
    expect(getSpecialMeterSegments(FINISHER_METER_REQUIREMENT)).toBe(4);
    expect(getSpecialMeterSegments(100)).toBe(7);
  });

  it('ignores unknown templates and still resolves a legal kit', () => {
    const kit = resolveCombatKit({ deckTemplateIds: ['card.doesNotExist', 'also.missing'] });

    expect(() => validateCombatKit(kit)).not.toThrow();
  });

  it('generates unique move instance ids across both fighters', () => {
    const player = resolveCombatKit({ idPrefix: 'player' });
    const opponent = resolveCombatKit({ idPrefix: 'opponent' });

    const ids = new Set([...player.slots, ...opponent.slots].map((move) => move.id));
    expect(ids.size).toBe(8);
  });
});

describe('getSignatureFinisher', () => {
  it('maps holobots to their signature identity (case-insensitive)', () => {
    expect(getSignatureFinisher('ace').name).toBe('1st Strike');
    expect(getSignatureFinisher('WOLF').name).toBe('Lunar Howl');
    expect(getSignatureFinisher(' shadow ').name).toBe('Shadow Strike');
  });

  it('falls back to a generic signature for unknown names', () => {
    expect(getSignatureFinisher('MYSTERY').id).toBe('signature.generic');
  });
});
