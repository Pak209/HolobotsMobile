import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

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
import { useArenaTeamBattleStore } from "@/stores/arena-team-battle-store";
import { benchIndexes, getActiveMoves, SEND_IN_DEADLINE_MS, type TeamFighterEntry } from "@/features/arena/teamBattle";
import { resolveCombatKit } from "@/features/arena/moveKits";
import { computeArenaSettlement } from "@/lib/arenaEconomy";
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
    paused,
    resetBattle,
    setPaused,
    startBattle,
    useMove: playMove,
    useSignatureFinisher: playSignature,
  } = useArenaBattleStore();

  const teamStore = useArenaTeamBattleStore();
  const [phase, setPhase] = useState<ArenaPhase>("prebattle");
  const [teamMode, setTeamMode] = useState(false);
  const [teamSetup, setTeamSetup] = useState<{ tier: ArenaTier; teamNames: string[]; battleId: string } | null>(null);
  const teamSettledRef = useRef<string | null>(null);
  const [teamRewards, setTeamRewards] = useState<{ exp: number; syncPoints: number; holos: number } | null>(null);
  const [isStartingBattle, setIsStartingBattle] = useState(false);
  const [isPvpOpen, setIsPvpOpen] = useState(false);
  const [latestSetup, setLatestSetup] = useState<BattleSetup | null>(null);
  const [roundProgress, setRoundProgress] = useState<{ currentRound: number; totalRounds: number } | null>(null);
  const persistedBattleIdRef = useRef<string | null>(null);
  const [runTotals, setRunTotals] = useState({
    exp: 0,
    syncPoints: 0,
    holos: 0,
    blueprints: {} as Record<string, number>,
    rounds: 0,
  });
  const accumulatedBattleIdRef = useRef<string | null>(null);

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
      if (accumulatedBattleIdRef.current !== currentBattle.battleId) {
        accumulatedBattleIdRef.current = currentBattle.battleId;
        const rewards = battleResult.rewards;
        setRunTotals((totals) => ({
          exp: totals.exp + rewards.exp,
          syncPoints: totals.syncPoints + rewards.syncPoints,
          holos: totals.holos + (rewards.holos ?? 0),
          blueprints: (rewards.blueprintRewards ?? []).reduce(
            (acc, reward) => ({ ...acc, [reward.holobotKey]: (acc[reward.holobotKey] ?? 0) + reward.amount }),
            { ...totals.blueprints },
          ),
          rounds: totals.rounds + 1,
        }));
      }
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

      if (roundIndex === 0) {
        setRunTotals({ exp: 0, syncPoints: 0, holos: 0, blueprints: {}, rounds: 0 });
        accumulatedBattleIdRef.current = null;
      }

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

  const handleStart3v3 = useCallback(
    async ({ teamNames, tier, paymentMethod }: { teamNames: [string, string, string]; tier: ArenaTier; paymentMethod: "tokens" | "pass" }) => {
      if (!user || !profile) {
        Alert.alert("Sign In Required", "Please sign in before entering the Arena.");
        return;
      }
      if (paymentMethod === "tokens" && (profile.holosTokens || 0) < tier.entryFeeHolos) {
        Alert.alert("Not Enough Holos", "You do not have enough Holos for this Arena tier.");
        return;
      }
      if (paymentMethod === "pass" && (profile.arena_passes || 0) <= 0) {
        Alert.alert("No Arena Passes", "You need an Arena Pass or enough Holos to enter.");
        return;
      }

      setIsStartingBattle(true);
      try {
        await chargeArenaEntryAuthoritative(profile, user.uid, tier.id, paymentMethod);

        const playerEntries: TeamFighterEntry[] = teamNames.map((name) => {
          const holobot = (profile.holobots || []).find(
            (candidate) => candidate.name.trim().toUpperCase() === name.trim().toUpperCase(),
          );
          if (!holobot) {
            throw new Error(`You do not own ${name}.`);
          }
          return {
            fighter: buildPlayerFighter(user.uid, holobot),
            moves: [
              ...resolveCombatKit({
                savedKitTemplateIds: holobot.combatKit?.slots,
                deckTemplateIds: profile.arena_deck_template_ids,
                ownedBattleCards: profile.battle_cards,
                moveProgress: holobot.moveProgress,
                idPrefix: `p3-${name.toLowerCase()}`,
              }).slots,
            ],
          };
        });

        const lineup = getTierOpponentLineup(tier, teamNames[0]).slice(0, 3);
        const opponentEntries: TeamFighterEntry[] = lineup.map((_, index) => ({
          fighter: buildOpponentFighter(tier, teamNames[0], index),
          moves: [...resolveCombatKit({ idPrefix: `o3-${index}` }).slots],
        }));

        const battleId = `3v3_${tier.id}_${Date.now()}`;
        setTeamSetup({ tier, teamNames, battleId });
        teamSettledRef.current = null;
        setTeamRewards(null);
        setTeamMode(true);
        teamStore.startTeamBattle(playerEntries, opponentEntries, {
          battleType: "pve",
          difficulty: tier.difficulty,
          playerHolobotId: `player-${teamNames[0].toLowerCase()}`,
          allowPlayerControl: true,
          potentialRewards: getArenaPotentialRewards(tier, lineup[0]),
          tier: ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id),
        });
        setPhase("battle");
      } catch (error) {
        console.error("[Arena] Failed to start 3v3", error);
        Alert.alert("Arena Error", error instanceof Error ? error.message : "We couldn't start the battle.");
      } finally {
        setIsStartingBattle(false);
      }
    },
    [profile, teamStore, user],
  );

  // 3v3 settlement: one server settlement per defeated enemy (economically
  // identical to a 3-round tier run), plus a consolation settle on a loss.
  const persist3v3Outcome = useCallback(async () => {
    const team = teamStore.team;
    const result = teamStore.teamResult;
    if (!user || !profile || !team || !result || !teamSetup) return;
    if (teamSettledRef.current === teamSetup.battleId) return;
    teamSettledRef.current = teamSetup.battleId;

    const activePlayerName = team.player.slots[team.player.activeIndex].fighter.name;
    const totals = { exp: 0, syncPoints: 0, holos: 0 };
    const settlements: Array<{ id: string; didWin: boolean; opponentName: string }> = [];

    team.opponent.slots.forEach((slot, index) => {
      if (slot.isKnockedOut) {
        settlements.push({ id: `${teamSetup.battleId}-ko-${index}`, didWin: true, opponentName: slot.fighter.name });
      }
    });
    if (result.winnerSide === "opponent") {
      const survivor = team.opponent.slots.find((slot) => !slot.isKnockedOut);
      settlements.push({
        id: `${teamSetup.battleId}-loss`,
        didWin: false,
        opponentName: survivor?.fighter.name ?? team.opponent.slots[0].fighter.name,
      });
    }

    for (const settlement of settlements) {
      const input = {
        combosCompleted: 0,
        didWin: settlement.didWin,
        opponentName: settlement.opponentName,
        perfectDefenses: 0,
        tierId: teamSetup.tier.id as ArenaTierId,
      };
      const preview = computeArenaSettlement(input);
      if (preview) {
        totals.exp += preview.exp;
        totals.syncPoints += preview.syncPoints;
        totals.holos += preview.holos ?? 0;
      }
      try {
        await settleArenaBattleAuthoritative(profile, user.uid, activePlayerName, settlement.id, input);
      } catch (error) {
        console.error("[Arena] 3v3 settlement failed", error);
      }
    }
    setTeamRewards(totals);
  }, [profile, teamSetup, teamStore.team, teamStore.teamResult, user]);

  useEffect(() => {
    if (teamMode && teamStore.teamResult) {
      setPhase("results");
      void persist3v3Outcome();
    }
  }, [persist3v3Outcome, teamMode, teamStore.teamResult]);

  const handleExitResults = useCallback(() => {
    if (teamMode) {
      teamStore.endBattle();
      setTeamMode(false);
      setTeamSetup(null);
      setTeamRewards(null);
      setPhase("prebattle");
      return;
    }
    resetBattle();
    setPhase("prebattle");
    persistedBattleIdRef.current = null;
    setRoundProgress(null);
  }, [resetBattle, teamMode, teamStore]);

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

  const teamHud = (() => {
    const team = teamStore.team;
    if (!teamMode || !team) return null;
    const now = Date.now();
    const toChips = (side: typeof team.player) =>
      side.slots.map((slot, index) => ({
        index,
        name: slot.fighter.name,
        hpPct: slot.fighter.maxHP > 0 ? Math.max(0, slot.fighter.currentHP / slot.fighter.maxHP) : 0,
        meterPct: Math.max(0, Math.min(1, slot.fighter.specialMeter / 100)),
        isKnockedOut: slot.isKnockedOut,
        isActive: index === side.activeIndex,
      }));

    const playerSendIn =
      team.phase === "awaiting_send_in" && team.pendingSendInSide === "player"
        ? {
            secondsLeft: Math.ceil(((team.sendInDeadline ?? now) - now) / 1000),
            options: benchIndexes(team.player).map((index) => ({
              index,
              name: team.player.slots[index].fighter.name,
              hpPct:
                team.player.slots[index].fighter.maxHP > 0
                  ? team.player.slots[index].fighter.currentHP / team.player.slots[index].fighter.maxHP
                  : 0,
              meterPct: Math.min(1, team.player.slots[index].fighter.specialMeter / 100),
              isKnockedOut: false,
              isActive: false,
            })),
          }
        : null;

    return {
      playerChips: toChips(team.player),
      opponentChips: toChips(team.opponent),
      canSwitchNow: team.phase === "active" && now >= team.player.switchCooldownUntil,
      switchSecondsLeft: Math.max(0, Math.ceil((team.player.switchCooldownUntil - now) / 1000)),
      entryLocked: now < team.player.entryLockUntil,
      onSwitch: teamStore.switchTo,
      sendIn: playerSendIn,
      opponentChoosing: team.phase === "awaiting_send_in" && team.pendingSendInSide === "opponent",
      onSendIn: teamStore.chooseSendIn,
    };
  })();

  const teamAvailability = teamMode ? teamStore.getMoveAvailabilityMap() : null;
  const teamPlayableIds = teamMode ? teamStore.getPlayableMoves().map((move) => move.id) : null;

  return (
    <View style={styles.page}>
      {phase !== "battle" ? <HomeCogButton onOpenPvp={() => setIsPvpOpen(true)} /> : null}

      {phase === "battle" && (currentBattle || teamStore.team) ? (
        <Pressable onPress={() => (teamMode ? teamStore.setPaused(true) : setPaused(true))} style={styles.pauseButton}>
          <Text style={styles.pauseButtonGlyph}>⚙</Text>
        </Pressable>
      ) : null}

      {(teamMode ? teamStore.paused : paused) && phase === "battle" ? (
        <View style={styles.pauseOverlay}>
          <View style={styles.pauseCard}>
            <Text style={styles.pauseEyebrow}>ARENA SETTINGS</Text>
            <Text style={styles.pauseTitle}>Battle Paused</Text>
            <Pressable
              onPress={() => (teamMode ? teamStore.setPaused(false) : setPaused(false))}
              style={styles.pausePrimaryButton}
            >
              <Text style={styles.pausePrimaryText}>CONTINUE BATTLE</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (teamMode) {
                  teamStore.setPaused(false);
                  teamStore.endBattle();
                  setTeamMode(false);
                  setTeamSetup(null);
                  setPhase("prebattle");
                  return;
                }
                setPaused(false);
                resetBattle();
                setPhase("prebattle");
              }}
              style={styles.pauseSecondaryButton}
            >
              <Text style={styles.pauseSecondaryText}>QUIT BATTLE</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === "prebattle" || (!currentBattle && !teamStore.team) ? (
        <ArenaPrebattleMenu
          onStartBattle={handleStartBattle}
          onStart3v3={handleStart3v3}
          userArenaPasses={userArenaPasses}
          userHolobots={holobots}
          userTokens={userTokens}
        />
      ) : null}

      {phase === "battle" && !teamMode && currentBattle ? (
        <BattleArenaView
          battle={currentBattle}
          roundProgress={roundProgress}
          playerCards={playerMoves}
          playableCardIds={playableCardIds}
          cardAvailability={cardAvailability}
          lastAction={lastAction}
          isAnimating={isAnimating}
          onCardPlay={(moveId) => {
            if (canUseMove(moveId)) {
              playMove(moveId);
            }
          }}
          onSignaturePlay={playSignature}
        />
      ) : null}

      {phase === "battle" && teamMode && teamStore.team ? (
        <BattleArenaView
          battle={teamStore.team.duel}
          roundProgress={null}
          playerCards={getActiveMoves(teamStore.team, "player")}
          playableCardIds={teamPlayableIds ?? []}
          cardAvailability={teamAvailability ?? {}}
          lastAction={teamStore.lastAction}
          isAnimating={teamStore.isAnimating}
          onCardPlay={(moveId) => {
            if (teamStore.canUseMove(moveId)) {
              teamStore.useMove(moveId);
            }
          }}
          onSignaturePlay={teamStore.useSignatureFinisher}
          team={teamHud}
        />
      ) : null}

      {phase === "results" && teamMode && teamStore.teamResult ? (
        <BattleResultsModal
          visible
          didWin={teamStore.teamResult.winnerSide === "player"}
          rewards={{
            exp: teamRewards?.exp ?? 0,
            syncPoints: teamRewards?.syncPoints ?? 0,
            holos: teamRewards?.holos ?? 0,
          }}
          subtitle="3V3 SHOWDOWN"
          continueLabel="EXIT ARENA"
          onRematch={handleExitResults}
          onExit={handleExitResults}
        />
      ) : null}

      {phase === "results" && !teamMode && battleResult && currentBattle ? (
        <BattleResultsModal
          visible
          didWin={battleResult.winnerId === currentBattle.player.holobotId}
          rewards={battleResult.rewards}
          runTotals={runTotals}
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
  pauseButton: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderRadius: 22,
    borderWidth: 2,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 14,
    top: 54,
    width: 44,
    zIndex: 40,
  },
  pauseButtonGlyph: {
    color: "#f0bf14",
    fontSize: 20,
  },
  pauseCard: {
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 22,
    width: "80%",
  },
  pauseEyebrow: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  pauseOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.82)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 60,
  },
  pausePrimaryButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    marginTop: 18,
    paddingVertical: 13,
  },
  pausePrimaryText: {
    color: "#07080d",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pauseSecondaryButton: {
    alignItems: "center",
    borderColor: "#3a3f4b",
    borderWidth: 1,
    marginTop: 10,
    paddingVertical: 13,
  },
  pauseSecondaryText: {
    color: "#b7bdc9",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pauseTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
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
