import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { ArenaPrebattleMenu } from "@/components/arena/ArenaPrebattleMenu";
import { BattleArenaView } from "@/components/arena/BattleArenaView";
import { BattleResultsModal } from "@/components/arena/BattleResultsModal";
import { PvpArenaModal } from "@/components/arena/PvpArenaModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import {
  ARENA_TIERS,
  type ArenaTier,
  buildOpponentFighter,
  buildPlayerFighter,
  getArenaPotentialRewards,
  getTierOpponentLineup,
} from "@/config/arenaConfig";
import { applyHolobotExperience } from "@/config/holobots";
import { collection, db, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { incrementArenaBattlesToday } from "@/lib/dailyMissions";
import { useArenaBattleStore } from "@/stores/arena-battle-store";
import type { UserHolobot } from "@/types/profile";

type ArenaPhase = "prebattle" | "battle" | "results";

type BattleSetup = {
  paymentMethod: "tokens" | "pass";
  roundIndex: number;
  selectedHolobot: UserHolobot;
  tier: ArenaTier;
};

type PvpStoredPlayer = {
  battleCards: Record<string, number>;
  holobot: UserHolobot;
  userId: string;
  username: string;
};

type PvpRoomRecord = {
  code?: string;
  createdBy: string;
  createdClientAt: number;
  mode: "friend" | "quick";
  players: Record<string, PvpStoredPlayer>;
  status: "ready" | "started" | "waiting";
};

export function ArenaScreen() {
  const { profile, user } = useAuth();
  const {
    battleResult,
    canPlayCard,
    currentBattle,
    getPlayableCards,
    isAnimating,
    lastAction,
    playCard,
    playerCards,
    resetBattle,
    selectedCardId,
    selectCard,
    startBattle,
    toggleDefenseMode,
  } = useArenaBattleStore();

  const [phase, setPhase] = useState<ArenaPhase>("prebattle");
  const [isStartingBattle, setIsStartingBattle] = useState(false);
  const [isPvpOpen, setIsPvpOpen] = useState(false);
  const [latestSetup, setLatestSetup] = useState<BattleSetup | null>(null);
  const [pvpStatus, setPvpStatus] = useState<{
    accent: string;
    message: string;
    roomCode?: string | null;
  } | null>(null);
  const [roundProgress, setRoundProgress] = useState<{ currentRound: number; totalRounds: number } | null>(null);
  const persistedBattleIdRef = useRef<string | null>(null);
  const activeBattleHolobotNameRef = useRef<string | null>(null);
  const pvpQueueUnsubRef = useRef<(() => void) | null>(null);
  const pvpRoomUnsubRef = useRef<(() => void) | null>(null);
  const startedPvpRoomIdRef = useRef<string | null>(null);

  const holobots = profile?.holobots ?? [];
  const userTokens = profile?.holosTokens ?? 0;
  const userArenaPasses = profile?.arena_passes ?? 0;
  const playableCardIds = useMemo(
    () => getPlayableCards().map((card) => card.id),
    [currentBattle, getPlayableCards],
  );

  const stopPvpQueueListener = useCallback(() => {
    pvpQueueUnsubRef.current?.();
    pvpQueueUnsubRef.current = null;
  }, []);

  const stopPvpRoomListener = useCallback(() => {
    pvpRoomUnsubRef.current?.();
    pvpRoomUnsubRef.current = null;
  }, []);

  const clearQuickMatchEntry = useCallback(async () => {
    if (!user) {
      return;
    }

    await deleteDoc(doc(db, "pvpQueue", user.uid)).catch(() => undefined);
  }, [user]);

  const buildPvpPlayer = useCallback(
    (holobot: UserHolobot): PvpStoredPlayer => ({
      battleCards: { ...(profile?.battle_cards || {}) },
      holobot: JSON.parse(JSON.stringify(holobot)) as UserHolobot,
      userId: user!.uid,
      username: profile?.username || "Pilot",
    }),
    [profile?.battle_cards, profile?.username, user],
  );

  const startPvpBattleFromRoom = useCallback(
    async (roomId: string, room: PvpRoomRecord) => {
      if (!user || !profile || startedPvpRoomIdRef.current === roomId) {
        return;
      }

      const myPilot = room.players[user.uid];
      const opponentPilot = Object.values(room.players).find((entry) => entry.userId !== user.uid);

      if (!myPilot || !opponentPilot) {
        return;
      }

      const localHolobot =
        profile.holobots?.find((holobot) => holobot.name.toUpperCase() === myPilot.holobot.name.toUpperCase()) ||
        myPilot.holobot;

      startedPvpRoomIdRef.current = roomId;
      stopPvpQueueListener();
      stopPvpRoomListener();
      await clearQuickMatchEntry();

      const player = {
        ...buildPlayerFighter(user.uid, localHolobot),
        holobotId: `pvp-${user.uid}-${localHolobot.name.toLowerCase()}`,
      };
      const opponent = {
        ...buildPlayerFighter(opponentPilot.userId, opponentPilot.holobot),
        holobotId: `pvp-${opponentPilot.userId}-${opponentPilot.holobot.name.toLowerCase()}`,
      };

      persistedBattleIdRef.current = null;
      activeBattleHolobotNameRef.current = localHolobot.name;
      setLatestSetup(null);
      setRoundProgress(null);
      setPvpStatus(null);
      setIsPvpOpen(false);

      startBattle(player, opponent, {
        allowPlayerControl: true,
        battleType: "pvp",
        difficulty: "medium",
        opponentBattleCards: opponentPilot.battleCards,
        opponentHolobotId: opponent.holobotId,
        playerBattleCards: profile.battle_cards,
        playerHolobotId: player.holobotId,
        potentialRewards: {
          exp: 140,
          holos: 120,
          syncPoints: 90,
        },
      });
      setPhase("battle");

      await setDoc(
        doc(db, "pvpRooms", roomId),
        {
          startedAt: serverTimestamp(),
          status: "started",
        },
        { merge: true },
      ).catch(() => undefined);
    },
    [clearQuickMatchEntry, profile, startBattle, stopPvpQueueListener, stopPvpRoomListener, user],
  );

  const watchPvpRoom = useCallback(
    (roomId: string, waitingMessage: string) => {
      stopPvpRoomListener();
      pvpRoomUnsubRef.current = onSnapshot(doc(db, "pvpRooms", roomId), (snapshot) => {
        if (!snapshot.exists()) {
          return;
        }

        const room = snapshot.data() as PvpRoomRecord;
        const players = Object.values(room.players || {});
        if (players.length < 2 || room.status === "waiting") {
          setPvpStatus({
            accent: "#17d9ff",
            message: waitingMessage,
            roomCode: room.code || null,
          });
          return;
        }

        void startPvpBattleFromRoom(roomId, room);
      });
    },
    [startPvpBattleFromRoom, stopPvpRoomListener],
  );

  const handleQuickMatch = useCallback(
    async (selectedHolobot: UserHolobot) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before entering PVP.");
        return;
      }

      startedPvpRoomIdRef.current = null;
      setPvpStatus({
        accent: "#17d9ff",
        message: "Searching the queue for another pilot.",
      });

      await setDoc(
        doc(db, "pvpQueue", user.uid),
        {
          createdAt: serverTimestamp(),
          player: buildPvpPlayer(selectedHolobot),
          status: "waiting",
          userId: user.uid,
        },
        { merge: true },
      );

      stopPvpQueueListener();
      pvpQueueUnsubRef.current = onSnapshot(query(collection(db, "pvpQueue")), (snapshot) => {
        const queue = snapshot.docs.map((entry) => entry.data() as {
          createdAt?: unknown;
          player: PvpStoredPlayer;
          status?: string;
          userId: string;
        });
        const me = queue.find((entry) => entry.userId === user.uid);

        if (!me || me.status !== "waiting") {
          return;
        }

        const opponent = queue.find((entry) => entry.userId !== user.uid && entry.status === "waiting");
        if (!opponent) {
          return;
        }

        const roomId = ["quick", user.uid, opponent.userId].sort().join("_");
        const sortedIds = [user.uid, opponent.userId].sort();

        watchPvpRoom(roomId, "Match found. Syncing both pilots into the arena.");

        if (user.uid !== sortedIds[0]) {
          return;
        }

        void setDoc(
          doc(db, "pvpRooms", roomId),
          {
            createdAt: serverTimestamp(),
            createdBy: user.uid,
            createdClientAt: Date.now(),
            mode: "quick",
            players: {
              [user.uid]: me.player,
              [opponent.userId]: opponent.player,
            },
            status: "ready",
          },
          { merge: true },
        );
      });
    },
    [buildPvpPlayer, profile, stopPvpQueueListener, user, watchPvpRoom],
  );

  const handleCreateFriendRoom = useCallback(
    async (selectedHolobot: UserHolobot, roomCode: string) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before creating a PVP room.");
        return;
      }

      startedPvpRoomIdRef.current = null;
      const normalizedCode = roomCode.trim().toUpperCase();
      const roomId = `friend_${normalizedCode}`;

      await setDoc(
        doc(db, "pvpRooms", roomId),
        {
          code: normalizedCode,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdClientAt: Date.now(),
          mode: "friend",
          players: {
            [user.uid]: buildPvpPlayer(selectedHolobot),
          },
          status: "waiting",
        },
        { merge: true },
      );

      setPvpStatus({
        accent: "#ae4cff",
        message: "Room created. Share this code with your friend and stay ready.",
        roomCode: normalizedCode,
      });
      watchPvpRoom(roomId, "Waiting for your friend to join this room.");
    },
    [buildPvpPlayer, profile, user, watchPvpRoom],
  );

  const handleJoinFriendRoom = useCallback(
    async (selectedHolobot: UserHolobot, roomCode: string) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before joining a PVP room.");
        return;
      }

      const normalizedCode = roomCode.trim().toUpperCase();
      const roomId = `friend_${normalizedCode}`;
      const roomRef = doc(db, "pvpRooms", roomId);
      const roomSnapshot = await getDoc(roomRef);

      if (!roomSnapshot.exists()) {
        Alert.alert("Room Not Found", "That room code is not live yet.");
        return;
      }

      const room = roomSnapshot.data() as PvpRoomRecord;
      const players = room.players || {};
      const playerIds = Object.keys(players);

      if (playerIds.length >= 2 && !players[user.uid]) {
        Alert.alert("Room Full", "That room already has two pilots in it.");
        return;
      }

      await setDoc(
        roomRef,
        {
          players: {
            ...players,
            [user.uid]: buildPvpPlayer(selectedHolobot),
          },
          status: "ready",
        },
        { merge: true },
      );

      setPvpStatus({
        accent: "#17d9ff",
        message: `Joining room ${normalizedCode}. Syncing battle data now.`,
        roomCode: normalizedCode,
      });
      watchPvpRoom(roomId, `Joining room ${normalizedCode}. Syncing battle data now.`);
    },
    [buildPvpPlayer, profile, user, watchPvpRoom],
  );

  const persistBattleOutcome = useCallback(async () => {
    if (!user || !profile || !battleResult || !currentBattle) {
      return;
    }

    if (persistedBattleIdRef.current === currentBattle.battleId) {
      return;
    }

    persistedBattleIdRef.current = currentBattle.battleId;

    const didWin = battleResult.winnerId === currentBattle.player.holobotId;
    const rewardExp = battleResult.rewards.exp;
    const rewardSyncPoints = battleResult.rewards.syncPoints;
    const rewardHolos = battleResult.rewards.holos || 0;
    const rewardBlueprints = battleResult.rewards.blueprintRewards || [];
    const userRef = doc(db, "users", user.uid);
    const selectedHolobotName = activeBattleHolobotNameRef.current;
    const updatedHolobots = (profile.holobots || []).map((holobot) => {
      if (holobot.name !== selectedHolobotName) {
        return holobot;
      }

      return applyHolobotExperience(holobot, rewardExp);
    });
    const updatedBlueprints = { ...(profile.blueprints || {}) };

    for (const reward of rewardBlueprints) {
      updatedBlueprints[reward.holobotKey] = (updatedBlueprints[reward.holobotKey] || 0) + reward.amount;
    }
    const updatedRewardSystem = incrementArenaBattlesToday(profile.rewardSystem);

    try {
      await updateDoc(userRef, {
        blueprints: updatedBlueprints,
        holobots: updatedHolobots,
        holosTokens: (profile.holosTokens || 0) + rewardHolos,
        losses: (profile.stats?.losses || 0) + (didWin ? 0 : 1),
        rewardSystem: updatedRewardSystem,
        syncPoints: (profile.syncPoints || 0) + rewardSyncPoints,
        wins: (profile.stats?.wins || 0) + (didWin ? 1 : 0),
      });
    } catch (error) {
      console.error("[Arena] Failed to persist battle rewards", error);
      Alert.alert("Arena Sync Failed", "The battle finished, but the rewards could not be saved yet.");
    }
  }, [battleResult, currentBattle, profile, user]);

  useEffect(() => {
    if (battleResult && currentBattle) {
      setPhase("results");
      void persistBattleOutcome();
    }
  }, [battleResult, currentBattle, persistBattleOutcome]);

  useEffect(
    () => () => {
      stopPvpQueueListener();
      stopPvpRoomListener();
    },
    [stopPvpQueueListener, stopPvpRoomListener],
  );

  const startTierRound = useCallback(
    async ({ selectedHolobot, tier, paymentMethod, roundIndex }: BattleSetup, shouldChargeEntry: boolean) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before entering the Arena.");
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const nextArenaPasses =
        shouldChargeEntry && paymentMethod === "pass"
          ? Math.max(0, (profile.arena_passes || 0) - 1)
          : profile.arena_passes || 0;
      const nextHolos =
        shouldChargeEntry && paymentMethod === "tokens"
          ? Math.max(0, (profile.holosTokens || 0) - tier.entryFeeHolos)
          : profile.holosTokens || 0;

      if (shouldChargeEntry && paymentMethod === "tokens" && (profile.holosTokens || 0) < tier.entryFeeHolos) {
        Alert.alert("Not Enough Holos", "You do not have enough Holos for this Arena tier.");
        return;
      }

      if (shouldChargeEntry && paymentMethod === "pass" && (profile.arena_passes || 0) <= 0) {
        Alert.alert("No Arena Passes", "You need an Arena Pass or enough Holos to enter.");
        return;
      }

      setIsStartingBattle(true);

      try {
        if (shouldChargeEntry) {
          await updateDoc(userRef, {
            arena_passes: nextArenaPasses,
            holosTokens: nextHolos,
          });
        }

        const player = buildPlayerFighter(user.uid, selectedHolobot);
        const opponent = buildOpponentFighter(tier, selectedHolobot.name, roundIndex);

        persistedBattleIdRef.current = null;
        activeBattleHolobotNameRef.current = selectedHolobot.name;
        setLatestSetup({ paymentMethod, selectedHolobot, tier, roundIndex });
        setRoundProgress({ currentRound: roundIndex + 1, totalRounds: getTierOpponentLineup(tier, selectedHolobot.name).length });
        startBattle(player, opponent, {
          battleType: "pve",
          difficulty: tier.difficulty,
          playerHolobotId: player.holobotId,
          opponentHolobotId: opponent.holobotId,
          allowPlayerControl: true,
          playerBattleCards: profile.battle_cards,
          potentialRewards: getArenaPotentialRewards(tier, opponent.name),
          tier: ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id),
        });
        setPhase("battle");
      } catch (error) {
        console.error("[Arena] Failed to start battle", error);
        Alert.alert("Arena Error", "We couldn't start the battle. Please try again.");
      } finally {
        setIsStartingBattle(false);
      }
    },
    [profile, startBattle, user],
  );

  const handleStartBattle = useCallback(
    async ({ selectedHolobot, tier, paymentMethod }: Omit<BattleSetup, "roundIndex">) => {
      await startTierRound({ selectedHolobot, tier, paymentMethod, roundIndex: 0 }, true);
    },
    [startTierRound],
  );

  const handleExitResults = useCallback(() => {
    resetBattle();
    setPhase("prebattle");
    activeBattleHolobotNameRef.current = null;
    persistedBattleIdRef.current = null;
    setRoundProgress(null);
  }, [resetBattle]);

  const handleRematch = useCallback(async () => {
    const setup = latestSetup;

    resetBattle();
    persistedBattleIdRef.current = null;

    if (!setup) {
      activeBattleHolobotNameRef.current = null;
      setPhase("prebattle");
      return;
    }

    const lineup = getTierOpponentLineup(setup.tier, setup.selectedHolobot.name);
    const didWinLastRound = battleResult?.winnerId === currentBattle?.player.holobotId;
    const nextRoundIndex =
      didWinLastRound && setup.roundIndex < lineup.length - 1 ? setup.roundIndex + 1 : 0;
    const shouldChargeEntry = !(didWinLastRound && setup.roundIndex < lineup.length - 1);

    if (!didWinLastRound) {
      setRoundProgress(null);
    }

    await startTierRound(
      { ...setup, roundIndex: nextRoundIndex },
      shouldChargeEntry,
    );
  }, [battleResult?.winnerId, currentBattle?.player.holobotId, latestSetup, resetBattle, startTierRound]);

  const hasMoreRounds =
    !!latestSetup &&
    !!battleResult &&
    !!currentBattle &&
    battleResult.winnerId === currentBattle.player.holobotId &&
    latestSetup.roundIndex < getTierOpponentLineup(latestSetup.tier, latestSetup.selectedHolobot.name).length - 1;

  return (
    <View style={styles.page}>
      <HomeCogButton onOpenPvp={() => setIsPvpOpen(true)} showSettings={false} showStats={false} />

      {phase === "prebattle" || !currentBattle ? (
        <ArenaPrebattleMenu
          onStartBattle={handleStartBattle}
          userArenaPasses={userArenaPasses}
          userHolobots={holobots}
          userTokens={userTokens}
        />
      ) : null}

      {phase === "battle" && currentBattle ? (
        <BattleArenaView
          battle={currentBattle}
          playerCards={playerCards}
          playableCardIds={playableCardIds}
          selectedCardId={selectedCardId}
          lastAction={lastAction}
          isAnimating={isAnimating}
          onCardSelect={selectCard}
          onCardPlay={(cardId) => {
            if (canPlayCard(cardId)) {
              playCard(cardId);
            }
          }}
          onDefenseToggle={toggleDefenseMode}
        />
      ) : null}

      {phase === "results" && battleResult && currentBattle ? (
        <BattleResultsModal
          visible
          didWin={battleResult.winnerId === currentBattle.player.holobotId}
          rewards={battleResult.rewards}
          continueLabel={hasMoreRounds ? `NEXT ROUND ${latestSetup!.roundIndex + 2}` : "REMATCH"}
          subtitle={roundProgress ? `Round ${roundProgress.currentRound} of ${roundProgress.totalRounds}` : undefined}
          onRematch={handleRematch}
          onExit={handleExitResults}
        />
      ) : null}

      {isStartingBattle ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#f0bf14" />
        </View>
      ) : null}

      <PvpArenaModal
        visible={isPvpOpen}
        onClose={() => setIsPvpOpen(false)}
        onCreateRoom={handleCreateFriendRoom}
        onJoinRoom={handleJoinFriendRoom}
        onQuickMatch={handleQuickMatch}
        statusAccent={pvpStatus?.accent}
        statusMessage={pvpStatus?.message}
        statusRoomCode={pvpStatus?.roomCode}
        userHolobots={holobots}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(5, 6, 6, 0.48)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  page: {
    backgroundColor: "#050606",
    flex: 1,
  },
});
