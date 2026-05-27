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
import {
  createArmedDefenseTrap,
  evaluateCardAvailability,
  getDefenseTrapCard,
  getCardCooldownTurns,
  getCardEfficiency,
  getFighterHealthPercent,
  getPlayableCards,
  tickCooldownMap,
  type ArenaCardAvailability,
} from './arenaCards';

const SPECIAL_METER_MAX = 100;
const TURN_STAMINA_REGEN = 1;

type FighterRole = 'player' | 'opponent';

type DamageMeterGain = {
  attackerGain: number;
  defenderGain: number;
};

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
    hand: [...(fighter.hand ?? [])],
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
    const initialPlayer = this.prepareFighter(player, now);
    const initialOpponent = this.prepareFighter(opponent, now);

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
    };
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
      actor.stamina = Math.max(0, actor.stamina - card.staminaCost);
      actor.staminaState = this.getStaminaState(actor.stamina);
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

    const staminaModifier = this.getStaminaModifier(attacker.staminaState);
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

    const defenseCards = playableCards.filter((card) => card.type === 'defense');
    if ((situation.isLowHP || situation.isLowStamina) && defenseCards.length > 0) {
      return this.selectBestDefense(defenseCards, situation);
    }

    if (situation.hasFinisherReady) {
      const finisher = playableCards.find((card) => card.type === 'finisher');
      if (finisher && (opponent.staminaState === 'gassed' || opponent.staminaState === 'exhausted')) {
        return finisher;
      }
    }

    if (situation.comboActive) {
      const combos = playableCards.filter((card) => card.type === 'combo');
      if (combos.length > 0) {
        return combos.reduce((best, current) =>
          current.baseDamage > best.baseDamage ? current : best,
        );
      }
    }

    const strikes = playableCards.filter((card) => card.type === 'strike');
    if (strikes.length > 0) {
      return strikes
        .map((card) => ({
          card,
          score:
            card.baseDamage +
            getCardEfficiency(card) * 5 +
            card.speedModifier * 10 +
            (situation.opponentLowHP ? card.baseDamage * 0.5 : 0) +
            (situation.isLowStamina ? getCardEfficiency(card) * 4 : 0),
        }))
        .sort((left, right) => right.score - left.score)[0]?.card ?? strikes[0];
    }

    return playableCards[0];
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
    if (state.player.currentHP <= 0) {
      return { isComplete: true, winnerId: state.opponent.holobotId, winType: 'ko' };
    }

    if (state.opponent.currentHP <= 0) {
      return { isComplete: true, winnerId: state.player.holobotId, winType: 'ko' };
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

    const lastAction = state.actionHistory[state.actionHistory.length - 1];
    if (lastAction?.actionType === 'finisher' && lastAction.outcome === 'hit') {
      return {
        isComplete: true,
        winnerId: lastAction.actorId,
        winType: 'finisher',
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

    action.damageDealt = damageResult.rawDamage;
    action.actualDamage = finalDamage;
    action.outcome = outcome;

    defender.currentHP = Math.max(0, defender.currentHP - finalDamage);

    const meterGain = this.getMeterGainForDamage('strike', finalDamage);
    attacker.specialMeter = capMeter(attacker.specialMeter + meterGain.attackerGain);
    defender.specialMeter = capMeter(defender.specialMeter + meterGain.defenderGain);
    action.specialMeterChange = meterGain.attackerGain;

    if (outcome === 'hit') {
      attacker.comboCounter += 1;
    } else {
      attacker.comboCounter = 0;
    }

    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + finalDamage;
  }

  private static resolveDefense(
    action: BattleAction,
    defender: ArenaFighter,
    attacker: ArenaFighter,
  ): void {
    const defenseTrap = createArmedDefenseTrap(action.card);
    const defenseCard = getDefenseTrapCard(action.card);
    const staminaRestore = defenseCard?.staminaGain ?? 2;
    const specialMeterGain = defenseCard?.specialMeterGain ?? 6;

    defender.stamina = Math.min(defender.maxStamina, defender.stamina + staminaRestore);
    defender.staminaState = this.getStaminaState(defender.stamina);
    defender.isInDefenseMode = true;
    defender.defenseActive = true;
    defender.defendedAt = Date.now();
    defender.armedDefenseTrap = defenseTrap;

    action.outcome = 'blocked';
    action.damageDealt = 0;
    action.actualDamage = 0;
    action.staminaChange = staminaRestore;
    action.specialMeterChange = specialMeterGain;
    action.openedCounterWindow = true;

    defender.specialMeter = capMeter(defender.specialMeter + specialMeterGain);

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

    action.damageDealt = Math.floor(damageResult.rawDamage * comboMultiplier);
    action.actualDamage = actualDamage;
    action.outcome = outcome;
    action.triggeredCombo = true;
    action.comboLength = comboLength + 1;

    defender.currentHP = Math.max(0, defender.currentHP - actualDamage);

    const meterGain = this.getMeterGainForDamage('combo', actualDamage);
    attacker.specialMeter = capMeter(attacker.specialMeter + meterGain.attackerGain);
    defender.specialMeter = capMeter(defender.specialMeter + meterGain.defenderGain);
    action.specialMeterChange = meterGain.attackerGain;

    attacker.comboCounter = 0;
    attacker.combosCompleted = (attacker.combosCompleted ?? 0) + 1;
    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + actualDamage;
  }

  private static resolveFinisher(
    action: BattleAction,
    attacker: ArenaFighter,
    defender: ArenaFighter,
  ): void {
    const damageResult = this.calculateDamage(attacker, defender, action.card, false, 0);
    const actualDamage = damageResult.rawDamage * 2;

    action.damageDealt = actualDamage;
    action.actualDamage = actualDamage;
    action.outcome = 'hit';

    defender.currentHP = Math.max(0, defender.currentHP - actualDamage);
    attacker.specialMeter = 0;
    attacker.comboCounter = 0;
    attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + actualDamage;
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

  private static calculateComboMultiplier(comboLength: number): number {
    if (comboLength <= 0) return 1;
    if (comboLength <= 3) return 1 + comboLength * 0.15;
    if (comboLength <= 5) return 1 + comboLength * 0.12;
    return 1 + comboLength * 0.08;
  }

  private static getMeterGainForDamage(
    cardType: ActionCard['type'],
    damage: number,
  ): DamageMeterGain {
    if (cardType === 'combo') {
      return {
        attackerGain: Math.floor(damage * 2.0),
        defenderGain: Math.floor(damage * 0.8),
      };
    }

    if (cardType === 'finisher') {
      return { attackerGain: 0, defenderGain: 0 };
    }

    return {
      attackerGain: Math.floor(damage * 1.5),
      defenderGain: Math.floor(damage * 0.5),
    };
  }

  private static advanceTurnState(
    state: BattleState,
    actorRole: FighterRole,
    card: ActionCard,
  ): void {
    state.playerCardCooldowns = tickCooldownMap({ ...(state.playerCardCooldowns ?? {}) });
    state.opponentCardCooldowns = tickCooldownMap({ ...(state.opponentCardCooldowns ?? {}) });

    const cooldownField = actorRole === 'player' ? 'playerCardCooldowns' : 'opponentCardCooldowns';
    const cooldownTurns = getCardCooldownTurns(card);

    if (cooldownTurns > 0) {
      state[cooldownField]![card.templateId] = cooldownTurns;
    }

    state.player = this.recoverStamina(state.player, TURN_STAMINA_REGEN);
    state.opponent = this.recoverStamina(state.opponent, TURN_STAMINA_REGEN);
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

    const trapResult = this.resolveDefenseTrap({
      trap,
      attacker,
      defender,
      incomingDamage,
    });

    if (trapResult.counterDamage > 0) {
      attacker.currentHP = Math.max(0, attacker.currentHP - trapResult.counterDamage);
    }

    defender.armedDefenseTrap = null;
    defender.isInDefenseMode = false;
    defender.defenseActive = false;
    defender.defendedAt = undefined;

    return trapResult;
  }
}
