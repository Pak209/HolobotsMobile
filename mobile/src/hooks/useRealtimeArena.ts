import { useCallback, useEffect, useRef, useState } from "react";
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
import { claimOpponentAndCreateRoom, isFreshPoolEntry } from "@/lib/pvpMatchmaking";
import { getHolobotBaseProfile, type HolobotRosterEntry } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import type {
  BattleHolobotStats,
  BattlePoolEntry,
  BattleRoom,
  BattleRoomPlayer,
  BoostableStat,
  PlayerRole,
  RealtimeActionCard,
  StatBoost,
} from "@/types/battle-room";

const BATTLE_ROOMS = "battle_rooms";
const BATTLE_POOL = "battle_pool_entries";
const HEARTBEAT_INTERVAL_MS = 5000;
const STAMINA_REGEN_INTERVAL_MS = 2000;
const MAX_STAMINA = 7;

const CARD_POOL: Array<Omit<RealtimeActionCard, "id">> = [
  { name: "Jab", type: "strike", tier: 1, staminaCost: 1, baseDamage: 8 },
  { name: "Cross", type: "strike", tier: 1, staminaCost: 1, baseDamage: 10 },
  { name: "Hook", type: "strike", tier: 2, staminaCost: 2, baseDamage: 12, statEffect: { target: "opponent", stat: "speed", stages: -1, durationMs: 4000 } },
  { name: "Body Blow", type: "strike", tier: 2, staminaCost: 2, baseDamage: 11, statEffect: { target: "opponent", stat: "attack", stages: -1, durationMs: 4000 } },
  { name: "Overhand", type: "strike", tier: 3, staminaCost: 2, baseDamage: 15, statEffect: { target: "opponent", stat: "defense", stages: -2, durationMs: 5000 } },
  { name: "Block", type: "defense", tier: 1, staminaCost: 0, staminaRestore: 2 },
  { name: "Retreat", type: "defense", tier: 1, staminaCost: 0, staminaRestore: 2 },
  { name: "Parry", type: "defense", tier: 2, staminaCost: 0, staminaRestore: 2, statEffect: { target: "self", stat: "defense", stages: 1, durationMs: 4000 } },
  { name: "Sidestep", type: "defense", tier: 2, staminaCost: 0, staminaRestore: 2, statEffect: { target: "self", stat: "speed", stages: 1, durationMs: 4000 } },
  { name: "Steel Guard", type: "defense", tier: 3, staminaCost: 1, staminaRestore: 1, statEffect: { target: "self", stat: "defense", stages: 2, durationMs: 6000 } },
  { name: "Focus", type: "defense", tier: 3, staminaCost: 1, staminaRestore: 1, statEffect: { target: "self", stat: "attack", stages: 2, durationMs: 6000 } },
  { name: "One-Two", type: "combo", tier: 1, staminaCost: 2, baseDamage: 18 },
  { name: "Jab-Cross", type: "combo", tier: 1, staminaCost: 3, baseDamage: 22 },
  { name: "Uppercut Chain", type: "combo", tier: 2, staminaCost: 3, baseDamage: 20, statEffect: { target: "self", stat: "attack", stages: 1, durationMs: 5000 } },
  { name: "Rush", type: "combo", tier: 2, staminaCost: 2, baseDamage: 18, statEffect: { target: "self", stat: "speed", stages: 1, durationMs: 5000 } },
  { name: "Blitz Rush", type: "combo", tier: 3, staminaCost: 3, baseDamage: 20, statEffect: { target: "self", stat: "attack", stages: 2, durationMs: 6000 } },
  { name: "Overdrive", type: "combo", tier: 3, staminaCost: 4, baseDamage: 28, statEffect: { target: "opponent", stat: "defense", stages: -2, durationMs: 6000 } },
];

const FINISHER_CARD: Omit<RealtimeActionCard, "id"> = {
  name: "FINISHER",
  type: "finisher",
  tier: 3,
  staminaCost: 6,
  baseDamage: 80,
};

const STAGE_MULTIPLIERS: Record<number, number> = {
  [-3]: 0.5,
  [-2]: 0.67,
  [-1]: 0.8,
  [0]: 1,
  [1]: 1.25,
  [2]: 1.5,
  [3]: 2,
};

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateCardId() {
  return Math.random().toString(36).slice(2, 11);
}

function weightedRandomTier(): 1 | 2 | 3 {
  const roll = Math.random();
  if (roll < 0.45) return 1;
  if (roll < 0.9) return 2;
  return 3;
}

function withId(card: Omit<RealtimeActionCard, "id">): RealtimeActionCard {
  return { id: generateCardId(), ...card };
}

function drawCard(specialMeter: number, alreadyHasFinisher = false): RealtimeActionCard {
  if (specialMeter >= 100 && !alreadyHasFinisher) {
    return withId(FINISHER_CARD);
  }
  const tier = weightedRandomTier();
  const tieredPool = CARD_POOL.filter((card) => card.tier === tier);
  return withId(tieredPool[Math.floor(Math.random() * tieredPool.length)]);
}

function generateStartingHand() {
  const defenseCards = CARD_POOL.filter((card) => card.type === "defense");
  const hand = [
    withId(defenseCards[Math.floor(Math.random() * defenseCards.length)]),
    withId(defenseCards[Math.floor(Math.random() * defenseCards.length)]),
  ];
  for (let i = 0; i < 5; i += 1) {
    hand.push(drawCard(0));
  }
  return hand;
}

function getEffectiveStat(baseStat: number, activeBoosts: StatBoost[] | undefined, stat: BoostableStat) {
  const now = Date.now();
  const stages = (activeBoosts ?? [])
    .filter((boost) => boost.stat === stat && boost.expiresAt > now)
    .reduce((sum, boost) => sum + boost.stages, 0);
  const clamped = Math.max(-3, Math.min(3, stages));
  return Math.round(baseStat * (STAGE_MULTIPLIERS[clamped] ?? 1));
}

function buildPlayer(uid: string, username: string, holobotStats: BattleHolobotStats): BattleRoomPlayer {
  return {
    uid,
    username,
    holobot: holobotStats,
    health: holobotStats.maxHealth,
    maxHealth: holobotStats.maxHealth,
    stamina: MAX_STAMINA,
    maxStamina: MAX_STAMINA,
    specialMeter: 0,
    hand: generateStartingHand(),
    activeBoosts: [],
    isConnected: true,
    lastHeartbeat: serverTimestamp(),
    damageDealt: 0,
    damageTaken: 0,
  };
}

export function buildRealtimeHolobotStats(holobot: HolobotRosterEntry): BattleHolobotStats {
  const base = getHolobotBaseProfile(holobot.name);
  const levelBonus = 1 + (Math.max(1, holobot.level) - 1) * 0.05;
  const pvpWins = "pvpWins" in holobot && typeof holobot.pvpWins === "number" ? holobot.pvpWins : 0;

  return {
    name: holobot.name,
    level: holobot.level,
    attack: Math.floor(base.attack * levelBonus) + (holobot.boostedAttributes?.attack || 0),
    defense: Math.floor(base.defense * levelBonus) + (holobot.boostedAttributes?.defense || 0),
    speed: Math.floor(base.speed * levelBonus) + (holobot.boostedAttributes?.speed || 0),
    intelligence: base.intelligence + pvpWins * 2,
    maxHealth: Math.floor(base.hp * levelBonus) + (holobot.boostedAttributes?.health || 0),
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

  const createRoom = useCallback(async (holobotStats: BattleHolobotStats) => {
    if (!user || !profile) throw new Error("Sign in before creating a room.");
    setLoading(true);
    setError(null);
    try {
      const roomRef = doc(collection(db, BATTLE_ROOMS));
      const roomCode = generateRoomCode();
      const newRoom: BattleRoom = {
        roomId: roomRef.id,
        roomCode,
        status: "waiting",
        players: {
          p1: buildPlayer(user.uid, profile.username || "Pilot", holobotStats),
          p2: {
            uid: "",
            username: "",
            holobot: {} as BattleHolobotStats,
            health: 0,
            maxHealth: 0,
            stamina: 0,
            maxStamina: 0,
            specialMeter: 0,
            hand: [],
            activeBoosts: [],
            isConnected: false,
            damageDealt: 0,
            damageTaken: 0,
          },
        },
        currentTurn: 0,
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
  }, [profile, subscribeToRoom, user]);

  const joinRoom = useCallback(async (roomCode: string, holobotStats: BattleHolobotStats) => {
    if (!user || !profile) throw new Error("Sign in before joining a room.");
    setLoading(true);
    setError(null);
    try {
      const rooms = await getDocs(query(collection(db, BATTLE_ROOMS), where("roomCode", "==", roomCode.toUpperCase()), limit(1)));
      if (rooms.empty) throw new Error("Room not found.");
      const roomDoc = rooms.docs[0];
      const roomData = roomDoc.data() as BattleRoom;
      if (roomData.status !== "waiting" || roomData.players.p2.uid) throw new Error("Room is not available.");
      await updateDoc(doc(db, BATTLE_ROOMS, roomDoc.id), {
        "players.p2": buildPlayer(user.uid, profile.username || "Pilot", holobotStats),
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
  }, [profile, subscribeToRoom, user]);

  const joinRoomById = useCallback(async (roomId: string) => {
    if (!user) throw new Error("Sign in before joining a room.");
    const roomSnap = await getDoc(doc(db, BATTLE_ROOMS, roomId));
    if (!roomSnap.exists()) throw new Error("Room not found.");
    const roomData = roomSnap.data() as BattleRoom;
    if (roomData.players.p1.uid === user.uid) setMyRole("p1");
    else if (roomData.players.p2.uid === user.uid) setMyRole("p2");
    else throw new Error("You are not part of this room.");
    subscribeToRoom(roomId);
  }, [subscribeToRoom, user]);

  const enterMatchmaking = useCallback(async (holobotStats: BattleHolobotStats) => {
    if (!user || !profile) throw new Error("Sign in before matchmaking.");
    setMatchmakingStatus("searching");
    setError(null);
    // Keyed by uid: one queue entry per player, and re-queueing overwrites
    // any ghost entry left behind by a crashed session.
    const myPoolRef = doc(db, BATTLE_POOL, user.uid);
    await setDoc(myPoolRef, {
      userId: user.uid,
      username: profile.username || "Pilot",
      holobotStats,
      isActive: true,
      createdAt: serverTimestamp(),
    } satisfies BattlePoolEntry);
    poolEntryIdRef.current = user.uid;

    const candidates = await getDocs(query(collection(db, BATTLE_POOL), where("isActive", "==", true), limit(10)));
    for (const candidateDoc of candidates.docs) {
      if (candidateDoc.id === user.uid) continue;
      const candidate = candidateDoc.data() as BattlePoolEntry;
      if (candidate.userId === user.uid || !isFreshPoolEntry(candidate)) continue;

      const claim = await claimOpponentAndCreateRoom(db, user.uid, candidateDoc.id, (roomId, opponent) => ({
        roomId,
        roomCode: generateRoomCode(),
        status: "active",
        players: {
          p1: buildPlayer(user.uid, profile.username || "Pilot", holobotStats),
          p2: buildPlayer(opponent.userId, opponent.username, opponent.holobotStats),
        },
        currentTurn: 0,
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
  }, [joinRoomById, profile, subscribeToRoom, user]);

  const cancelMatchmaking = useCallback(async () => {
    poolUnsubscribeRef.current?.();
    poolUnsubscribeRef.current = null;
    if (!poolEntryIdRef.current) return;
    await deleteDoc(doc(db, BATTLE_POOL, poolEntryIdRef.current));
    poolEntryIdRef.current = null;
    setMatchmakingStatus("idle");
  }, []);

  const playCard = useCallback(async (cardId: string) => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = roomSnap.data() as BattleRoom;
      if (freshRoom.status !== "active") throw new Error("Battle is not active.");

      const opponentRole: PlayerRole = myRole === "p1" ? "p2" : "p1";
      const myPlayer = freshRoom.players[myRole];
      const opponent = freshRoom.players[opponentRole];
      const card = myPlayer.hand.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error("Card not found in hand.");
      if (myPlayer.stamina < card.staminaCost) throw new Error("Not enough stamina.");
      if (card.type === "finisher" && myPlayer.specialMeter < 100) throw new Error("Special meter is not full.");

      const now = Date.now();
      if (card.type !== "defense" && myPlayer.defenseActive && myPlayer.defendedAt && now - myPlayer.defendedAt < 2000) {
        throw new Error("Still in defensive stance.");
      }

      let damageDealt = 0;
      let staminaChange = 0;
      let specialMeterGain = card.type === "combo" ? 15 : card.type === "strike" ? 10 : card.type === "defense" ? 5 : -100;
      let logMessage = "";
      let myBoosts = (myPlayer.activeBoosts ?? []).filter((boost) => boost.expiresAt > now);
      let opponentBoosts = (opponent.activeBoosts ?? []).filter((boost) => boost.expiresAt > now);

      if (card.type === "defense") {
        staminaChange = card.staminaRestore || 2;
        const defenderScore = getEffectiveStat(myPlayer.holobot.speed, myBoosts, "speed") * 3 + myPlayer.holobot.intelligence * 4;
        const attackerScore = getEffectiveStat(opponent.holobot.attack, opponentBoosts, "attack") * 2 + getEffectiveStat(opponent.holobot.speed, opponentBoosts, "speed") * 2;
        if (defenderScore > attackerScore && Math.random() * 100 < Math.min(75, (defenderScore - attackerScore) / 2)) {
          if (Math.random() < 0.5) {
            damageDealt = Math.round(15 * (getEffectiveStat(myPlayer.holobot.speed, myBoosts, "speed") / 20));
            staminaChange += 1;
            logMessage = `${myPlayer.username} counter attacked for ${damageDealt} damage.`;
          } else {
            staminaChange += 2;
            specialMeterGain = 15;
            logMessage = `${myPlayer.username} perfect evaded.`;
          }
        } else {
          logMessage = `${myPlayer.username} used ${card.name}.`;
        }
      } else {
        staminaChange = -card.staminaCost;
        const effectiveAttack = getEffectiveStat(myPlayer.holobot.attack, myBoosts, "attack");
        const effectiveDefense = getEffectiveStat(opponent.holobot.defense, opponentBoosts, "defense");
        let calculatedDamage = (card.baseDamage || 0) * (effectiveAttack / 20) * (20 / (20 + effectiveDefense * 0.3));
        if (card.type === "finisher") calculatedDamage *= 2;
        if (opponent.defenseActive && opponent.defendedAt && now - opponent.defendedAt < 3000) {
          calculatedDamage *= 1 - Math.min(0.7, effectiveDefense / 50);
          logMessage = `${myPlayer.username} used ${card.name} for ${Math.round(calculatedDamage)} damage. Blocked.`;
        } else {
          logMessage = `${myPlayer.username} used ${card.name} for ${Math.round(calculatedDamage)} damage.`;
        }
        damageDealt = Math.round(calculatedDamage);
      }

      const newHand = myPlayer.hand.filter((candidate) => candidate.id !== cardId);
      const newSpecialMeter = Math.max(0, Math.min(100, myPlayer.specialMeter + specialMeterGain));
      newHand.push(drawCard(newSpecialMeter, newHand.some((candidate) => candidate.type === "finisher")));

      const battleLog = [
        ...(freshRoom.battleLog || []),
        { turnNumber: freshRoom.currentTurn + 1, message: logMessage, timestamp: now },
      ];

      if (card.statEffect) {
        const boost = {
          stat: card.statEffect.stat,
          stages: card.statEffect.stages,
          expiresAt: now + card.statEffect.durationMs,
          source: card.name,
        };
        if (card.statEffect.target === "self") myBoosts = [...myBoosts, boost];
        else opponentBoosts = [...opponentBoosts, boost];
        const target = card.statEffect.target === "self" ? myPlayer.username : opponent.username;
        battleLog.push({
          turnNumber: freshRoom.currentTurn + 1,
          message: `${card.name}: ${target}'s ${card.statEffect.stat} ${card.statEffect.stages > 0 ? "rose" : "fell"}.`,
          timestamp: now,
        });
      }

      const opponentHealth = Math.max(0, opponent.health - damageDealt);
      const winner = opponentHealth <= 0 ? myRole : null;
      transaction.update(roomRef, {
        [`players.${myRole}.hand`]: newHand,
        [`players.${myRole}.stamina`]: Math.max(0, Math.min(myPlayer.maxStamina, myPlayer.stamina + staminaChange)),
        [`players.${myRole}.specialMeter`]: newSpecialMeter,
        [`players.${myRole}.damageDealt`]: myPlayer.damageDealt + damageDealt,
        [`players.${myRole}.activeBoosts`]: myBoosts,
        [`players.${myRole}.defenseActive`]: card.type === "defense",
        [`players.${myRole}.defendedAt`]: card.type === "defense" ? now : myPlayer.defendedAt || null,
        [`players.${opponentRole}.health`]: opponentHealth,
        [`players.${opponentRole}.damageTaken`]: opponent.damageTaken + damageDealt,
        [`players.${opponentRole}.activeBoosts`]: opponentBoosts,
        battleLog,
        currentTurn: freshRoom.currentTurn + 1,
        lastActionAt: serverTimestamp(),
        winner,
        status: winner ? "completed" : "active",
        completedAt: winner ? serverTimestamp() : freshRoom.completedAt || null,
      });
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

  return {
    cancelMatchmaking,
    createRoom,
    enterMatchmaking,
    error,
    joinRoom,
    leaveRoom,
    loading,
    matchmakingStatus,
    myRole,
    opponentRole: myRole === "p1" ? "p2" : myRole === "p2" ? "p1" : null,
    playCard,
    room,
  };
}
