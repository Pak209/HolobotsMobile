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
import type { FinisherPower } from "@/features/arena/finisherPolicy";
import { ArenaCombatEngine } from "@/features/arena/combatEngine";
import {
  battleStateToRoomUpdates,
  buildPvpFighterDoc,
  PVP_FIGHTER_IDS,
  roomToBattleState,
} from "@/features/arena/pvpBattle";
import {
  autoPickSendInIndex,
  buildPvpTeamSide,
  buildSendInUpdates,
  buildSwitchUpdates,
  getRoomMode,
  interceptTeamKo,
  regenBenchMembers,
  validatePvpSendIn,
  validatePvpSwitch,
  validateTeamAct,
  TEAM_SIZE,
} from "@/features/arena/pvpTeamBattle";
import { claimOpponentAndCreateRoom, isFreshPoolEntry } from "@/lib/pvpMatchmaking";
import {
  mergePvpHostReply,
  pvpOpponentReadDelay,
  pvpSeatPending,
  PVP_OPPONENT_READ_DELAYS_MS,
  type PvpHostFighterStatus,
  type PvpHostView,
} from "@/lib/bots/pvpFighterLevel";
import { pvpRoomFighterCallForUid, readHostFighters, seatHostFighters } from "@/lib/pvpRoomFightersClient";
import { useAuth } from "@/contexts/AuthContext";
import type { ArenaCardAvailability } from "@/features/arena/arenaCards";
import {
  BATTLE_ROOM_RULES_VERSION,
  type BattleMode,
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
  const [hostFighterStatus, setHostFighterStatus] = useState<PvpHostFighterStatus>("idle");
  const [hostView, setHostView] = useState<PvpHostView | null>(null);
  // Re-read attempts per (room, opponent uid, opponent bot): a 3v3 switch back to a bot keeps its spent budget.
  const [opponentReads, setOpponentReads] = useState<Record<string, number>>({});
  const hostSeatRoomRef = useRef<string | null>(null);

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

  /** 1v1: one name. 3v3: three DISTINCT names, lead first. */
  const buildOwnLineup = useCallback(
    (holobotNames: string[], mode: BattleMode): PvpFighterDoc[] => {
      const distinct = new Set(holobotNames.map((name) => name.trim().toUpperCase()));
      if (mode === "3v3" && (holobotNames.length !== TEAM_SIZE || distinct.size !== TEAM_SIZE)) {
        throw new Error("Pick three different Holobots for 3v3.");
      }
      if (mode === "1v1" && holobotNames.length !== 1) {
        throw new Error("Pick one Holobot for 1v1.");
      }
      return holobotNames.map((name) => buildOwnFighter(name));
    },
    [buildOwnFighter],
  );

  // pvp-room-fighters-1: ask the host to mint my seat's level snapshots (stored server-side, never on the
  // room doc) and keep the seats its replies return. Presentation only and fire-and-forget: a refusing or
  // not-yet-deployed host leaves the badges absent and never blocks or fails the room.
  const requestHostFighters = useCallback((roomId: string, holobotNames: string[]) => {
    if (!user) return;
    hostSeatRoomRef.current = roomId;
    setHostView(null);
    setHostFighterStatus("pending");
    void seatHostFighters(pvpRoomFighterCallForUid(user.uid), roomId, holobotNames).then((outcome) => {
      if (hostSeatRoomRef.current !== roomId) return;
      setHostView((view) => outcome.replies.reduce<PvpHostView | null>((next, reply) => mergePvpHostReply(next, reply, roomId), view));
      // "ready" = the host answered (a refused bot just stays absent), so opponent reads may run.
      setHostFighterStatus(outcome.status === "ready" || outcome.replies.length > 0 ? "ready" : "unavailable");
    });
  }, [user]);

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
    hostSeatRoomRef.current = null;
    setHostFighterStatus("idle");
    setHostView(null);
    setOpponentReads({});
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

        // Send-in self-heal: past the deadline, either client commits the
        // auto-pick so an AWOL chooser can't freeze the room forever.
        if (
          getRoomMode(battleRoom) === "3v3" &&
          battleRoom.phase === "awaiting_send_in" &&
          battleRoom.pendingSendInRole &&
          Date.now() >= (battleRoom.sendInDeadline ?? 0) &&
          battleRoom.teams
        ) {
          const pick = autoPickSendInIndex(battleRoom.teams[battleRoom.pendingSendInRole]);
          if (pick >= 0) {
            transaction.update(roomRef, buildSendInUpdates({ ...battleRoom, roomId: room.roomId }, pick));
          }
          return;
        }

        const player = battleRoom.players[myRole];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore update map
        const updates: { [key: string]: any } = {};
        if (battleRoom.phase !== "awaiting_send_in" && player.stamina < player.maxStamina) {
          updates[`players.${myRole}.stamina`] = Math.min(player.maxStamina, player.stamina + 1);
        }
        // Bench catches its breath too (3v3): +1 stamina, meter frozen.
        if (getRoomMode(battleRoom) === "3v3" && battleRoom.teams) {
          const side = battleRoom.teams[myRole];
          const regenerated = regenBenchMembers(side);
          if (regenerated.some((member, index) => member !== side.members[index])) {
            updates[`teams.${myRole}.members`] = regenerated;
          }
        }
        if (Object.keys(updates).length > 0) {
          transaction.update(roomRef, updates);
        }
      }).catch((staminaError) => setError(staminaError.message));
    }, STAMINA_REGEN_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (staminaRef.current) clearInterval(staminaRef.current);
      heartbeatRef.current = null;
      staminaRef.current = null;
    };
  }, [myRole, room?.roomId, user]);

  // The opponent's snapshot exists only once THEY have seated, so re-read a few times (bounded), then
  // leave their badge absent. Keyed on stable values: stamina/heartbeat writes must not reset the timer.
  const opponentSeatRole: PlayerRole | null = myRole === "p1" ? "p2" : myRole === "p2" ? "p1" : null;
  const hostRoomId = room?.roomId ?? "";
  const opponentUid = opponentSeatRole ? room?.players[opponentSeatRole]?.uid ?? "" : "";
  const opponentBot = opponentSeatRole ? room?.players[opponentSeatRole]?.holobotName ?? "" : "";
  const opponentKey = `${hostRoomId}:${opponentUid}:${opponentBot}`;
  const opponentAttempts = opponentReads[opponentKey] ?? 0;
  useEffect(() => {
    if (!user || !hostRoomId || !opponentSeatRole) return;
    const seen = { roomId: hostRoomId, players: { [opponentSeatRole]: { uid: opponentUid, holobotName: opponentBot } } };
    const delay = pvpOpponentReadDelay(hostFighterStatus, hostView, seen, opponentSeatRole, opponentAttempts);
    if (delay === null) return;
    const timer = setTimeout(() => {
      void readHostFighters(pvpRoomFighterCallForUid(user.uid), hostRoomId).then((outcome) => {
        if (hostSeatRoomRef.current !== hostRoomId) return;
        if (outcome.status === "ready") setHostView((view) => mergePvpHostReply(view, outcome.reply, hostRoomId));
        // A refused read (not seated / room gone), an outage or a missing host: stop and show absent.
        setOpponentReads((reads) => ({ ...reads, [opponentKey]: outcome.status === "ready" ? opponentAttempts + 1 : PVP_OPPONENT_READ_DELAYS_MS.length }));
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [hostFighterStatus, hostRoomId, hostView, opponentAttempts, opponentBot, opponentKey, opponentSeatRole, opponentUid, user]);

  const hostSeatPending = useMemo<Record<PlayerRole, boolean>>(() => {
    const readsLeft = PVP_OPPONENT_READ_DELAYS_MS.length - opponentAttempts;
    return myRole
      ? { p1: pvpSeatPending("p1", myRole, hostFighterStatus, readsLeft), p2: pvpSeatPending("p2", myRole, hostFighterStatus, readsLeft) }
      : { p1: false, p2: false };
  }, [hostFighterStatus, myRole, opponentAttempts]);

  const createRoom = useCallback(async (holobotNames: string[], mode: BattleMode = "1v1") => {
    if (!user || !profile) throw new Error("Sign in before creating a room.");
    setLoading(true);
    setError(null);
    try {
      const lineup = buildOwnLineup(holobotNames, mode);
      const roomRef = doc(collection(db, BATTLE_ROOMS));
      const roomCode = generateRoomCode();
      const newRoom: BattleRoom = {
        roomId: roomRef.id,
        roomCode,
        rulesVersion: BATTLE_ROOM_RULES_VERSION,
        status: "waiting",
        mode,
        ...(mode === "3v3"
          ? {
              phase: "active" as const,
              pendingSendInRole: null,
              sendInDeadline: null,
              teams: { p1: buildPvpTeamSide(lineup), p2: buildPvpTeamSide([]) },
            }
          : {}),
        players: {
          p1: lineup[0],
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
      requestHostFighters(roomRef.id, lineup.map((fighter) => fighter.holobotName));
      return roomCode;
    } catch (createError: any) {
      setError(createError.message);
      throw createError;
    } finally {
      setLoading(false);
    }
  }, [buildOwnLineup, profile, requestHostFighters, subscribeToRoom, user]);

  const joinRoom = useCallback(async (roomCode: string, holobotNames: string[]) => {
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
      const roomMode = getRoomMode(roomData);
      if (roomMode === "3v3" && holobotNames.length !== TEAM_SIZE) {
        throw new Error("This is a 3v3 room — pick three Holobots to join.");
      }
      const lineup = buildOwnLineup(holobotNames, roomMode);
      await updateDoc(doc(db, BATTLE_ROOMS, roomDoc.id), {
        "players.p2": lineup[0],
        ...(roomMode === "3v3" ? { "teams.p2": buildPvpTeamSide(lineup) } : {}),
        status: "active",
        startedAt: serverTimestamp(),
      });
      setMyRole("p2");
      subscribeToRoom(roomDoc.id);
      requestHostFighters(roomDoc.id, lineup.map((fighter) => fighter.holobotName));
    } catch (joinError: any) {
      setError(joinError.message);
      throw joinError;
    } finally {
      setLoading(false);
    }
  }, [buildOwnLineup, profile, requestHostFighters, subscribeToRoom, user]);

  const joinRoomById = useCallback(async (roomId: string) => {
    if (!user) throw new Error("Sign in before joining a room.");
    const roomSnap = await getDoc(doc(db, BATTLE_ROOMS, roomId));
    if (!roomSnap.exists()) throw new Error("Room not found.");
    const roomData = roomSnap.data() as BattleRoom;
    if (roomData.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
    const role: PlayerRole | null =
      roomData.players.p1.uid === user.uid ? "p1" : roomData.players.p2.uid === user.uid ? "p2" : null;
    if (!role) throw new Error("You are not part of this room.");
    setMyRole(role);
    subscribeToRoom(roomId);
    // Matchmaking seats: my live fighter plus any 3v3 lineup the pairing wrote for me.
    requestHostFighters(roomId, [
      roomData.players[role].holobotName,
      ...(roomData.teams?.[role]?.members ?? []).map((member) => member.holobotName),
    ]);
  }, [requestHostFighters, subscribeToRoom, user]);

  const enterMatchmaking = useCallback(async (holobotNames: string[], mode: BattleMode = "1v1") => {
    if (!user || !profile) throw new Error("Sign in before matchmaking.");
    const myLineup = buildOwnLineup(holobotNames, mode);
    const myFighter = myLineup[0];
    setMatchmakingStatus("searching");
    setError(null);
    // Keyed by uid: one queue entry per player, and re-queueing overwrites
    // any ghost entry left behind by a crashed session.
    const myPoolRef = doc(db, BATTLE_POOL, user.uid);
    await setDoc(myPoolRef, {
      userId: user.uid,
      username: profile.username || "Pilot",
      fighter: myFighter,
      ...(mode === "3v3" ? { team: myLineup } : {}),
      mode,
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
      // Only pair identical modes (legacy entries without a mode are 1v1).
      if ((candidate.mode ?? "1v1") !== mode) continue;
      if (mode === "3v3" && (candidate.team?.length ?? 0) !== TEAM_SIZE) continue;

      const claim = await claimOpponentAndCreateRoom(db, user.uid, candidateDoc.id, (roomId, opponent) => ({
        roomId,
        roomCode: generateRoomCode(),
        rulesVersion: BATTLE_ROOM_RULES_VERSION,
        status: "active",
        mode,
        ...(mode === "3v3"
          ? {
              phase: "active" as const,
              pendingSendInRole: null,
              sendInDeadline: null,
              teams: {
                p1: buildPvpTeamSide(myLineup),
                p2: buildPvpTeamSide(opponent.team ?? [opponent.fighter]),
              },
            }
          : {}),
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
        requestHostFighters(claim.roomId, myLineup.map((fighter) => fighter.holobotName));
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
  }, [buildOwnLineup, joinRoomById, profile, requestHostFighters, subscribeToRoom, user]);

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

      const actGate = validateTeamAct(freshRoom, myRole);
      if (actGate === "awaiting_send_in") throw new Error("A Holobot is down — the send-in comes first.");
      if (actGate === "entry_locked") throw new Error("Your Holobot is still entering the arena.");

      const state = roomToBattleState(freshRoom);
      const availability = ArenaCombatEngine.getCardAvailability(state, engineRole, move);
      if (!availability.playable) {
        throw new Error(availabilityMessage(availability));
      }

      const nextState = ArenaCombatEngine.resolveAction(state, move, PVP_FIGHTER_IDS[myRole]);
      if (nextState === state) throw new Error("That move cannot be used right now.");

      // In a team room a KO with bench remaining freezes into the send-in
      // phase instead of completing the match.
      transaction.update(roomRef, interceptTeamKo(freshRoom, battleStateToRoomUpdates(freshRoom, nextState)));
    });
  }, [myRole, room, user]);

  // Fires my signature finisher (7/7 meter) through the shared engine.
  const useSignature = useCallback(async (power: FinisherPower = "full") => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);
    const engineRole = myRole === "p1" ? "player" : "opponent";

    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = { ...(roomSnap.data() as BattleRoom), roomId: roomSnap.id };
      if (freshRoom.rulesVersion !== BATTLE_ROOM_RULES_VERSION) throw new Error(VERSION_MISMATCH_MESSAGE);
      if (freshRoom.status !== "active") throw new Error("Battle is not active.");

      const actGate = validateTeamAct(freshRoom, myRole);
      if (actGate === "awaiting_send_in") throw new Error("A Holobot is down — the send-in comes first.");
      if (actGate === "entry_locked") throw new Error("Your Holobot is still entering the arena.");

      const state = roomToBattleState(freshRoom);
      if (!ArenaCombatEngine.canUseSignatureFinisher(state, engineRole, power)) {
        throw new Error("Your Finisher needs enough stamina and the selected Sync charge.");
      }

      const nextState = ArenaCombatEngine.resolveSignatureFinisher(state, PVP_FIGHTER_IDS[myRole], power);
      if (nextState === state) throw new Error("Signature finisher is not ready.");

      transaction.update(roomRef, interceptTeamKo(freshRoom, battleStateToRoomUpdates(freshRoom, nextState)));
    });
  }, [myRole, room, user]);

  // 3v3: voluntary rotation (10s side cooldown, 1.5s entry lock).
  const switchActive = useCallback(async (toIndex: number) => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);

    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = { ...(roomSnap.data() as BattleRoom), roomId: roomSnap.id };
      const refusal = validatePvpSwitch(freshRoom, myRole, toIndex);
      if (refusal) throw new Error(switchRefusalMessage(refusal));
      transaction.update(roomRef, buildSwitchUpdates(freshRoom, myRole, toIndex));
    });
  }, [myRole, room, user]);

  // 3v3: pick the replacement after a KO. After the deadline EITHER client
  // may commit the auto-pick for an AWOL chooser (self-healing).
  const sendIn = useCallback(async (toIndex: number) => {
    if (!room || !myRole || !user) throw new Error("You are not in a battle.");
    const roomRef = doc(db, BATTLE_ROOMS, room.roomId);

    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("Battle room no longer exists.");
      const freshRoom = { ...(roomSnap.data() as BattleRoom), roomId: roomSnap.id };
      const refusal = validatePvpSendIn(freshRoom, myRole, toIndex);
      if (refusal) throw new Error(sendInRefusalMessage(refusal));
      transaction.update(roomRef, buildSendInUpdates(freshRoom, toIndex));
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
    hostFighterStatus,
    hostSeatPending,
    hostView,
    joinRoom,
    leaveRoom,
    loading,
    matchmakingStatus,
    moveAvailability,
    myRole,
    opponentRole: myRole === "p1" ? "p2" : myRole === "p2" ? "p1" : null,
    playMove,
    room,
    sendIn,
    switchActive,
    useSignature,
  };
}

function switchRefusalMessage(refusal: NonNullable<ReturnType<typeof validatePvpSwitch>>): string {
  switch (refusal) {
    case "cooldown":
      return "Your side's switch is still cooling down.";
    case "knocked_out":
      return "That Holobot is down.";
    case "already_active":
      return "That Holobot is already fighting.";
    case "awaiting_send_in":
      return "A Holobot is down — the send-in comes first.";
    default:
      return "You cannot switch right now.";
  }
}

function sendInRefusalMessage(refusal: NonNullable<ReturnType<typeof validatePvpSendIn>>): string {
  switch (refusal) {
    case "not_your_pick":
      return "Waiting for your opponent's send-in.";
    case "knocked_out":
      return "That Holobot cannot fight.";
    default:
      return "No send-in is pending.";
  }
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
