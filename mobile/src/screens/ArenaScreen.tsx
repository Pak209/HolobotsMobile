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
import { useAuth } from "@/contexts/AuthContext";
import { chargeArenaEntryAuthoritative, settleArenaBattleAuthoritative } from "@/lib/arenaClient";
import type { ArenaTierId } from "@/lib/arenaEconomy";
import { useArenaBattleStore } from "@/stores/arena-battle-store";
import type { UserHolobot } from "@/types/profile";

type ArenaPhase = "prebattle" | "battle" | "results";

type BattleSetup = {
  paymentMethod: "tokens" | "pass";
  roundIndex: number;
  selectedHolobot: UserHolobot;
  tier: ArenaTier;
};

export function ArenaScreen() {
  const { profile, user } = useAuth();
  const {
    battleResult,
    canUseMove,
    currentBattle,
    getMoveAvailabilityMap,
    getPlayableMoves,
    isAnimating,
    lastAction,
    playerMoves,
    resetBattle,
    selectedCardId,
    selectCard,
    startBattle,
    useMove: playMove,
    useSignatureFinisher: playSignature,
  } = useArenaBattleStore();

  const [phase, setPhase] = useState<ArenaPhase>("prebattle");
  const [isStartingBattle, setIsStartingBattle] = useState(false);
  const [isPvpOpen, setIsPvpOpen] = useState(false);
  const [latestSetup, setLatestSetup] = useState<BattleSetup | null>(null);
  const [roundProgress, setRoundProgress] = useState<{ currentRound: number; totalRounds: number } | null>(null);
  const persistedBattleIdRef = useRef<string | null>(null);

  const holobots = profile?.holobots ?? [];
  const userTokens = profile?.holosTokens ?? 0;
  const userArenaPasses = profile?.arena_passes ?? 0;
  const playableCardIds = useMemo(
    () => getPlayableMoves().map((move) => move.id),
    [currentBattle, getPlayableMoves],
  );
  const cardAvailability = useMemo(
    () => getMoveAvailabilityMap(),
    [currentBattle, getMoveAvailabilityMap],
  );

  const persistBattleOutcome = useCallback(async () => {
    if (!user || !profile || !battleResult || !currentBattle || !latestSetup) {
      return;
    }

    if (persistedBattleIdRef.current === currentBattle.battleId) {
      return;
    }

    persistedBattleIdRef.current = currentBattle.battleId;

    // The server derives the payout from the tier table plus these
    // performance counts (clamped server-side); reward amounts are no
    // longer sent from the client.
    const didWin = battleResult.winnerId === currentBattle.player.holobotId;
    const perfectDefenses = currentBattle.actionHistory.filter((action) => action.perfectDefense).length;
    const combosCompleted = currentBattle.actionHistory.filter((action) => action.triggeredCombo).length;

    try {
      await settleArenaBattleAuthoritative(
        profile,
        user.uid,
        latestSetup.selectedHolobot.name,
        currentBattle.battleId,
        {
          combosCompleted,
          didWin,
          opponentName: currentBattle.opponent.name,
          perfectDefenses,
          tierId: latestSetup.tier.id as ArenaTierId,
        },
      );
    } catch (error) {
      console.error("[Arena] Failed to persist battle rewards", error);
      Alert.alert("Arena Sync Failed", "The battle finished, but the rewards could not be saved yet.");
    }
  }, [battleResult, currentBattle, latestSetup, profile, user]);

  useEffect(() => {
    if (battleResult && currentBattle) {
      setPhase("results");
      void persistBattleOutcome();
    }
  }, [battleResult, currentBattle, persistBattleOutcome]);

  const startTierRound = useCallback(
    async ({ selectedHolobot, tier, paymentMethod, roundIndex }: BattleSetup, shouldChargeEntry: boolean) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before entering the Arena.");
        return;
      }

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
          await chargeArenaEntryAuthoritative(profile, user.uid, tier.id, paymentMethod);
        }

        const player = buildPlayerFighter(user.uid, selectedHolobot);
        const opponent = buildOpponentFighter(tier, selectedHolobot.name, roundIndex);

        persistedBattleIdRef.current = null;
        setLatestSetup({ paymentMethod, selectedHolobot, tier, roundIndex });
        setRoundProgress({ currentRound: roundIndex + 1, totalRounds: getTierOpponentLineup(tier, selectedHolobot.name).length });
        startBattle(player, opponent, {
          battleType: "pve",
          difficulty: tier.difficulty,
          playerHolobotId: player.holobotId,
          opponentHolobotId: opponent.holobotId,
          allowPlayerControl: true,
          playerBattleCards: profile.battle_cards,
          playerDeckTemplateIds: profile.arena_deck_template_ids,
          playerKitTemplateIds: selectedHolobot.combatKit?.slots,
          playerMoveProgress: selectedHolobot.moveProgress,
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
    persistedBattleIdRef.current = null;
    setRoundProgress(null);
  }, [resetBattle]);

  const handleRematch = useCallback(async () => {
    const setup = latestSetup;

    resetBattle();
    persistedBattleIdRef.current = null;

    if (!setup) {
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
      <HomeCogButton onOpenPvp={() => setIsPvpOpen(true)} />

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
          playerCards={playerMoves}
          playableCardIds={playableCardIds}
          cardAvailability={cardAvailability}
          selectedCardId={selectedCardId}
          lastAction={lastAction}
          isAnimating={isAnimating}
          onCardSelect={selectCard}
          onCardPlay={(moveId) => {
            if (canUseMove(moveId)) {
              playMove(moveId);
            }
          }}
          onSignaturePlay={playSignature}
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
