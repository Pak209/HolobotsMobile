import { describe, expect, it } from 'vitest';

import type { ActionCard, ArenaFighter } from '@/types/arena';
import { ArenaCombatEngine } from '../combatEngine';

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
    hand: [],
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

    expect(resolved.player.stamina).toBe(6);
  });

  it('defense applies cooldown', () => {
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });

    const resolved = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);

    expect(resolved.playerCardCooldowns?.block).toBe(2);
    expect(resolved.player.armedDefenseTrap?.templateId).toBe('block');
    expect(ArenaCombatEngine.canPlayCard(resolved, 'player', block)).toBe(false);
  });

  it('cooldown ticks down each turn', () => {
    const battle = makeBattle();
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const jab = makeCard({ id: 'jab-1', templateId: 'jab', type: 'strike', staminaCost: 1, baseDamage: 8 });
    const cross = makeCard({ id: 'cross-1', templateId: 'cross', type: 'strike', staminaCost: 1, baseDamage: 9 });

    const afterDefense = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    const afterOpponentTurn = ArenaCombatEngine.resolveAction(afterDefense, jab, afterDefense.opponent.holobotId);
    const afterPlayerTurn = ArenaCombatEngine.resolveAction(afterOpponentTurn, cross, afterOpponentTurn.player.holobotId);

    expect(afterDefense.playerCardCooldowns?.block).toBe(2);
    expect(afterOpponentTurn.playerCardCooldowns?.block).toBe(1);
    expect(afterPlayerTurn.playerCardCooldowns?.block).toBeUndefined();
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

  it('passTurn regenerates stamina, ticks cooldowns, and hands the turn over', () => {
    const battle = makeBattle({ stamina: 2 }, { stamina: 3 });
    const block = makeCard({ templateId: 'block', type: 'defense', staminaCost: 1, baseDamage: 0 });
    const defended = ArenaCombatEngine.resolveAction(battle, block, battle.player.holobotId);
    expect(defended.currentActorId).toBe(defended.opponent.holobotId);

    const passed = ArenaCombatEngine.passTurn(defended, 'opponent');

    expect(passed.currentActorId).toBe(passed.player.holobotId);
    expect(passed.turnNumber).toBe(defended.turnNumber + 1);
    expect(passed.player.stamina).toBe(defended.player.stamina + 1);
    expect(passed.opponent.stamina).toBe(defended.opponent.stamina + 1);
    expect(passed.playerCardCooldowns?.block).toBe((defended.playerCardCooldowns?.block ?? 1) - 1);
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

    it('spends a full special meter on its finisher', () => {
      const battle = makeBattle({}, { specialMeter: 100 });
      const choice = ArenaCombatEngine.selectAIAction(battle, [jab, finisher, block]);

      expect(choice?.type).toBe('finisher');
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
