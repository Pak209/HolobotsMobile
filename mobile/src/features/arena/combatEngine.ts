import type {
  ActionCard,
  ActionOutcome,
  ArmedDefenseTrap,
  ArenaBattleConfig,
  ArenaFighter,
  BattleAction,
  BattleRewards,
  BattleState,
  DamageModifier,
  DamageResult,
  StaminaState,
} from '@/types/arena';
import { fireAbility, getRuleBend } from './abilities';
import { FINISHER_METER_REQUIREMENT } from './moveKits';
import {
  createArmedDefenseTrap,
  enhanceTrapWithStacks,
  evaluateCardAvailability,
  getDefenseCooldownMs,
  getDefenseTrapCard,
  getCardCooldownTurns,
  getCardEfficiency,
  getFighterHealthPercent,
  getPlayableCards,
  MAX_GUARD_STACKS,
  POST_DEFENSE_ACTION_LOCK_MS,
  tickCooldownMap,
  type ArenaCardAvailability,
} from './arenaCards';

const SPECIAL_METER_MAX = 100;
const TURN_STAMINA_REGEN = 1;
// Technical finisher = chain ender: base capstone plus a growing cut per
// live combo link, capped so KEN's persistent chain can't run away with it.
const FINISHER_CAPSTONE_BASE = 1.25;
const CHAIN_ENDER_BONUS_PER_LINK = 0.1;
const CHAIN_ENDER_BONUS_CAP = 0.5;

type FighterRole = 'player' | 'opponent';

type AISituation = {
  isLowHP: boolean;
  isLowStamina: boolean;
  opponentLowHP: boolean;
  opponentLowStamina: boolean;
  hasFinisherReady: boolean;
  comboActive: boolean;
};

function cloneFighter(fighter: ArenaFighter): ArenaFighter {
  return {
    ...fighter,
    statusEffects: [...(fighter.statusEffects ?? [])],
  };
}

function buildBattleId(player: ArenaFighter, opponent: ArenaFighter): string {
  return `${player.holobotId}-vs-${opponent.holobotId}-${Date.now()}`;
}

function capMeter(value: number): number {
  return Math.max(0, Math.min(SPECIAL_METER_MAX, value));
}

export class ArenaCombatEngine {
  static readonly DEFENSE_COOLDOWN_TURNS = 2;

  static initializeBattle(
    player: ArenaFighter,
    opponent: ArenaFighter,
    config?: Partial<ArenaBattleConfig>,
  ): BattleState {
    const now = Date.now();
    const initialPlayer = this.prepareFighterWithBends(player, now);
    const initialOpponent = this.prepareFighterWithBends(opponent, now);

    // Innate abilities are live from the opening bell (e.g. ERA starts with
    // meter already charged).
    fireAbility(initialPlayer, 'battle_start', { turnNumber: 0 });
    fireAbility(initialOpponent, 'battle_start', { turnNumber: 0 });

    return {
      battleId: buildBattleId(initialPlayer, initialOpponent),
      battleType: config?.battleType ?? 'pve',
      status: 'active',
      player: initialPlayer,
      opponent: initialOpponent,
      turnNumber: 1,
      currentActorId: initialPlayer.holobotId,
      playerDefenseCooldownUntil: 0,
      opponentDefenseCooldownUntil: 0,
      playerCardCooldowns: {},
      opponentCardCooldowns: {},
      pendingActions: [],
      actionHistory: [],
      timer: 0,
      neutralPhase: false,
      counterWindowOpen: false,
      lastActionTimestamp: now,
      createdAt: now,
      startedAt: now,
      playerBattleStyle: 'balanced',
      hackUsed: false,
      allowPlayerControl: config?.allowPlayerControl ?? true,
      config: {
        battleType: config?.battleType ?? 'pve',
        playerHolobotId: config?.playerHolobotId ?? initialPlayer.holobotId,
        opponentHolobotId: config?.opponentHolobotId ?? initialOpponent.holobotId,
        allowPlayerControl: config?.allowPlayerControl ?? true,
        difficulty: config?.difficulty,
        globalModifiers: config?.globalModifiers,
        maxTurns: config?.maxTurns,
        opponentBattleCards: config?.opponentBattleCards,
        playerBattleCards: config?.playerBattleCards,
        potentialRewards: config?.potentialRewards,
        tier: config?.tier,
        timeLimit: config?.timeLimit,
      },
      potentialRewards:
        config?.potentialRewards ??
        this.calculatePotentialRewards(initialPlayer, initialOpponent, config?.battleType ?? 'pve'),
    };
  }

  static prepareFighter(fighter: ArenaFighter, now = Date.now()): ArenaFighter {
    const stamina = Math.min(fighter.maxStamina, Math.max(0, fighter.stamina ?? fighter.maxStamina));
    return {
      ...cloneFighter(fighter),
      currentHP: Math.min(fighter.maxHP, fighter.currentHP),
      stamina,
      staminaState: this.getStaminaState(stamina),
      specialMeter: capMeter(fighter.specialMeter ?? 0),
      isInDefenseMode: Boolean(fighter.isInDefenseMode),
      defenseCooldownUntil: fighter.defenseCooldownUntil ?? 0,
      defenseActive: Boolean(fighter.defenseActive),
      defendedAt: fighter.defendedAt,
      armedDefenseTrap: fighter.armedDefenseTrap ?? null,
      comboCounter: fighter.comboCounter ?? 0,
      lastActionTime: fighter.lastActionTime ?? now,
      staminaEfficiency: fighter.staminaEfficiency ?? 1,
      defenseTimingWindow: fighter.defenseTimingWindow ?? 500,
      counterDamageBonus: fighter.counterDamageBonus ?? 1.25,
      damageMultiplier: fighter.damageMultiplier ?? 1,
      speedBonus: fighter.speedBonus ?? 0,
      totalDamageDealt: fighter.totalDamageDealt ?? 0,
      perfectDefenses: fighter.perfectDefenses ?? 0,
      combosCompleted: fighter.combosCompleted ?? 0,
      abilityRuntime: fighter.abilityRuntime ?? { firedCount: 0 },
      guardStacks: fighter.guardStacks ?? 0,
    };
  }

  static prepareFighterWithBends(fighter: ArenaFighter, now = Date.now()): ArenaFighter {
    const prepared = this.prepareFighter(fighter, now);
    this.applyMeterFloor(prepared);
    return prepared;
  }

  static getCardAvailability(
    state: BattleState,
    role: FighterRole,
    card: ActionCard,
  ): ArenaCardAvailability {
    return evaluateCardAvailability(state, role, card);
  }

  static getPlayableCards(
    state: BattleState,
    role: FighterRole,
    cards: ActionCard[],
  ): ActionCard[] {
    return getPlayableCards(state, role, cards);
  }

  static canPlayCard(
    state: BattleState,
    role: FighterRole,
    card: ActionCard,
  ): boolean {
    return this.getCardAvailability(state, role, card).playable;
  }

  /** Applies damage with GAMA's per-hit cap; returns the damage actually dealt. */
  private static dealDamage(defender: ArenaFighter, amount: number): number {
    let final = Math.max(0, amount);
    const cap = getRuleBend(defender, 'max_hit_percent_cap');
    if (cap && final > 0) {
      final = Math.min(final, Math.max(1, Math.floor(defender.maxHP * cap.value)));
    }
    defender.currentHP = Math.max(0, defender.currentHP - final);
    return final;
  }

  /** KURAI's bend: below the HP threshold, heal a bounded share of damage dealt. */
  private static applyLifesteal(attacker: ArenaFighter, damage: number): void {
    const bend = getRuleBend(attacker, 'lifesteal_below_percent');
    if (!bend || damage <= 0 || attacker.maxHP <= 0) return;
    if (attacker.currentHP / attacker.maxHP >= bend.threshold) return;
    const accrued = attacker.abilityRuntime?.bendAccrued ?? 0;
    const heal = Math.min(Math.floor(damage * bend.ratio), bend.battleCap - accrued);
    if (heal <= 0) return;
    attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + heal);
    attacker.abilityRuntime = {
      ...(attacker.abilityRuntime ?? { firedCount: 0 }),
      bendAccrued: accrued + heal,
    };
  }

  /** Meter writes honor ERA's floor bend. */
  static applyMeterFloor(fighter: ArenaFighter): void {
    const floor = getRuleBend(fighter, 'meter_floor');
    if (floor) {
      fighter.specialMeter = Math.max(floor.value, fighter.specialMeter);
    }
  }

  private static setMeter(fighter: ArenaFighter, value: number): void {
    fighter.specialMeter = capMeter(value);
    this.applyMeterFloor(fighter);
  }

  static resolveAction(
    state: BattleState,
    card: ActionCard,
    actorId: string,
  ): BattleState {
    const nextState: BattleState = {
      ...state,
      player: cloneFighter(state.player),
      opponent: cloneFighter(state.opponent),
      actionHistory: [...state.actionHistory],
      playerCardCooldowns: { ...(state.playerCardCooldowns ?? {}) },
      opponentCardCooldowns: { ...(state.opponentCardCooldowns ?? {}) },
    };

    const actorRole: FighterRole = actorId === state.player.holobotId ? 'player' : 'opponent';
    const targetRole: FighterRole = actorRole === 'player' ? 'opponent' : 'player';
    const actor = actorRole === 'player' ? nextState.player : nextState.opponent;
    const target = targetRole === 'player' ? nextState.player : nextState.opponent;

    if (!this.canPlayCard(nextState, actorRole, card)) {
      return state;
    }

    const now = Date.now();
    const action: BattleAction = {
      id: `arena-action-${now}`,
      battleId: nextState.battleId,
      turnNumber: nextState.turnNumber,
      actionOrder: nextState.actionHistory.length,
      actorId: actor.holobotId,
      actorRole,
      targetId: target.holobotId,
      card,
      actionType: card.type,
      timestamp: now,
      elapsedMs: nextState.createdAt ? now - nextState.createdAt : 0,
      outcome: 'hit',
      damageDealt: 0,
      actualDamage: 0,
      staminaChange: -card.staminaCost,
      specialMeterChange: 0,
      wasCountered: false,
      triggeredCombo: false,
      perfectDefense: false,
      comboLength: actor.comboCounter,
      openedCounterWindow: false,
      animationId: card.animationId,
      animationDuration: 800,
    };

    if (card.type !== 'defense') {
      // WAKE's bend: overflow pressure — a full tank discounts the next move.
      let staminaCost = card.staminaCost;
      const discount = getRuleBend(actor, 'full_stamina_discount');
      if (discount && staminaCost > 0 && actor.stamina >= actor.maxStamina) {
        staminaCost = Math.max(1, staminaCost - discount.value);
      }
      action.staminaChange = -staminaCost;
      actor.stamina = Math.max(0, actor.stamina - staminaCost);
      actor.staminaState = this.getStaminaState(actor.stamina);

      // Attacking breaks the consecutive-defense streak (Guard Stacks).
      actor.guardStacks = 0;

      // Attacking drops your own guard: an armed trap only persists while
      // its owner holds the defensive stance. SHADOW's bend lets the trap
      // survive the FIRST attack after arming.
      if (actor.armedDefenseTrap) {
        const grace = getRuleBend(actor, 'guard_holds_through_first_attack');
        if (grace && !actor.armedDefenseTrap.graceUsed) {
          actor.armedDefenseTrap = { ...actor.armedDefenseTrap, graceUsed: true };
        } else {
          actor.armedDefenseTrap = null;
          actor.isInDefenseMode = false;
          actor.defenseActive = false;
          actor.defendedAt = undefined;
        }
      }
    }
    actor.lastActionTime = now;

    switch (card.type) {
      case 'defense':
        this.resolveDefense(action, actor, target);
        break;
      case 'combo':
        this.resolveCombo(action, actor, target);
        break;
      case 'finisher':
        this.resolveFinisher(action, actor, target);
        break;
      case 'strike':
      default:
        this.resolveStrike(action, actor, target);
        break;
    }

    this.applyCardEffects(card, actor, target, action);
    this.applyAbilityTriggers(nextState, action, actor, target);
    this.advanceTurnState(nextState, actorRole, card);

    nextState.actionHistory.push(action);
    nextState.turnNumber += 1;
    nextState.currentActorId = target.holobotId;
    nextState.lastActionTimestamp = now;

    const winCondition = this.checkWinCondition(nextState);
    if (winCondition.isComplete) {
      nextState.status = 'completed';
    }

    return nextState;
  }

  /**
   * Deterministic damage forecast mirroring resolveStrike/resolveCombo/
   * resolveFinisher (combo multipliers, the technique-finisher capstone
   * bonus, and the target's armed-trap reduction). Signature cards
   * (templateId "signature.*") forecast the signature's doubled raw damage.
   * Drives AI decisions.
   */
  static estimateCardDamage(
    attacker: ArenaFighter,
    defender: ArenaFighter,
    card: ActionCard,
  ): number {
    if (card.type === 'defense') {
      return 0;
    }

    const result = this.calculateDamage(attacker, defender, card, false, attacker.comboCounter);
    let damage = result.finalDamage;

    if (card.type === 'combo') {
      damage = Math.floor(damage * this.calculateComboMultiplier(attacker.comboCounter));
    }
    if (card.type === 'finisher') {
      damage = card.templateId.startsWith('signature.')
        ? result.rawDamage * 2
        : Math.floor(
            damage *
              this.calculateComboMultiplier(attacker.comboCounter) *
              this.getFinisherCapstoneBonus(attacker.comboCounter),
          );
    }
    if (defender.armedDefenseTrap) {
      damage = Math.max(0, Math.round(damage * (1 - defender.armedDefenseTrap.damageReduction)));
    }

    return damage;
  }

  // -------------------------------------------------------------------------
  // Signature Finisher — innate Holobot identity, never part of the four-slot
  // kit. Available at exactly 100 special meter, fired only by an explicit
  // command (never auto-selected for the player), and consumes the full
  // meter. Traps still apply, preserving counterplay.
  // -------------------------------------------------------------------------

  static readonly SIGNATURE_METER_COST = SPECIAL_METER_MAX;

  static canUseSignatureFinisher(state: BattleState, role: FighterRole): boolean {
    const fighter = role === 'player' ? state.player : state.opponent;
    return (
      state.status === 'active' &&
      fighter.specialMeter >= SPECIAL_METER_MAX &&
      (fighter.actionLockUntil ?? 0) <= Date.now()
    );
  }

  static buildSignatureCard(fighter: ArenaFighter): ActionCard {
    const signature = fighter.signatureFinisher ?? {
      id: 'signature.generic',
      name: 'Arena Burst',
      baseDamage: 38,
      animationId: 'finisher_signature',
    };

    return {
      id: signature.id,
      templateId: signature.id,
      name: signature.name,
      type: 'finisher',
      staminaCost: 0,
      requirements: [],
      baseDamage: signature.baseDamage,
      speedModifier: 0.8,
      effects: [],
      animationId: signature.animationId,
      description: `${fighter.name}'s signature finisher.`,
    };
  }

  static resolveSignatureFinisher(state: BattleState, actorId: string): BattleState {
    const actorRole: FighterRole = actorId === state.player.holobotId ? 'player' : 'opponent';
    if (!this.canUseSignatureFinisher(state, actorRole)) {
      return state;
    }

    const nextState: BattleState = {
      ...state,
      player: cloneFighter(state.player),
      opponent: cloneFighter(state.opponent),
      actionHistory: [...state.actionHistory],
    };

    const actor = actorRole === 'player' ? nextState.player : nextState.opponent;
    const target = actorRole === 'player' ? nextState.opponent : nextState.player;
    const card = this.buildSignatureCard(actor);
    const now = Date.now();

    const action: BattleAction = {
      id: `arena-signature-${now}`,
      battleId: nextState.battleId,
      turnNumber: nextState.turnNumber,
      actionOrder: nextState.actionHistory.length,
      actorId: actor.holobotId,
      actorRole,
      targetId: target.holobotId,
      card,
      actionType: 'finisher',
      timestamp: now,
      elapsedMs: nextState.createdAt ? now - nextState.createdAt : 0,
      outcome: 'hit',
      damageDealt: 0,
      actualDamage: 0,
      staminaChange: 0,
      specialMeterChange: -SPECIAL_METER_MAX,
      wasCountered: false,
      triggeredCombo: false,
      perfectDefense: false,
      comboLength: actor.comboCounter,
      openedCounterWindow: false,
      animationId: card.animationId,
      animationDuration: 1100,
    };

    // Committing to the super drops the actor's own guard, like any attack.
    if (actor.armedDefenseTrap) {
      actor.armedDefenseTrap = null;
      actor.isInDefenseMode = false;
      actor.defenseActive = false;
      actor.defendedAt = undefined;
    }
    actor.lastActionTime = now;

    const damageResult = this.calculateDamage(actor, target, card, false, 0);
    let actualDamage = damageResult.rawDamage * 2;
    if (target.armedDefenseTrap) {
      const trapResult = this.consumeDefenseTrap(actor, target, actualDamage);
      if (trapResult) {
        actualDamage = trapResult.finalDamage;
        action.outcome = trapResult.outcome;
        action.wasCountered = trapResult.counterDamage > 0;
        action.perfectDefense = trapResult.evaded;
      }
    }

    const dealt = this.dealDamage(target, actualDamage);
    action.damageDealt = damageResult.rawDamage * 2;
    action.actualDamage = dealt;
    this.applyLifesteal(actor, dealt);

    this.setMeter(actor, 0);
    actor.comboCounter = 0;
    actor.totalDamageDealt = (actor.totalDamageDealt ?? 0) + dealt;

    this.applyAbilityTriggers(nextState, action, actor, target);

    nextState.actionHistory.push(action);
    nextState.turnNumber += 1;
    nextState.lastActionTimestamp = now;

    if (this.checkWinCondition(nextState).isComplete) {
      nextState.status = 'completed';
    }

    return nextState;
  }

  static resolveDefenseTrap({
    trap,
    attacker,
    defender,
    incomingDamage,
  }: {
    trap: ArmedDefenseTrap;
    attacker: ArenaFighter;
    defender: ArenaFighter;
    incomingDamage: number;
  }): {
    finalDamage: number;
    counterDamage: number;
    evaded: boolean;
    outcome: ActionOutcome;
  } {
    const didEvade = Math.random() < trap.evadeChance;

    let finalDamage = incomingDamage;
    let counterDamage = 0;

    if (didEvade) {
      finalDamage = 0;
    } else {
      finalDamage = Math.max(0, Math.round(incomingDamage * (1 - trap.damageReduction)));
    }

    if (trap.effect === 'counter' || trap.effect === 'perfect_reversal') {
      counterDamage = Math.round(
        incomingDamage * trap.counterDamageMultiplier * (defender.counterDamageBonus || 1),
      );
    }

    return {
      finalDamage,
      counterDamage,
      evaded: didEvade,
      outcome:
        counterDamage > 0 ? 'countered' : didEvade ? 'perfect_defense' : 'blocked',
    };
  }

  static calculateDamage(
    attacker: ArenaFighter,
    defender: ArenaFighter,
    card: ActionCard,
    isCounter = false,
    comboLength = 0,
  ): DamageResult {
    const modifiers: DamageModifier[] = [];
    const attackMultiplier = (attacker.attack || 20) / 20;
    const defenseReduction = 30 / (30 + (defender.defense || 10));
    let damage = card.baseDamage * attackMultiplier * defenseReduction;

    modifiers.push({
      source: 'Attack Stat',
      type: 'multiply',
      value: attackMultiplier,
      description: `x${attackMultiplier.toFixed(2)} from ${attacker.attack} ATK`,
    });

    modifiers.push({
      source: 'Defense Stat',
      type: 'multiply',
      value: defenseReduction,
      description: `x${defenseReduction.toFixed(2)} against ${defender.defense} DEF`,
    });

    // WOLF's bend: hits at full power regardless of stamina state.
    const staminaModifier = getRuleBend(attacker, 'ignore_stamina_damage_penalty')
      ? 1
      : this.getStaminaModifier(attacker.staminaState);
    if (staminaModifier !== 1) {
      damage *= staminaModifier;
      modifiers.push({
        source: 'Stamina State',
        type: 'multiply',
        value: staminaModifier,
        description: `x${staminaModifier.toFixed(2)} (${attacker.staminaState})`,
      });
    }

    if (isCounter) {
      const counterBonus = attacker.counterDamageBonus || 1.5;
      damage *= counterBonus;
      modifiers.push({
        source: 'Counter Strike',
        type: 'multiply',
        value: counterBonus,
        description: `x${counterBonus.toFixed(2)} counter bonus`,
      });
    }

    if (comboLength > 0) {
      const comboBonus = 1 + comboLength * 0.1;
      damage *= comboBonus;
      modifiers.push({
        source: 'Combo',
        type: 'multiply',
        value: comboBonus,
        description: `x${comboBonus.toFixed(2)} combo bonus`,
      });
    }

    if ((attacker.damageMultiplier ?? 1) !== 1) {
      damage *= attacker.damageMultiplier ?? 1;
      modifiers.push({
        source: 'Damage Buff',
        type: 'multiply',
        value: attacker.damageMultiplier ?? 1,
        description: `x${(attacker.damageMultiplier ?? 1).toFixed(2)} status bonus`,
      });
    }

    const rawDamage = Math.floor(damage);
    const finalDamage = Math.max(1, rawDamage);

    return {
      rawDamage,
      finalDamage,
      damageReduction: 0,
      isCritical: false,
      modifiers,
    };
  }

  static regenerateStamina(state: BattleState): BattleState {
    return {
      ...state,
      player: this.recoverStamina(cloneFighter(state.player), TURN_STAMINA_REGEN),
      opponent: this.recoverStamina(cloneFighter(state.opponent), TURN_STAMINA_REGEN),
    };
  }

  static getStaminaState(currentStamina: number): StaminaState {
    if (currentStamina >= 6) return 'fresh';
    if (currentStamina >= 4) return 'working';
    if (currentStamina >= 2) return 'gassed';
    return 'exhausted';
  }

  static getStaminaModifier(state: StaminaState): number {
    switch (state) {
      case 'fresh':
        return 1.0;
      case 'working':
        return 0.95;
      case 'gassed':
        return 0.85;
      case 'exhausted':
        return 0.7;
      default:
        return 1.0;
    }
  }

  static recoverStamina(fighter: ArenaFighter, amount = 1): ArenaFighter {
    const stamina = Math.min(fighter.maxStamina, fighter.stamina + amount);
    fighter.stamina = stamina;
    fighter.staminaState = this.getStaminaState(stamina);
    return fighter;
  }

  /**
   * Full AI decision including the Signature Finisher (plan §10): fire the
   * signature when it kills, or as soon as the meter is full and the player
   * has no armed trap to eat it; otherwise pick the best kit move.
   */
  static selectAICommand(
    state: BattleState,
    moves: ActionCard[],
  ): { kind: 'signature' } | { kind: 'move'; card: ActionCard } | null {
    if (this.canUseSignatureFinisher(state, 'opponent')) {
      const signatureCard = this.buildSignatureCard(state.opponent);
      const signatureDamage = this.estimateCardDamage(state.opponent, state.player, signatureCard);
      if (signatureDamage >= state.player.currentHP || !state.player.armedDefenseTrap) {
        return { kind: 'signature' };
      }
    }

    const card = this.selectAIAction(state, moves);
    return card ? { kind: 'move', card } : null;
  }

  static selectAIAction(
    state: BattleState,
    cards: ActionCard[],
  ): ActionCard | null {
    const self = state.opponent;
    const opponent = state.player;
    const playableCards = this.getPlayableCards(state, 'opponent', cards);

    if (playableCards.length === 0) {
      return null;
    }

    const situation: AISituation = {
      isLowHP: getFighterHealthPercent(self) < 0.3,
      isLowStamina: self.stamina / self.maxStamina < 0.3,
      opponentLowHP: getFighterHealthPercent(opponent) < 0.3,
      opponentLowStamina: opponent.stamina / opponent.maxStamina < 0.3,
      hasFinisherReady: self.specialMeter >= SPECIAL_METER_MAX,
      comboActive: self.comboCounter >= 2,
    };

    const attacks = playableCards.filter((card) => card.type !== 'defense');
    const defenses = playableCards.filter((card) => card.type === 'defense');
    const opponentTrapArmed = Boolean(opponent.armedDefenseTrap);
    const opponentWinded =
      opponent.staminaState === 'gassed' || opponent.staminaState === 'exhausted';

    // 1) Close out the fight: cheapest attack that finishes the player now.
    const lethal = attacks
      .filter((card) => this.estimateCardDamage(self, opponent, card) >= opponent.currentHP)
      .sort((left, right) => left.staminaCost - right.staminaCost)[0];
    if (lethal) {
      return lethal;
    }

    // 2) The kit finisher is an early meter cash-out (unlocks at 4/7 but
    //    spends the whole charge). Cash it early only to press a kill window
    //    — otherwise hold and build toward the full-strength signature.
    const kitFinisher = attacks.find((card) => card.type === 'finisher');
    if (kitFinisher && getFighterHealthPercent(opponent) < 0.35) {
      return kitFinisher;
    }
    const attackOptions = attacks.filter((card) => card.type !== 'finisher');

    // 3) Defense is for recovering stamina, not hiding: brace only when no
    //    attack is affordable, or when badly hurt while the player still has
    //    the gas to punish an opening.
    const mustRecover = attacks.length === 0;
    const shouldBrace =
      situation.isLowHP && self.stamina <= 2 && opponent.stamina >= 2 && !opponentTrapArmed;
    if (defenses.length > 0 && (mustRecover || shouldBrace)) {
      return this.selectBestDefense(defenses, situation);
    }

    // 4) The player armed a trap: spring it with the cheapest attack so the
    //    real hits land after the trap is spent.
    if (opponentTrapArmed) {
      const probe = [...attackOptions].sort(
        (left, right) => left.staminaCost - right.staminaCost || left.baseDamage - right.baseDamage,
      )[0];
      if (probe) {
        return probe;
      }
    }

    // 5) Cash in a hot combo counter — but keep one point of stamina in
    //    reserve unless the payoff is a big chunk of the player's health.
    if (situation.comboActive) {
      const combos = attackOptions
        .filter((card) => card.type === 'combo')
        .sort(
          (left, right) =>
            this.estimateCardDamage(self, opponent, right) -
            this.estimateCardDamage(self, opponent, left),
        );
      const bestCombo = combos[0];
      if (
        bestCombo &&
        (self.stamina - bestCombo.staminaCost >= 1 ||
          this.estimateCardDamage(self, opponent, bestCombo) >= opponent.currentHP * 0.3)
      ) {
        return bestCombo;
      }
    }

    // 5.5) Catch a breath: gassed with no kill pressure on, the AI RESTS
    //    (plays nothing) so the timed regen can actually refill the tank —
    //    the same pacing a human plays instead of re-spending every point
    //    the moment it trickles in. Blood in the water overrides the rest:
    //    a hurt or winded player, or a live chain worth cashing, keeps the
    //    pressure up.
    if (
      self.stamina <= 2 &&
      !situation.opponentLowHP &&
      !opponentWinded &&
      !situation.comboActive
    ) {
      return null;
    }

    // 6) Default: best value for the current stamina budget. When the bar is
    //    low, damage-per-stamina matters more than raw damage; never dump the
    //    last point without a kill, and press harder while the player is winded.
    const staminaTight = self.stamina <= 3;
    const scored = attackOptions
      .map((card) => {
        const damage = this.estimateCardDamage(self, opponent, card);
        const efficiency = getCardEfficiency(card);
        let score = damage + efficiency * (staminaTight ? 8 : 3) + card.speedModifier * 2;
        if (self.stamina - card.staminaCost <= 0) {
          score -= damage * 0.5;
        }
        if (opponentWinded) {
          score += damage * 0.3;
        }
        return { card, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.card ?? playableCards[0];
  }

  static calculatePotentialRewards(
    player: ArenaFighter,
    opponent: ArenaFighter,
    battleType: string,
  ): BattleRewards {
    const baseExp = 100;
    const baseSyncPoints = 50;
    const statDiff = (opponent.attack + opponent.defense) - (player.attack + player.defense);
    const diffMultiplier = 1 + Math.max(0, statDiff / 100);

    return {
      exp: Math.floor(baseExp * diffMultiplier),
      syncPoints: Math.floor(baseSyncPoints * diffMultiplier),
      holos: 0,
      eloChange: battleType === 'ranked' ? 25 : undefined,
    };
  }

  static calculateActualRewards(state: BattleState, winnerId: string): BattleRewards {
    const didWin = winnerId === state.player.holobotId;
    const base = state.potentialRewards;

    if (!didWin) {
      return {
        exp: Math.floor(base.exp * 0.3),
        syncPoints: Math.floor(base.syncPoints * 0.2),
        holos: 0,
        eloChange: base.eloChange ? -base.eloChange : undefined,
      };
    }

    const perfectDefenses = state.actionHistory.filter((action) => action.perfectDefense).length;
    const combos = state.actionHistory.filter((action) => action.triggeredCombo).length;
    const performanceBonus = 1 + perfectDefenses * 0.05 + combos * 0.1;

    return {
      exp: Math.floor(base.exp * performanceBonus),
      syncPoints: Math.floor(base.syncPoints * performanceBonus),
      holos: base.holos,
      blueprintRewards: base.blueprintRewards,
      eloChange: base.eloChange,
    };
  }

  static checkWinCondition(state: BattleState): {
    isComplete: boolean;
    winnerId?: string;
    winType?: 'ko' | 'finisher' | 'timeout' | 'forfeit';
  } {
    // A finisher is a big attack, not an auto-win: only a KO (or timeout)
    // ends the battle. The old rule completed the battle for whoever landed
    // a finisher even when the target had plenty of HP left, which handed
    // out instant defeats the moment the AI's meter filled. The label still
    // reports 'finisher' when the KO'ing blow was one.
    const lastAction = state.actionHistory[state.actionHistory.length - 1];
    const koWinType = lastAction?.actionType === 'finisher' ? 'finisher' : 'ko';

    if (state.player.currentHP <= 0) {
      return { isComplete: true, winnerId: state.opponent.holobotId, winType: koWinType };
    }

    if (state.opponent.currentHP <= 0) {
      return { isComplete: true, winnerId: state.player.holobotId, winType: koWinType };
    }

    if (state.config?.maxTurns && state.turnNumber >= state.config.maxTurns) {
      return {
        isComplete: true,
        winnerId:
          state.player.currentHP >= state.opponent.currentHP
            ? state.player.holobotId
            : state.opponent.holobotId,
        winType: 'timeout',
      };
    }

    return { isComplete: false };
  }

  private static resolveStrike(
    action: BattleAction,
    attacker: ArenaFighter,
    defender: ArenaFighter,
  ): void {
    const damageResult = this.calculateDamage(attacker, defender, action.card, false, attacker.comboCounter);
    let finalDamage = damageResult.finalDamage;
    let outcome: ActionOutcome = 'hit';

    const trapResult = this.consumeDefenseTrap(attacker, defender, finalDamage);
    if (trapResult) {
      finalDamage = trapResult.finalDamage;
      outcome = trapResult.outcome;
      action.wasCountered = trapResult.counterDamage > 0;
      action.perfectDefense = trapResult.evaded;
    }

    const dealt = this.dealDamage(defender, finalDamage);
    action.damageDealt = damageResult.rawDamage;
    action.actualDamage = dealt;
    action.outcome = outcome;
    this.applyLifesteal(attacker, dealt);

    const meterGain = this.getMeterGainForDamage('strike', dealt, outcome);
    this.setMeter(attacker, attacker.specialMeter + meterGain);
    action.specialMeterChange = meterGain;

    if (outcome === 'hit') {
      attacker.comboCounter += 1;
    } else if (!(outcome === 'blocked' && getRuleBend(attacker, 'chain_survives_block'))) {
      // KUMA's bend: a blocked hit doesn't break the chain (counters and
      // evades still do).
      attacker.comboCounter = 0;
    }

    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + dealt;
  }

  private static resolveDefense(
    action: BattleAction,
    defender: ArenaFighter,
    attacker: ArenaFighter,
  ): void {
    const baseTrap = createArmedDefenseTrap(action.card);
    const defenseCard = getDefenseTrapCard(action.card);
    const staminaRestore = defenseCard?.staminaGain ?? 2;
    const now = Date.now();

    defender.stamina = Math.min(defender.maxStamina, defender.stamina + staminaRestore);
    defender.staminaState = this.getStaminaState(defender.stamina);
    defender.isInDefenseMode = true;
    defender.defenseActive = true;
    defender.defendedAt = now;

    // Going defensive abandons the offensive chain (same rule as rotating
    // out in 3v3): the combo counter is a live streak, not a bank. Cash it
    // with a combo or the technical finisher BEFORE arming a defense.
    defender.comboCounter = 0;

    // Guard Stacks: consecutive defense plays overcharge the trap being
    // armed; the streak only breaks when this fighter attacks.
    const stacks = Math.min(MAX_GUARD_STACKS, defender.guardStacks ?? 0);
    defender.armedDefenseTrap = baseTrap
      ? {
          ...enhanceTrapWithStacks(baseTrap, stacks),
          charges: getRuleBend(defender, 'trap_extra_charge') ? 2 : 1,
        }
      : baseTrap;
    defender.guardStacks = Math.min(MAX_GUARD_STACKS, stacks + 1);

    // Defense cooldown is time-based: waiting it out (instead of attacking)
    // is exactly how the stack streak is kept alive.
    defender.defenseCooldownUntil = now + getDefenseCooldownMs(action.card);

    // Brace: committing to the stance locks this fighter's ATTACKS for a
    // beat — no defend-then-instant-strike.
    defender.actionLockUntil = now + POST_DEFENSE_ACTION_LOCK_MS;

    action.outcome = 'blocked';
    action.damageDealt = 0;
    action.actualDamage = 0;
    action.staminaChange = staminaRestore;
    action.specialMeterChange = 0;
    action.openedCounterWindow = true;

    if (defender.speed + defender.intelligence > attacker.attack + attacker.speed) {
      defender.perfectDefenses = (defender.perfectDefenses ?? 0) + 1;
      action.perfectDefense = true;
    }
  }

  private static resolveCombo(
    action: BattleAction,
    attacker: ArenaFighter,
    defender: ArenaFighter,
  ): void {
    const comboLength = attacker.comboCounter;
    const comboMultiplier = this.calculateComboMultiplier(comboLength);
    const damageResult = this.calculateDamage(attacker, defender, action.card, false, comboLength);
    let actualDamage = Math.floor(damageResult.finalDamage * comboMultiplier);
    let outcome: ActionOutcome = 'hit';

    const trapResult = this.consumeDefenseTrap(attacker, defender, actualDamage);
    if (trapResult) {
      actualDamage = trapResult.finalDamage;
      outcome = trapResult.outcome;
      action.wasCountered = trapResult.counterDamage > 0;
      action.perfectDefense = trapResult.evaded;
    }

    const dealt = this.dealDamage(defender, actualDamage);
    action.damageDealt = Math.floor(damageResult.rawDamage * comboMultiplier);
    action.actualDamage = dealt;
    action.outcome = outcome;
    action.triggeredCombo = true;
    action.comboLength = comboLength + 1;
    this.applyLifesteal(attacker, dealt);

    const meterGain = this.getMeterGainForDamage('combo', dealt, outcome);
    this.setMeter(attacker, attacker.specialMeter + meterGain);
    action.specialMeterChange = meterGain;

    // KEN's bend: a landed combo cash-out keeps the chain alive; for
    // everyone else (and on any stopped hit) the chain resets.
    if (!(outcome === 'hit' && getRuleBend(attacker, 'chain_survives_combo_cash'))) {
      attacker.comboCounter = 0;
    }
    attacker.combosCompleted = (attacker.combosCompleted ?? 0) + 1;
    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + dealt;
  }

  // Kit Finisher (slot 4): the EARLY meter cash-out. It unlocks at 4/7 of
  // the special meter (availability requirement) and consumes the whole
  // meter when used — lower damage than holding the charge to 7/7 for the
  // Signature Finisher below. Blockable/counterable like any attack.
  //
  // It is also the CHAIN ENDER: on top of the normal combo multiplier, the
  // capstone bonus grows with the live chain, so building a combo with
  // strikes and cashing it with the technical finisher out-damages a plain
  // combo cash-out. This is the payoff for stamina discipline — arming a
  // defense drops the chain, so the links must be sustained on offense.
  private static resolveFinisher(
    action: BattleAction,
    attacker: ArenaFighter,
    defender: ArenaFighter,
  ): void {
    const comboLength = attacker.comboCounter;
    const capstoneBonus = this.getFinisherCapstoneBonus(comboLength);
    const damageResult = this.calculateDamage(attacker, defender, action.card, false, comboLength);
    let actualDamage = Math.floor(
      damageResult.finalDamage * this.calculateComboMultiplier(comboLength) * capstoneBonus,
    );
    let outcome: ActionOutcome = 'hit';

    const trapResult = this.consumeDefenseTrap(attacker, defender, actualDamage);
    if (trapResult) {
      actualDamage = trapResult.finalDamage;
      outcome = trapResult.outcome;
      action.wasCountered = trapResult.counterDamage > 0;
      action.perfectDefense = trapResult.evaded;
    }

    const dealt = this.dealDamage(defender, actualDamage);
    action.damageDealt = Math.floor(damageResult.rawDamage * capstoneBonus);
    action.actualDamage = dealt;
    action.outcome = outcome;
    action.comboLength = comboLength;
    this.applyLifesteal(attacker, dealt);

    // Cash out: the finisher spends the built-up meter. TORA's bend spends
    // only the 4/7 requirement; ERA's floor is applied by setMeter.
    const remainder = getRuleBend(attacker, 'finisher_costs_requirement_only')
      ? Math.max(0, attacker.specialMeter - FINISHER_METER_REQUIREMENT)
      : 0;
    action.specialMeterChange = remainder - attacker.specialMeter;
    this.setMeter(attacker, remainder);

    attacker.comboCounter = 0;
    attacker.combosCompleted = (attacker.combosCompleted ?? 0) + 1;
    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + dealt;
  }

  private static applyCardEffects(
    card: ActionCard,
    actor: ArenaFighter,
    target: ArenaFighter,
    action: BattleAction,
  ): void {
    for (const effect of card.effects) {
      const effectTarget = effect.target === 'self' ? actor : target;

      switch (effect.type) {
        case 'stamina_gain': {
          const before = effectTarget.stamina;
          effectTarget.stamina = Math.min(effectTarget.maxStamina, effectTarget.stamina + effect.value);
          effectTarget.staminaState = this.getStaminaState(effectTarget.stamina);
          if (effectTarget === actor) {
            action.staminaChange += effectTarget.stamina - before;
          }
          break;
        }
        case 'special_meter':
          effectTarget.specialMeter = capMeter(effectTarget.specialMeter + effect.value);
          if (effectTarget === actor) {
            action.specialMeterChange += effect.value;
          }
          break;
        case 'combo_enable':
          actor.comboCounter = Math.max(actor.comboCounter, effect.value > 0 ? 1 : actor.comboCounter);
          break;
        case 'status':
          effectTarget.statusEffects = [
            ...(effectTarget.statusEffects ?? []),
            {
              id: `${card.id}-${action.timestamp}`,
              type: 'guard',
              value: effect.value,
              duration: effect.duration ?? 1,
              appliedBy: card.name,
            },
          ];
          break;
        case 'damage':
        default:
          break;
      }
    }
  }

  /** Technical-finisher capstone: 1.25 base, +10% per chain link (cap +50%). */
  static getFinisherCapstoneBonus(comboLength: number): number {
    return (
      FINISHER_CAPSTONE_BASE +
      Math.min(CHAIN_ENDER_BONUS_CAP, Math.max(0, comboLength) * CHAIN_ENDER_BONUS_PER_LINK)
    );
  }

  private static calculateComboMultiplier(rawComboLength: number): number {
    // Safety cap: KEN's persistent chain must not scale unboundedly.
    const comboLength = Math.min(rawComboLength, 8);
    if (comboLength <= 0) return 1;
    if (comboLength <= 3) return 1 + comboLength * 0.15;
    if (comboLength <= 5) return 1 + comboLength * 0.12;
    return 1 + comboLength * 0.08;
  }

  // The special meter charges ONLY from the fighter's own Strike and Combo
  // plays — never from taking hits or arming defenses — so both finisher
  // tiers have to be earned with offense. (Innate abilities may still grant
  // bounded meter as explicit identity exceptions.)
  // Flat, level-independent meter economy: a clean strike is +10 and a clean
  // combo +14 no matter how hard the fighter hits, so a full meter is always
  // ~10 strikes (4/7 finisher unlock around strike 6) at every level and
  // tier. Blocked/countered attacks earn half; a fully evaded hit earns
  // nothing.
  private static getMeterGainForDamage(
    cardType: ActionCard['type'],
    damage: number,
    outcome: ActionOutcome = 'hit',
  ): number {
    if (damage <= 0) {
      return 0;
    }
    const base = cardType === 'combo' ? 14 : cardType === 'strike' ? 10 : 0;
    return outcome === 'hit' ? base : Math.floor(base / 2);
  }

  // Fires both fighters' innate abilities for whatever this action triggered:
  // arming a defense, landing a hit, countering/evading with a trap, or
  // taking damage. Stamina states are refreshed afterwards since abilities
  // can restore stamina.
  private static applyAbilityTriggers(
    state: BattleState,
    action: BattleAction,
    actor: ArenaFighter,
    target: ArenaFighter,
  ): void {
    const context = { turnNumber: state.turnNumber };

    const dealtDamage = action.actualDamage ?? 0;

    if (action.actionType === 'defense') {
      fireAbility(actor, 'after_defend', context);
    } else {
      if (action.outcome === 'hit' && dealtDamage > 0) {
        fireAbility(actor, 'after_hit', {
          ...context,
          damage: dealtDamage,
          comboCount: Math.max(actor.comboCounter, action.comboLength ?? 0),
        });
      }
      if (action.wasCountered || action.perfectDefense) {
        fireAbility(target, 'on_counter', context);
      }
      if (dealtDamage > 0) {
        fireAbility(target, 'on_damaged', { ...context, damage: dealtDamage });
      }
    }

    actor.staminaState = this.getStaminaState(actor.stamina);
    target.staminaState = this.getStaminaState(target.stamina);
  }

  // Combat is real-time: stamina regenerates on the store's timer (via
  // regenerateStamina), not per action, and a cooldown counts the ACTOR's own
  // subsequent plays — "CD 2" means locked for your next two cards.
  private static advanceTurnState(
    state: BattleState,
    actorRole: FighterRole,
    card: ActionCard,
  ): void {
    const cooldownField = actorRole === 'player' ? 'playerCardCooldowns' : 'opponentCardCooldowns';
    state[cooldownField] = tickCooldownMap({ ...(state[cooldownField] ?? {}) });

    // Defense cooldowns are time-based (set in resolveDefense); the
    // play-based map remains only for potential non-defense cooldowns.
    const cooldownTurns = card.type === 'defense' ? 0 : getCardCooldownTurns(card);
    if (cooldownTurns > 0) {
      state[cooldownField]![card.templateId] = cooldownTurns;
    }
  }

  private static selectBestDefense(cards: ActionCard[], situation: AISituation): ActionCard {
    if (situation.isLowStamina) {
      const parry = cards.find((card) => card.templateId === 'parry');
      if (parry) return parry;
    }

    const roll = cards.find((card) => card.templateId === 'roll');
    if (situation.comboActive && roll) {
      return roll;
    }

    const slip = cards.find((card) => card.templateId === 'slip');
    if (slip) {
      return slip;
    }

    return cards[0];
  }

  private static consumeDefenseTrap(
    attacker: ArenaFighter,
    defender: ArenaFighter,
    incomingDamage: number,
  ): {
    finalDamage: number;
    counterDamage: number;
    evaded: boolean;
    outcome: ActionOutcome;
  } | null {
    const trap = defender.armedDefenseTrap;
    if (!trap) {
      return null;
    }

    // ACE's bend: its first attack into an armed trap slips straight
    // through — the trap neither triggers nor breaks.
    if (
      getRuleBend(attacker, 'pierce_traps_first_attack') &&
      (attacker.abilityRuntime?.bendUses ?? 0) === 0
    ) {
      attacker.abilityRuntime = {
        ...(attacker.abilityRuntime ?? { firedCount: 0 }),
        bendUses: 1,
      };
      return null;
    }

    const trapResult = this.resolveDefenseTrap({
      trap,
      attacker,
      defender,
      incomingDamage,
    });

    if (trapResult.counterDamage > 0) {
      this.dealDamage(attacker, trapResult.counterDamage);
    }

    // HARE's bend arms traps with two charges; everyone else's are one-shot.
    const remainingCharges = (trap.charges ?? 1) - 1;
    if (remainingCharges > 0) {
      defender.armedDefenseTrap = { ...trap, charges: remainingCharges };
    } else {
      defender.armedDefenseTrap = null;
      defender.isInDefenseMode = false;
      defender.defenseActive = false;
      defender.defendedAt = undefined;
    }

    return trapResult;
  }
}
