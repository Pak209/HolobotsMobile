import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import {
  claimQuestRun,
  getEligibleQuestHolobots,
  getHolobotPowerScore,
  getQuestDefinition,
  isSessionComplete,
  normalizeProgressionSystem,
  QUEST_DEFINITIONS,
  refreshQuestBoard,
  startQuestRun,
} from "@/lib/progressionSystems";
import { computeLeaderboardScore } from "@/lib/profile";
import { getSyncRank } from "@/lib/syncProgression";

function formatQuestDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

function formatRemaining(endsAt: string, nowTick: number) {
  const remainingMs = Math.max(0, new Date(endsAt).getTime() - nowTick);
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

export function QuestsScreen() {
  const { profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const progression = useMemo(() => normalizeProgressionSystem(profile?.rewardSystem), [profile?.rewardSystem]);
  const eligibleHolobots = useMemo(() => getEligibleQuestHolobots(profile), [profile]);
  const eligibleRoster = useMemo(
    () =>
      mergeHolobotRoster(eligibleHolobots).filter((holobot) =>
        eligibleHolobots.some((candidate) => candidate.name.toUpperCase() === holobot.name.toUpperCase()),
      ),
    [eligibleHolobots],
  );
  const selectedHolobot = eligibleRoster[selectedHolobotIndex] ?? eligibleRoster[0];
  const availableQuests = progression.availableQuestIds.map((questId) => getQuestDefinition(questId));

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
    if (!profile) return;
    if (progression.questRefreshesRemaining <= 0) {
      Alert.alert("No Refreshes Left", "Come back tomorrow for more quest refreshes.");
      return;
    }

    try {
      await updateProfile({
        rewardSystem: refreshQuestBoard(profile.rewardSystem),
      });
    } catch (error) {
      Alert.alert("Refresh Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleSendQuest = async (questId: (typeof QUEST_DEFINITIONS)[number]["id"]) => {
    if (!profile || !selectedHolobot) {
      Alert.alert("Select a Holobot", "Choose a Holobot to send on this quest first.");
      return;
    }

    if (progression.activeQuests.length >= 3) {
      Alert.alert("Quest Slots Full", "Complete or claim an active quest before sending another Holobot.");
      return;
    }

    const ownedHolobot = profile.holobots.find((holobot) => holobot.name.toUpperCase() === selectedHolobot.name.toUpperCase());
    if (!ownedHolobot) return;
    const quest = getQuestDefinition(questId);

    if ((profile.dailyEnergy || 0) < quest.energyCost) {
      Alert.alert("Not Enough Energy", `You need ${quest.energyCost} energy to send this quest.`);
      return;
    }

    try {
      await updateProfile({
        dailyEnergy: Math.max(0, (profile.dailyEnergy || 0) - quest.energyCost),
        rewardSystem: startQuestRun(profile.rewardSystem, ownedHolobot, questId),
      });
    } catch (error) {
      Alert.alert("Quest Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleClaimQuest = async (questIndex: number) => {
    if (!profile?.holobots) return;
    const quest = progression.activeQuests[questIndex];
    if (!quest || !isSessionComplete(quest.endsAt, new Date(nowTick))) {
      return;
    }

    const claimResult = claimQuestRun(profile.holobots, profile.inventory, profile.syncPoints || 0, quest);
    const nextRewardSystem = {
      ...progression,
      activeQuests: progression.activeQuests.filter((entry) => entry.id !== quest.id),
    };
    const earnedSyncPoints = Math.max(0, claimResult.syncPoints - (profile.syncPoints || 0));
    const nextLifetimeSyncPoints = (profile.lifetimeSyncPoints || 0) + earnedSyncPoints;
    const nextSeasonSyncPoints = (profile.seasonSyncPoints || 0) + earnedSyncPoints;

    try {
      await updateProfile({
        holobots: claimResult.holobots,
        inventory: claimResult.inventory,
        lifetimeSyncPoints: nextLifetimeSyncPoints,
        leaderboardScore: computeLeaderboardScore({
          holobots: claimResult.holobots,
          prestigeCount: profile.prestigeCount,
          seasonSyncPoints: nextSeasonSyncPoints,
          wins: profile.stats?.wins,
        }),
        rewardSystem: nextRewardSystem,
        seasonSyncPoints: nextSeasonSyncPoints,
        syncRank: getSyncRank(nextLifetimeSyncPoints),
        syncPoints: claimResult.syncPoints,
      });
    } catch (error) {
      Alert.alert("Claim Failed", error instanceof Error ? error.message : "Please try again.");
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
            <Text style={styles.questCounterLabel}>ACTIVE QUESTS</Text>
            <Text style={styles.questCounterValue}>{`${progression.activeQuests.length}/3`}</Text>
            <Pressable
              disabled={progression.questRefreshesRemaining <= 0}
              onPress={handleRefreshBoard}
              style={[styles.refreshButton, progression.questRefreshesRemaining <= 0 ? styles.disabledAction : null]}
            >
              <Text style={styles.refreshButtonText}>{`REFRESH ${progression.questRefreshesRemaining}/5`}</Text>
            </Pressable>
          </View>
        </View>

        {progression.activeQuests.length ? (
          <View style={styles.activeQuestStack}>
            {progression.activeQuests.map((quest, index) => {
              const questDefinition = getQuestDefinition(quest.questId);
              const isReady = isSessionComplete(quest.endsAt, new Date(nowTick));
              return (
                <View key={quest.id} style={styles.activeQuestCard}>
                  <View style={[styles.questBadge, styles.activeQuestBadge, { borderColor: questDefinition.accent }]}>
                    <Text style={[styles.questBadgeText, { color: questDefinition.accent }]}>{questDefinition.difficulty}</Text>
                  </View>
                  <View style={styles.activeQuestBody}>
                    <Text numberOfLines={1} style={[styles.activeQuestTitle, { color: questDefinition.accent }]}>
                      {questDefinition.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.activeSlotMeta}>{quest.holobotName}</Text>
                    <Text style={styles.activeSlotMeta}>
                      {isReady ? "READY TO CLAIM" : `TIME ${formatRemaining(quest.endsAt, nowTick)}`}
                    </Text>
                  </View>
                  <Pressable
                    disabled={!isReady}
                    onPress={() => handleClaimQuest(index)}
                    style={[styles.claimQuestButton, !isReady ? styles.disabledAction : null]}
                  >
                    <Text style={styles.claimQuestText}>{isReady ? "CLAIM" : "RUNNING"}</Text>
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

            return (
              <View key={quest.id} style={styles.questCard}>
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
                      disabled={!selectedHolobot || progression.activeQuests.length >= 3 || (profile?.dailyEnergy || 0) < quest.energyCost}
                      onPress={() => handleSendQuest(quest.id)}
                      style={[
                        styles.sendButton,
                        (!selectedHolobot || progression.activeQuests.length >= 3 || (profile?.dailyEnergy || 0) < quest.energyCost)
                          ? styles.disabledAction
                          : null,
                      ]}
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
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 10,
    minHeight: 74,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  activeQuestStack: {
    gap: 6,
  },
  activeQuestTitle: {
    fontSize: 14,
    fontWeight: "900",
  },
  activeSlotCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flex: 1,
    minHeight: 108,
    padding: 8,
  },
  activeSlotDifficulty: {
    color: "#7ee467",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 2,
  },
  activeSlotMeta: {
    color: "#ddd2b5",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  activeSlotTitle: {
    color: "#fef1e0",
    fontSize: 12,
    fontWeight: "900",
  },
  claimQuestButton: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    marginTop: "auto",
    minHeight: 26,
  },
  claimQuestText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
  },
  content: {
    backgroundColor: "#050606",
    gap: 8,
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 96,
  },
  disabledAction: {
    opacity: 0.4,
  },
  emptyHeroCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flex: 1,
    minHeight: 96,
    padding: 10,
  },
  emptyHeroCopy: {
    color: "#ddd2b5",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
  },
  emptyHeroTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 18,
    fontStyle: "italic",
    fontWeight: "900",
    marginTop: 4,
  },
  page: {
    backgroundColor: "#050606",
    flex: 1,
  },
  powerLow: {
    color: "#ff7474",
  },
  powerReady: {
    color: "#7ee467",
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
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 8,
    minHeight: 96,
    paddingHorizontal: 8,
    paddingVertical: 7,
    width: "100%",
  },
  questCounterCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    justifyContent: "space-between",
    minHeight: 96,
    padding: 10,
    width: 116,
  },
  questCounterLabel: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  questCounterValue: {
    color: "#fef1e0",
    fontSize: 24,
    fontWeight: "900",
  },
  questActionColumn: {
    alignItems: "stretch",
    borderLeftColor: "#242424",
    borderLeftWidth: 1,
    justifyContent: "center",
    paddingLeft: 6,
    width: 84,
  },
  questEnergyCost: {
    color: "#ddd2b5",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "center",
  },
  questMetaBlock: {
    borderLeftColor: "#242424",
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
    color: "#8f866f",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  questMetaValue: {
    color: "#fef1e0",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 5,
  },
  questPowerValue: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  questStack: {
    gap: 8,
  },
  questReward: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "900",
  },
  questRewardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  questSummary: {
    color: "#ddd2b5",
    fontSize: 10,
    lineHeight: 13,
  },
  questTitle: {
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 15,
  },
  refreshButton: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    minHeight: 28,
  },
  refreshButtonText: {
    color: "#050606",
    fontSize: 10,
    fontWeight: "900",
  },
  selectedHolobotBody: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  selectedHolobotCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 96,
    padding: 8,
  },
  selectedHolobotImage: {
    height: 74,
    width: 64,
  },
  selectedHolobotMeta: {
    color: "#d9d2bd",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  selectedHolobotName: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  selectedHolobotPower: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 6,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    marginTop: 6,
    minHeight: 30,
  },
  sendButtonText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
  },
  subcopy: {
    color: "#d1c7ad",
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
    backgroundColor: "#f0bf14",
    marginHorizontal: -18,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  yellowBandText: {
    color: "#050606",
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: "900",
  },
});
