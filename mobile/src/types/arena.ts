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
export type ActionOutcome = 'hit' | 'blocked' | 'dodged' | 'countered' | 'missed';

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
  stamina: number; // current hand size
  maxStamina: number; // max hand size (7 base)
  specialMeter: number; // 0-100

  // Current Battle State
  staminaState: StaminaState;
  isInDefenseMode: boolean;
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
  statusEffects?: Array<{ id: string; name: string; turnsRemaining: number }>;
  damageMultiplier?: number;
  speedBonus?: number;
  hand?: ActionCard[];
  totalDamageDealt?: number;
  perfectDefenses?: number;
  combosCompleted?: number;
  syncAbilities?: string[];
  syncModifiers?: SyncBattleModifiers;
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

  // Action Queue
  pendingActions: BattleAction[];
  actionHistory: BattleAction[];

  // Game State
  timer: number;
  neutralPhase: boolean;

  // Player Control
  playerBattleStyle: 'aggressive' | 'balanced' | 'defensive';
  hackUsed: boolean;

  // Rewards Preview
  potentialRewards: BattleRewards;
}

export interface BattleAction {
  id: string;
  turnNumber: number;
  actorId: string;
  targetId: string;

  card: ActionCard;
  timestamp: number;

  // Resolution
  outcome: ActionOutcome;
  damageDealt: number;
  staminaChange: number;
  specialMeterChange: number;

  // Context
  wasCountered: boolean;
  triggeredCombo: boolean;
  perfectDefense: boolean;
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
}

export interface BattleModifier {
  id: string;
  type: 'stamina' | 'damage' | 'speed' | 'special_meter';
  target: 'player' | 'opponent' | 'both';
  multiplier: number;
  description: string;
}
