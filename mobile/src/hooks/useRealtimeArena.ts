import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/config/firebase";
import { ArenaCombatEngine } from "@/features/arena/combatEngine";
import {
  battleStateToRoomUpdates,
  buildPvpFighterDoc,
  PVP_FIGHTER_IDS,
  roomToBattleState,
} from "@/features/arena/pvpBattle";
import { claimOpponentAndCreateRoom, isFreshPoolEntry } from "@/lib/pvpMatchmaking";
import { useAuth } from "@/contexts/AuthContext";
import type { ArenaCardAvailability } from "@/features/arena/arenaCards";
import {
  BATTLE_ROOM_RULES_VERSION,
  type BattlePoolEntry,
  type BattleRoom,
  type PlayerRole,
  type PvpFighterDoc,
} from "@/types/battle-room";
import type { UserHolobot } from "@/types/profile";

/**
 * Realtime PvP transport (rooms, matchmaking, presence, stamina cadence).
 *
 * Combat itself is NOT implemented here (plan Phase 5 convergence): every
 * action rebuilds the shared room into an ArenaCombatEngine BattleState and
 * resolves through the exact PvE rules — same move catalog, kits, ranks,
 * abilities, and signature finishers — inside a Firestore transaction. Both
 * devices render the committed shared state, and `rulesVersion` keeps
 * old-app clients out of new rooms.
 */

const BATTLE_ROOMS = "battle_rooms";
const BATTLE_POOL = "battle_pool_entries";
const HEARTBEAT_INTERVAL_MS = 5000;
const STAMINA_REGEN_INTERVAL_MS = 2000;

const VERSION_MISMATCH_MESSAGE = "This room was made on a different app version. Both players need the latest update.";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function emptyPvpFighter(): PvpFighterDoc {
  return {
    uid: "",
    username: "",
    holobotName: "",
    level: 0,
    archetype: "balanced",
    maxHP: 0,
    currentHP: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    intelligence: 0,
    stamina: 0,
    maxStamina: 0,
    specialMeter: 0,
    comboCounter: 0,
    guardStacks: 0,
    isInDefenseMode: false,
    defenseActive: false,
    defendedAt: null,
    armedDefenseTrap: null,
    moveCooldowns: {},
    abilityRuntime: { firedCount: 0 },
    moves: [],
    signatureFinisher: { id: "signature.none", name: "", baseDamage: 0, animationId: "" },
    totalDamageDealt: 0,
    isConnected: false,
  };
}

export function useRealtimeArena() {
  const { profile, user } = useAuth();
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [myRole, setMyRole] = useState<PlayerRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchmakingStatus, setMatchmakingStatus] = useState<"idle" | "searching" | "matched">("idle");
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const poolUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const staminaRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const poolEntryIdRef = useRef<string | null>(null);

  const findHolobot = useCallback(
    (holobotName: string): UserHolobot => {
      const normalized = holobotName.trim().toUpperCase();
      const holobot = (profile?.holobots || []).find(
        (candidate) => String(candidate.name || "").trim().toUpperCase() === normalized,
      );
      if (!holobot) {
        throw new Error("Choose a Holobot you own before entering PvP.");
      }
      return holobot;
    },
    [profile?.holobots],
  );

  const buildOwnFighter = useCallback(
    (holobotName: string): PvpFighterDoc => {
      if (!user || !profile) {
        throw new Error("Sign in before entering PvP.");
      }
      return buildPvpFighterDoc(user.uid, profile.username || "Pilot", findHolobot(holobotName), profile);
    },
    [findHolobot, profile, user],
  );

  const cleanup = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    poolUnsubscribeRef.current?.();
    poolUnsubscribeRef.current = null;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (staminaRef.current) clearInterval(staminaRef.current);
    heartbeatRef.current = null;
    staminaRef.current = null;
    setRoom(null);
    setMyRole(null);
    setMatchmakingStatus("idle");
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const subscribeToRoom = useCallback((roomId: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = onSnapshot(
      doc(db, BATTLE_ROOMS, roomId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setError("Battle room no longer exists.");
          cleanup();
          return;
        }
        setRoom({ ...(snapshot.data() as BattleRoom), roomId: snapshot.id });
      },
      (snapshotError) => setError(snapshotError.message),
    );
  }, [cleanup]);

  // Presence + real-time stamina cadence (each client drives its own fighter,
  // matching the PvE loop's +1 per 2 seconds).
  useEffect(() => {
    if (!room?.roomId || !myRole || !user) return;

    heartbeatRef.current = setInterval(() => {
      void updateDoc(doc(db, BATTLE_ROOMS, room.roomId), {
        [`players.${myRole}.isConnected`]: true,
        [`players.${myRole}.lastHeartbeat`]: serverTimestamp(),
      }).catch((heartbeatError) => setError(heartbeatError.message));
    }, HEARTBEAT_INTERVAL_MS);

    staminaRef.current = setInterval(() => {
      const roomRef = doc(db, BATTLE_ROOMS, room.roomId);
      void runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) return;
        const battleRoom = roomSnap.data() as BattleRoom;
        if (battleRoom.status !== "active") return;
        const player = battleRoom.players[myRole];
        if (player.stamina >= player.maxStamina) return;
        transaction.update(roomRef, {
          [`players.${myRole}.stamina`]: Math.min(player.maxStamina, player.stamina + 1),
        });
      }).catch((staminaError) => setError(staminaError.message));
    }, STAMINA_REGEN_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (staminaRef.current) clearInterval(staminaRef.current);
      heartbeatRef.current = null;
      staminaRef.current = null;
    };
  }, [myRole, room?.roomId, user]);

  const createRoom = useCallback(async (holobotName: string) => {
    if (!user || !profile) throw new Error("Sign in before creating a room.");
    setLoading(true);
    setError(null);
    try {
      const roomRef = doc(collection(db, BATTLE_ROOMS));
      const roomCode = generateRoomCode();
      const newRoom: BattleRoom = {
        roomId: roomRef.id,
        roomCode,
        rulesVersion: BATTLE_ROOM_RULES_VERSION,
        status: "waiting",
        players: {
          p1: buildOwnFighter(holobotName),
          p2: emptyPvpFighter(),
        },
        turnNumber: 0,
        winner: null,
        battleLog: [],
        createdAt: serverTimestamp(),
      };
      await setDoc(roomRef, newRoom);
      setMyRole("p1");
      subscribeToRoom(roomRef.id);
      return roomCode;
    } catch (createError: any) {
      setError(createError.message);
      throw createError;
    } finally {
      setLoading(false);
    }
  }, [buildOwnFighter, profile, subscribeToRoom, user]);

  const joinRoom = useCallback(async (roomCode: string, holobotName: string) => {
    if (!user || !profile) throw new Error("Sign in before joining a room.");
    setLoading(true);
    setError(null);
    try {
      const rooms = await getDocs(query(collection(db, BATTLE_ROOMS), where("roomCode", "==", roomCode.toUpperCase()), limit(1)));
      if (rooms.empty) throw new Error("Room not found.");
      const roomDoc = rooms.docs[0];
      const roomData = roomDoc.data() as BattleRoom;
      if (roomData.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
      if (roomData.status !== "waiting" || roomData.players.p2.uid) throw new Error("Room is not available.");
      await updateDoc(doc(db, BATTLE_ROOMS, roomDoc.id), {
        "players.p2": buildOwnFighter(holobotName),
        status: "active",
        startedAt: serverTimestamp(),
      });
      setMyRole("p2");
      subscribeToRoom(roomDoc.id);
    } catch (joinError: any) {
      setError(joinError.message);
      throw joinError;
    } finally {
      setLoading(false);
    }
  }, [buildOwnFighter, profile, subscribeToRoom, user]);

  const joinRoomById = useCallback(async (roomId: string) => {
    if (!user) throw new Error("Sign in before joining a room.");
    const roomSnap = await getDoc(doc(db, BATTLE_ROOMS, roomId));
    if (!roomSnap.exists()) throw new Error("Room not found.");
    const roomData = roomSnap.data() as BattleRoom;
    if (roomData.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
    if (roomData.players.p1.uid === user.uid) setMyRole("p1");
    else if (roomData.players.p2.uid === user.uid) setMyRole("p2");
    else throw new Error("You are not part of this room.");
    subscribeToRoom(roomId);
  }, [subscribeToRoom, user]);

  const enterMatchmaking = useCallback(async (holobotName: string) => {
    if (!user || !profile) throw new Error("Sign in before matchmaking.");
    const myFighter = buildOwnFighter(holobotName);
    setMatchmakingStatus("searching");
    setError(null);
    // Keyed by uid: one queue entry per player, and re-queueing overwrites
    // any ghost entry left behind by a crashed session.
    const myPoolRef = doc(db, BATTLE_POOL, user.uid);
    await setDoc(myPoolRef, {
      userId: user.uid,
      username: profile.username || "Pilot",
      fighter: myFighter,
      rulesVersion: BATTLE_ROOM_RULES_VERSION,
      isActive: true,
      createdAt: serverTimestamp(),
    } satisfies BattlePoolEntry);
    poolEntryIdRef.current = user.uid;

    const candidates = await getDocs(query(collection(db, BATTLE_POOL), where("isActive", "==", true), limit(10)));
    for (const candidateDoc of candidates.docs) {
      if (candidateDoc.id === user.uid) continue;
      const candidate = candidateDoc.data() as BattlePoolEntry;
      if (candidate.userId === user.uid || !isFreshPoolEntry(candidate)) continue;
      if (candidate.rulesVersion !== BATTLE_ROOM_RULES_VERSION || !candidate.fighter?.uid) continue;

      const claim = await claimOpponentAndCreateRoom(db, user.uid, candidateDoc.id, (roomId, opponent) => ({
        roomId,
        roomCode: generateRoomCode(),
        rulesVersion: BATTLE_ROOM_RULES_VERSION,
        status: "active",
        players: {
          p1: myFighter,
          p2: opponent.fighter,
        },
        turnNumber: 0,
        winner: null,
        battleLog: [],
        createdAt: serverTimestamp(),
        startedAt: serverTimestamp(),
      } satisfies BattleRoom));

      if (claim.outcome === "created") {
        setMatchmakingStatus("matched");
        setMyRole("p1");
        subscribeToRoom(claim.roomId);
        return;
      }
      if (claim.outcome === "alreadyMatched") {
        setMatchmakingStatus("matched");
        await joinRoomById(claim.roomId);
        return;
      }
      // candidateGone: another searcher claimed this entry first — try the next.
    }

    poolUnsubscribeRef.current?.();
    poolUnsubscribeRef.current = onSnapshot(myPoolRef, (snapshot) => {
      const entry = snapshot.data() as BattlePoolEntry | undefined;
      if (!entry?.roomId || entry.isActive) return;
      poolUnsubscribeRef.current?.();
      poolUnsubscribeRef.current = null;
      setMatchmakingStatus("matched");
      void joinRoomById(entry.roomId);
    });
  }, [buildOwnFighter, joinRoomById, profile, subscribeToRoom, user]);

  const cancelMatchmaking = useCallback(async () => {
    poolUnsubscribeRef.current?.();
    poolUnsubscribeRef.current = null;
    if (!poolEntryIdRef.current) return;
    await deleteDoc(doc(db, BATTLE_POOL, poolEntryIdRef.current));
    poolEntryIdRef.current = null;
    setMatchmakingStatus("idle");
  }, []);

  // Resolves one of my kit moves through the shared combat engine inside a
  // Firestore transaction (single-writer authority per action).
  const playMove = useCallback(async (moveId: string) => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);
    const engineRole = myRole === "p1" ? "player" : "opponent";

    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = { ...(roomSnap.data() as BattleRoom), roomId: roomSnap.id };
      if (freshRoom.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
      if (freshRoom.status !== "active") throw new Error("Battle is not active.");

      const move = freshRoom.players[myRole].moves.find((candidate) => candidate.id === moveId);
      if (!move) throw new Error("That move is not in your kit.");

      const state = roomToBattleState(freshRoom);
      const availability = ArenaCombatEngine.getCardAvailability(state, engineRole, move);
      if (!availability.playable) {
        throw new Error(availabilityMessage(availability));
      }

      const nextState = ArenaCombatEngine.resolveAction(state, move, PVP_FIGHTER_IDS[myRole]);
      if (nextState === state) throw new Error("That move cannot be used right now.");

      transaction.update(roomRef, battleStateToRoomUpdates(freshRoom, nextState));
    });
  }, [myRole, room, user]);

  // Fires my signature finisher (7/7 meter) through the shared engine.
  const useSignature = useCallback(async () => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);
    const engineRole = myRole === "p1" ? "player" : "opponent";

    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = { ...(roomSnap.data() as BattleRoom), roomId: roomSnap.id };
      if (freshRoom.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
      if (freshRoom.status !== "active") throw new Error("Battle is not active.");

      const state = roomToBattleState(freshRoom);
      if (!ArenaCombatEngine.canUseSignatureFinisher(state, engineRole)) {
        throw new Error("Your signature finisher needs a full special meter.");
      }

      const nextState = ArenaCombatEngine.resolveSignatureFinisher(state, PVP_FIGHTER_IDS[myRole]);
      if (nextState === state) throw new Error("Signature finisher is not ready.");

      transaction.update(roomRef, battleStateToRoomUpdates(freshRoom, nextState));
    });
  }, [myRole, room, user]);

  const leaveRoom = useCallback(async () => {
    if (poolEntryIdRef.current) {
      await deleteDoc(doc(db, BATTLE_POOL, poolEntryIdRef.current)).catch(() => undefined);
      poolEntryIdRef.current = null;
    }
    if (room?.roomId && myRole) {
      await updateDoc(doc(db, BATTLE_ROOMS, room.roomId), {
        [`players.${myRole}.isConnected`]: false,
        status: room.status === "completed" ? "completed" : "abandoned",
      }).catch((leaveError) => setError(leaveError.message));
    }
    cleanup();
  }, [cleanup, myRole, room?.roomId, room?.status]);

  // Availability for my four moves + signature, computed from the shared
  // room via the same engine rules the transaction will enforce.
  const moveAvailability = useMemo<Record<string, ArenaCardAvailability>>(() => {
    if (!room || !myRole || room.status !== "active") return {};
    const engineRole = myRole === "p1" ? "player" : "opponent";
    const state = roomToBattleState(room);
    return room.players[myRole].moves.reduce<Record<string, ArenaCardAvailability>>((result, move) => {
      result[move.id] = ArenaCombatEngine.getCardAvailability(state, engineRole, move);
      return result;
    }, {});
  }, [myRole, room]);

  const canFireSignature = useMemo(() => {
    if (!room || !myRole || room.status !== "active") return false;
    return ArenaCombatEngine.canUseSignatureFinisher(roomToBattleState(room), myRole === "p1" ? "player" : "opponent");
  }, [myRole, room]);

  return {
    cancelMatchmaking,
    canFireSignature,
    createRoom,
    enterMatchmaking,
    error,
    joinRoom,
    leaveRoom,
    loading,
    matchmakingStatus,
    moveAvailability,
    myRole,
    opponentRole: myRole === "p1" ? "p2" : myRole === "p2" ? "p1" : null,
    playMove,
    room,
    useSignature,
  };
}

function availabilityMessage(availability: ArenaCardAvailability): string {
  switch (availability.reason) {
    case "stamina":
      return "Not enough stamina.";
    case "special_meter":
      return "Your special meter is not charged enough yet.";
    case "cooldown":
      return `That move is cooling down (${availability.cooldownTurns ?? "?"} more plays).`;
    case "combo":
      return "You need an active combo chain.";
    case "defense_lock":
      return "A defense stance is already armed.";
    case "opponent_state":
      return "Your opponent is not vulnerable to that move.";
    default:
      return "That move cannot be used right now.";
  }
}
