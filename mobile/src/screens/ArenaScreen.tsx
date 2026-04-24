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
import { collection, db, doc, onSnapshot, query, serverTimestamp, updateDoc } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { incrementArenaBattlesToday } from "@/lib/dailyMissions";
import { computeLeaderboardScore } from "@/lib/profile";
import { getSyncRank } from "@/lib/syncProgression";
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

type PvpPresence = {
  battleCards: Record<string, number>;
  holobot: UserHolobot;
  mode: "friend-guest" | "friend-host" | "quick";
  opponentUserId?: string;
  roomCode?: string;
  roomId: string;
  status: "in-battle" | "ready" | "waiting";
  updatedAt?: unknown;
  userId: string;
  username: string;
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

  const clearOwnPvpPresence = useCallback(async () => {
    if (!user) {
      return;
    }

    await updateDoc(doc(db, "users", user.uid), {
      pvpPresence: null,
    }).catch(() => undefined);
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

  const updateOwnPvpPresence = useCallback(
    async (presence: Omit<PvpPresence, "updatedAt" | "userId" | "username">) => {
      if (!user || !profile) {
        throw new Error("You must be signed in before entering PVP.");
      }

      await updateDoc(doc(db, "users", user.uid), {
        pvpPresence: {
          ...presence,
          updatedAt: serverTimestamp(),
          userId: user.uid,
          username: profile.username || "Pilot",
        },
      });
    },
    [profile, user],
  );

  const startPvpBattleFromRoom = useCallback(
    async (roomId: string, myPresence: PvpPresence, opponentPresence: PvpPresence) => {
      if (!user || !profile || startedPvpRoomIdRef.current === roomId) {
        return;
      }

      const localHolobot =
        profile.holobots?.find((holobot) => holobot.name.toUpperCase() === myPresence.holobot.name.toUpperCase()) ||
        myPresence.holobot;

      startedPvpRoomIdRef.current = roomId;
      stopPvpQueueListener();
      stopPvpRoomListener();

      const player = {
        ...buildPlayerFighter(user.uid, localHolobot),
        holobotId: `pvp-${user.uid}-${localHolobot.name.toLowerCase()}`,
      };
      const opponent = {
        ...buildPlayerFighter(opponentPresence.userId, opponentPresence.holobot),
        holobotId: `pvp-${opponentPresence.userId}-${opponentPresence.holobot.name.toLowerCase()}`,
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
        opponentBattleCards: opponentPresence.battleCards,
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

      await updateOwnPvpPresence({
        ...myPresence,
        status: "in-battle",
      }).catch(() => undefined);
    },
    [profile, startBattle, stopPvpQueueListener, stopPvpRoomListener, updateOwnPvpPresence, user],
  );

  const watchPvpRoom = useCallback(
    (roomId: string, waitingMessage: string, roomCode?: string) => {
      if (!user) {
        return;
      }

      stopPvpRoomListener();
      pvpRoomUnsubRef.current = onSnapshot(query(collection(db, "users")), (snapshot) => {
        const users = snapshot.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data() as { pvpPresence?: PvpPresence }),
        }));
        const me = users.find((entry) => entry.id === user.uid)?.pvpPresence;

        if (!me || me.roomId !== roomId) {
          return;
        }

        if (!me.opponentUserId) {
          const waitingOpponent = users
            .filter((entry) => entry.id !== user.uid)
            .map((entry) => entry.pvpPresence)
            .find((presence) => presence?.roomId === roomId && presence.status !== "waiting" ? true : presence?.roomId === roomId);

          if (waitingOpponent) {
            void updateOwnPvpPresence({
              ...me,
              opponentUserId: waitingOpponent.userId,
              status: "ready",
            }).catch(() => undefined);
          } else {
            setPvpStatus({
              accent: roomCode ? "#ae4cff" : "#17d9ff",
              message: waitingMessage,
              roomCode: roomCode || null,
            });
          }
          return;
        }

        const opponent = users
          .filter((entry) => entry.id !== user.uid)
          .map((entry) => entry.pvpPresence)
          .find((presence) => presence?.roomId === roomId && presence.userId === me.opponentUserId);

        if (!opponent || (opponent.status !== "ready" && opponent.status !== "in-battle")) {
          setPvpStatus({
            accent: roomCode ? "#ae4cff" : "#17d9ff",
            message: waitingMessage,
            roomCode: roomCode || null,
          });
          return;
        }

        if (me.status === "waiting") {
          void updateOwnPvpPresence({
            ...me,
            status: "ready",
          }).catch(() => undefined);
          return;
        }

        if (me.status === "ready" || me.status === "in-battle") {
          void startPvpBattleFromRoom(roomId, me, opponent);
        }
      });
    },
    [startPvpBattleFromRoom, stopPvpRoomListener, updateOwnPvpPresence, user],
  );

  const handleQuickMatch = useCallback(
    async (selectedHolobot: UserHolobot) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before entering PVP.");
        return;
      }

      try {
        startedPvpRoomIdRef.current = null;
        setPvpStatus({
          accent: "#17d9ff",
          message: "Searching the queue for another pilot.",
        });

        await updateOwnPvpPresence({
          ...buildPvpPlayer(selectedHolobot),
          mode: "quick",
          roomId: `quick_wait_${user.uid}`,
          status: "waiting",
        });

        stopPvpQueueListener();
        pvpQueueUnsubRef.current = onSnapshot(query(collection(db, "users")), (snapshot) => {
          const users = snapshot.docs.map((entry) => ({
            id: entry.id,
            ...(entry.data() as { pvpPresence?: PvpPresence }),
          }));
          const me = users.find((entry) => entry.id === user.uid)?.pvpPresence;

          if (!me || me.mode !== "quick" || me.status === "in-battle") {
            return;
          }

          if (me.opponentUserId && me.roomId.startsWith("quick_")) {
            watchPvpRoom(me.roomId, "Match found. Syncing both pilots into the arena.");
            return;
          }

          const opponent = users
            .filter((entry) => entry.id !== user.uid)
            .map((entry) => entry.pvpPresence)
            .find((presence) => presence?.mode === "quick" && presence.status === "waiting");

          if (!opponent) {
            return;
          }

          const roomId = `quick_${[user.uid, opponent.userId].sort().join("_")}`;
          void updateOwnPvpPresence({
            ...me,
            opponentUserId: opponent.userId,
            roomId,
            status: "ready",
          }).catch((error) => {
            console.error("[Arena] Quick match ready failed", error);
          });

          watchPvpRoom(roomId, "Match found. Syncing both pilots into the arena.");
        });
      } catch (error) {
        console.error("[Arena] Quick match failed", error);
        Alert.alert("Quick Match Failed", error instanceof Error ? error.message : "Please try again.");
      }
    },
    [buildPvpPlayer, profile, stopPvpQueueListener, updateOwnPvpPresence, user, watchPvpRoom],
  );

  const handleCreateFriendRoom = useCallback(
    async (selectedHolobot: UserHolobot, roomCode: string) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before creating a PVP room.");
        return;
      }

      try {
        startedPvpRoomIdRef.current = null;
        const normalizedCode = roomCode.trim().toUpperCase();
        const roomId = `friend_${normalizedCode}`;

        await updateOwnPvpPresence({
          ...buildPvpPlayer(selectedHolobot),
          mode: "friend-host",
          roomCode: normalizedCode,
          roomId,
          status: "waiting",
        });

        setPvpStatus({
          accent: "#ae4cff",
          message: "Room created. Share this code with your friend and stay ready.",
          roomCode: normalizedCode,
        });
        watchPvpRoom(roomId, "Waiting for your friend to join this room.", normalizedCode);
      } catch (error) {
        console.error("[Arena] Create friend room failed", error);
        Alert.alert("Create Room Failed", error instanceof Error ? error.message : "Please try again.");
      }
    },
    [buildPvpPlayer, profile, updateOwnPvpPresence, user, watchPvpRoom],
  );

  const handleJoinFriendRoom = useCallback(
    async (selectedHolobot: UserHolobot, roomCode: string) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before joining a PVP room.");
        return;
      }

      try {
        const normalizedCode = roomCode.trim().toUpperCase();
        const roomId = `friend_${normalizedCode}`;

        stopPvpQueueListener();
        stopPvpRoomListener();

        pvpRoomUnsubRef.current = onSnapshot(query(collection(db, "users")), (snapshot) => {
          const users = snapshot.docs.map((entry) => ({
            id: entry.id,
            ...(entry.data() as { pvpPresence?: PvpPresence }),
          }));
          const host = users
            .filter((entry) => entry.id !== user.uid)
            .map((entry) => entry.pvpPresence)
            .find(
              (presence) =>
                presence?.mode === "friend-host" &&
                presence.roomCode === normalizedCode &&
                (presence.status === "waiting" || presence.status === "ready" || presence.status === "in-battle"),
            );

          if (!host) {
            setPvpStatus({
              accent: "#17d9ff",
              message: `Looking for room ${normalizedCode}.`,
              roomCode: normalizedCode,
            });
            return;
          }

          void updateOwnPvpPresence({
            ...buildPvpPlayer(selectedHolobot),
            mode: "friend-guest",
            opponentUserId: host.userId,
            roomCode: normalizedCode,
            roomId,
            status: "ready",
          }).catch((error) => {
            console.error("[Arena] Join room failed", error);
          });

          watchPvpRoom(roomId, `Joining room ${normalizedCode}. Syncing battle data now.`, normalizedCode);
        });
      } catch (error) {
        console.error("[Arena] Join friend room failed", error);
        Alert.alert("Join Room Failed", error instanceof Error ? error.message : "Please try again.");
      }
    },
    [buildPvpPlayer, profile, stopPvpQueueListener, stopPvpRoomListener, updateOwnPvpPresence, user, watchPvpRoom],
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
    const nextWins = (profile.stats?.wins || 0) + (didWin ? 1 : 0);
    const nextLosses = (profile.stats?.losses || 0) + (didWin ? 0 : 1);
    const nextSyncPoints = (profile.syncPoints || 0) + rewardSyncPoints;
    const nextLifetimeSyncPoints = (profile.lifetimeSyncPoints || 0) + rewardSyncPoints;
    const nextSeasonSyncPoints = (profile.seasonSyncPoints || 0) + rewardSyncPoints;
    const nextLeaderboardScore = computeLeaderboardScore({
      holobots: updatedHolobots,
      prestigeCount: profile.prestigeCount || 0,
      seasonSyncPoints: nextSeasonSyncPoints,
      wins: nextWins,
    });

    try {
      await updateDoc(userRef, {
        blueprints: updatedBlueprints,
        holobots: updatedHolobots,
        holosTokens: (profile.holosTokens || 0) + rewardHolos,
        leaderboardScore: nextLeaderboardScore,
        lifetimeSyncPoints: nextLifetimeSyncPoints,
        losses: nextLosses,
        rewardSystem: updatedRewardSystem,
        seasonSyncPoints: nextSeasonSyncPoints,
        syncRank: getSyncRank(nextLifetimeSyncPoints),
        syncPoints: nextSyncPoints,
        wins: nextWins,
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
      void clearOwnPvpPresence();
    },
    [clearOwnPvpPresence, stopPvpQueueListener, stopPvpRoomListener],
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
    setPvpStatus(null);
    void clearOwnPvpPresence();
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
      {phase === "prebattle" ? (
        <HomeCogButton onOpenPvp={() => setIsPvpOpen(true)} showSettings={false} showStats={false} />
      ) : null}

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
          roundProgress={roundProgress}
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
