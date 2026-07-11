import { describe, expect, it } from 'vitest';

import { getSignatureFinisher, resolveCombatKit, validateCombatKit } from '../moveKits';

describe('resolveCombatKit', () => {
  it('builds a valid stock kit from nothing', () => {
    const kit = resolveCombatKit();

    expect(kit.slots).toHaveLength(4);
    expect(kit.slots[3].type).toBe('finisher');
    kit.slots.slice(0, 3).forEach((move) => expect(move.type).not.toBe('finisher'));
    expect(new Set(kit.slots.map((move) => move.templateId)).size).toBe(4);
  });

  it('honors saved loadout order for slots 1-3', () => {
    const kit = resolveCombatKit({
      deckTemplateIds: ['combo.chainBurst', 'strike.snapShot', 'defense.guardUp', 'strike.quickJab'],
    });

    expect(kit.slots[0].templateId).toBe('combo.chainBurst');
    expect(kit.slots[1].templateId).toBe('strike.snapShot');
    expect(kit.slots[2].templateId).toBe('defense.guardUp');
    expect(kit.slots[3].templateId).toBe('finisher.tacticalOverride');
  });

  it('takes the first owned technique finisher for slot 4 and fills gaps with stock', () => {
    const kit = resolveCombatKit({
      ownedBattleCards: { 'finisher.tacticalOverride': 1, 'strike.backhand': 1 },
    });

    expect(kit.slots[3].templateId).toBe('finisher.tacticalOverride');
    expect(kit.slots[0].templateId).toBe('strike.backhand');
    expect(() => validateCombatKit(kit)).not.toThrow();
  });

  it('replaces the legacy meter gate with a combo gate on technique finishers', () => {
    const finisher = resolveCombatKit().slots[3];

    expect(finisher.requirements.some((req) => req.type === 'special_meter')).toBe(false);
    expect(finisher.requirements.some((req) => req.type === 'combo')).toBe(true);
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
