import { describe, expect, it, vi } from 'vitest';

import { useArenaTeamBattleStore } from '@/stores/arena-team-battle-store';
import type { ActionCard, ArenaFighter } from '@/types/arena';

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
    abilityRuntime: { firedCount: 0 },
    ...overrides,
  };
}

const jab: ActionCard = {
  id: 'jab-s',
  templateId: 'jab',
  name: 'Jab',
  type: 'strike',
  staminaCost: 1,
  requirements: [],
  baseDamage: 10,
  speedModifier: 1,
  effects: [],
  animationId: 'test',
  description: 'test',
};

function entries(prefix: string, hp: number[]) {
  return hp.map((currentHP, index) => ({
    fighter: makeFighter(`${prefix}-${index}`, { currentHP }),
    moves: [jab],
  }));
}

describe('arena team battle store', () => {
  it('drives a full 3v3: KO -> player picks send-in target implicitly via CPU flow -> completion', () => {
    vi.useFakeTimers();
    const store = useArenaTeamBattleStore.getState();

    // All three enemies at 3 HP: each jab is a KO.
    store.startTeamBattle(entries('p', [100, 100, 100]), entries('o', [3, 3, 3]), {
      battleType: 'pve',
      allowPlayerControl: true,
      playerHolobotId: 'p-0',
      opponentHolobotId: 'o-0',
    });

    const strikeOnce = () => {
      const state = useArenaTeamBattleStore.getState();
      const move = state.team!.player.slots[state.team!.player.activeIndex].moves[0];
      state.useMove(move.id);
      vi.advanceTimersByTime(400); // clear the animation lock
    };

    // KO #1 -> CPU send-in phase.
    strikeOnce();
    let state = useArenaTeamBattleStore.getState();
    expect(state.team?.phase).toBe('awaiting_send_in');
    expect(state.team?.pendingSendInSide).toBe('opponent');

    // The loop auto-picks for the CPU after its think time.
    vi.advanceTimersByTime(2000);
    state = useArenaTeamBattleStore.getState();
    expect(state.team?.phase).toBe('active');
    expect(state.team?.opponent.activeIndex).toBe(1);

    // Wait out the fresh entry lock, then KO #2 and #3.
    vi.advanceTimersByTime(1600);
    strikeOnce();
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(1600);
    strikeOnce();

    state = useArenaTeamBattleStore.getState();
    expect(state.team?.phase).toBe('completed');
    expect(state.teamResult?.winnerSide).toBe('player');

    useArenaTeamBattleStore.getState().endBattle();
    vi.useRealTimers();
  });

  it('player switching respects the cooldown and swaps the duel', () => {
    vi.useFakeTimers();
    const store = useArenaTeamBattleStore.getState();
    store.startTeamBattle(entries('p', [100, 100, 100]), entries('o', [100, 100, 100]), {
      battleType: 'pve',
      allowPlayerControl: true,
      playerHolobotId: 'p-0',
      opponentHolobotId: 'o-0',
    });

    useArenaTeamBattleStore.getState().switchTo(2);
    let state = useArenaTeamBattleStore.getState();
    expect(state.team?.player.activeIndex).toBe(2);
    expect(state.team?.duel.player.holobotId).toBe('p-2');

    vi.advanceTimersByTime(400);
    useArenaTeamBattleStore.getState().switchTo(1);
    state = useArenaTeamBattleStore.getState();
    expect(state.team?.player.activeIndex).toBe(2); // cooldown refused

    useArenaTeamBattleStore.getState().endBattle();
    vi.useRealTimers();
  });
});
