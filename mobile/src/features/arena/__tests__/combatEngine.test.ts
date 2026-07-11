import { describe, expect, it } from 'vitest';

import type { ActionCard, ArenaFighter } from '@/types/arena';
import { ArenaCombatEngine } from '../combatEngine';
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
  it('defense restores stamina', () => {
    const battle = makeBattle({ stamina: 3, maxStamina: 7 });
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    const resolved = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    // +2 from the guard trap's staminaGain; ambient regen is time-based in
    // the store loop, not per action.
    expect(resolved.player.stamina).toBe(5);
  });

  it('defense applies cooldown', () => {
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    const resolved = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    expect(resolved.playerCardCooldowns?.block).toBe(2);
    expect(resolved.player.armedDefenseTrap?.templateId).toBe('block');
    expect(ArenaCombatEngine.canPlayCard(resolved, 'player', block)).toBe(false);
  });

  it("defense cooldown ticks down with the defender's own plays", () => {
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const jab = makeCard({ id: 'jab-1', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const cross = makeCard({ id: 'cross-1', templateId: 'cross', type: 'strike', staminaCost: 1, baseDamage: 9 });
    const hook = makeCard({ id: 'hook-1', templateId: 'hook', type: 'strike', staminaCost: 2, baseDamage: 12 });

    const afterDefense = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    // The opponent acting does NOT burn the player's cooldown...
    const afterOpponentAction = ArenaCombatEngine.resolveAction(afterDefense, jab, afterDefense.opponent.holobotId);
    // ...only the player's own plays do.
    const afterPlayerStrike = ArenaCombatEngine.resolveAction(afterOpponentAction, cross, afterOpponentAction.player.holobotId);
    const afterSecondStrike = ArenaCombatEngine.resolveAction(afterPlayerStrike, hook, afterPlayerStrike.player.holobotId);

    expect(afterDefense.playerCardCooldowns?.block).toBe(2);
    expect(afterOpponentAction.playerCardCooldowns?.block).toBe(2);
    expect(afterPlayerStrike.playerCardCooldowns?.block).toBe(1);
    expect(afterSecondStrike.playerCardCooldowns?.block).toBeUndefined();
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
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const opponentBlock = makeCard({ id: 'block-opp', templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const jab = makeCard({ id: 'jab-1', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });

    const playerDefended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    const bothDefended = ArenaCombatEngine.resolveAction(playerDefended, opponentBlock, playerDefended.opponent.holobotId);

    // Both fighters trap-armed — previously zero playable cards for either side.
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
});
