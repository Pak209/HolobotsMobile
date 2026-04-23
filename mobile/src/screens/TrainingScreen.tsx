import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { getExpProgress, getHolobotDisplayStats, mergeHolobotRoster, normalizeUserHolobot } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import {
  claimTrainingSession,
  getTrainingCourse,
  isSessionComplete,
  normalizeProgressionSystem,
  startTrainingSession,
  TRAINING_COURSES,
} from "@/lib/progressionSystems";

function formatCountdown(endsAt: string, nowTick: number) {
  const remainingMs = Math.max(0, new Date(endsAt).getTime() - nowTick);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TrainingScreen() {
  const { profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots).filter((holobot) => holobot.owned), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const progression = useMemo(() => normalizeProgressionSystem(profile?.rewardSystem), [profile?.rewardSystem]);
  const activeTraining = progression.activeTraining;
  const trainingComplete = activeTraining ? isSessionComplete(activeTraining.endsAt, new Date(nowTick)) : false;
  const canRefill = (profile?.energy_refills || 0) > 0 && (profile?.dailyEnergy || 0) < (profile?.maxDailyEnergy || 100);
  const actualStats = selectedHolobot
    ? getHolobotDisplayStats(selectedHolobot.name, selectedHolobot.level, selectedHolobot.boostedAttributes)
    : null;

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedHolobot) {
      setSelectedHolobotIndex(0);
    }
  }, [selectedHolobot]);

  const handleStartTraining = async (courseId: (typeof TRAINING_COURSES)[number]["id"]) => {
    if (!profile || !selectedHolobot) {
      return;
    }

    if (activeTraining && !trainingComplete) {
      Alert.alert("Training In Progress", "Finish the current training session before starting another course.");
      return;
    }

    const ownedHolobot = profile.holobots.find((holobot) => holobot.name.toUpperCase() === selectedHolobot.name.toUpperCase());
    if (!ownedHolobot) {
      return;
    }

    const course = getTrainingCourse(courseId);
    if ((profile.dailyEnergy || 0) < course.energyCost) {
      Alert.alert("Not Enough Energy", `You need ${course.energyCost} energy for ${course.attributeLabel} training.`);
      return;
    }

    try {
      await updateProfile({
        dailyEnergy: Math.max(0, (profile.dailyEnergy || 0) - course.energyCost),
        rewardSystem: startTrainingSession(profile.rewardSystem, normalizeUserHolobot(ownedHolobot), courseId),
      });
    } catch (error) {
      Alert.alert("Training Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleClaimTraining = async () => {
    if (!profile?.holobots || !activeTraining || !trainingComplete) {
      return;
    }

    const nextRewardSystem = {
      ...progression,
      activeTraining: null,
    };

    try {
      await updateProfile({
        holobots: claimTrainingSession(profile.holobots, activeTraining),
        rewardSystem: nextRewardSystem,
      });
    } catch (error) {
      Alert.alert("Claim Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleToggleSyncBoost = async () => {
    if (!profile) {
      return;
    }

    try {
      await updateProfile({
        rewardSystem: {
          ...progression,
          syncBoostEnabled: !progression.syncBoostEnabled,
        },
      });
    } catch (error) {
      Alert.alert("Update Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleQuickRefill = async () => {
    if (!profile || !canRefill) {
      return;
    }

    try {
      await updateProfile({
        dailyEnergy: profile.maxDailyEnergy || 100,
        energy_refills: Math.max(0, (profile.energy_refills || 0) - 1),
      });
    } catch (error) {
      Alert.alert("Refill Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <View style={styles.page}>
      <HomeCogButton showStats={false} />
      <ScrollView bounces={false} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>TRAINING</Text>
        <Text style={styles.subcopy}>Choose a training course to focus your Holobot&apos;s growth.</Text>

        {selectedHolobot ? (
          <Pressable style={styles.heroCard} onPress={() => setIsPickerOpen(true)}>
            <Image source={selectedHolobot.imageSource} style={styles.heroImage} resizeMode="contain" />
            <View style={styles.heroContent}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroTitleBlock}>
                  <Text style={styles.heroName}>{selectedHolobot.name}</Text>
                  <Text style={styles.heroMeta}>{`Lv ${selectedHolobot.level}   EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
                </View>
                <View style={styles.energyBox}>
                  <Text style={styles.energyLabel}>ENERGY</Text>
                  <View style={styles.energyRow}>
                    <Text style={styles.energyValue}>{`${profile?.dailyEnergy || 0}/${profile?.maxDailyEnergy || 100}`}</Text>
                    <Pressable
                      disabled={!canRefill}
                      onPress={handleQuickRefill}
                      style={[styles.energyRefillButton, !canRefill ? styles.disabledAction : null]}
                    >
                      <Text style={styles.energyRefillText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
              <View style={styles.expTrack}>
                <View style={[styles.expFill, { width: `${getExpProgress(selectedHolobot) * 100}%` }]} />
              </View>
              <View style={styles.statsRow}>
                <View>
                  <Text style={styles.statLabel}>HP</Text>
                  <Text style={[styles.statValue, { color: "#7ee467" }]}>{actualStats?.hp ?? 0}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>ATK</Text>
                  <Text style={[styles.statValue, { color: "#ff5d3f" }]}>{actualStats?.attack ?? 0}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>DEF</Text>
                  <Text style={[styles.statValue, { color: "#4da7ff" }]}>{actualStats?.defense ?? 0}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>SPD</Text>
                  <Text style={[styles.statValue, { color: "#ffd44d" }]}>{actualStats?.speed ?? 0}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>SPC</Text>
                  <Text style={[styles.statValue, { color: "#b280ff" }]}>{actualStats?.special ?? 0}</Text>
                </View>
              </View>
            </View>
          </Pressable>
        ) : null}

        {activeTraining ? (
          <View style={styles.activePanel}>
            <Text style={styles.sectionTitle}>ACTIVE TRAINING</Text>
            <Text style={styles.activeCopy}>
              {`${activeTraining.holobotName} is in ${getTrainingCourse(activeTraining.courseId).attributeLabel} training.`}
            </Text>
            <Text style={styles.activeCountdown}>
              {trainingComplete ? "READY TO CLAIM" : formatCountdown(activeTraining.endsAt, nowTick)}
            </Text>
            <Text style={styles.activeRewards}>
              {`EXP +${activeTraining.expReward}  •  BOOST ${Object.entries(activeTraining.statBoosts)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key.toUpperCase()} +${value}`)
                .join("  •  ")}`}
            </Text>
            {trainingComplete ? (
              <Pressable style={styles.claimButton} onPress={handleClaimTraining}>
                <Text style={styles.claimButtonText}>CLAIM TRAINING</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.yellowBand}>
          <Text style={styles.yellowBandText}>SELECT TRAINING COURSE</Text>
        </View>

        <View style={styles.courseStack}>
          {TRAINING_COURSES.map((course) => (
            <View key={course.id} style={styles.courseCard}>
              <View style={[styles.courseIcon, { borderColor: course.accent }]}>
                <Text style={[styles.courseIconText, { color: course.textColor }]}>{course.attributeLabel}</Text>
              </View>
              <View style={styles.courseBody}>
                <Text numberOfLines={1} style={[styles.courseTitle, { color: course.textColor }]}>
                  {course.id === "balanced" ? "BALANCED TRAINING" : `${course.attributeLabel} TRAINING`}
                </Text>
                <Text style={styles.courseCopy} numberOfLines={2}>{course.copy}</Text>
                <Text style={[styles.courseRange, { color: course.textColor }]}>
                  {course.id === "balanced" ? "ALL +5 to +8" : `${course.attributeLabel} +10 to +18`}
                </Text>
              </View>
              <View style={styles.courseMetaBlock}>
                <View style={styles.courseMetaRow}>
                  <Text style={styles.courseMetaLabel}>TIME</Text>
                  <Text style={styles.courseMetaValue}>{`${course.durationMinutes} min`}</Text>
                </View>
                <View style={styles.courseMetaRow}>
                  <Text style={styles.courseMetaLabel}>ENERGY</Text>
                  <Text style={styles.courseMetaValue}>{course.energyCost}</Text>
                </View>
                <Pressable
                  style={[
                    styles.selectButton,
                    ((profile?.dailyEnergy || 0) < course.energyCost || (activeTraining && !trainingComplete)) ? styles.disabledAction : null,
                  ]}
                  disabled={(profile?.dailyEnergy || 0) < course.energyCost || Boolean(activeTraining && !trainingComplete)}
                  onPress={() => handleStartTraining(course.id)}
                >
                  <Text style={styles.selectButtonText}>SELECT</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.syncBoostRow}>
          <View style={styles.syncBoostIcon}>
            <Text style={styles.syncBoostIconText}>SYNC</Text>
          </View>
          <View style={styles.syncBoostBody}>
            <Text style={styles.syncBoostTitle}>SYNC BOOST</Text>
            <Text style={styles.syncBoostCopy}>Train while moving. Earn extra bonuses based on your speed.</Text>
          </View>
          <View style={styles.syncBoostMeta}>
            <Text style={styles.syncBoostValue}>BONUS +20% EXP</Text>
            <Switch
              onValueChange={handleToggleSyncBoost}
              thumbColor={progression.syncBoostEnabled ? "#f5c40d" : "#dddddd"}
              trackColor={{ false: "#272727", true: "#524000" }}
              value={progression.syncBoostEnabled}
            />
          </View>
        </View>
      </ScrollView>

      <HolobotPickerModal
        onClose={() => setIsPickerOpen(false)}
        onSelect={(index) => {
          setSelectedHolobotIndex(index);
          setIsPickerOpen(false);
        }}
        roster={roster}
        selectedIndex={selectedHolobotIndex}
        visible={isPickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  activeCopy: {
    color: "#d9d2bd",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  activeCountdown: {
    color: "#f5c40d",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },
  activePanel: {
    backgroundColor: "#0b0b0b",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 10,
  },
  activeRewards: {
    color: "#9fe4ff",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 4,
  },
  claimButton: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 34,
  },
  claimButtonText: {
    color: "#050606",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  content: {
    backgroundColor: "#050606",
    gap: 8,
    paddingBottom: 16,
    paddingHorizontal: 18,
    paddingTop: 96,
  },
  courseBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  courseCard: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 9,
    minHeight: 82,
    paddingHorizontal: 8,
    paddingVertical: 7,
    width: "100%",
  },
  courseCopy: {
    color: "#ddd2b5",
    fontSize: 10,
    lineHeight: 13,
  },
  courseIcon: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 2,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  courseIconText: {
    fontSize: 12,
    fontWeight: "900",
  },
  courseMetaBlock: {
    borderLeftColor: "#242424",
    borderLeftWidth: 1,
    gap: 3,
    justifyContent: "center",
    paddingLeft: 8,
    width: 94,
  },
  courseMetaLabel: {
    color: "#8f866f",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  courseMetaRow: {
    gap: 1,
  },
  courseMetaValue: {
    color: "#fef1e0",
    fontSize: 11,
    fontWeight: "900",
  },
  courseRange: {
    fontSize: 10,
    fontWeight: "900",
    marginTop: 1,
  },
  courseStack: {
    gap: 8,
  },
  courseTitle: {
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },
  disabledAction: {
    opacity: 0.4,
  },
  energyBox: {
    alignItems: "flex-end",
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 1,
    minWidth: 88,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  energyLabel: {
    color: "#f0bf14",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  energyRefillButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    height: 18,
    justifyContent: "center",
    marginLeft: 6,
    width: 18,
  },
  energyRefillText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 14,
  },
  energyRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 2,
  },
  energyValue: {
    color: "#fef1e0",
    fontSize: 12,
    fontWeight: "900",
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 18,
    fontStyle: "italic",
    fontWeight: "900",
    marginTop: 4,
  },
  expFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  expTrack: {
    backgroundColor: "#2d2d2d",
    height: 8,
    marginTop: 10,
    overflow: "hidden",
  },
  heroCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 10,
    padding: 8,
  },
  heroContent: {
    flex: 1,
  },
  heroImage: {
    height: 90,
    width: 76,
  },
  heroMeta: {
    color: "#d9d2bd",
    fontSize: 10,
    fontWeight: "700",
  },
  heroName: {
    color: "#fef1e0",
    fontSize: 24,
    fontWeight: "900",
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  heroTitleBlock: {
    flex: 1,
    paddingRight: 4,
  },
  page: {
    backgroundColor: "#050606",
    flex: 1,
  },
  sectionTitle: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  selectButton: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    marginTop: 2,
    minHeight: 26,
    paddingHorizontal: 8,
  },
  selectButtonText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
  },
  statLabel: {
    color: "#fef1e0",
    fontSize: 9,
    fontWeight: "800",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  subcopy: {
    color: "#d1c7ad",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 2,
    maxWidth: 250,
  },
  syncBoostBody: {
    flex: 1,
    gap: 4,
  },
  syncBoostCopy: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 18,
  },
  syncBoostIcon: {
    alignItems: "center",
    borderColor: "#1fc9ff",
    borderRadius: 18,
    borderWidth: 2,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  syncBoostIconText: {
    color: "#5fe1ff",
    fontSize: 9,
    fontWeight: "900",
  },
  syncBoostMeta: {
    alignItems: "flex-end",
    gap: 4,
  },
  syncBoostRow: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 8,
    padding: 8,
  },
  syncBoostTitle: {
    color: "#1fc9ff",
    fontSize: 18,
    fontWeight: "900",
  },
  syncBoostValue: {
    color: "#5fe1ff",
    fontSize: 10,
    fontWeight: "900",
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
