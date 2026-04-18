import type {
  ArenaFighter,
  BattleState,
  BattleAction,
  ActionCard,
  StaminaState,
  DefenseOutcome,
  ActionOutcome,
  ArenaBattleConfig,
  BattleRewards,
} from '../../types/arena';

// ============================================================================
// Arena Combat Engine
// ============================================================================

export class ArenaCombatEngine {
  // ============================================================================
  // Initialization
  // ============================================================================

  static initializeBattle(
    player: ArenaFighter,
    opponent: ArenaFighter,
    config?: Partial<ArenaBattleConfig>
  ): BattleState {
    const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      battleId,
      battleType: config?.battleType || 'pve',
      status: 'active',
      player: {
        ...player,
        currentHP: player.maxHP,
        stamina: player.maxStamina,
        specialMeter: 0,
        staminaState: 'fresh',
        isInDefenseMode: false,
        comboCounter: 0,
        lastActionTime: Date.now(),
      },
      opponent: {
        ...opponent,
        currentHP: opponent.maxHP,
        stamina: opponent.maxStamina,
        specialMeter: 0,
        staminaState: 'fresh',
        isInDefenseMode: false,
        comboCounter: 0,
        lastActionTime: Date.now(),
      },
      turnNumber: 1,
      currentActorId: player.speed >= opponent.speed ? player.holobotId : opponent.holobotId,
      pendingActions: [],
      actionHistory: [],
      timer: 0,
      neutralPhase: false,
      playerBattleStyle: 'balanced',
      hackUsed: false,
      potentialRewards:
        config?.potentialRewards ??
        this.calculatePotentialRewards(player, opponent, config?.battleType || 'pve'),
    };
  }

  // ============================================================================
  // Real-time stamina regeneration
  // ============================================================================

  static regenerateStamina(state: BattleState): BattleState {
    const now = Date.now();
    const nextState: BattleState = {
      ...state,
      player: { ...state.player },
      opponent: { ...state.opponent },
    };

    const REGEN_INTERVAL_MS = 1800;

    const regenerateFighter = (fighter: ArenaFighter) => {
      if (fighter.stamina >= fighter.maxStamina) {
        return fighter;
      }

      const elapsed = now - fighter.lastActionTime;
      const recovered = Math.floor(elapsed / REGEN_INTERVAL_MS);

      if (recovered <= 0) {
        return fighter;
      }

      const stamina = Math.min(fighter.maxStamina, fighter.stamina + recovered);

      return {
        ...fighter,
        stamina,
        staminaState: this.getStaminaState(stamina),
        lastActionTime: fighter.lastActionTime + recovered * REGEN_INTERVAL_MS,
      };
    };

    nextState.player = regenerateFighter(nextState.player);
    nextState.opponent = regenerateFighter(nextState.opponent);

    return nextState;
  }

  // ============================================================================
  // Action Resolution
  // ============================================================================

  static resolveAction(state: BattleState, action: BattleAction): BattleState {
    const newState = { ...state };
    const attacker = action.actorId === state.player.holobotId ? newState.player : newState.opponent;
    const defender = action.actorId === state.player.holobotId ? newState.opponent : newState.player;
    const defenderWasBlocking = defender.isInDefenseMode;

    // 1. Validate action
    if (!this.canPlayCard(attacker, action.card)) {
      console.warn('Invalid action: cannot play card', action.card.name);
      return state;
    }

    // 2. Consume stamina
    attacker.stamina -= action.card.staminaCost;
    attacker.staminaState = this.getStaminaState(attacker.stamina);
    attacker.lastActionTime = Date.now();

    // 3. Resolve based on card type
    let outcome: ActionOutcome = 'hit';
    let damageDealt = 0;
    let wasCountered = false;
    let perfectDefense = false;

    if (action.card.type === 'strike' || action.card.type === 'combo' || action.card.type === 'finisher') {
      // Check if defender is in defense mode
      if (defender.isInDefenseMode) {
        const defenseResult = this.evaluateDefense(defender, attacker, action.card);
        outcome = defenseResult.outcome;
        perfectDefense = defenseResult.perfect;
        wasCountered = defenseResult.countered;

        if (outcome === 'blocked') {
          damageDealt = Math.floor(action.card.baseDamage * 0.25); // Chip damage
          if (perfectDefense) {
            defender.stamina = Math.min(defender.maxStamina, defender.stamina + 2);
            defender.specialMeter = Math.min(100, defender.specialMeter + 15);
          }
        } else if (outcome === 'countered') {
          damageDealt = 0;
          // Counter damage back to attacker
          const counterDamage = Math.floor(action.card.baseDamage * 0.5 * defender.counterDamageBonus);
          attacker.currentHP = Math.max(0, attacker.currentHP - counterDamage);
        }
      } else {
        // Normal hit
        damageDealt = this.calculateDamage(attacker, defender, action.card, false);
        outcome = 'hit';
      }

      // Apply damage
      if (outcome === 'hit' || outcome === 'blocked') {
        defender.currentHP = Math.max(0, defender.currentHP - damageDealt);
      }

      // Build special meter
      attacker.specialMeter = Math.min(100, attacker.specialMeter + this.getMeterGain(action.card, outcome));

      // Track combo
      if (action.card.type === 'combo' || outcome === 'hit') {
        attacker.comboCounter++;
      } else {
        attacker.comboCounter = 0;
      }
    } else if (action.card.type === 'defense') {
      // Entering defense mode
      attacker.isInDefenseMode = true;
      attacker.stamina = Math.min(attacker.maxStamina, attacker.stamina + 1);
      attacker.staminaState = this.getStaminaState(attacker.stamina);
      outcome = 'blocked';
    }

    this.applyCardEffects(action.card, attacker, defender);

    // 4. Update action with results
    const resolvedAction: BattleAction = {
      ...action,
      outcome,
      damageDealt,
      staminaChange: -action.card.staminaCost,
      specialMeterChange: this.getMeterGain(action.card, outcome),
      wasCountered,
      triggeredCombo: attacker.comboCounter >= 3,
      perfectDefense,
    };

    // 5. Add to history
    newState.actionHistory = [...newState.actionHistory, resolvedAction];

    // 6. Switch turns
    newState.turnNumber++;
    newState.currentActorId =
      newState.currentActorId === newState.player.holobotId
        ? newState.opponent.holobotId
        : newState.player.holobotId;

    // 7. Reset defense mode after the defending fighter has absorbed an offensive card.
    if (
      action.card.type !== 'defense' &&
      defenderWasBlocking &&
      (outcome === 'hit' || outcome === 'blocked' || outcome === 'countered')
    ) {
      defender.isInDefenseMode = false;
    }

    // 8. Check win conditions
    const winCheck = this.checkWinCondition(newState);
    if (winCheck.isComplete) {
      newState.status = 'completed';
    }

    return newState;
  }

  // ============================================================================
  // Damage Calculation
  // ============================================================================

  static calculateDamage(
    attacker: ArenaFighter,
    defender: ArenaFighter,
    card: ActionCard,
    isCounter: boolean = false
  ): number {
    // Match Arena V2's PvP-style stat curve:
    // baseDamage x (ATK / 20) x (30 / (30 + DEF)).
    // This makes high-investment Holobots hit like high-investment Holobots.
    const attackMultiplier = Math.max(0.35, (attacker.attack || 20) / 20);
    const defenseReduction = 30 / (30 + Math.max(0, defender.defense || 10));
    let damage = card.baseDamage * attackMultiplier * defenseReduction;

    // Apply stamina state modifier
    const staminaMultiplier = this.getStaminaMultiplier(attacker.staminaState);
    damage *= staminaMultiplier;

    // Apply combo bonus
    if (attacker.comboCounter >= 2) {
      const comboMultiplier = 1 + (Math.min(attacker.comboCounter, 5) * 0.1);
      damage *= comboMultiplier;
    }

    // Apply counter bonus
    if (isCounter) {
      damage *= attacker.counterDamageBonus;
    }

    if (card.type === 'finisher') {
      damage *= 2;
    }

    // Minimum 1 damage
    return Math.max(1, Math.floor(damage));
  }

  // ============================================================================
  // Defense System
  // ============================================================================

  static evaluateDefense(
    defender: ArenaFighter,
    attacker: ArenaFighter,
    incomingCard: ActionCard
  ): { outcome: ActionOutcome; perfect: boolean; countered: boolean } {
    // Intelligence affects timing window success
    const defenseChance = 0.4 + (defender.intelligence / 200);
    const roll = Math.random();

    if (roll < defenseChance * 0.3) {
      // Perfect defense + counter
      return { outcome: 'countered', perfect: true, countered: true };
    } else if (roll < defenseChance) {
      // Perfect block
      return { outcome: 'blocked', perfect: true, countered: false };
    } else if (roll < defenseChance + 0.3) {
      // Partial block
      return { outcome: 'blocked', perfect: false, countered: false };
    } else {
      // Failed defense
      return { outcome: 'hit', perfect: false, countered: false };
    }
  }

  // ============================================================================
  // Stamina Management
  // ============================================================================

  static getStaminaState(currentStamina: number): StaminaState {
    if (currentStamina >= 6) return 'fresh';
    if (currentStamina >= 4) return 'working';
    if (currentStamina >= 2) return 'gassed';
    return 'exhausted';
  }

  static getStaminaMultiplier(state: StaminaState): number {
    switch (state) {
      case 'fresh': return 1.0;
      case 'working': return 0.95;
      case 'gassed': return 0.85;
      case 'exhausted': return 0.7;
      default: return 1.0;
    }
  }

  static canPlayCard(fighter: ArenaFighter, card: ActionCard): boolean {
    if (fighter.stamina < card.staminaCost) return false;

    // Check requirements
    for (const req of card.requirements) {
      switch (req.type) {
        case 'stamina':
          if (req.operator === 'gte' && fighter.stamina < (req.value as number)) return false;
          if (req.operator === 'lte' && fighter.stamina > (req.value as number)) return false;
          break;
        case 'special_meter':
          if (req.operator === 'gte' && fighter.specialMeter < (req.value as number)) return false;
          break;
      }
    }

    return true;
  }

  static recoverStamina(
    fighter: ArenaFighter,
    trigger: 'perfect_defense' | 'tempo_reset' | 'combo_complete' | 'turn_end'
  ): ArenaFighter {
    let recovery = 0;
    switch (trigger) {
      case 'perfect_defense': recovery = 2; break;
      case 'combo_complete': recovery = 3; break;
      case 'tempo_reset': recovery = 4; break;
      case 'turn_end': recovery = 1; break;
    }

    return {
      ...fighter,
      stamina: Math.min(fighter.maxStamina, fighter.stamina + recovery),
      staminaState: this.getStaminaState(Math.min(fighter.maxStamina, fighter.stamina + recovery)),
    };
  }

  // ============================================================================
  // Special Meter
  // ============================================================================

  static getMeterGain(card: ActionCard, outcome: ActionOutcome): number {
    let base = 5;
    if (card.type === 'combo') base = 8;
    if (card.type === 'finisher') base = 0; // Finishers consume meter

    if (outcome === 'hit') return base;
    if (outcome === 'blocked') return Math.floor(base * 0.5);
    if (outcome === 'countered') return base + 10; // Bonus for counter
    return 0;
  }

  static canUseFinisher(attacker: ArenaFighter, defender: ArenaFighter): boolean {
    return (
      attacker.specialMeter >= 100 &&
      (defender.staminaState === 'gassed' || defender.staminaState === 'exhausted')
    );
  }

  // ============================================================================
  // Win Conditions
  // ============================================================================

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
    if (state.turnNumber > 100) {
      // Timeout - winner by HP percentage
      const playerPercent = state.player.currentHP / state.player.maxHP;
      const opponentPercent = state.opponent.currentHP / state.opponent.maxHP;
      return {
        isComplete: true,
        winnerId: playerPercent > opponentPercent ? state.player.holobotId : state.opponent.holobotId,
        winType: 'timeout',
      };
    }
    return { isComplete: false };
  }

  // ============================================================================
  // Rewards
  // ============================================================================

  static calculatePotentialRewards(
    player: ArenaFighter,
    opponent: ArenaFighter,
    battleType: string
  ): BattleRewards {
    const baseExp = 100;
    const baseSyncPoints = 50;

    // Scale by opponent level/stats
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

    // Bonus for performance
    const perfectDefenses = state.actionHistory.filter((action) => action.perfectDefense).length;
    const maxCombo = Math.max(...state.actionHistory.map((action) => action.triggeredCombo ? 1 : 0), 0);
    const performanceBonus = 1 + (perfectDefenses * 0.05) + (maxCombo * 0.1);

    return {
      exp: Math.floor(base.exp * performanceBonus),
      syncPoints: Math.floor(base.syncPoints * performanceBonus),
      holos: base.holos,
      blueprintRewards: base.blueprintRewards,
      eloChange: base.eloChange,
    };
  }

  private static applyCardEffects(card: ActionCard, actor: ArenaFighter, target: ArenaFighter) {
    for (const effect of card.effects) {
      const effectTarget = effect.target === 'self' ? actor : target;

      switch (effect.type) {
        case 'stamina_gain':
          effectTarget.stamina = Math.min(effectTarget.maxStamina, effectTarget.stamina + effect.value);
          effectTarget.staminaState = this.getStaminaState(effectTarget.stamina);
          break;
        case 'special_meter':
          effectTarget.specialMeter = Math.min(100, effectTarget.specialMeter + effect.value);
          break;
        case 'combo_enable':
          actor.comboCounter = Math.max(actor.comboCounter, effect.value > 0 ? 1 : actor.comboCounter);
          break;
        case 'status':
          effectTarget.statusEffects = [
            ...(effectTarget.statusEffects || []),
            {
              id: `${card.id}-${Date.now()}`,
              name: card.name,
              turnsRemaining: effect.duration || 1,
            },
          ];
          break;
        case 'damage':
        default:
          break;
      }
    }
  }
}
