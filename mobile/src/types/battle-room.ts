import type { FieldValue, Timestamp } from "firebase/firestore";

import type {
  AbilityRuntimeState,
  ActionCard,
  ArmedDefenseTrap,
  ResolvedSignatureFinisher,
} from "@/types/arena";

/**
 * Realtime PvP room schema, version 2 (arena-card-to-move plan Phase 5).
 *
 * PvP battles resolve through the SAME ArenaCombatEngine, move catalog,
 * kits, ranks, abilities, and signatures as PvE. Each player's entry is a
 * serializable fighter snapshot (no image sources — clients resolve art
 * from holobotName locally); every action is resolved inside a Firestore
 * transaction by the acting client and both devices render the shared
 * result. `rulesVersion` gates mismatched app versions out of each other's
 * rooms.
 */

export const BATTLE_ROOM_RULES_VERSION = 2;

export type RoomStatus = "waiting" | "active" | "completed" | "abandoned";
export type PlayerRole = "p1" | "p2";

export type PvpFighterDoc = {
  uid: string;
  username: string;
  holobotName: string;
  level: number;
  archetype: "striker" | "grappler" | "technical" | "balanced";

  // Combat stats (resolved once at entry, sync modifiers applied).
  maxHP: number;
  currentHP: number;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;

  // Resources
  stamina: number;
  maxStamina: number;
  specialMeter: number;

  // Combat state
  comboCounter: number;
  isInDefenseMode: boolean;
  defenseActive?: boolean;
  defendedAt?: number | null;
  armedDefenseTrap: ArmedDefenseTrap | null;
  moveCooldowns: Record<string, number>;
  abilityRuntime: AbilityRuntimeState;

  // Content (resolved kit with ranks applied; signature identity)
  moves: ActionCard[];
  signatureFinisher: ResolvedSignatureFinisher;

  // Telemetry / presence
  totalDamageDealt: number;
  isConnected: boolean;
  lastHeartbeat?: Timestamp | FieldValue | number;
};

export type BattleLogEntry = {
  turnNumber: number;
  message: string;
  timestamp: number;
};

export type BattlePoolEntry = {
  userId: string;
  username: string;
  /** The queuer's prebuilt fighter snapshot (self-authored kit + stats). */
  fighter: PvpFighterDoc;
  rulesVersion: number;
  isActive: boolean;
  roomId?: string;
  createdAt: Timestamp | FieldValue | number;
};

export type BattleRoom = {
  roomId: string;
  roomCode: string;
  rulesVersion: number;
  status: RoomStatus;
  players: {
    p1: PvpFighterDoc;
    p2: PvpFighterDoc;
  };
  turnNumber: number;
  winner: PlayerRole | null;
  battleLog: BattleLogEntry[];
  createdAt: Timestamp | FieldValue | number;
  startedAt?: Timestamp | FieldValue | number;
  lastActionAt?: Timestamp | FieldValue | number;
  completedAt?: Timestamp | FieldValue | number;
};
