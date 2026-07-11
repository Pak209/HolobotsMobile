import { describe, expect, it, vi } from 'vitest';

import { useArenaBattleStore } from '@/stores/arena-battle-store';
import type { ArenaFighter } from '@/types/arena';

function makeFighter(id: string, overrides: Partial<ArenaFighter> = {}): ArenaFighter {
  return {
    holobotId: id,
    ownerUserId: 'user-1',
    name: id.toUpperCase(),
    avatar: 'test://avatar',
    archetype: 'balanced',
    level: 1,
    maxHP: 100,
    currentHP: 100,
    attack: 40,
    defense: 30,
    speed: 25,
    intelligence: 25,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: 'fresh',
    isInDefenseMode: false,
    comboCounter: 0,
    lastActionTime: 0,
    statusEffects: [],
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    totalDamageDealt: 0,
    ...overrides,
  };
}

function startBattle(opponentOverrides: Partial<ArenaFighter> = {}) {
  useArenaBattleStore.getState().resetBattle();
  useArenaBattleStore.getState().startBattle(
    makeFighter('player-1'),
    makeFighter('opponent-1', opponentOverrides),
    {
      battleType: 'pve',
      allowPlayerControl: true,
      playerHolobotId: 'player-1',
      opponentHolobotId: 'opponent-1',
    },
  );
}

// Regression guard for the results flow: battleResult drives the Arena
// results/rewards modal (ArenaScreen switches phase when it appears), so a
// KO by any path must always populate it.
describe('arena battle store results flow', () => {
  it('a KO by a kit move sets battleResult with winner and rewards', () => {
    vi.useFakeTimers();
    startBattle({ currentHP: 3 });

    const strike = useArenaBattleStore.getState().playerMoves.find((move) => move.type === 'strike')!;
    useArenaBattleStore.getState().useMove(strike.id);

    const state = useArenaBattleStore.getState();
    expect(state.currentBattle?.status).toBe('completed');
    expect(state.battleResult?.winnerId).toBe('player-1');
    expect(state.battleResult?.rewards.exp).toBeGreaterThan(0);
    expect(state.isAnimating).toBe(false);

    useArenaBattleStore.getState().endBattle();
    vi.useRealTimers();
  });

  it('a KO by the signature finisher sets battleResult too', () => {
    vi.useFakeTimers();
    startBattle({ currentHP: 3 });
    useArenaBattleStore.setState((current) => ({
      currentBattle: current.currentBattle
        ? { ...current.currentBattle, player: { ...current.currentBattle.player, specialMeter: 100 } }
        : null,
    }));

    useArenaBattleStore.getState().useSignatureFinisher();

    const state = useArenaBattleStore.getState();
    expect(state.currentBattle?.status).toBe('completed');
    expect(state.battleResult?.winnerId).toBe('player-1');

    useArenaBattleStore.getState().endBattle();
    vi.useRealTimers();
  });

  it('the four kit moves stay stable through a non-lethal exchange', () => {
    vi.useFakeTimers();
    startBattle();

    const before = useArenaBattleStore.getState().playerMoves.map((move) => move.id);
    const strike = useArenaBattleStore.getState().playerMoves.find((move) => move.type === 'strike')!;
    useArenaBattleStore.getState().useMove(strike.id);

    const after = useArenaBattleStore.getState();
    expect(after.playerMoves.map((move) => move.id)).toEqual(before);
    expect(after.battleResult).toBeNull();

    useArenaBattleStore.getState().endBattle();
    vi.useRealTimers();
  });
});
