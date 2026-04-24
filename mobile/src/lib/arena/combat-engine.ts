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
import { SYNC_ABILITIES, type SyncAbility } from '@/lib/syncProgression';

// ============================================================================
// Arena Combat Engine
// ============================================================================

export class ArenaCombatEngine {
  private static readonly SYNC_MARKER_PREFIX = 'sync:';

  // ============================================================================
  // Initialization
  // ============================================================================

  static initializeBattle(
    player: ArenaFighter,
    opponent: ArenaFighter,
    config?: Partial<ArenaBattleConfig>
  ): BattleState {
    const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const playerState = this.applySyncAbilityBattleStartEffects({
      ...player,
      currentHP: player.maxHP,
      stamina: player.maxStamina,
      specialMeter: 0,
      staminaState: 'fresh',
      isInDefenseMode: false,
      comboCounter: 0,
      lastActionTime: Date.now(),
    });
    const opponentState = this.applySyncAbilityBattleStartEffects({
      ...opponent,
      currentHP: opponent.maxHP,
      stamina: opponent.maxStamina,
      specialMeter: 0,
      staminaState: 'fresh',
      isInDefenseMode: false,
      comboCounter: 0,
      lastActionTime: Date.now(),
    });

    return {
      battleId,
      battleType: config?.battleType || 'pve',
      status: 'active',
      player: playerState,
      opponent: opponentState,
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

    const BASE_REGEN_INTERVAL_MS = 1800;

    const regenerateFighter = (fighter: ArenaFighter) => {
      if (fighter.stamina >= fighter.maxStamina) {
        return fighter;
      }

      const flowStateBonus = this.hasSyncAbility(fighter, 'wake_flow_state') && fighter.currentHP > fighter.maxHP * 0.5
        ? 1 + 0.08
        : 1;
      const effectiveEfficiency = Math.max(0.5, (fighter.staminaEfficiency || 1) * flowStateBonus);
      const regenIntervalMs = Math.max(400, Math.floor(BASE_REGEN_INTERVAL_MS / effectiveEfficiency));
      const elapsed = now - fighter.lastActionTime;
      const recovered = Math.floor(elapsed / regenIntervalMs);

      if (recovered <= 0) {
        return fighter;
      }

      const stamina = Math.min(fighter.maxStamina, fighter.stamina + recovered);
      let nextFighter: ArenaFighter = {
        ...fighter,
        stamina,
        staminaState: this.getStaminaState(stamina),
        lastActionTime: fighter.lastActionTime + recovered * regenIntervalMs,
      };

      if (fighter.stamina < fighter.maxStamina && stamina >= fighter.maxStamina) {
        nextFighter = this.addSyncMarker(nextFighter, 'stamina-full-ready');
      }

      return nextFighter;
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
    const staminaCost = this.getEffectiveStaminaCost(attacker, action.card);
    attacker.stamina -= staminaCost;
    attacker.staminaState = this.getStaminaState(attacker.stamina);
    attacker.lastActionTime = Date.now();

    if (
      this.hasSyncAbility(attacker, 'era_time_slip') &&
      attacker.staminaState === 'exhausted' &&
      !this.hasSyncMarker(attacker, 'era-time-slip-used')
    ) {
      attacker.stamina = Math.min(attacker.maxStamina, attacker.stamina + 2);
      attacker.staminaState = this.getStaminaState(attacker.stamina);
      this.addSyncMarkerMutating(attacker, 'era-time-slip-used');
    }

    // 3. Resolve based on card type
    let outcome: ActionOutcome = 'hit';
    let damageDealt = 0;
    let wasCountered = false;
    let perfectDefense = false;
    let syncMeterBonus = 0;
    let syncDamageMultiplier = 1;
    let syncCounterBonus = 0;
    let resolvedMeterGain = 0;

    if (action.card.type === 'strike' || action.card.type === 'combo' || action.card.type === 'finisher') {
      // Check if defender is in defense mode
      if (defender.isInDefenseMode) {
        const defenseResult = this.evaluateDefense(defender, attacker, action.card);
        outcome = defenseResult.outcome;
        perfectDefense = defenseResult.perfect;
        wasCountered = defenseResult.countered;

        if (outcome === 'blocked') {
          let chipMultiplier = 0.25;
          const defenseSyncEffects = this.applySyncAbilityDefenseEffects(defender, attacker, outcome);
          Object.assign(defender, defenseSyncEffects.fighter);
          Object.assign(attacker, defenseSyncEffects.opponent);
          chipMultiplier *= defenseSyncEffects.blockMultiplier;
          syncMeterBonus += defenseSyncEffects.meterBonus;
          syncCounterBonus += defenseSyncEffects.counterBonus;
          damageDealt = Math.floor(action.card.baseDamage * chipMultiplier);
          if (perfectDefense) {
            defender.stamina = Math.min(defender.maxStamina, defender.stamina + 2);
            defender.specialMeter = Math.min(100, defender.specialMeter + 15);
          }
        } else if (outcome === 'countered') {
          const defenseSyncEffects = this.applySyncAbilityDefenseEffects(defender, attacker, outcome);
          Object.assign(defender, defenseSyncEffects.fighter);
          Object.assign(attacker, defenseSyncEffects.opponent);
          syncMeterBonus += defenseSyncEffects.meterBonus;
          syncCounterBonus += defenseSyncEffects.counterBonus;
          damageDealt = 0;
          // Counter damage back to attacker
          const counterDamage = Math.floor(
            action.card.baseDamage * 0.5 * defender.counterDamageBonus * (1 + syncCounterBonus)
          );
          attacker.currentHP = Math.max(0, attacker.currentHP - counterDamage);
        }
      } else {
        // Normal hit
        damageDealt = this.calculateDamage(attacker, defender, action.card, false);
        outcome = 'hit';
      }

      // Track combo
      if (action.card.type === 'combo' || outcome === 'hit') {
        attacker.comboCounter++;
      } else {
        attacker.comboCounter = 0;
      }

      const syncCardEffects = this.applySyncAbilityCardEffects(
        { ...action, outcome },
        action.card,
        attacker,
        defender,
      );
      Object.assign(attacker, syncCardEffects.fighter);
      Object.assign(defender, syncCardEffects.opponent);
      syncDamageMultiplier = syncCardEffects.damageMultiplier;
      syncMeterBonus += syncCardEffects.meterBonus;
      damageDealt = Math.floor(damageDealt * syncDamageMultiplier);

      // Apply damage
      if (outcome === 'hit' || outcome === 'blocked') {
        defender.currentHP = Math.max(0, defender.currentHP - damageDealt);
      }

      // Build special meter
      const baseMeterGain = this.getMeterGain(action.card, outcome);
      resolvedMeterGain = Math.max(0, Math.floor(baseMeterGain * syncCardEffects.meterMultiplier + syncMeterBonus));
      attacker.specialMeter = Math.min(100, attacker.specialMeter + resolvedMeterGain);
    } else if (action.card.type === 'defense') {
      // Entering defense mode
      attacker.isInDefenseMode = true;
      attacker.stamina = Math.min(attacker.maxStamina, attacker.stamina + 1);
      attacker.staminaState = this.getStaminaState(attacker.stamina);
      outcome = 'blocked';
      const syncCardEffects = this.applySyncAbilityCardEffects(
        { ...action, outcome },
        action.card,
        attacker,
        defender,
      );
      Object.assign(attacker, syncCardEffects.fighter);
      Object.assign(defender, syncCardEffects.opponent);
      syncMeterBonus += syncCardEffects.meterBonus;
      if (syncMeterBonus > 0) {
        resolvedMeterGain = Math.floor(syncMeterBonus);
        attacker.specialMeter = Math.min(100, attacker.specialMeter + resolvedMeterGain);
      }
    }

    this.applyCardEffects(action.card, attacker, defender);

    // 4. Update action with results
    const resolvedAction: BattleAction = {
      ...action,
      outcome,
      damageDealt,
      staminaChange: -staminaCost,
      specialMeterChange: resolvedMeterGain,
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
    const effectiveCost = this.getEffectiveStaminaCost(fighter, card);
    if (fighter.stamina < effectiveCost) return false;

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
    const syncAbilityExpMultiplier = this.getFighterSyncAbilityDefinitions(state.player)
      .filter((ability) => ability.effectType === 'exp_bonus')
      .reduce((multiplier, ability) => multiplier * (1 + ability.value), 1);
    const syncExpMultiplier =
      (state.player.syncModifiers?.bondExpRewardMultiplier || 1) * syncAbilityExpMultiplier;

    if (!didWin) {
      return {
        exp: Math.floor(base.exp * 0.3 * syncExpMultiplier),
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
      exp: Math.floor(base.exp * performanceBonus * syncExpMultiplier),
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

  static hasSyncAbility(fighter: ArenaFighter, abilityId: string) {
    return (fighter.syncAbilities || []).includes(abilityId);
  }

  static getFighterSyncAbilityDefinitions(fighter: ArenaFighter): SyncAbility[] {
    const activeAbilityIds = new Set(fighter.syncAbilities || []);
    return SYNC_ABILITIES.filter((ability) => activeAbilityIds.has(ability.id));
  }

  static applySyncAbilityBattleStartEffects(fighter: ArenaFighter): ArenaFighter {
    let nextFighter: ArenaFighter = {
      ...fighter,
      statusEffects: [...(fighter.statusEffects || [])],
    };

    for (const ability of this.getFighterSyncAbilityDefinitions(nextFighter)) {
      switch (ability.id) {
        case 'era_chrono_read':
        case 'wolf_lunar_howl':
          nextFighter.specialMeter = Math.min(100, nextFighter.specialMeter + ability.value);
          if (ability.oncePerBattle) {
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'kuma_guardian_core':
        case 'shadow_vanish_protocol':
        case 'era_rewind_pulse':
        case 'kurai_void_shell':
          // TODO: implement harder Sync defensive effects in a later combat-engine phase.
          break;
        default:
          break;
      }
    }

    return nextFighter;
  }

  static applySyncAbilityCardEffects(
    action: BattleAction,
    card: ActionCard,
    fighter: ArenaFighter,
    opponent: ArenaFighter
  ): {
    damageMultiplier: number;
    fighter: ArenaFighter;
    meterBonus: number;
    meterMultiplier: number;
    opponent: ArenaFighter;
  } {
    let nextFighter: ArenaFighter = fighter;
    let nextOpponent: ArenaFighter = opponent;
    let damageMultiplier = 1;
    let meterBonus = 0;
    let meterMultiplier = 1;

    for (const ability of this.getFighterSyncAbilityDefinitions(nextFighter)) {
      switch (ability.id) {
        case 'ace_knockout_rhythm':
          if (card.type === 'finisher' && nextFighter.comboCounter >= 1) {
            damageMultiplier *= 1 + ability.value;
          }
          break;
        case 'tora_predator_mark':
          if (card.type === 'strike' && action.outcome === 'hit' && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            damageMultiplier *= 1 + ability.value;
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'tora_pounce_protocol':
          if (
            card.type === 'combo' &&
            (nextOpponent.staminaState === 'gassed' || nextOpponent.staminaState === 'exhausted') &&
            !this.hasSyncMarker(nextFighter, `${ability.id}:used`)
          ) {
            damageMultiplier *= 1 + ability.value;
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'ken_blade_focus':
          if (card.type === 'strike' && nextFighter.specialMeter > 50) {
            damageMultiplier *= 1 + ability.value;
          }
          break;
        case 'ken_clean_cut':
          if (
            (card.type === 'strike' || card.type === 'combo' || card.type === 'finisher') &&
            this.hasSyncMarker(nextFighter, 'perfect-defense-window')
          ) {
            damageMultiplier *= 1 + ability.value;
            nextFighter = this.removeSyncMarker(nextFighter, 'perfect-defense-window');
          }
          break;
        case 'tsuin_mirror_chain':
          if (card.type === 'combo' && nextFighter.comboCounter >= 2) {
            damageMultiplier *= 1 + ability.value;
          }
          break;
        case 'wolf_pack_instinct':
          if (nextFighter.currentHP <= nextFighter.maxHP * 0.5) {
            damageMultiplier *= 1 + ability.value;
          }
          break;
        case 'ace_rocket_tempo':
          if (card.type === 'strike' && this.hasSyncMarker(nextFighter, 'stamina-full-ready')) {
            nextFighter = this.removeSyncMarker(nextFighter, 'stamina-full-ready');
            if (ability.oncePerBattle) {
              nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
            }
          }
          break;
        case 'tsuin_linked_rhythm':
          if (card.type === 'combo' && ability.oncePerBattle && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'hare_guarded_stance':
          if (card.type === 'defense' && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            nextFighter.stamina = Math.min(nextFighter.maxStamina, nextFighter.stamina + ability.value);
            nextFighter.staminaState = this.getStaminaState(nextFighter.stamina);
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'wake_torrent_shift':
          if (card.type === 'defense') {
            nextFighter = this.addSyncMarker(nextFighter, 'wake-torrent-shift-ready');
          } else if (card.type === 'strike' && this.hasSyncMarker(nextFighter, 'wake-torrent-shift-ready')) {
            meterBonus += ability.value;
            nextFighter = this.removeSyncMarker(nextFighter, 'wake-torrent-shift-ready');
          }
          break;
        case 'tora_stalk_pattern':
          if (card.type === 'strike' && this.hasSyncMarker(nextFighter, 'stamina-full-ready')) {
            meterBonus += ability.value;
            nextFighter = this.removeSyncMarker(nextFighter, 'stamina-full-ready');
          }
          break;
        case 'ken_blade_storm':
          if (card.type === 'combo') {
            meterMultiplier += ability.value;
          }
          break;
        case 'wake_riptide_loop':
          if (card.type === 'combo' && nextFighter.comboCounter >= 3 && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            nextFighter.stamina = Math.min(nextFighter.maxStamina, nextFighter.stamina + ability.value);
            nextFighter.staminaState = this.getStaminaState(nextFighter.stamina);
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'era_time_slip':
          // Handled when stamina is spent and the fighter drops to exhausted.
          break;
        case 'gama_heavy_leap':
          if (card.type === 'combo' && this.hasSyncMarker(nextFighter, 'after-defense-window') && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            damageMultiplier *= 1 + ability.value;
            nextFighter = this.removeSyncMarker(nextFighter, 'after-defense-window');
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'shadow_silent_counter':
          if (
            (card.type === 'strike' || card.type === 'combo' || card.type === 'finisher') &&
            this.hasSyncMarker(nextFighter, 'silent-counter-ready')
          ) {
            damageMultiplier *= 1 + ability.value;
            nextFighter = this.removeSyncMarker(nextFighter, 'silent-counter-ready');
          }
          break;
        case 'tsuin_twin_strike':
          if (card.type === 'strike' && action.outcome === 'hit' && nextFighter.comboCounter > 0 && nextFighter.comboCounter % 3 === 0) {
            nextFighter.comboCounter += ability.value;
          }
          break;
        case 'era_rewind_pulse':
        case 'kuma_guardian_core':
        case 'shadow_vanish_protocol':
        case 'hare_last_hop_reflex':
        case 'kurai_pressure_field':
        case 'kurai_void_shell':
          // TODO: implement harder Sync reactive effects in a later combat-engine phase.
          break;
        default:
          break;
      }
    }

    return {
      damageMultiplier,
      fighter: nextFighter,
      meterBonus,
      meterMultiplier,
      opponent: nextOpponent,
    };
  }

  static applySyncAbilityDefenseEffects(
    fighter: ArenaFighter,
    opponent: ArenaFighter,
    outcome: ActionOutcome
  ): {
    blockMultiplier: number;
    counterBonus: number;
    fighter: ArenaFighter;
    meterBonus: number;
    opponent: ArenaFighter;
  } {
    let nextFighter: ArenaFighter = fighter;
    let nextOpponent: ArenaFighter = opponent;
    let blockMultiplier = 1;
    let counterBonus = 0;
    let meterBonus = 0;

    for (const ability of this.getFighterSyncAbilityDefinitions(nextFighter)) {
      switch (ability.id) {
        case 'kuma_iron_fur_protocol':
          if ((outcome === 'blocked' || outcome === 'countered') && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            blockMultiplier *= Math.max(0, 1 - ability.value);
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'kuma_bearwall_sync':
          if (outcome === 'countered') {
            meterBonus += ability.value;
          }
          break;
        case 'hare_counter_claw':
          if (outcome === 'countered') {
            counterBonus += ability.value;
          }
          break;
        case 'shadow_silent_counter':
          if (outcome === 'blocked' || outcome === 'countered') {
            nextFighter = this.addSyncMarker(nextFighter, 'silent-counter-ready');
          }
          break;
        case 'gama_spring_guard':
          if ((outcome === 'blocked' || outcome === 'countered') && nextFighter.staminaState === 'fresh') {
            meterBonus += ability.value;
          }
          break;
        case 'gama_amphibian_anchor':
          if ((outcome === 'blocked' || outcome === 'countered') && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            blockMultiplier *= Math.max(0, 1 - ability.value);
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'kurai_dark_veil':
          if ((outcome === 'blocked' || outcome === 'hit') && !this.hasSyncMarker(nextFighter, `${ability.id}:used`)) {
            blockMultiplier *= Math.max(0, 1 - ability.value);
            nextFighter = this.addSyncMarker(nextFighter, `${ability.id}:used`);
          }
          break;
        case 'hare_last_hop_reflex':
        case 'shadow_ghost_step':
          // TODO: implement dodge-based Sync defenses in a later combat-engine phase.
          break;
        case 'era_rewind_pulse':
          // TODO: implement post-hit HP restore logic in a later combat-engine phase.
          break;
        case 'kurai_void_shell':
          // TODO: implement Finisher resistance in a later combat-engine phase.
          break;
        case 'kurai_pressure_field':
          // TODO: implement enemy meter debuff in a later combat-engine phase.
          break;
        case 'kuma_guardian_core':
        case 'shadow_vanish_protocol':
          // TODO: implement survive-lethal effects in a later combat-engine phase.
          break;
        default:
          break;
      }
    }

    if (outcome === 'blocked' || outcome === 'countered') {
      nextFighter = this.addSyncMarker(nextFighter, 'after-defense-window');
    }

    return {
      blockMultiplier,
      counterBonus,
      fighter: nextFighter,
      meterBonus,
      opponent: nextOpponent,
    };
  }

  private static getEffectiveStaminaCost(fighter: ArenaFighter, card: ActionCard) {
    let discount = 0;

    if (
      card.type === 'strike' &&
      this.hasSyncAbility(fighter, 'ace_rocket_tempo') &&
      this.hasSyncMarker(fighter, 'stamina-full-ready') &&
      !this.hasSyncMarker(fighter, 'ace_rocket_tempo:used')
    ) {
      discount = Math.max(discount, 1);
    }

    if (
      card.type === 'combo' &&
      this.hasSyncAbility(fighter, 'tsuin_linked_rhythm') &&
      !this.hasSyncMarker(fighter, 'tsuin_linked_rhythm:used')
    ) {
      discount = Math.max(discount, 1);
    }

    return Math.max(0, card.staminaCost - discount);
  }

  private static hasSyncMarker(fighter: ArenaFighter, markerId: string) {
    return (fighter.statusEffects || []).some((effect) => effect.id === `${this.SYNC_MARKER_PREFIX}${markerId}`);
  }

  private static addSyncMarker(fighter: ArenaFighter, markerId: string) {
    if (this.hasSyncMarker(fighter, markerId)) {
      return fighter;
    }

    return {
      ...fighter,
      statusEffects: [
        ...(fighter.statusEffects || []),
        {
          id: `${this.SYNC_MARKER_PREFIX}${markerId}`,
          name: markerId,
          turnsRemaining: 99,
        },
      ],
    };
  }

  private static addSyncMarkerMutating(fighter: ArenaFighter, markerId: string) {
    if (this.hasSyncMarker(fighter, markerId)) {
      return;
    }

    fighter.statusEffects = [
      ...(fighter.statusEffects || []),
      {
        id: `${this.SYNC_MARKER_PREFIX}${markerId}`,
        name: markerId,
        turnsRemaining: 99,
      },
    ];
  }

  private static removeSyncMarker(fighter: ArenaFighter, markerId: string) {
    return {
      ...fighter,
      statusEffects: (fighter.statusEffects || []).filter(
        (effect) => effect.id !== `${this.SYNC_MARKER_PREFIX}${markerId}`
      ),
    };
  }
}
