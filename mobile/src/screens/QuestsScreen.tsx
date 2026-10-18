import { theme } from "@/theme";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useCityProgressionTimers } from "@/hooks/useCityProgressionTimers";
import { useEnergyRegen } from "@/hooks/useEnergyRegen";
import {
  buildQuestCards,
  canTryClaim,
  CITY_QUEST_SLOTS,
  cityBusyHolobots,
  createStartRequestMemo,
  legacyRefusals,
  markLegacyRefused,
  progressionRefusalCopy,
  questStartBlock,
  runStatusLine,
  START_BLOCK_COPY,
  type CityTimers,
  type QuestCard,
} from "@/lib/progressionHost";
import { claimQuestRunInCity, startQuestRunInCity, updateRewardSystemKeys } from "@/lib/progressionHostClient";
import {
  getEligibleQuestHolobots,
  getHolobotPowerScore,
  getQuestDefinition,
  normalizeProgressionSystem,
  QUEST_DEFINITIONS,
  refreshQuestBoard,
} from "@/lib/progressionSystems";

function formatQuestDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

/**
 * Quests run through the City (host #145): SEND asks startQuestRun, which stamps the run with the City's clock and
 * debits the energy; the cards show the City's end time; CLAIM asks claimQuestRun against the City's record. Nothing
 * here writes a run, a timer, a power score or the energy. `timersPreview` is the offline QA harness only.
 */
export function QuestsScreen({ timersPreview }: { timersPreview?: CityTimers } = {}) {
  const { profile, user } = useAuth();
  useEnergyRegen();
  const uid = user?.uid ?? null;
  const timers = useCityProgressionTimers(uid, timersPreview);
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [refusedRevision, setRefusedRevision] = useState(0);
  const starts = useRef(createStartRequestMemo()).current;
  const progression = useMemo(() => normalizeProgressionSystem(profile?.rewardSystem), [profile?.rewardSystem]);
  const cards = useMemo(
    () => buildQuestCards(timers, profile?.rewardSystem, legacyRefusals(uid), nowTick),
    // refusedRevision: a legacy refusal changes legacyRefusals(uid) outside React state.
    [timers, profile?.rewardSystem, uid, nowTick, refusedRevision],
  );
  const cityRuns = timers.status === "ready" ? timers.quests.length : 0;
  const eligibleHolobots = useMemo(() => getEligibleQuestHolobots(profile, cityBusyHolobots(timers)), [profile, timers]);
  const eligibleRoster = useMemo(
    () =>
      mergeHolobotRoster(eligibleHolobots).filter((holobot) =>
        eligibleHolobots.some((candidate) => candidate.name.toUpperCase() === holobot.name.toUpperCase()),
      ),
    [eligibleHolobots],
  );
  const selectedHolobot = eligibleRoster[selectedHolobotIndex] ?? eligibleRoster[0];
  const availableQuests = progression.availableQuestIds.map((questId) => getQuestDefinition(questId));
  const timersNote = timers.status === "ready" ? null : START_BLOCK_COPY[timers.status === "loading" ? "checking" : "unavailable"];

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedHolobot && eligibleRoster.length) {
      setSelectedHolobotIndex(0);
    }
    if (selectedHolobot && !eligibleRoster.some((holobot) => holobot.name === selectedHolobot.name)) {
      setSelectedHolobotIndex(0);
    }
  }, [eligibleRoster, selectedHolobot]);

  const handleRefreshBoard = async () => {
    if (!profile || !uid) return;
    const board = refreshQuestBoard(profile.rewardSystem);
    if (!board) {
      Alert.alert("No Refreshes Left", "Come back tomorrow for more quest refreshes.");
      return;
    }

    try {
      // The board is a client preference: only its three keys are written, never the run copies or mission counters.
      await updateRewardSystemKeys(uid, board);
    } catch (error) {
      Alert.alert("Refresh Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleSendQuest = async (questId: (typeof QUEST_DEFINITIONS)[number]["id"]) => {
    if (busy || !profile || !uid) return;
    const quest = getQuestDefinition(questId);
    const block = questStartBlock(timers, selectedHolobot?.name ?? null, profile.dailyEnergy || 0, quest.energyCost);
    if (block || !selectedHolobot) {
      Alert.alert("Quest not sent", START_BLOCK_COPY[block ?? "no_holobot"]);
      return;
    }

    const ownedHolobot = profile.holobots.find((holobot) => holobot.name.toUpperCase() === selectedHolobot.name.toUpperCase());
    if (!ownedHolobot) return;
    const key = `quest:${questId}:${ownedHolobot.name.toUpperCase()}`;
    setBusy(true);
    try {
      // The City validates the bot, the slots and the energy, debits the energy and stamps the run with its clock.
      await startQuestRunInCity({ questId, holobotName: ownedHolobot.name, requestId: starts.requestIdFor(key) });
      starts.settle(key);
    } catch (error) {
      const copy = progressionRefusalCopy(error, "quest_start");
      // Unknown outcome: keep the request id so a retry is the identical request (the City replays it, never twice).
      if (copy.outcome !== "unknown") starts.settle(key);
      Alert.alert(copy.title, copy.body);
    } finally {
      setBusy(false);
    }
  };

  const handleClaimQuest = async (card: QuestCard) => {
    if (busy || !canTryClaim(card)) return;
    setBusy(true);
    try {
      // The City rolls the outcome at claim time against its own record (a legacy run: only while it still honours them).
      await claimQuestRunInCity(card.runId);
    } catch (error) {
      const copy = progressionRefusalCopy(error, "quest_claim");
      if (copy.outcome === "legacy_refused" && card.source === "legacy") {
        markLegacyRefused(uid, card.runId);
        setRefusedRevision((value) => value + 1);
      }
      Alert.alert(copy.title, copy.body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <HomeCogButton showStats={false} />
      <ScrollView bounces={false} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>QUESTS</Text>
        <Text style={styles.subcopy}>Send your Holobots on quests to earn rewards while you&apos;re away.</Text>

        <View style={styles.topRow}>
          {selectedHolobot ? (
            <Pressable style={styles.selectedHolobotCard} onPress={() => setIsPickerOpen(true)}>
              <GameSurfaceFrame strong />
              <Image source={selectedHolobot.imageSource} style={styles.selectedHolobotImage} resizeMode="contain" />
              <View style={styles.selectedHolobotBody}>
                <Text numberOfLines={1} style={styles.selectedHolobotName}>{selectedHolobot.name}</Text>
                <Text style={styles.selectedHolobotMeta}>{`Lv ${selectedHolobot.level}`}</Text>
                <Text style={styles.selectedHolobotPower}>{`POWER ${getHolobotPowerScore({
                  boostedAttributes: selectedHolobot.boostedAttributes,
                  experience: selectedHolobot.experience,
                  level: selectedHolobot.level,
                  name: selectedHolobot.name,
                  nextLevelExp: selectedHolobot.nextLevelExp,
                  rank: selectedHolobot.rank,
                })}`}</Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.emptyHeroCard}>
              <Text style={styles.emptyHeroTitle}>NO AVAILABLE HOLOBOT</Text>
              <Text style={styles.emptyHeroCopy}>Complete an active quest or mint another Holobot to keep questing.</Text>
            </View>
          )}

          <View style={styles.questCounterCard}>
            <GameSurfaceFrame />
            <Text style={styles.questCounterLabel}>ACTIVE QUESTS</Text>
            <Text style={styles.questCounterValue}>{timers.status === "ready" ? `${cityRuns}/${CITY_QUEST_SLOTS}` : "…"}</Text>
            <Pressable
              disabled={progression.questRefreshesRemaining <= 0}
              onPress={handleRefreshBoard}
              style={[styles.refreshButton, progression.questRefreshesRemaining <= 0 ? styles.disabledAction : null]}
            >
              <Text style={styles.refreshButtonText}>{`REFRESH ${progression.questRefreshesRemaining}/5`}</Text>
            </Pressable>
          </View>
        </View>

        {timersNote ? <Text style={styles.cityNote}>{timersNote}</Text> : null}

        {cards.length ? (
          <View style={styles.activeQuestStack}>
            {cards.map((quest) => {
              const questDefinition = getQuestDefinition(quest.questId);
              const canClaim = canTryClaim(quest) && !busy;
              return (
                <View key={quest.runId} style={styles.activeQuestCard}>
                  <GameSurfaceFrame accent={questDefinition.accent} />
                  <View style={[styles.questBadge, styles.activeQuestBadge, { borderColor: questDefinition.accent }]}>
                    <Text style={[styles.questBadgeText, { color: questDefinition.accent }]}>{questDefinition.difficulty}</Text>
                  </View>
                  <View style={styles.activeQuestBody}>
                    <Text numberOfLines={1} style={[styles.activeQuestTitle, { color: questDefinition.accent }]}>
                      {questDefinition.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.activeSlotMeta}>{quest.holobotName}</Text>
                    <Text style={styles.activeSlotMeta}>{runStatusLine(quest, nowTick)}</Text>
                  </View>
                  <Pressable
                    disabled={!canClaim}
                    onPress={() => void handleClaimQuest(quest)}
                    style={[styles.claimQuestButton, !canClaim ? styles.disabledAction : null]}
                  >
                    <Text style={styles.claimQuestText}>{canTryClaim(quest) ? "CLAIM" : quest.state === "legacy_refused" ? "CLOSED" : "RUNNING"}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.yellowBand}>
          <Text style={styles.yellowBandText}>AVAILABLE QUESTS</Text>
        </View>

        <View style={styles.questStack}>
          {availableQuests.map((quest) => {
            const selectedPower = selectedHolobot
              ? getHolobotPowerScore({
                  boostedAttributes: selectedHolobot.boostedAttributes,
                  experience: selectedHolobot.experience,
                  level: selectedHolobot.level,
                  name: selectedHolobot.name,
                  nextLevelExp: selectedHolobot.nextLevelExp,
                  rank: selectedHolobot.rank,
                })
              : 0;
            // A hint from the City's last record; the City still decides the start.
            const sendBlocked = busy || questStartBlock(timers, selectedHolobot?.name ?? null, profile?.dailyEnergy || 0, quest.energyCost) !== null;

            return (
              <View key={quest.id} style={styles.questCard}>
                <GameSurfaceFrame accent={quest.accent} />
                <View style={[styles.questBadge, { borderColor: quest.accent }]}>
                  <Text style={[styles.questBadgeText, { color: quest.accent }]}>{quest.difficulty}</Text>
                </View>
                <View style={styles.questBody}>
                  <Text numberOfLines={2} style={[styles.questTitle, { color: quest.accent }]}>{quest.title}</Text>
                  <Text numberOfLines={2} style={styles.questSummary}>{quest.summary}</Text>
                </View>
                <View style={styles.questMetaBlock}>
                  <View style={styles.questMetaColumn}>
                    <Text style={styles.questMetaLabel}>TIME</Text>
                    <Text style={styles.questMetaValue}>{formatQuestDuration(quest.durationMinutes)}</Text>
                    <Text style={styles.questMetaLabel}>REWARDS</Text>
                    <View style={styles.questRewardRow}>
                      <Text style={styles.questReward}>{`EXP ${quest.rewards.exp}`}</Text>
                      <Text style={styles.questReward}>{`SP ${quest.rewards.syncPoints}`}</Text>
                      {quest.rewards.itemKey && quest.rewards.itemAmount ? (
                        <Text style={styles.questReward}>{`${quest.rewards.itemKey.toUpperCase()} x${quest.rewards.itemAmount}`}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.questActionColumn}>
                    <Text style={styles.questMetaLabel}>REC. POWER</Text>
                    <Text style={[styles.questPowerValue, selectedPower >= quest.recommendedPower ? styles.powerReady : styles.powerLow]}>
                      {quest.recommendedPower.toLocaleString()}
                    </Text>
                    <Text style={styles.questEnergyCost}>{`${quest.energyCost} ENERGY`}</Text>
                    <Pressable
                      disabled={sendBlocked}
                      onPress={() => void handleSendQuest(quest.id)}
                      style={[styles.sendButton, sendBlocked ? styles.disabledAction : null]}
                    >
                      <Text style={styles.sendButtonText}>SEND</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <HolobotPickerModal
        onClose={() => setIsPickerOpen(false)}
        onSelect={(index) => {
          setSelectedHolobotIndex(index);
          setIsPickerOpen(false);
        }}
        roster={eligibleRoster}
        selectedIndex={selectedHolobotIndex}
        visible={isPickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  activeQuestBadge: {
    height: 48,
    width: 48,
  },
  activeQuestBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  activeQuestCard: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 10,
    minHeight: 74,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 7,
    position: "relative",
  },
  activeQuestStack: {
    gap: 6,
  },
  cityNote: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    textAlign: "center",
  },
  activeQuestTitle: {
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
  },
  activeSlotCard: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 2,
    flex: 1,
    minHeight: 108,
    padding: 8,
  },
  activeSlotDifficulty: {
    color: theme.colors.success,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    marginTop: 2,
  },
  activeSlotMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    marginTop: 4,
  },
  activeSlotTitle: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
  },
  claimQuestButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    marginTop: "auto",
    minHeight: 26,
  },
  claimQuestText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
  },
  content: {
    backgroundColor: theme.colors.carbon,
    gap: 8,
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 96,
  },
  disabledAction: {
    opacity: 0.4,
  },
  emptyHeroCard: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 2,
    flex: 1,
    minHeight: 96,
    padding: 10,
  },
  emptyHeroCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
  },
  emptyHeroTitle: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontStyle: "italic",
    fontWeight: "900",
    marginTop: 4,
  },
  page: {
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  powerLow: {
    color: "#ff7474",
  },
  powerReady: {
    color: theme.colors.success,
  },
  questBadge: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 2,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  questBadgeText: {
    fontFamily: "HoloBody",
    fontSize: 7,
    fontWeight: "900",
    textAlign: "center",
  },
  questBody: {
    flex: 1,
    gap: 3,
    minWidth: 0,
    paddingRight: 2,
  },
  questCard: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 8,
    minHeight: 96,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 7,
    position: "relative",
    width: "100%",
  },
  questCounterCard: {
    backgroundColor: "transparent",
    justifyContent: "space-between",
    minHeight: 96,
    overflow: "hidden",
    padding: 10,
    position: "relative",
    width: 116,
  },
  questCounterLabel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  questCounterValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 24,
    fontWeight: "900",
  },
  questActionColumn: {
    alignItems: "stretch",
    borderLeftColor: theme.colors.carbon,
    borderLeftWidth: 1,
    justifyContent: "center",
    paddingLeft: 6,
    width: 84,
  },
  questEnergyCost: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "center",
  },
  questMetaBlock: {
    borderLeftColor: theme.colors.carbon,
    borderLeftWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingLeft: 6,
    width: 154,
  },
  questMetaColumn: {
    flex: 1,
    justifyContent: "center",
  },
  questMetaLabel: {
    color: theme.colors.subtle,
    fontFamily: "HoloBody",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  questMetaValue: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    marginBottom: 5,
  },
  questPowerValue: {
    fontFamily: "HoloBody",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  questStack: {
    gap: 8,
  },
  questReward: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
  },
  questRewardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  questSummary: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    lineHeight: 13,
  },
  questTitle: {
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 15,
  },
  refreshButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    minHeight: 28,
  },
  refreshButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
  },
  selectedHolobotBody: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  selectedHolobotCard: {
    backgroundColor: "transparent",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 96,
    overflow: "hidden",
    padding: 8,
    position: "relative",
  },
  selectedHolobotImage: {
    height: 74,
    width: 64,
  },
  selectedHolobotMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    marginTop: 1,
  },
  selectedHolobotName: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  selectedHolobotPower: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
    marginTop: 6,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    marginTop: 6,
    minHeight: 30,
  },
  sendButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
  },
  subcopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 2,
    maxWidth: 250,
  },
  topRow: {
    flexDirection: "row",
    gap: 8,
  },
  yellowBand: {
    backgroundColor: theme.colors.accent,
    marginHorizontal: -18,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  yellowBandText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: "900",
  },
});
