import { describe, expect, it } from 'vitest';

import type { UserProfile } from '@/types/profile';
import { resolveMove } from '../moveKits';
import {
  applyMoveProgress,
  buildKitSaveUpdates,
  buildMoveUpgradeUpdates,
  CATEGORY_SPECIALIZATIONS,
  MOVE_RANK_SP_COSTS,
} from '../moveProgression';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    holobots: [{ name: 'ACE', level: 5, experience: 0, nextLevelExp: 100 }],
    battle_cards: {
      'combo.doubleTap': 1,
      'combo.chainBurst': 1,
      'defense.guardUp': 1,
      'finisher.tacticalOverride': 1,
      'strike.quickJab': 1,
      'strike.snapShot': 1,
    },
    syncPoints: 500,
    ...overrides,
  } as UserProfile;
}

describe('applyMoveProgress', () => {
  const jab = resolveMove('strike.quickJab', 'test')!;

  it('is a no-op at rank 0 and idempotent from the base move', () => {
    expect(applyMoveProgress(jab, { rank: 0 })).toEqual(jab);

    const once = applyMoveProgress(jab, { rank: 1 });
    const again = applyMoveProgress(jab, { rank: 1 });
    expect(again).toEqual(once);
  });

  it('rank 1 improves damage for attacks', () => {
    const upgraded = applyMoveProgress(jab, { rank: 1 });
    expect(upgraded.baseDamage).toBeGreaterThan(jab.baseDamage);
    expect(upgraded.staminaCost).toBe(jab.staminaCost);
  });

  it('cost-reduction branches never drop a move below cost 1 (guardrail)', () => {
    // quickJab costs 1: the Pressure branch cannot reduce it further.
    const upgraded = applyMoveProgress(jab, { rank: 2, specializationId: 'strike.pressure' });
    expect(upgraded.staminaCost).toBe(1);

    const finisher = resolveMove('finisher.tacticalOverride', 'test')!;
    const reliable = applyMoveProgress(finisher, { rank: 2, specializationId: 'finisher.reliable' });
    expect(reliable.staminaCost).toBe(finisher.staminaCost - 1);
  });

  it('damage branches scale with rank 3 deepening', () => {
    const power2 = applyMoveProgress(jab, { rank: 2, specializationId: 'strike.power' });
    const power3 = applyMoveProgress(jab, { rank: 3, specializationId: 'strike.power' });
    expect(power3.baseDamage).toBeGreaterThan(power2.baseDamage);
  });
});

describe('buildMoveUpgradeUpdates', () => {
  it('debits Sync Points and records the new rank on the holobot', () => {
    const profile = makeProfile();

    const result = buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 0);

    expect(result.cost).toBe(MOVE_RANK_SP_COSTS[1]);
    expect(result.updates.syncPoints).toBe(500 - MOVE_RANK_SP_COSTS[1]);
    expect(result.updates.holobots[0].moveProgress?.['strike.quickJab']).toEqual({ rank: 1 });
  });

  it('requires a valid branch choice at rank 2 and stores it', () => {
    const profile = makeProfile({
      holobots: [{
        name: 'ACE', level: 5, experience: 0, nextLevelExp: 100,
        moveProgress: { 'strike.quickJab': { rank: 1 } },
      }],
    });

    expect(() => buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 1)).toThrow(/branch/i);
    expect(() =>
      buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 1, 'combo.flow'),
    ).toThrow(/branch/i);

    const result = buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 1, 'strike.power');
    expect(result.updates.holobots[0].moveProgress?.['strike.quickJab']).toEqual({
      rank: 2,
      specializationId: 'strike.power',
    });
  });

  it('enforces sequential ranks via the optimistic expectedRank', () => {
    const profile = makeProfile();
    expect(() => buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 1)).toThrow(/changed/i);
  });

  it('rejects insufficient Sync Points, unknown holobots, and unowned moves', () => {
    expect(() =>
      buildMoveUpgradeUpdates(makeProfile({ syncPoints: 5 }), 'ACE', 'strike.quickJab', 0),
    ).toThrow(/Sync Points/i);
    expect(() => buildMoveUpgradeUpdates(makeProfile(), 'WOLF', 'strike.quickJab', 0)).toThrow(/own/i);
    expect(() => buildMoveUpgradeUpdates(makeProfile(), 'ACE', 'strike.heavySlam', 0)).toThrow(/pool/i);
  });

  it('rejects upgrades past max rank', () => {
    const profile = makeProfile({
      holobots: [{
        name: 'ACE', level: 5, experience: 0, nextLevelExp: 100,
        moveProgress: { 'strike.quickJab': { rank: 3, specializationId: 'strike.power' } },
      }],
    });
    expect(() => buildMoveUpgradeUpdates(profile, 'ACE', 'strike.quickJab', 3)).toThrow(/max rank/i);
  });
});

describe('buildKitSaveUpdates', () => {
  const validSlots: [string, string, string, string] = [
    'strike.snapShot',
    'defense.guardUp',
    'combo.doubleTap',
    'finisher.tacticalOverride',
  ];

  it('saves a valid kit and bumps the revision', () => {
    const result = buildKitSaveUpdates(makeProfile(), 'ACE', validSlots, 0);

    expect(result.revision).toBe(1);
    expect(result.updates.holobots[0].combatKit).toEqual({ slots: validSlots, revision: 1 });
  });

  it('rejects a stale revision', () => {
    const profile = makeProfile({
      holobots: [{
        name: 'ACE', level: 5, experience: 0, nextLevelExp: 100,
        combatKit: { slots: validSlots, revision: 3 },
      }],
    });
    expect(() => buildKitSaveUpdates(profile, 'ACE', validSlots, 1)).toThrow(/changed/i);
  });

  it('rejects wrong category order and unowned moves', () => {
    expect(() =>
      buildKitSaveUpdates(makeProfile(), 'ACE', [
        'defense.guardUp',
        'strike.snapShot',
        'combo.doubleTap',
        'finisher.tacticalOverride',
      ], 0),
    ).toThrow(/slot/i);

    expect(() =>
      buildKitSaveUpdates(makeProfile(), 'ACE', [
        'strike.heavySlam',
        'defense.guardUp',
        'combo.doubleTap',
        'finisher.tacticalOverride',
      ], 0),
    ).toThrow(/own/i);
  });
});

describe('specialization tables', () => {
  it('every category offers exactly two distinct branches', () => {
    Object.values(CATEGORY_SPECIALIZATIONS).forEach(([first, second]) => {
      expect(first.id).not.toBe(second.id);
      expect(first.name).toBeTruthy();
      expect(second.description).toBeTruthy();
    });
  });
});
