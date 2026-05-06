import type {
  ActionCard,
  ActionOutcome,
  ArmedDefenseTrap,
  ArenaCardAvailability,
  ArenaFighter,
  ArenaBattleConfig,
  BattleAction,
  BattleRewards,
  BattleState,
  StaminaState,
} from "../../types/arena";
import { buildCardAvailability, getCardCooldownKey, getCardCooldownTurns } from "./arenaCards";

type DamageCalculation = {
  finalDamage: number;
  rawDamage: number;
};

export class ArenaCombatEngine {
  static initializeBattle(
    player: ArenaFighter,
    opponent: ArenaFighter,
    config?: Partial<ArenaBattleConfig>,
  ): BattleState {
    const now = Date.now();
    const battleId = `battle_${now}_${Math.random().toString(36).slice(2, 9)}`;

    const playerState = this.initializeFighter(player, now);
    const opponentState = this.initializeFighter(opponent, now);

    return {
      actionHistory: [],
      battleId,
      battleType: config?.battleType || "pve",
      currentActorId:
        playerState.speed >= opponentState.speed
          ? playerState.holobotId
          : opponentState.holobotId,
      hackUsed: false,
      neutralPhase: false,
      opponent: opponentState,
      opponentCardCooldowns: {},
      opponentDefenseCooldownTurns: 0,
      pendingActions: [],
      player: playerState,
      playerBattleStyle: "balanced",
      playerCardCooldowns: {},
      playerDefenseCooldownTurns: 0,
      potentialRewards:
        config?.potentialRewards ??
        this.calculatePotentialRewards(playerState, opponentState, config?.battleType || "pve"),
      status: "active",
      timer: 0,
      turnNumber: 1,
    };
  }

  static regenerateStamina(state: BattleState): BattleState {
    const now = Date.now();
    let changed = false;

    const regenerateFighter = (fighter: ArenaFighter): ArenaFighter => {
      if (fighter.stamina >= fighter.maxStamina) {
        return fighter;
      }

      const effectiveEfficiency = Math.max(0.5, fighter.staminaEfficiency || 1);
      const regenIntervalMs = Math.max(450, Math.floor(1800 / effectiveEfficiency));
      const elapsed = now - fighter.lastActionTime;
      const recovered = Math.floor(elapsed / regenIntervalMs);

      if (recovered <= 0) {
        return fighter;
      }

      changed = true;
      const stamina = Math.min(fighter.maxStamina, fighter.stamina + recovered);
      return {
        ...fighter,
        stamina,
        staminaState: this.getStaminaState(stamina),
        lastActionTime: fighter.lastActionTime + recovered * regenIntervalMs,
      };
    };

    const player = regenerateFighter(state.player);
    const opponent = regenerateFighter(state.opponent);

    if (!changed) {
      return state;
    }

    return {
      ...state,
      player,
      opponent,
    };
  }

  static getCardAvailability(
    cards: ActionCard[],
    fighter: ArenaFighter,
    opponent: ArenaFighter,
    state: BattleState,
    isPlayer: boolean,
  ): ArenaCardAvailability[] {
    return buildCardAvailability(cards, fighter, opponent, state, isPlayer);
  }

  static getPlayableCards(
    cards: ActionCard[],
    fighter: ArenaFighter,
    opponent: ArenaFighter,
    state: BattleState,
    isPlayer: boolean,
  ): ActionCard[] {
    const availability = this.getCardAvailability(cards, fighter, opponent, state, isPlayer);
    const playableIds = new Set(
      availability.filter((entry) => entry.playable).map((entry) => entry.cardId),
    );
    return cards.filter((card) => playableIds.has(card.id));
  }

  static canPlayCard(
    fighter: ArenaFighter,
    card: ActionCard,
    state?: BattleState,
    isPlayer = true,
  ): boolean {
    if (!state) {
      if (fighter.stamina < card.staminaCost) {
        return false;
      }
      if (card.type === "finisher" && fighter.specialMeter < 100) {
        return false;
      }
      return true;
    }

    const opponent = isPlayer ? state.opponent : state.player;
    return this.getCardAvailability([card], fighter, opponent, state, isPlayer)[0]?.playable ?? false;
  }

  static resolveAction(state: BattleState, action: BattleAction): BattleState {
    const nextState = this.cloneState(this.regenerateStamina(state));
    const isPlayerAction = action.actorId === nextState.player.holobotId;
    const attacker = isPlayerAction ? nextState.player : nextState.opponent;
    const defender = isPlayerAction ? nextState.opponent : nextState.player;

    if (!this.canPlayCard(attacker, action.card, nextState, isPlayerAction)) {
      return state;
    }

    const now = Date.now();
    attacker.stamina = Math.max(0, attacker.stamina - action.card.staminaCost);
    attacker.staminaState = this.getStaminaState(attacker.stamina);
    attacker.lastActionTime = now;

    let outcome: ActionOutcome = "hit";
    let damageResult: DamageCalculation = { finalDamage: 0, rawDamage: 0 };
    let attackerMeterGain = 0;
    let defenderMeterGain = 0;
    let staminaChange = -action.card.staminaCost;
    let triggeredCombo = false;
    let comboLength: number | undefined;
    let wasCountered = false;
    let perfectDefense = false;

    if (action.card.type === "defense") {
      const restore = this.getDefenseStaminaRestore(action.card);
      attacker.stamina = Math.min(attacker.maxStamina, attacker.stamina + restore);
      attacker.staminaState = this.getStaminaState(attacker.stamina);
      attacker.armedDefenseTrap = this.createDefenseTrap(action.card, nextState.turnNumber);
      attacker.comboCounter = 0;
      attacker.isInDefenseMode = true;
      attacker.defenseActive = true;
      staminaChange += restore;
      attackerMeterGain = 8;
      attacker.specialMeter = Math.min(100, attacker.specialMeter + attackerMeterGain);

      outcome = "blocked";
    } else {
      comboLength = action.card.type === "combo" ? this.getComboMeter(attacker) : undefined;
      damageResult = this.calculateDamage(attacker, defender, action.card, {
        comboLength: comboLength ?? 0,
      });
      const trap = this.getActiveDefenseTrap(defender, nextState.turnNumber);
      if (trap) {
        const trapResult = this.resolveDefenseTrap({
          attacker,
          defender,
          incomingDamage: damageResult.finalDamage,
          trap,
        });
        damageResult = {
          rawDamage: damageResult.rawDamage,
          finalDamage: trapResult.finalDamage,
        };

        if (trapResult.counterDamage > 0) {
          attacker.currentHP = Math.max(0, attacker.currentHP - trapResult.counterDamage);
        }

        defender.armedDefenseTrap = null;
        defender.defenseActive = false;
        defender.isInDefenseMode = false;

        outcome = trapResult.evaded
          ? "dodged"
          : trapResult.counterDamage > 0
            ? "countered"
            : "blocked";
        wasCountered = trapResult.counterDamage > 0;
        perfectDefense = trapResult.evaded;
      } else {
        outcome = "hit";
      }

      defender.currentHP = Math.max(0, defender.currentHP - damageResult.finalDamage);

      if (action.card.type === "strike") {
        attacker.comboCounter = damageResult.finalDamage <= 0 ? 0 : Math.min(3, attacker.comboCounter + 1);
        attackerMeterGain = Math.floor(damageResult.finalDamage * 1.5);
        defenderMeterGain = Math.floor(damageResult.finalDamage * 0.5);
      } else if (action.card.type === "combo") {
        attacker.comboCounter = 0;
        attackerMeterGain = Math.floor(damageResult.finalDamage * 2.0);
        defenderMeterGain = Math.floor(damageResult.finalDamage * 0.8);
        triggeredCombo = true;
      } else if (action.card.type === "finisher") {
        attacker.comboCounter = 0;
        attacker.specialMeter = 0;
      }

      if (action.card.type !== "finisher") {
        attacker.specialMeter = Math.min(100, attacker.specialMeter + attackerMeterGain);
      }
      defender.specialMeter = Math.min(100, defender.specialMeter + defenderMeterGain);

      this.applyCardEffects(action.card, attacker, defender);
    }
    const resolvedAction: BattleAction = {
      ...action,
      actualDamage: damageResult.finalDamage,
      comboLength,
      damageDealt: damageResult.rawDamage,
      outcome,
      perfectDefense,
      specialMeterChange: attackerMeterGain,
      staminaChange,
      timestamp: now,
      triggeredCombo,
      wasCountered,
    };

    const cooldownTurns =
      action.card.type === "defense" || action.card.type === "finisher"
        ? getCardCooldownTurns(action.card)
        : 0;
    if (cooldownTurns > 0) {
      const cooldownValue = cooldownTurns + 1;
      if (isPlayerAction) {
        nextState.playerCardCooldowns = {
          ...(nextState.playerCardCooldowns ?? {}),
          [getCardCooldownKey(action.card)]: cooldownValue,
        };
      } else {
        nextState.opponentCardCooldowns = {
          ...(nextState.opponentCardCooldowns ?? {}),
          [getCardCooldownKey(action.card)]: cooldownValue,
        };
      }
    }

    nextState.actionHistory = [...nextState.actionHistory, resolvedAction];
    nextState.turnNumber += 1;
    nextState.currentActorId = isPlayerAction
      ? nextState.opponent.holobotId
      : nextState.player.holobotId;

    this.tickCooldowns(nextState);

    const winCheck = this.checkWinCondition(nextState);
    if (winCheck.isComplete) {
      nextState.status = "completed";
    }

    return nextState;
  }

  static passTurn(state: BattleState): BattleState {
    const nextState = this.cloneState(this.regenerateStamina(state));
    nextState.turnNumber += 1;
    nextState.currentActorId =
      state.currentActorId === state.player.holobotId
        ? state.opponent.holobotId
        : state.player.holobotId;
    this.tickCooldowns(nextState);
    return nextState;
  }

  static calculateDamage(
    attacker: ArenaFighter,
    defender: ArenaFighter,
    card: ActionCard,
    options?: {
      comboLength?: number;
      isCounter?: boolean;
    },
  ): DamageCalculation {
    const attackMultiplier = Math.max(0.35, (attacker.attack || 20) / 20);
    const defenseReduction = 30 / (30 + Math.max(0, defender.defense || 10));

    let damage = card.baseDamage * attackMultiplier * defenseReduction;
    damage *= this.getStaminaMultiplier(attacker.staminaState);

    if (card.type === "combo") {
      damage *= Math.max(1, Math.min(3, options?.comboLength ?? 1));
    }

    if (options?.isCounter) {
      damage *= attacker.counterDamageBonus || 1.5;
    }

    if (card.type === "finisher") {
      damage *= 2.0;
    }

    const rawDamage = Math.max(1, Math.floor(damage));
    return { finalDamage: rawDamage, rawDamage };
  }

  static getStaminaState(currentStamina: number): StaminaState {
    if (currentStamina >= 6) return "fresh";
    if (currentStamina >= 4) return "working";
    if (currentStamina >= 2) return "gassed";
    return "exhausted";
  }

  static getStaminaMultiplier(state: StaminaState): number {
    switch (state) {
      case "fresh":
        return 1.0;
      case "working":
        return 0.95;
      case "gassed":
        return 0.85;
      case "exhausted":
        return 0.7;
      default:
        return 1.0;
    }
  }

  static canUseFinisher(attacker: ArenaFighter): boolean {
    return attacker.specialMeter >= 100 && attacker.stamina >= 3;
  }

  static getComboMeter(fighter: ArenaFighter): number {
    return Math.max(1, Math.min(3, Math.floor(fighter.comboCounter || 0) + 1));
  }

  static checkWinCondition(state: BattleState): {
    isComplete: boolean;
    winnerId?: string;
    winType?: "ko" | "finisher" | "timeout" | "forfeit";
  } {
    if (state.player.currentHP <= 0) {
      return { isComplete: true, winnerId: state.opponent.holobotId, winType: "ko" };
    }

    if (state.opponent.currentHP <= 0) {
      return { isComplete: true, winnerId: state.player.holobotId, winType: "ko" };
    }

    if (state.turnNumber > 100) {
      const playerPercent = state.player.currentHP / state.player.maxHP;
      const opponentPercent = state.opponent.currentHP / state.opponent.maxHP;
      return {
        isComplete: true,
        winnerId: playerPercent >= opponentPercent ? state.player.holobotId : state.opponent.holobotId,
        winType: "timeout",
      };
    }

    return { isComplete: false };
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
      eloChange: battleType === "ranked" ? 25 : undefined,
      exp: Math.floor(baseExp * diffMultiplier),
      holos: 0,
      syncPoints: Math.floor(baseSyncPoints * diffMultiplier),
    };
  }

  static calculateActualRewards(state: BattleState, winnerId: string): BattleRewards {
    const didWin = winnerId === state.player.holobotId;
    const base = state.potentialRewards;
    const syncExpMultiplier = state.player.syncModifiers?.bondExpRewardMultiplier || 1;

    if (!didWin) {
      return {
        eloChange: base.eloChange ? -base.eloChange : undefined,
        exp: Math.floor(base.exp * 0.3 * syncExpMultiplier),
        holos: 0,
        syncPoints: Math.floor(base.syncPoints * 0.2),
      };
    }

    const perfectDefenses = state.actionHistory.filter((entry) => entry.perfectDefense).length;
    const comboActions = state.actionHistory.filter((entry) => entry.triggeredCombo).length;
    const performanceBonus = 1 + perfectDefenses * 0.05 + comboActions * 0.1;

    return {
      blueprintRewards: base.blueprintRewards,
      eloChange: base.eloChange,
      exp: Math.floor(base.exp * performanceBonus * syncExpMultiplier),
      holos: base.holos,
      syncPoints: Math.floor(base.syncPoints * performanceBonus),
    };
  }

  private static initializeFighter(fighter: ArenaFighter, now: number): ArenaFighter {
    return {
      ...fighter,
      comboCounter: 0,
      currentHP: fighter.maxHP,
      armedDefenseTrap: null,
      defendedAt: 0,
      defenseActive: false,
      isInDefenseMode: false,
      lastActionTime: now,
      specialMeter: 0,
      stamina: fighter.maxStamina,
      staminaState: this.getStaminaState(fighter.maxStamina),
    };
  }

  private static cloneState(state: BattleState): BattleState {
    return {
      ...state,
      actionHistory: [...state.actionHistory],
      opponent: {
        ...state.opponent,
        armedDefenseTrap: state.opponent.armedDefenseTrap
          ? { ...state.opponent.armedDefenseTrap }
          : null,
      },
      opponentCardCooldowns: { ...(state.opponentCardCooldowns ?? {}) },
      pendingActions: [...state.pendingActions],
      player: {
        ...state.player,
        armedDefenseTrap: state.player.armedDefenseTrap
          ? { ...state.player.armedDefenseTrap }
          : null,
      },
      playerCardCooldowns: { ...(state.playerCardCooldowns ?? {}) },
    };
  }

  private static getDefenseStaminaRestore(card: ActionCard): number {
    const effectRestore = card.effects
      .filter((effect) => effect.type === "stamina_gain" && effect.target === "self")
      .reduce((total, effect) => total + effect.value, 0);
    return Math.max(3, card.staminaCost + 2, effectRestore);
  }

  private static getActiveDefenseTrap(
    fighter: ArenaFighter,
    currentTurn: number,
  ): ArmedDefenseTrap | null {
    if (!fighter.armedDefenseTrap) {
      return null;
    }

    if (fighter.armedDefenseTrap.expiresOnTurn < currentTurn) {
      fighter.armedDefenseTrap = null;
      fighter.defenseActive = false;
      fighter.isInDefenseMode = false;
      fighter.defendedAt = 0;
      return null;
    }

    return fighter.armedDefenseTrap;
  }

  private static createDefenseTrap(card: ActionCard, currentTurn: number): ArmedDefenseTrap {
    return {
      cardId: card.id,
      cardName: card.name,
      tier: card.tier ?? 'common',
      effect: card.defenseEffect ?? 'guard',
      expiresOnTurn: currentTurn + 1,
      evadeChance: card.evadeChance ?? 0,
      damageReduction: card.damageReduction ?? 0.5,
      counterDamageMultiplier: card.counterDamageMultiplier ?? 0,
    };
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
  }) {
    const didEvade = Math.random() < trap.evadeChance;

    let finalDamage = incomingDamage;
    let counterDamage = 0;

    if (didEvade) {
      finalDamage = 0;
    } else {
      finalDamage = Math.round(incomingDamage * (1 - trap.damageReduction));
    }

    if (trap.effect === 'counter' || trap.effect === 'perfect_reversal') {
      counterDamage = Math.round(
        incomingDamage * trap.counterDamageMultiplier * (defender.counterDamageBonus || 1),
      );
    }

    return {
      finalDamage: Math.max(0, finalDamage),
      counterDamage: Math.max(0, counterDamage),
      evaded: didEvade,
    };
  }

  private static applyCardEffects(card: ActionCard, actor: ArenaFighter, target: ArenaFighter) {
    for (const effect of card.effects) {
      const effectTarget = effect.target === "self" ? actor : target;

      switch (effect.type) {
        case "stamina_gain":
          effectTarget.stamina = Math.min(effectTarget.maxStamina, effectTarget.stamina + effect.value);
          effectTarget.staminaState = this.getStaminaState(effectTarget.stamina);
          break;
        case "special_meter":
          effectTarget.specialMeter = Math.min(100, effectTarget.specialMeter + effect.value);
          break;
        case "combo_enable":
          actor.comboCounter = Math.max(actor.comboCounter, effect.value > 0 ? 1 : actor.comboCounter);
          break;
        case "status":
          effectTarget.statusEffects = [
            ...(effectTarget.statusEffects || []),
            {
              id: `${card.id}:${effect.type}:${Date.now()}`,
              name: card.name,
              turnsRemaining: effect.duration || 1,
            },
          ];
          break;
        default:
          break;
      }
    }
  }

  private static tickCooldowns(state: BattleState) {
    state.playerCardCooldowns = this.tickCooldownMap(state.playerCardCooldowns ?? {});
    state.opponentCardCooldowns = this.tickCooldownMap(state.opponentCardCooldowns ?? {});
    state.playerDefenseCooldownTurns = Math.max(0, state.playerDefenseCooldownTurns ?? 0);
    state.opponentDefenseCooldownTurns = Math.max(0, state.opponentDefenseCooldownTurns ?? 0);
    this.getActiveDefenseTrap(state.player, state.turnNumber);
    this.getActiveDefenseTrap(state.opponent, state.turnNumber);
    state.player.isInDefenseMode = Boolean(state.player.armedDefenseTrap);
    state.opponent.isInDefenseMode = Boolean(state.opponent.armedDefenseTrap);
    state.player.defenseActive = Boolean(state.player.armedDefenseTrap);
    state.opponent.defenseActive = Boolean(state.opponent.armedDefenseTrap);
  }

  private static tickCooldownMap(cooldowns: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
      Object.entries(cooldowns)
        .map(([key, turns]) => [key, Math.max(0, turns - 1)])
        .filter(([, turns]) => Number(turns) > 0),
    );
  }

}
