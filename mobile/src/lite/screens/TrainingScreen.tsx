import { theme } from "@/lite/theme";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { HolobotPickerModal } from "@/lite/components/HolobotPickerModal";
import { HomeCogButton } from "@/lite/components/HomeCogButton";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { getExpProgress, getHolobotDisplayStats, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useCityProgression } from "@/lite/hooks/useCityProgression";
import { useEnergyRegen } from "@/hooks/useEnergyRegen";
import { useEnergyRefillAuthoritative } from "@/lib/progressionClient";
import {
  buildTrainingCard,
  canTryClaim,
  createStartRequestMemo,
  progressionRefusalCopy,
  runStatusLine,
  START_BLOCK_COPY,
  trainingStartBlock,
  type CityProgression,
} from "@/lite/lib/progressionHost";
import { claimTrainingInCity, legacyRefusals, startTrainingInCity, updateRewardSystemKeys } from "@/lite/lib/progressionHostClient";
import { getTrainingCourse, normalizeProgressionSystem, TRAINING_COURSES } from "@/lib/progressionSystems";

/**
 * Training runs through the City (host #145): SELECT asks startTrainingSession, which rolls the boost, debits the
 * energy and stamps the session with its clock; the panel shows the City's end time and boost; CLAIM asks
 * claimTrainingSession against the City's record. `cityPreview` is the offline QA harness only.
 */
export function TrainingScreen({ cityPreview }: { cityPreview?: CityProgression } = {}) {
  const { profile, updateProfile, user } = useAuth();
  useEnergyRegen();
  const uid = user?.uid ?? null;
  // The City's records and the run copies come from one snapshot, so a card is never classified across two moments.
  const city = useCityProgression(uid, cityPreview);
  const timers = city.timers;
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [refusedRevision, setRefusedRevision] = useState(0);
  const starts = useRef(createStartRequestMemo()).current;
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots).filter((holobot) => holobot.owned), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const progression = useMemo(() => normalizeProgressionSystem(profile?.rewardSystem), [profile?.rewardSystem]);
  const activeTraining = useMemo(
    () => buildTrainingCard(timers, city.rewardSystem, legacyRefusals.get(uid), nowTick),
    // refusedRevision: a legacy refusal changes legacyRefusals outside React state.
    [timers, city.rewardSystem, uid, nowTick, refusedRevision],
  );
  const timersNote = timers.status === "ready" ? null : START_BLOCK_COPY[timers.status === "loading" ? "checking" : "unavailable"];

  useEffect(() => {
    // Legacy runs the City already refused stay closed across launches.
    let live = true;
    void legacyRefusals.load(uid).then(() => { if (live) setRefusedRevision((value) => value + 1); });
    return () => { live = false; };
  }, [uid]);
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
    if (busy || !profile || !uid) {
      return;
    }

    const course = getTrainingCourse(courseId);
    const block = trainingStartBlock(timers, activeTraining, selectedHolobot?.name ?? null, profile.dailyEnergy || 0, course.energyCost);
    if (block || !selectedHolobot) {
      Alert.alert("Training not started", START_BLOCK_COPY[block ?? "no_holobot"]);
      return;
    }

    const ownedHolobot = profile.holobots.find((holobot) => holobot.name.toUpperCase() === selectedHolobot.name.toUpperCase());
    if (!ownedHolobot) {
      return;
    }

    const key = `training:${courseId}:${ownedHolobot.name.toUpperCase()}`;
    setBusy(true);
    try {
      // The City rolls the boost, debits the energy and stamps the session with its clock.
      await startTrainingInCity({ courseId, holobotName: ownedHolobot.name, requestId: starts.requestIdFor(key) });
      starts.settle(key);
    } catch (error) {
      const copy = progressionRefusalCopy(error, "training_start");
      // Unknown outcome: keep the request id so a retry is the identical request (the City replays it, never twice).
      if (copy.outcome !== "unknown") starts.settle(key);
      Alert.alert(copy.title, copy.body);
    } finally {
      setBusy(false);
    }
  };

  const handleClaimTraining = async () => {
    if (busy || !uid || !activeTraining || !canTryClaim(activeTraining)) {
      return;
    }

    setBusy(true);
    try {
      // The City pays its own record's boosts and the course's EXP (a legacy session: only while it still honours them).
      await claimTrainingInCity();
    } catch (error) {
      const copy = progressionRefusalCopy(error, "training_claim", activeTraining.source);
      if (copy.outcome === "legacy_refused" && activeTraining.source === "legacy") {
        await legacyRefusals.mark(uid, activeTraining.runId);
        setRefusedRevision((value) => value + 1);
      }
      Alert.alert(copy.title, copy.body);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSyncBoost = async () => {
    if (!profile || !uid) {
      return;
    }

    try {
      // One preference key, never the whole rewardSystem map (run copies and mission counters stay the City's).
      await updateRewardSystemKeys(uid, { syncBoostEnabled: !progression.syncBoostEnabled });
    } catch (error) {
      Alert.alert("Update Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleQuickRefill = async () => {
    if (!profile || !canRefill) {
      return;
    }

    try {
      await useEnergyRefillAuthoritative(profile, updateProfile);
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
            <GameSurfaceFrame strong />
            <Image source={selectedHolobot.imageSource} style={styles.heroImage} resizeMode="contain" />
            <View style={styles.heroContent}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroTitleBlock}>
                  <Text style={styles.heroName}>{selectedHolobot.name}</Text>
                  <Text style={styles.heroMeta}>{`LV ${selectedHolobot.level}   EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
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
                  <Text style={[styles.statValue, { color: theme.colors.success }]}>{actualStats?.hp ?? 0}</Text>
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

        {timersNote ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Check your runs again" disabled={timers.status !== "unavailable"} onPress={city.retry}>
            <Text style={styles.cityNote}>{timers.status === "unavailable" ? `${timersNote}  RETRY` : timersNote}</Text>
          </Pressable>
        ) : null}

        {activeTraining ? (
          <View style={styles.activePanel}>
            <GameSurfaceFrame strong />
            <Text style={styles.sectionTitle}>ACTIVE TRAINING</Text>
            <Text style={styles.activeCopy}>
              {`${activeTraining.holobotName} is in ${getTrainingCourse(activeTraining.courseId).attributeLabel} training.`}
            </Text>
            <Text style={styles.activeCountdown}>{runStatusLine(activeTraining, nowTick)}</Text>
            <Text style={styles.activeRewards}>
              {`EXP +${activeTraining.expReward}  •  BOOST ${Object.entries(activeTraining.statBoosts)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key.toUpperCase()} +${value}`)
                .join("  •  ")}`}
            </Text>
            {canTryClaim(activeTraining) ? (
              <Pressable disabled={busy} style={[styles.claimButton, busy ? styles.disabledAction : null]} onPress={() => void handleClaimTraining()}>
                <Text style={styles.claimButtonText}>CLAIM TRAINING</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.yellowBand}>
          <Text style={styles.yellowBandText}>SELECT TRAINING COURSE</Text>
        </View>

        <View style={styles.courseStack}>
          {TRAINING_COURSES.map((course) => {
            // A hint from the City's last record; the City still decides the start.
            const selectBlocked = busy || trainingStartBlock(timers, activeTraining, selectedHolobot?.name ?? null, profile?.dailyEnergy || 0, course.energyCost) !== null;
            return (
            <View key={course.id} style={styles.courseCard}>
              <GameSurfaceFrame accent={course.accent} />
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
                  style={[styles.selectButton, selectBlocked ? styles.disabledAction : null]}
                  disabled={selectBlocked}
                  onPress={() => void handleStartTraining(course.id)}
                >
                  <Text style={styles.selectButtonText}>SELECT</Text>
                </Pressable>
              </View>
            </View>
            );
          })}
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
              thumbColor={progression.syncBoostEnabled ? theme.colors.accent : "#dddddd"}
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
  cityNote: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    textAlign: "center",
  },
  activeCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    lineHeight: 16,
    marginTop: 4,
  },
  activeCountdown: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },
  activePanel: {
    backgroundColor: "transparent",
    overflow: "hidden",
    padding: 10,
    position: "relative",
  },
  activeRewards: {
    color: "#9fe4ff",
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 4,
  },
  claimButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 34,
  },
  claimButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  content: {
    backgroundColor: theme.colors.carbon,
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
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 9,
    minHeight: 82,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 7,
    position: "relative",
    width: "100%",
  },
  courseCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
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
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
  },
  courseMetaBlock: {
    borderLeftColor: theme.colors.carbon,
    borderLeftWidth: 1,
    gap: 3,
    justifyContent: "center",
    paddingLeft: 8,
    width: 94,
  },
  courseMetaLabel: {
    color: theme.colors.subtle,
    fontFamily: "HoloBody",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  courseMetaRow: {
    gap: 1,
  },
  courseMetaValue: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
  },
  courseRange: {
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    marginTop: 1,
  },
  courseStack: {
    gap: 8,
  },
  courseTitle: {
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },
  disabledAction: {
    opacity: 0.4,
  },
  energyBox: {
    alignItems: "flex-end",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    minWidth: 88,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  energyLabel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  energyRefillButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    height: 18,
    justifyContent: "center",
    marginLeft: 6,
    width: 18,
  },
  energyRefillText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
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
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
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
  expFill: {
    backgroundColor: theme.colors.accent,
    height: "100%",
  },
  expTrack: {
    backgroundColor: theme.plates.raised,
    height: 8,
    marginTop: 10,
    overflow: "hidden",
  },
  heroCard: {
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 10,
    overflow: "hidden",
    padding: 8,
    position: "relative",
  },
  heroContent: {
    flex: 1,
  },
  heroImage: {
    height: 90,
    width: 76,
  },
  heroMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
  },
  heroName: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
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
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  sectionTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  selectButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    marginTop: 2,
    minHeight: 26,
    paddingHorizontal: 8,
  },
  selectButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
  },
  statLabel: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "800",
  },
  statValue: {
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  subcopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
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
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    lineHeight: 18,
  },
  syncBoostIcon: {
    alignItems: "center",
    borderColor: theme.colors.accent,
    borderRadius: 18,
    borderWidth: 2,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  syncBoostIconText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "900",
  },
  syncBoostMeta: {
    alignItems: "flex-end",
    gap: 4,
  },
  syncBoostRow: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 2,
    flexDirection: "row",
    gap: 8,
    padding: 8,
  },
  syncBoostTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  syncBoostValue: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
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
