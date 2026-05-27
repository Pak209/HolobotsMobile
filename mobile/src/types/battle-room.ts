import type { FieldValue, Timestamp } from "firebase/firestore";

export type RoomStatus = "waiting" | "active" | "completed" | "abandoned";
export type PlayerRole = "p1" | "p2";
export type CardType = "strike" | "defense" | "combo" | "finisher";

export type BoostableStat = "attack" | "defense" | "speed";

export type StatBoost = {
  stat: BoostableStat;
  stages: number;
  expiresAt: number;
  source: string;
};

export type RealtimeActionCard = {
  id: string;
  name: string;
  type: CardType;
  tier: 1 | 2 | 3;
  staminaCost: number;
  baseDamage?: number;
  staminaRestore?: number;
  statEffect?: {
    target: "self" | "opponent";
    stat: BoostableStat;
    stages: number;
    durationMs: number;
  };
};

export type BattleHolobotStats = {
  name: string;
  level: number;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;
  maxHealth: number;
};

export type BattleRoomPlayer = {
  uid: string;
  username: string;
  holobot: BattleHolobotStats;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  specialMeter: number;
  hand: RealtimeActionCard[];
  activeBoosts?: StatBoost[];
  isConnected: boolean;
  lastHeartbeat?: Timestamp | FieldValue | number;
  damageDealt: number;
  damageTaken: number;
  defenseActive?: boolean;
  defendedAt?: number;
};

export type BattleLogEntry = {
  turnNumber: number;
  message: string;
  timestamp: number;
};

export type BattlePoolEntry = {
  userId: string;
  username: string;
  holobotStats: BattleHolobotStats;
  isActive: boolean;
  roomId?: string;
  createdAt: Timestamp | FieldValue | number;
};

export type BattleRoom = {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  players: {
    p1: BattleRoomPlayer;
    p2: BattleRoomPlayer;
  };
  currentTurn: number;
  winner: PlayerRole | null;
  battleLog: BattleLogEntry[];
  createdAt: Timestamp | FieldValue | number;
  startedAt?: Timestamp | FieldValue | number;
  lastActionAt?: Timestamp | FieldValue | number;
  completedAt?: Timestamp | FieldValue | number;
};
