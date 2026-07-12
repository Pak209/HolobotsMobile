import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionCard, ArenaFighter } from '@/types/arena';
import { getAbility } from '../abilities';
import { ArenaCombatEngine } from '../combatEngine';
import {
  applyBenchRegen,
  applyDuelResolution,
  autoPickIndex,
  canSwitch,
  createTeamBattle,
  ENTRY_LOCK_MS,
  isSideDefeated,
  selectAISendIn,
  selectAISwitch,
  sendIn,
  SWITCH_COOLDOWN_MS,
  switchActive,
  type TeamBattle,
} from '../teamBattle';

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
    stamina: 6,
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

function makeCard(overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id: overrides.id ?? 'card-1',
    templateId: overrides.templateId ?? 'jab',
    name: overrides.name ?? 'Jab',
    type: overrides.type ?? 'strike',
    staminaCost: overrides.staminaCost ?? 1,
    requirements: overrides.requirements ?? [],
    baseDamage: overrides.baseDamage ?? 10,
    speedModifier: overrides.speedModifier ?? 1,
    effects: overrides.effects ?? [],
    animationId: 'test',
    description: 'test',
  };
}

const jab = makeCard({ id: 'jab-t', templateId: 'jab', baseDamage: 8 });
const block = makeCard({ id: 'block-t', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

function makeTeam(
  playerOverrides: Array<Partial<ArenaFighter>> = [{}, {}, {}],
  opponentOverrides: Array<Partial<ArenaFighter>> = [{}, {}, {}],
): TeamBattle {
  return createTeamBattle(
    playerOverrides.map((overrides, index) => ({
      fighter: makeFighter(`p-${index}`, overrides),
      moves: [jab, block],
    })),
    opponentOverrides.map((overrides, index) => ({
      fighter: makeFighter(`o-${index}`, overrides),
      moves: [jab, block],
    })),
    { battleType: 'pve', allowPlayerControl: true, playerHolobotId: 'p-0', opponentHolobotId: 'o-0' },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createTeamBattle', () => {
  it('requires exactly three per side and leads with slot 0', () => {
    expect(() =>
      createTeamBattle(
        [{ fighter: makeFighter('a'), moves: [jab] }],
        [{ fighter: makeFighter('b'), moves: [jab] }],
      ),
    ).toThrow(/3/);

    const team = makeTeam();
    expect(team.duel.player.holobotId).toBe('p-0');
    expect(team.duel.opponent.holobotId).toBe('o-0');
    expect(team.phase).toBe('active');
  });
});

describe('switching', () => {
  it('is a retreat: trap, chain, and stacks are dropped; resources persist', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    let team = makeTeam();

    // Arm a trap and build state on the active player fighter.
    const defended = ArenaCombatEngine.resolveAction(team.duel, block, team.duel.player.holobotId);
    team = applyDuelResolution(team, defended);
    expect(team.player.slots[0].fighter.armedDefenseTrap).not.toBeNull();
    const staminaBefore = team.player.slots[0].fighter.stamina;

    team = switchActive(team, 'player', 1);
    const retreated = team.player.slots[0].fighter;

    expect(team.player.activeIndex).toBe(1);
    expect(team.duel.player.holobotId).toBe('p-1');
    expect(retreated.armedDefenseTrap).toBeNull();
    expect(retreated.comboCounter).toBe(0);
    expect(retreated.guardStacks).toBe(0);
    expect(retreated.stamina).toBe(staminaBefore); // resources persist
  });

  it('enforces the side switch cooldown and entry lock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    let team = makeTeam();

    team = switchActive(team, 'player', 1);
    expect(team.player.entryLockUntil).toBe(5_000_000 + ENTRY_LOCK_MS);
    expect(canSwitch(team, 'player', 2)).toBe('cooldown');

    vi.setSystemTime(5_000_000 + SWITCH_COOLDOWN_MS + 1);
    expect(canSwitch(team, 'player', 2)).toBeNull();
  });

  it('refuses KO’d and already-active slots', () => {
    const team = makeTeam();
    const koTeam: TeamBattle = {
      ...team,
      player: {
        ...team.player,
        slots: team.player.slots.map((slot, index) =>
          index === 1 ? { ...slot, isKnockedOut: true } : slot,
        ),
      },
    };

    expect(canSwitch(koTeam, 'player', 1)).toBe('knocked_out');
    expect(canSwitch(koTeam, 'player', 0)).toBe('already_active');
  });
});

describe('knockouts and send-in', () => {
  function koActiveOpponent(team: TeamBattle): TeamBattle {
    const duel = {
      ...team.duel,
      opponent: { ...team.duel.opponent, currentHP: 0 },
      status: 'completed' as const,
    };
    return applyDuelResolution(team, duel, 7_000_000);
  }

  it('a KO with bench remaining freezes into awaiting_send_in with a deadline', () => {
    const team = koActiveOpponent(makeTeam());

    expect(team.phase).toBe('awaiting_send_in');
    expect(team.pendingSendInSide).toBe('opponent');
    expect(team.sendInDeadline).toBe(7_000_000 + 5_000);
    expect(team.opponent.slots[0].isKnockedOut).toBe(true);
  });

  it('send-in restores combat with the chosen fighter under entry lock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_100_000);
    let team = koActiveOpponent(makeTeam());

    team = sendIn(team, 'opponent', 2);

    expect(team.phase).toBe('active');
    expect(team.opponent.activeIndex).toBe(2);
    expect(team.duel.opponent.holobotId).toBe('o-2');
    expect(team.duel.opponent.currentHP).toBe(100);
    expect(team.opponent.entryLockUntil).toBe(7_100_000 + ENTRY_LOCK_MS);
  });

  it('the last KO completes the match with the right winner', () => {
    let team = makeTeam();
    team = {
      ...team,
      opponent: {
        ...team.opponent,
        slots: team.opponent.slots.map((slot, index) =>
          index === 0 ? slot : { ...slot, isKnockedOut: true },
        ),
      },
    };

    team = koActiveOpponent(team);

    expect(team.phase).toBe('completed');
    expect(team.winnerSide).toBe('player');
    expect(isSideDefeated(team.opponent)).toBe(true);
  });

  it('autoPickIndex picks the next living bench slot in order', () => {
    const team = koActiveOpponent(makeTeam());
    expect(autoPickIndex(team.opponent)).toBe(1);
  });
});

describe('bench state', () => {
  it('benched fighters regen stamina; actives and KO’d do not (via team layer)', () => {
    let team = makeTeam(
      [{}, { stamina: 3 }, { stamina: 7 }],
      [{}, { stamina: 2 }, { stamina: 4 }],
    );
    team = {
      ...team,
      opponent: {
        ...team.opponent,
        slots: team.opponent.slots.map((slot, index) =>
          index === 2 ? { ...slot, isKnockedOut: true } : slot,
        ),
      },
    };

    const regenerated = applyBenchRegen(team);

    expect(regenerated.player.slots[1].fighter.stamina).toBe(4); // benched
    expect(regenerated.player.slots[2].fighter.stamina).toBe(7); // capped
    expect(regenerated.player.slots[0].fighter.stamina).toBe(6); // active untouched here
    expect(regenerated.opponent.slots[1].fighter.stamina).toBe(3);
    expect(regenerated.opponent.slots[2].fighter.stamina).toBe(4); // KO'd frozen
  });

  it('spent one-shot bends persist across switches (ACE pierce stays spent)', () => {
    let team = makeTeam([
      { ability: getAbility('ACE'), abilityRuntime: { firedCount: 0, bendUses: 1 } },
      {},
      {},
    ]);

    team = switchActive(team, 'player', 1, Date.now());
    team = switchActive(team, 'player', 0, Date.now() + SWITCH_COOLDOWN_MS + 1);

    expect(team.player.slots[0].fighter.abilityRuntime?.bendUses).toBe(1);
  });
});

describe('CPU rotation policy', () => {
  it('rotates out a badly hurt active for a healthier bench', () => {
    const team = makeTeam([{}, {}, {}], [{ currentHP: 15 }, { currentHP: 90 }, { currentHP: 40 }]);
    expect(selectAISwitch(team, Date.now())).toBe(1);
  });

  it('does not rotate WOLF out for being gassed', () => {
    const wolf = makeTeam(
      [{}, {}, {}],
      [{ stamina: 1, ability: getAbility('WOLF') }, { stamina: 7 }, { stamina: 6 }],
    );
    expect(selectAISwitch(wolf, Date.now())).toBeNull();

    const normal = makeTeam([{}, {}, {}], [{ stamina: 1 }, { stamina: 7 }, { stamina: 6 }]);
    expect(selectAISwitch(normal, Date.now())).toBe(1);
  });

  it('walls a charged player signature with GAMA', () => {
    const team = makeTeam(
      [{ specialMeter: 100 }, {}, {}],
      [{}, { ability: getAbility('GAMA') }, {}],
    );
    expect(selectAISwitch(team, Date.now())).toBe(1);
  });

  it('respects the switch cooldown', () => {
    const team = makeTeam([{}, {}, {}], [{ currentHP: 10 }, { currentHP: 90 }, {}]);
    const locked: TeamBattle = {
      ...team,
      opponent: { ...team.opponent, switchCooldownUntil: Date.now() + 5000 },
    };
    expect(selectAISwitch(locked, Date.now())).toBeNull();
  });

  it('send-in counterpicks: wall vs charged meter, piercer vs armed trap, else healthiest', () => {
    // Charged player meter -> GAMA wall.
    let team = makeTeam([{ specialMeter: 100 }, {}, {}], [{}, { ability: getAbility('GAMA') }, {}]);
    team = { ...team, phase: 'awaiting_send_in', pendingSendInSide: 'opponent' };
    expect(selectAISendIn(team)).toBe(1);

    // Player trap armed -> unspent ACE pierce.
    let trapTeam = makeTeam([{}, {}, {}], [{}, {}, { ability: getAbility('ACE') }]);
    const armedDuel = ArenaCombatEngine.resolveAction(trapTeam.duel, block, trapTeam.duel.player.holobotId);
    trapTeam = applyDuelResolution(trapTeam, armedDuel);
    expect(selectAISendIn(trapTeam)).toBe(2);

    // Default: healthiest bench.
    const plain = makeTeam([{}, {}, {}], [{}, { currentHP: 20 }, { currentHP: 80 }]);
    expect(selectAISendIn(plain)).toBe(2);
  });
});
