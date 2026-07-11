import type { SyncBattleModifiers } from "@/lib/syncProgression";
import type { ImageSourcePropType } from "react-native";

// ============================================================================
// Arena V2 Types - React Native / Expo
// ============================================================================

export type BattleStatus = 'preparing' | 'active' | 'paused' | 'completed' | 'abandoned';
export type BattleType = 'pvp' | 'pve' | 'training' | 'ranked';

export type CardType = 'strike' | 'defense' | 'combo' | 'finisher';
export type CardRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export type StaminaState = 'fresh' | 'working' | 'gassed' | 'exhausted';
export type DefenseOutcome = 'perfect' | 'partial' | 'failed';
export type ActionOutcome =
  | 'hit'
  | 'blocked'
  | 'dodged'
  | 'countered'
  | 'counter'
  | 'missed'
  | 'perfect_defense';

export interface StatusEffect {
  id: string;
  type: 'damage_over_time' | 'stamina_drain' | 'stat_modifier' | 'guard' | 'utility';
  value: number;
  duration: number;
  appliedBy: string;
}

export interface DamageModifier {
  source: string;
  type: 'add' | 'multiply';
  value: number;
  description: string;
}

export interface DamageResult {
  rawDamage: number;
  finalDamage: number;
  damageReduction: number;
  isCritical: boolean;
  modifiers: DamageModifier[];
}

export type DefenseTrapEffect = 'guard' | 'evade' | 'counter' | 'perfect_reversal';
export type DefenseTrapTier = 'common' | 'rare' | 'epic' | 'legendary';

export interface ArmedDefenseTrap {
  cardId: string;
  templateId: string;
  name: string;
  tier: DefenseTrapTier;
  effect: DefenseTrapEffect;
  damageReduction: number;
  evadeChance: number;
  counterDamageMultiplier: number;
  cooldownTurns: number;
}

// ============================================================================
// Fighter (Holobot in Combat)
// ============================================================================

export interface ArenaFighter {
  holobotId: string;
  ownerUserId: string;

  // Base Stats (from NFT/database)
  maxHP: number;
  currentHP: number;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;

  // Arena-Specific State
  stamina: number; // current stamina points (regenerates in real time)
  maxStamina: number; // stamina cap (7 base)
  specialMeter: number; // 0-100; at 100 the Signature Finisher unlocks

  // Current Battle State
  staminaState: StaminaState;
  isInDefenseMode: boolean;
  defenseCooldownUntil?: number;
  defenseActive?: boolean;
  defendedAt?: number;
  armedDefenseTrap?: ArmedDefenseTrap | null;
  comboCounter: number;
  lastActionTime: number;

  // Modifiers (from Sync Training / Fitness)
  staminaEfficiency: number; // 1.0 = base, 1.2 = +20% efficiency
  defenseTimingWindow: number; // milliseconds
  counterDamageBonus: number; // multiplier

  // Visual
  avatar: string | ImageSourcePropType;
  name: string;
  archetype: 'striker' | 'grappler' | 'technical' | 'balanced';
  level: number;
  specialMove?: string;
  abilityDescription?: string;
  statusEffects?: StatusEffect[];
  damageMultiplier?: number;
  speedBonus?: number;
  totalDamageDealt?: number;
  perfectDefenses?: number;
  combosCompleted?: number;
  syncAbilities?: string[];
  syncModifiers?: SyncBattleModifiers;

  // Innate identity: available at exactly 100 special meter, consumed on use.
  // Never occupies a kit slot (arena-card-to-move-implementation-plan.md §6.2).
  signatureFinisher?: ResolvedSignatureFinisher;

  // Innate Ability: always active, fires on typed triggers. abilityRuntime
  // holds only bounded facts (fire count / last fire) for charge tracking.
  ability?: AbilityDefinition;
  abilityRuntime?: AbilityRuntimeState;
}

export interface ResolvedSignatureFinisher {
  id: string;
  name: string;
  baseDamage: number;
  animationId: string;
}

// ---------------------------------------------------------------------------
// Innate Abilities — one per Holobot, always active, never equipped or
// upgraded (v1). Implemented through these shared typed triggers/effects
// only; per-Holobot engine callbacks are not allowed.
// ---------------------------------------------------------------------------

export type AbilityTrigger =
  | 'battle_start'
  | 'after_hit'
  | 'after_defend'
  | 'on_counter'
  | 'on_damaged';

export type AbilityCondition =
  | { type: 'stamina_below'; value: number }
  | { type: 'stamina_at_least'; value: number }
  | { type: 'hp_below_percent'; value: number }
  | { type: 'combo_at_least'; value: number }
  | { type: 'damage_at_least'; value: number };

export type AbilityEffect =
  | { type: 'special_meter'; value: number }
  | { type: 'stamina_gain'; value: number }
  | { type: 'heal'; value: number };

export type AbilityCharges =
  | { kind: 'unlimited' }
  | { kind: 'once_per_battle' }
  | { kind: 'cooldown_actions'; actions: number };

export interface AbilityDefinition {
  id: string;
  holobotName: string;
  name: string;
  description: string;
  trigger: AbilityTrigger;
  conditions: AbilityCondition[];
  effects: AbilityEffect[];
  charges: AbilityCharges;
  aiHints: string[];
}

export interface AbilityRuntimeState {
  firedCount: number;
  lastFiredAtTurn?: number;
}

// ============================================================================
// Action Cards
// ============================================================================

export interface ActionCard {
  id: string;
  templateId: string;
  name: string;
  type: CardType;

  // Costs & Requirements
  staminaCost: number;
  requirements: CardRequirement[];

  // Effects
  baseDamage: number;
  speedModifier: number;
  effects: CardEffect[];

  // Metadata
  animationId: string;
  description: string;
  iconName?: string;
  tier?: DefenseTrapTier;
}

export interface CardRequirement {
  type: 'stamina' | 'combo' | 'special_meter' | 'opponent_state';
  operator: 'gte' | 'lte' | 'equals';
  value: number | string;
}

export interface CardEffect {
  type: 'damage' | 'stamina_gain' | 'special_meter' | 'status' | 'combo_enable';
  target: 'self' | 'opponent';
  value: number;
  duration?: number;
}

// ============================================================================
// Battle State
// ============================================================================

export interface BattleState {
  battleId: string;
  battleType: BattleType;
  status: BattleStatus;

  // Fighters
  player: ArenaFighter;
  opponent: ArenaFighter;

  // Turn State
  turnNumber: number;
  currentActorId: string;
  playerDefenseCooldownUntil?: number;
  opponentDefenseCooldownUntil?: number;
  playerCardCooldowns?: Record<string, number>;
  opponentCardCooldowns?: Record<string, number>;

  // Action Queue
  pendingActions: BattleAction[];
  actionHistory: BattleAction[];

  // Game State
  timer: number;
  neutralPhase: boolean;
  counterWindowOpen?: boolean;
  lastActionTimestamp?: number;
  createdAt?: number;
  startedAt?: number;

  // Player Control
  playerBattleStyle: 'aggressive' | 'balanced' | 'defensive';
  hackUsed: boolean;
  allowPlayerControl?: boolean;
  config?: ArenaBattleConfig;

  // Rewards Preview
  potentialRewards: BattleRewards;
}

export interface BattleAction {
  id: string;
  battleId?: string;
  turnNumber: number;
  actionOrder?: number;
  actorId: string;
  actorRole?: 'player' | 'opponent';
  targetId: string;

  card: ActionCard;
  actionType?: CardType;
  timestamp: number;
  elapsedMs?: number;

  // Resolution
  outcome: ActionOutcome;
  damageDealt: number;
  actualDamage?: number;
  staminaChange: number;
  specialMeterChange: number;

  // Context
  wasCountered: boolean;
  triggeredCombo: boolean;
  perfectDefense: boolean;
  comboLength?: number;
  openedCounterWindow?: boolean;
  animationId?: string;
  animationDuration?: number;
}

export interface BattleRewards {
  exp: number;
  syncPoints: number;
  holos?: number;
  blueprintRewards?: Array<{
    holobotKey: string;
    amount: number;
  }>;
  eloChange?: number;
}

// ============================================================================
// AI & Decision Making
// ============================================================================

export interface AIDecision {
  selectedCard: ActionCard;
  confidence: number;
  reasoning: string;
  enterDefenseMode: boolean;
}

export interface AIPersonality {
  aggression: number; // 0-1
  patience: number; // 0-1
  riskTolerance: number; // 0-1
  adaptability: number; // 0-1
}

// ============================================================================
// Battle Configuration
// ============================================================================

export interface ArenaBattleConfig {
  battleType: BattleType;
  playerHolobotId: string;
  opponentHolobotId?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  tier?: number;
  potentialRewards?: BattleRewards;

  // Rules
  maxTurns?: number;
  timeLimit?: number;
  allowPlayerControl: boolean;

  // Modifiers
  globalModifiers?: BattleModifier[];
  playerBattleCards?: Record<string, number>;
  opponentBattleCards?: Record<string, number>;
  /** Saved loadout order used to compose the kit when no saved kit exists. */
  playerDeckTemplateIds?: string[];
  /** The selected Holobot's saved four-slot kit (combatKit.slots). */
  playerKitTemplateIds?: string[];
  /** The selected Holobot's per-move rank/specialization. */
  playerMoveProgress?: Record<string, { rank: number; specializationId?: string }>;
}

export interface BattleModifier {
  id: string;
  type: 'stamina' | 'damage' | 'speed' | 'special_meter';
  target: 'player' | 'opponent' | 'both';
  multiplier: number;
  description: string;
}
