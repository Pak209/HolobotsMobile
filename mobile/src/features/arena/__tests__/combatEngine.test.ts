import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionCard, ArenaFighter } from '@/types/arena';
import { ArenaCombatEngine } from '../combatEngine';
import { getAbility } from '../abilities';
import { DEFENSE_COOLDOWN_MS_PER_TURN, POST_DEFENSE_ACTION_LOCK_MS } from '../arenaCards';
import { FINISHER_METER_REQUIREMENT } from '../moveKits';

function makeFighter(overrides: Partial<ArenaFighter> = {}): ArenaFighter {
  return ArenaCombatEngine.prepareFighter({
    holobotId: overrides.holobotId ?? 'fighter-1',
    ownerUserId: 'user-1',
    name: 'TESTBOT',
    avatar: 'test://avatar',
    archetype: 'balanced',
    level: 1,
    maxHP: 120,
    currentHP: 120,
    attack: 40,
    defense: 30,
    speed: 25,
    intelligence: 25,
    stamina: 6,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: 'fresh',
    isInDefenseMode: false,
    defenseCooldownUntil: 0,
    comboCounter: 0,
    lastActionTime: 0,
    statusEffects: [],
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    totalDamageDealt: 0,
    perfectDefenses: 0,
    combosCompleted: 0,
    ...overrides,
  });
}

function makeCard(overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id: overrides.id ?? overrides.templateId ?? 'card-1',
    templateId: overrides.templateId ?? 'jab',
    name: overrides.name ?? 'Jab',
    type: overrides.type ?? 'strike',
    staminaCost: overrides.staminaCost ?? 1,
    requirements: overrides.requirements ?? [],
    baseDamage: overrides.baseDamage ?? 10,
    speedModifier: overrides.speedModifier ?? 1,
    effects: overrides.effects ?? [],
    animationId: overrides.animationId ?? 'test',
    description: overrides.description ?? 'test card',
    iconName: overrides.iconName,
  };
}

function makeBattle(playerOverrides: Partial<ArenaFighter> = {}, opponentOverrides: Partial<ArenaFighter> = {}) {
  const player = makeFighter({ holobotId: 'player-1', ...playerOverrides });
  const opponent = makeFighter({ holobotId: 'opponent-1', ...opponentOverrides });

  return ArenaCombatEngine.initializeBattle(player, opponent, {
    battleType: 'pve',
    allowPlayerControl: true,
    playerHolobotId: player.holobotId,
    opponentHolobotId: opponent.holobotId,
  });
}

describe('ArenaCombatEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defense restores stamina', () => {
    const battle = makeBattle({ stamina: 3, maxStamina: 7 });
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    const resolved = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    // +2 from the guard trap's staminaGain; ambient regen is time-based in
    // the store loop, not per action.
    expect(resolved.player.stamina).toBe(5);
  });

  it('defense applies a TIME-based cooldown that expires by waiting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    const resolved = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    expect(resolved.player.armedDefenseTrap?.templateId).toBe('block');
    expect(resolved.player.defenseCooldownUntil).toBe(1_000_000 + 2 * DEFENSE_COOLDOWN_MS_PER_TURN);
    expect(ArenaCombatEngine.canPlayCard(resolved, 'player', block)).toBe(false);

    // Spring the trap so only the clock gates the next defense…
    const jab = makeCard({ id: 'jab-cd', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const sprung = ArenaCombatEngine.resolveAction(resolved, jab, resolved.opponent.holobotId);
    expect(ArenaCombatEngine.canPlayCard(sprung, 'player', block)).toBe(false);

    // …and waiting past the cooldown unlocks it without playing anything.
    vi.setSystemTime(1_000_000 + 2 * DEFENSE_COOLDOWN_MS_PER_TURN + 1);
    expect(ArenaCombatEngine.canPlayCard(sprung, 'player', block)).toBe(true);
  });

  describe('guard stacks (consecutive defense plays)', () => {
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const slip = makeCard({ id: 'slip-gs', templateId: 'slip', type: 'defense', staminaCost: 2, baseDamage: 0 });
    const jab = makeCard({ id: 'jab-gs', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

    function springTrapAndWait(state: ReturnType<typeof makeBattle>, ms: number) {
      const sprung = ArenaCombatEngine.resolveAction(state, jab, state.opponent.holobotId);
      vi.setSystemTime(Date.now() + ms);
      return sprung;
    }

    it('back-to-back defends overcharge the next trap, and attacks reset the streak', () => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000);
      const battle = makeBattle();

      // First defend: normal trap, streak starts.
      const first = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
      expect(first.player.armedDefenseTrap?.stackLevel ?? 0).toBe(0);
      expect(first.player.guardStacks).toBe(1);

      // Opponent springs it; the player WAITS out the cooldown (no attack).
      const sprung = springTrapAndWait(first, 2 * DEFENSE_COOLDOWN_MS_PER_TURN + 1);

      // Second consecutive defend: +1 stack — stronger reduction.
      const second = ArenaCombatEngine.resolveAction(sprung, block, sprung.player.holobotId);
      expect(second.player.armedDefenseTrap?.stackLevel).toBe(1);
      expect(second.player.armedDefenseTrap?.damageReduction).toBeCloseTo(0.65);
      expect(second.player.guardStacks).toBe(2);

      // Third consecutive defend (max stacks): an evade-capable trap becomes
      // a GUARANTEED evade.
      const sprung2 = springTrapAndWait(second, 3 * DEFENSE_COOLDOWN_MS_PER_TURN + 1);
      const third = ArenaCombatEngine.resolveAction(sprung2, slip, sprung2.player.holobotId);
      expect(third.player.armedDefenseTrap?.stackLevel).toBe(2);
      expect(third.player.armedDefenseTrap?.evadeChance).toBe(1);

      // Attacking (after the post-defend brace expires) resets the streak.
      const attacked = ArenaCombatEngine.resolveAction(
        springTrapAndWait(third, POST_DEFENSE_ACTION_LOCK_MS + 1),
        jab,
        third.player.holobotId,
      );
      expect(attacked.player.guardStacks).toBe(0);
    });
  });

  it('only defense cards carry cooldowns', () => {
    const battle = makeBattle();
    const strike = makeCard({ id: 'hook-cd', templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 12 });
    const combo = makeCard({ id: 'flurry-cd', templateId: 'flurry', type: 'combo', staminaCost: 3, baseDamage: 25 });

    const afterStrike = ArenaCombatEngine.resolveAction(battle, strike, battle.player.holobotId);
    const afterCombo = ArenaCombatEngine.resolveAction(afterStrike, combo, afterStrike.player.holobotId);

    expect(afterStrike.playerCardCooldowns?.hook).toBeUndefined();
    expect(afterCombo.playerCardCooldowns?.flurry).toBeUndefined();
  });

  it('blocked attacks deal reduced damage', () => {
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const strike = makeCard({ id: 'hook-1', templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 20 });

    const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    const blockedAttack = ArenaCombatEngine.resolveAction(defended, strike, defended.opponent.holobotId);
    const unblocked = ArenaCombatEngine.calculateDamage(blockedAttack.opponent, blockedAttack.player, strike);

    expect((blockedAttack.actionHistory.at(-1)?.outcome)).toBe('blocked');
    expect(blockedAttack.actionHistory.at(-1)?.actualDamage).toBeLessThan(unblocked.finalDamage);
    expect(blockedAttack.player.armedDefenseTrap).toBeNull();
  });

  it('counter trap deals return damage and is consumed', () => {
    const battle = makeBattle();
    const parry = makeCard({ templateId: 'parry', type: 'defense', staminaCost: 3, baseDamage: 0 });
    const strike = makeCard({ id: 'hook-1', templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 20 });

    const defended = ArenaCombatEngine.resolveAction(battle, parry, battle.player.holobotId);
    const countered = ArenaCombatEngine.resolveAction(defended, strike, defended.opponent.holobotId);

    expect(countered.actionHistory.at(-1)?.wasCountered).toBe(true);
    expect(countered.opponent.currentHP).toBeLessThan(defended.opponent.currentHP);
    expect(countered.player.armedDefenseTrap).toBeNull();
  });

  it('cannot stack a second defense trap while one is armed', () => {
    const battle = makeBattle({ stamina: 7 });
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const slip = makeCard({ templateId: 'slip', type: 'defense', staminaCost: 2, baseDamage: 0 });

    const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    expect(ArenaCombatEngine.canPlayCard(defended, 'player', slip)).toBe(false);
  });

  it('cards cannot be played without enough stamina', () => {
    const battle = makeBattle({ stamina: 1 });
    const heavyCard = makeCard({ templateId: 'flurry', type: 'combo', staminaCost: 5, baseDamage: 40 });

    expect(ArenaCombatEngine.canPlayCard(battle, 'player', heavyCard)).toBe(false);
  });

  // Regression: playing a defense trap (e.g. Safety Protocol) used to lock
  // EVERY card for its owner until the opponent attacked into it. If the
  // opponent defended too, both sides were trap-armed with zero playable
  // cards and the battle deadlocked permanently.
  it('attacking while your own trap is armed is allowed and drops the trap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const opponentBlock = makeCard({ id: 'block-opp', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const jab = makeCard({ id: 'jab-1', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

    const playerDefended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    const bothDefended = ArenaCombatEngine.resolveAction(playerDefended, opponentBlock, playerDefended.opponent.holobotId);

    // Both fighters trap-armed — previously zero playable cards for either
    // side. Attacks unlock once the short post-defend brace passes.
    vi.setSystemTime(5_000_000 + POST_DEFENSE_ACTION_LOCK_MS + 1);
    expect(ArenaCombatEngine.canPlayCard(bothDefended, 'player', jab)).toBe(true);

    const playerAttacked = ArenaCombatEngine.resolveAction(bothDefended, jab, bothDefended.player.holobotId);

    // Attacking drops the attacker's own guard and springs the defender's trap.
    expect(playerAttacked.player.armedDefenseTrap).toBeNull();
    expect(playerAttacked.player.isInDefenseMode).toBe(false);
    expect(playerAttacked.opponent.armedDefenseTrap).toBeNull();
    expect(playerAttacked.actionHistory.at(-1)?.outcome).toBe('blocked');
  });

  it('regenerateStamina adds a point to both fighters (real-time tick)', () => {
    const battle = makeBattle({ stamina: 2 }, { stamina: 3 });

    const regenerated = ArenaCombatEngine.regenerateStamina(battle);

    expect(regenerated.player.stamina).toBe(3);
    expect(regenerated.opponent.stamina).toBe(4);
  });

  describe('AI card selection', () => {
    const jab = makeCard({ id: 'jab-ai', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const hook = makeCard({ id: 'hook-ai', templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 20 });
    const block = makeCard({ id: 'block-ai', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const finisher = makeCard({ id: 'fin-ai', templateId: 'ultimate', type: 'finisher', staminaCost: 3, baseDamage: 30 });

    it('attacks in a neutral state instead of turtling', () => {
      const battle = makeBattle();
      const choice = ArenaCombatEngine.selectAIAction(battle, [jab, hook, block]);

      expect(choice).not.toBeNull();
      expect(choice?.type).not.toBe('defense');
    });

    it('takes the cheapest lethal attack when one is available', () => {
      const battle = makeBattle({ currentHP: 5 });
      const choice = ArenaCombatEngine.selectAIAction(battle, [hook, jab, block]);

      expect(choice?.id).toBe(jab.id);
    });

    it('fires its signature the moment the meter is full', () => {
      const battle = makeBattle({}, { specialMeter: 100 });
      const command = ArenaCombatEngine.selectAICommand(battle, [jab, hook, block]);

      expect(command).toEqual({ kind: 'signature' });
    });

    it('holds its signature while the player has a trap armed and probes instead', () => {
      const playerBlock = makeCard({ id: 'block-p', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
      const battle = makeBattle({}, { specialMeter: 100 });
      const defended = ArenaCombatEngine.resolveAction(battle, playerBlock, battle.player.holobotId);

      const command = ArenaCombatEngine.selectAICommand(defended, [jab, hook, block]);

      expect(command?.kind).toBe('move');
    });

    it('holds the kit finisher while the player is healthy', () => {
      const kitFinisher = makeCard({
        id: 'kf-ai',
        templateId: 'finisher.kit',
        type: 'finisher',
        staminaCost: 3,
        baseDamage: 30,
        requirements: [{ type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT }],
      });
      const battle = makeBattle({}, { specialMeter: FINISHER_METER_REQUIREMENT });

      const choice = ArenaCombatEngine.selectAIAction(battle, [jab, kitFinisher, block]);

      expect(choice?.id).not.toBe('kf-ai');
    });

    it('cashes the kit finisher early to close out a badly hurt player', () => {
      const kitFinisher = makeCard({
        id: 'kf-ai-2',
        templateId: 'finisher.kit',
        type: 'finisher',
        staminaCost: 3,
        baseDamage: 30,
        requirements: [{ type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT }],
      });
      // 40/120 HP = 33% (< 35% pressure threshold), but 37 estimated damage
      // is not lethal, so this exercises the early-cash branch specifically.
      const battle = makeBattle({ currentHP: 40 }, { specialMeter: FINISHER_METER_REQUIREMENT });

      const choice = ArenaCombatEngine.selectAIAction(battle, [jab, kitFinisher, block]);

      expect(choice?.id).toBe('kf-ai-2');
    });

    it('defends to recover when it cannot afford any attack', () => {
      const battle = makeBattle({}, { stamina: 1 });
      const choice = ArenaCombatEngine.selectAIAction(battle, [hook, block]);

      expect(choice?.type).toBe('defense');
    });

    it('returns null when nothing is playable so the turn can be passed', () => {
      const battle = makeBattle({}, { stamina: 0 });
      const choice = ArenaCombatEngine.selectAIAction(battle, [jab, hook, block]);

      expect(choice).toBeNull();
    });

    it('probes an armed player trap with its cheapest attack', () => {
      const battle = makeBattle();
      const playerBlock = makeCard({ id: 'block-player', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
      const defended = ArenaCombatEngine.resolveAction(battle, playerBlock, battle.player.holobotId);

      const choice = ArenaCombatEngine.selectAIAction(defended, [hook, jab, block]);

      expect(choice?.id).toBe(jab.id);
    });
  });

  // Regression: landing a finisher used to end the battle instantly with the
  // ACTOR as winner regardless of remaining HP — so the moment the AI's meter
  // filled it fired a non-lethal finisher and the player was handed a DEFEAT
  // while sitting on a full health bar.
  it('a non-lethal finisher does not end the battle', () => {
    const finisher = makeCard({ id: 'fin-1', templateId: 'hyper_strike', type: 'finisher', staminaCost: 4, baseDamage: 30 });
    const battle = makeBattle({ specialMeter: 100, stamina: 7 }, { currentHP: 120, maxHP: 120 });

    const resolved = ArenaCombatEngine.resolveAction(battle, finisher, battle.player.holobotId);
    const winCheck = ArenaCombatEngine.checkWinCondition(resolved);

    expect(resolved.opponent.currentHP).toBeGreaterThan(0);
    expect(winCheck.isComplete).toBe(false);
    expect(resolved.status).toBe('active');
  });

  it('a lethal finisher ends the battle with the finisher win type', () => {
    const finisher = makeCard({ id: 'fin-2', templateId: 'hyper_strike', type: 'finisher', staminaCost: 4, baseDamage: 30 });
    const battle = makeBattle({ specialMeter: 100, stamina: 7 }, { currentHP: 5 });

    const resolved = ArenaCombatEngine.resolveAction(battle, finisher, battle.player.holobotId);
    const winCheck = ArenaCombatEngine.checkWinCondition(resolved);

    expect(winCheck.isComplete).toBe(true);
    expect(winCheck.winnerId).toBe(battle.player.holobotId);
    expect(winCheck.winType).toBe('finisher');
  });

  describe('kit finisher (slot 4, early meter cash-out)', () => {
    const kitFinisher = makeCard({
      id: 'kf-1',
      templateId: 'finisher.kit',
      type: 'finisher',
      staminaCost: 3,
      baseDamage: 30,
      requirements: [{ type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT }],
    });

    it('unlocks at 4/7 of the special meter', () => {
      const locked = makeBattle({ specialMeter: FINISHER_METER_REQUIREMENT - 1 });
      const unlocked = makeBattle({ specialMeter: FINISHER_METER_REQUIREMENT });

      expect(ArenaCombatEngine.canPlayCard(locked, 'player', kitFinisher)).toBe(false);
      expect(ArenaCombatEngine.canPlayCard(unlocked, 'player', kitFinisher)).toBe(true);
    });

    it('consumes the whole meter when used', () => {
      const battle = makeBattle({ specialMeter: 80 });

      const resolved = ArenaCombatEngine.resolveAction(battle, kitFinisher, battle.player.holobotId);

      expect(resolved.player.specialMeter).toBe(0);
      expect(resolved.opponent.currentHP).toBeLessThan(battle.opponent.currentHP);
    });

    it('can be eaten by an armed defense trap', () => {
      const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
      const battle = makeBattle({ specialMeter: 100 });
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.opponent.holobotId);

      const resolved = ArenaCombatEngine.resolveAction(defended, kitFinisher, defended.player.holobotId);

      expect(resolved.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(resolved.opponent.armedDefenseTrap).toBeNull();
    });
  });

  describe('signature finisher', () => {
    it('is unavailable below 100 meter and a resolve attempt is a no-op', () => {
      const battle = makeBattle({ specialMeter: 99 });

      expect(ArenaCombatEngine.canUseSignatureFinisher(battle, 'player')).toBe(false);
      expect(ArenaCombatEngine.resolveSignatureFinisher(battle, battle.player.holobotId)).toBe(battle);
    });

    it('consumes exactly the full meter and deals damage', () => {
      const battle = makeBattle({ specialMeter: 100 });

      const resolved = ArenaCombatEngine.resolveSignatureFinisher(battle, battle.player.holobotId);

      expect(resolved.player.specialMeter).toBe(0);
      expect(resolved.opponent.currentHP).toBeLessThan(battle.opponent.currentHP);
      expect(resolved.actionHistory.at(-1)?.actionType).toBe('finisher');
    });

    it('respects an armed defense trap so counterplay is preserved', () => {
      const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
      const battle = makeBattle({ specialMeter: 100 });
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.opponent.holobotId);

      const resolved = ArenaCombatEngine.resolveSignatureFinisher(defended, defended.player.holobotId);

      expect(resolved.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(resolved.player.specialMeter).toBe(0);
    });
  });

  describe('innate abilities in battle', () => {
    it('battle_start abilities apply at initialization (ERA meter head start)', () => {
      const player = makeFighter({ holobotId: 'player-1' });
      player.ability = {
        id: 'ability.era', holobotName: 'ERA', name: 'Time Warp',
        description: 'Starts charged.', trigger: 'battle_start',
        conditions: [], effects: [{ type: 'special_meter', value: 25 }],
        charges: { kind: 'once_per_battle' }, aiHints: [],
      };
      const opponent = makeFighter({ holobotId: 'opponent-1' });

      const battle = ArenaCombatEngine.initializeBattle(player, opponent, {
        battleType: 'pve', allowPlayerControl: true,
        playerHolobotId: player.holobotId, opponentHolobotId: opponent.holobotId,
      });

      expect(battle.player.specialMeter).toBe(25);
      expect(battle.opponent.specialMeter).toBe(0);
    });

    it('after_hit abilities fire when a strike lands (once per battle)', () => {
      const battle = makeBattle();
      const withAbility = {
        ...battle,
        player: {
          ...battle.player,
          ability: {
            id: 'ability.ace', holobotName: 'ACE', name: 'First Strike Protocol',
            description: 'First hit pays.', trigger: 'after_hit' as const,
            conditions: [], effects: [{ type: 'special_meter' as const, value: 12 }],
            charges: { kind: 'once_per_battle' as const }, aiHints: [],
          },
          abilityRuntime: { firedCount: 0 },
        },
      };
      const jab = makeCard({ id: 'jab-ab', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

      // Baseline: the identical hit without the ability attached.
      const baseline = ArenaCombatEngine.resolveAction(battle, jab, battle.player.holobotId);
      const afterFirst = ArenaCombatEngine.resolveAction(withAbility, jab, withAbility.player.holobotId);

      // The first hit includes the +12 ability grant on top of normal gain...
      expect(afterFirst.player.specialMeter).toBe(baseline.player.specialMeter + 12);

      // ...and the once-per-battle charge does not fire again.
      const baselineSecond = ArenaCombatEngine.resolveAction(baseline, jab, baseline.player.holobotId);
      const afterSecond = ArenaCombatEngine.resolveAction(afterFirst, jab, afterFirst.player.holobotId);
      expect(afterSecond.player.specialMeter - afterFirst.player.specialMeter).toBe(
        baselineSecond.player.specialMeter - baseline.player.specialMeter,
      );
    });
  });

  describe('special meter economy', () => {
    const jab = makeCard({ id: 'jab-m', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const block = makeCard({ id: 'block-m', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    it('charges a flat +10 per clean strike regardless of damage dealt', () => {
      const battle = makeBattle();
      const heavy = makeCard({ id: 'heavy-m', templateId: 'heavy', type: 'strike', staminaCost: 2, baseDamage: 40 });

      const afterStrike = ArenaCombatEngine.resolveAction(battle, jab, battle.player.holobotId);
      const afterHeavy = ArenaCombatEngine.resolveAction(battle, heavy, battle.player.holobotId);

      expect(afterStrike.player.specialMeter).toBe(10);
      expect(afterHeavy.player.specialMeter).toBe(10);
      // Taking the hit does NOT charge the defender.
      expect(afterStrike.opponent.specialMeter).toBe(0);
    });

    it('blocked attacks earn half meter', () => {
      const battle = makeBattle();
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.opponent.holobotId);

      const blocked = ArenaCombatEngine.resolveAction(defended, jab, defended.player.holobotId);

      expect(blocked.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(blocked.player.specialMeter).toBe(5);
    });

    it('does not charge from arming a defense', () => {
      const battle = makeBattle();

      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

      expect(defended.player.specialMeter).toBe(0);
    });

    it('kit finishers deal no meter to either side', () => {
      const kitFinisher = makeCard({
        id: 'kf-m', templateId: 'finisher.kit', type: 'finisher', staminaCost: 3, baseDamage: 30,
        requirements: [{ type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT }],
      });
      const battle = makeBattle({ specialMeter: 80 });

      const resolved = ArenaCombatEngine.resolveAction(battle, kitFinisher, battle.player.holobotId);

      expect(resolved.player.specialMeter).toBe(0);
      expect(resolved.opponent.specialMeter).toBe(0);
    });
  });

  describe('rule-bend abilities (one broken rule per Holobot)', () => {
    const jab = makeCard({ id: 'jab-rb', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const cross = makeCard({ id: 'cross-rb', templateId: 'cross', type: 'strike', staminaCost: 2, baseDamage: 15 });
    const block = makeCard({ id: 'block-rb', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const combo = makeCard({ id: 'combo-rb', templateId: 'combo_x', type: 'combo', staminaCost: 2, baseDamage: 12 });
    const kitFinisher = makeCard({
      id: 'kf-rb', templateId: 'finisher.kit', type: 'finisher', staminaCost: 3, baseDamage: 30,
      requirements: [{ type: 'special_meter', operator: 'gte', value: FINISHER_METER_REQUIREMENT }],
    });

    const withAbility = (name: string, overrides: Partial<ArenaFighter> = {}) => ({
      ability: getAbility(name),
      abilityRuntime: { firedCount: 0 },
      ...overrides,
    });

    it('ACE: the first attack into an armed trap pierces it, once', () => {
      const battle = makeBattle(withAbility('ACE'));
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.opponent.holobotId);

      const pierced = ArenaCombatEngine.resolveAction(defended, jab, defended.player.holobotId);
      expect(pierced.actionHistory.at(-1)?.outcome).toBe('hit');
      expect(pierced.opponent.armedDefenseTrap).not.toBeNull();

      const second = ArenaCombatEngine.resolveAction(pierced, cross, pierced.player.holobotId);
      expect(second.actionHistory.at(-1)?.outcome).toBe('blocked');
    });

    it('KUMA: a blocked hit does not break the chain', () => {
      const battle = makeBattle(withAbility('KUMA', { comboCounter: 3 }));
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.opponent.holobotId);

      const blocked = ArenaCombatEngine.resolveAction(defended, jab, defended.player.holobotId);

      expect(blocked.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(blocked.player.comboCounter).toBe(3);
    });

    it('SHADOW: the armed trap survives the first attack after arming', () => {
      vi.useFakeTimers();
      vi.setSystemTime(6_000_000);
      const battle = makeBattle(withAbility('SHADOW'));
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

      // Wait out the post-defend brace before attacking.
      vi.setSystemTime(6_000_000 + POST_DEFENSE_ACTION_LOCK_MS + 1);
      const attacked = ArenaCombatEngine.resolveAction(defended, jab, defended.player.holobotId);
      expect(attacked.player.armedDefenseTrap).not.toBeNull();
      expect(attacked.player.armedDefenseTrap?.graceUsed).toBe(true);

      const second = ArenaCombatEngine.resolveAction(attacked, cross, attacked.player.holobotId);
      expect(second.player.armedDefenseTrap).toBeNull();
    });

    it("ERA: the meter never drops below 25 (start and after finishers)", () => {
      const battle = makeBattle(withAbility('ERA'));
      expect(battle.player.specialMeter).toBe(25);

      const charged = { ...battle, player: { ...battle.player, specialMeter: 70 } };
      const cashed = ArenaCombatEngine.resolveAction(charged, kitFinisher, charged.player.holobotId);
      expect(cashed.player.specialMeter).toBe(25);
    });

    it('HARE: traps trigger twice before they are spent', () => {
      const battle = makeBattle(withAbility('HARE'));
      const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
      expect(defended.player.armedDefenseTrap?.charges).toBe(2);

      const first = ArenaCombatEngine.resolveAction(defended, jab, defended.opponent.holobotId);
      expect(first.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(first.player.armedDefenseTrap?.charges).toBe(1);

      const second = ArenaCombatEngine.resolveAction(first, cross, first.opponent.holobotId);
      expect(second.actionHistory.at(-1)?.outcome).toBe('blocked');
      expect(second.player.armedDefenseTrap).toBeNull();
    });

    it('TORA: the kit finisher consumes only the 4/7 requirement', () => {
      const battle = makeBattle(withAbility('TORA', { specialMeter: 90 }));

      const cashed = ArenaCombatEngine.resolveAction(battle, kitFinisher, battle.player.holobotId);

      expect(cashed.player.specialMeter).toBe(90 - FINISHER_METER_REQUIREMENT);
    });

    it('WAKE: a full tank discounts the next move by 1 (min 1)', () => {
      const battle = makeBattle(withAbility('WAKE', { stamina: 7 }));

      const swung = ArenaCombatEngine.resolveAction(battle, cross, battle.player.holobotId);
      expect(swung.player.stamina).toBe(6); // paid 1 instead of 2

      const second = ArenaCombatEngine.resolveAction(swung, cross, swung.player.holobotId);
      expect(second.player.stamina).toBe(4); // not at max -> full price
    });

    it('GAMA: a single hit never exceeds 20% of max HP', () => {
      const battle = makeBattle(
        { attack: 80 },
        withAbility('GAMA', { maxHP: 100, currentHP: 100, defense: 10 }),
      );
      const nuke = makeCard({ id: 'nuke-rb', templateId: 'nuke', type: 'strike', staminaCost: 3, baseDamage: 80 });

      const hit = ArenaCombatEngine.resolveAction(battle, nuke, battle.player.holobotId);

      expect(hit.opponent.currentHP).toBeGreaterThanOrEqual(80);
      expect(hit.actionHistory.at(-1)?.actualDamage).toBeLessThanOrEqual(20);
    });

    it('KEN: a landed combo cash-out keeps the chain alive', () => {
      const battle = makeBattle(withAbility('KEN', { comboCounter: 3 }));

      const cashed = ArenaCombatEngine.resolveAction(battle, combo, battle.player.holobotId);

      expect(cashed.actionHistory.at(-1)?.outcome).toBe('hit');
      expect(cashed.player.comboCounter).toBe(3);
    });

    it('KURAI: heals a bounded quarter of damage dealt while below 40% HP', () => {
      const battle = makeBattle(withAbility('KURAI', { currentHP: 30, maxHP: 120 }));

      const hit = ArenaCombatEngine.resolveAction(battle, cross, battle.player.holobotId);
      const dealt = hit.actionHistory.at(-1)?.actualDamage ?? 0;

      expect(dealt).toBeGreaterThan(0);
      expect(hit.player.currentHP).toBe(30 + Math.floor(dealt * 0.25));
      expect(hit.player.abilityRuntime?.bendAccrued).toBe(Math.floor(dealt * 0.25));
    });

    it('WOLF: exhausted hits deal full-power damage', () => {
      const exhausted = makeBattle(withAbility('WOLF', { stamina: 1 }));
      const normal = makeBattle({ stamina: 1 });

      const wolfHit = ArenaCombatEngine.resolveAction(exhausted, jab, exhausted.player.holobotId);
      const normalHit = ArenaCombatEngine.resolveAction(normal, jab, normal.player.holobotId);

      expect(wolfHit.actionHistory.at(-1)!.actualDamage!).toBeGreaterThan(
        normalHit.actionHistory.at(-1)!.actualDamage!,
      );
    });
  });

  it('damage formula respects ATK and DEF', () => {
    const strike = makeCard({ templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 20 });
    const highAttack = makeFighter({ attack: 60, defense: 20 });
    const lowAttack = makeFighter({ attack: 20, defense: 20 });
    const lowDefense = makeFighter({ holobotId: 'def-low', defense: 10 });
    const highDefense = makeFighter({ holobotId: 'def-high', defense: 60 });

    const highAttackDamage = ArenaCombatEngine.calculateDamage(highAttack, lowDefense, strike);
    const lowAttackDamage = ArenaCombatEngine.calculateDamage(lowAttack, lowDefense, strike);
    const lowDefenseDamage = ArenaCombatEngine.calculateDamage(highAttack, lowDefense, strike);
    const highDefenseDamage = ArenaCombatEngine.calculateDamage(highAttack, highDefense, strike);

    expect(highAttackDamage.finalDamage).toBeGreaterThan(lowAttackDamage.finalDamage);
    expect(lowDefenseDamage.finalDamage).toBeGreaterThan(highDefenseDamage.finalDamage);
  });

  it('applies only the equipped Sync Ability to damage calculation', () => {
    const strike = makeCard({ templateId: 'sync-jab', type: 'strike', staminaCost: 1, baseDamage: 20 });
    const defender = makeFighter({ holobotId: 'sync-defender', defense: 20 });
    const baseline = makeFighter({ holobotId: 'sync-base' });
    const equipped = makeFighter({
      holobotId: 'sync-equipped',
      syncAbilities: ['ace_combo_ignition'],
    });

    const baseDamage = ArenaCombatEngine.calculateDamage(baseline, defender, strike, false, 3);
    const syncDamage = ArenaCombatEngine.calculateDamage(equipped, defender, strike, false, 3);

    expect(syncDamage.finalDamage).toBeGreaterThan(baseDamage.finalDamage);
    expect(syncDamage.modifiers.some((modifier) => modifier.source === 'Combo Ignition')).toBe(true);
  });
});

// The combo counter is a live streak, not a bank: strikes build it, going
// defensive drops it, and the technical finisher is its premium cash-out
// (combo multiplier PLUS a per-link capstone bonus).
describe('combo chain and the chain-ender finisher', () => {
  const jab = makeCard({ id: 'jab-cc', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
  const block = makeCard({ id: 'block-cc', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
  const finisher = makeCard({ id: 'fin-cc', templateId: 'hyper_strike', type: 'finisher', staminaCost: 4, baseDamage: 30 });

  it('clean strikes build the chain and arming a defense drops it', () => {
    const battle = makeBattle();

    let state = ArenaCombatEngine.resolveAction(battle, jab, battle.player.holobotId);
    state = ArenaCombatEngine.resolveAction(state, jab, state.player.holobotId);
    expect(state.player.comboCounter).toBe(2);

    state = ArenaCombatEngine.resolveAction(state, block, state.player.holobotId);
    expect(state.player.comboCounter).toBe(0);
  });

  it('the technical finisher out-damages its chainless self and resets the chain', () => {
    const cold = makeBattle({ specialMeter: 100, stamina: 7 }, { currentHP: 500, maxHP: 500 });
    const hot = makeBattle({ specialMeter: 100, stamina: 7, comboCounter: 3 }, { currentHP: 500, maxHP: 500 });

    const coldResolved = ArenaCombatEngine.resolveAction(cold, finisher, cold.player.holobotId);
    const hotResolved = ArenaCombatEngine.resolveAction(hot, finisher, hot.player.holobotId);

    const coldDamage = coldResolved.actionHistory[coldResolved.actionHistory.length - 1].actualDamage ?? 0;
    const hotDamage = hotResolved.actionHistory[hotResolved.actionHistory.length - 1].actualDamage ?? 0;

    expect(coldDamage).toBeGreaterThan(0);
    expect(hotDamage).toBeGreaterThan(coldDamage);
    expect(hotResolved.player.comboCounter).toBe(0);
    expect(hotResolved.player.specialMeter).toBe(0);
  });

  it('the chain-ender capstone grows per link and caps at +50%', () => {
    expect(ArenaCombatEngine.getFinisherCapstoneBonus(0)).toBeCloseTo(1.25);
    expect(ArenaCombatEngine.getFinisherCapstoneBonus(2)).toBeCloseTo(1.45);
    expect(ArenaCombatEngine.getFinisherCapstoneBonus(9)).toBeCloseTo(1.75);
  });
});

// The CPU has the same stamina mechanics as the player — including the
// human one: PACING. A gassed AI with no kill pressure rests (returns no
// command) so the timed regen can refill, instead of re-spending every
// point the moment it arrives.
describe('AI stamina pacing', () => {
  const jab = makeCard({ id: 'jab-rest', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

  it('rests when gassed with no pressure on', () => {
    const battle = makeBattle({}, { stamina: 2 });

    expect(ArenaCombatEngine.selectAIAction(battle, [jab])).toBeNull();
  });

  it('keeps attacking through low stamina when the player is nearly down', () => {
    const battle = makeBattle({ currentHP: 20, maxHP: 100 }, { stamina: 2 });

    expect(ArenaCombatEngine.selectAIAction(battle, [jab])).not.toBeNull();
  });

  it('fights normally with a working stamina tank', () => {
    const battle = makeBattle({}, { stamina: 5 });

    expect(ArenaCombatEngine.selectAIAction(battle, [jab])).not.toBeNull();
  });
});

// The reported stacking flow: defend, WAIT OUT the cooldown, defend again —
// with the first trap still armed and never sprung. The old availability
// rule locked the second defend behind "enemy must spring your trap first",
// which made stacking unreachable whenever the CPU held back.
describe('guard stacking without the trap being sprung', () => {
  const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

  it('re-defending over an armed trap overcharges it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const battle = makeBattle();

    const first = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    expect(first.player.armedDefenseTrap?.stackLevel ?? 0).toBe(0);

    // Cooldown still running: the second defend is gated by TIME only.
    expect(ArenaCombatEngine.canPlayCard(first, 'player', block)).toBe(false);

    vi.setSystemTime(3_000_000 + 2 * DEFENSE_COOLDOWN_MS_PER_TURN + 1);
    expect(ArenaCombatEngine.canPlayCard(first, 'player', block)).toBe(true);

    const second = ArenaCombatEngine.resolveAction(first, block, first.player.holobotId);
    expect(second.player.armedDefenseTrap?.stackLevel).toBe(1);
    expect(second.player.armedDefenseTrap?.damageReduction).toBeCloseTo(0.65);
    expect(second.player.guardStacks).toBe(2);
  });
});

// Post-defend brace: arming a defense locks that fighter's ATTACKS for a
// beat (the defense family keeps its own longer cooldown).
describe('post-defend action brace', () => {
  const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
  const jab = makeCard({ id: 'jab-brace', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

  it('locks attacks for the brace window, then releases', () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const battle = makeBattle();

    const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    expect(ArenaCombatEngine.getCardAvailability(defended, 'player', jab)).toEqual({
      playable: false,
      reason: 'bracing',
    });
    expect(ArenaCombatEngine.canUseSignatureFinisher({
      ...defended,
      player: { ...defended.player, specialMeter: 100 },
    }, 'player')).toBe(false);

    vi.setSystemTime(4_000_000 + POST_DEFENSE_ACTION_LOCK_MS + 1);
    expect(ArenaCombatEngine.canPlayCard(defended, 'player', jab)).toBe(true);

    // The opponent was never braced by the player's defend.
    expect(ArenaCombatEngine.canPlayCard(defended, 'opponent', jab)).toBe(true);
  });
});
