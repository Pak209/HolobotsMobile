import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HolobotRosterCard } from "@/lite/components/HolobotRosterCard";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { theme } from "@/lite/theme";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Image as RNImage,
  Pressable,
  StyleSheet,
  ScrollView,
  Text as RNText,
  View,
} from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { HolobotPickerModal } from "@/lite/components/HolobotPickerModal";
import { Svg, Path } from "@/components/FigmaSvg";
import { getHolobotFullImageSource, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useWatchWorkoutPresence } from "@/hooks/useWatchBridge";
import { useWorkout, type DistanceUnit } from "@/hooks/useWorkout";
import { normalizeProgressionSystem } from "@/lib/progressionSystems";
import { readinessDisplayValue, readinessResultCopy, readinessUiEnabled } from "@/lib/readiness";
import type { RootTabs } from "../../../LiteApp";

const KM_TO_MILES = 0.621371;
const TOTAL_SYNC_MINUTES = 5;

function formatDistanceLabel(unit: DistanceUnit) {
  return unit === "mi" ? "Miles" : "Kilometers";
}

function formatSyncBoostCopy(boostCount: number, unit: DistanceUnit) {
  if (boostCount <= 0) {
    return null;
  }

  const unitLabel = unit === "mi" ? (boostCount === 1 ? "MILE" : "MILES") : (boostCount === 1 ? "KM" : "KM");
  return `+${boostCount * 100} SP BOOST (${boostCount} ${unitLabel})`;
}

export function FitnessScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { user, profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localDistanceUnit, setLocalDistanceUnit] = useState<DistanceUnit>("km");
  const [claimAction, setClaimAction] = useState<"finish" | "continue" | null>(null);

  useEffect(() => {
    if (profile?.syncDistanceUnit) {
      setLocalDistanceUnit(profile.syncDistanceUnit);
    }
  }, [profile?.syncDistanceUnit]);

  const distanceUnit = profile?.syncDistanceUnit ?? localDistanceUnit;
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots, "full"), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const readiness = readinessDisplayValue(profile?.syncReadiness?.[selectedHolobot?.name?.toUpperCase() ?? ""], Date.now());
  const syncBoostMultiplier = normalizeProgressionSystem(profile?.rewardSystem).syncBoostEnabled ? 1.2 : 1;
  const workout = useWorkout(user?.uid ?? null, distanceUnit, {
    expMultiplier: syncBoostMultiplier,
    holobotName: selectedHolobot?.name,
  });
  const displayDistance = distanceUnit === "mi" ? workout.displayDistanceKm * KM_TO_MILES : workout.displayDistanceKm;
  const displaySpeed = distanceUnit === "mi" ? workout.liveSpeedKmh * KM_TO_MILES : workout.liveSpeedKmh;

  const handleDistanceUnitChange = (nextUnit: DistanceUnit) => {
    setLocalDistanceUnit(nextUnit);
    if (!user) {
      return;
    }

    void updateProfile({ syncDistanceUnit: nextUnit }).catch((error) => {
      console.error("[Fitness] Failed to save sync distance unit", error);
    });
  };

  const completionResult = workout.completionResult;
  const syncBoostCopy = formatSyncBoostCopy(workout.syncPointBoostCount, distanceUnit);
  const watchWorkoutActive = useWatchWorkoutPresence();
  // Soft cross-device lock: block only a FRESH start while the watch is
  // mid-workout — pausing/resuming this phone's own session stays allowed.
  const blockedByWatch =
    watchWorkoutActive && !workout.isRunning && workout.elapsedSeconds <= 0;
  const goLabel = workout.isRunning
    ? "PAUSE"
    : workout.elapsedSeconds > 0
      ? "RESUME"
      : blockedByWatch
        ? "ON WATCH"
        : "GO";

  const handleGoPress = () => {
    if (blockedByWatch) {
      return;
    }
    void workout.toggleRunning();
  };

  const persistWorkoutRewards = async () => {
    if (!completionResult) {
      return true;
    }

    if (!profile || !user) {
      return false;
    }

    // Rewards are persisted atomically inside the server-side fitness sync
    // transaction (EXP, Holos, and Sync Points). The old local profile-write
    // fallback was removed with the economy-field rules freeze — when the
    // sync failed or timed out, COLLECT retries it (idempotent by
    // activityId), so the button can never wedge and rewards are never
    // stranded.
    if (completionResult.rewardsPersisted) {
      workout.clearCompletionResult();
      return true;
    }

    const retried = await workout.retryCompletionSync();
    if (retried) {
      workout.clearCompletionResult();
    }
    return retried;
  };

  // Between-session rewards modal: the session pauses here so the player
  // chooses CLAIM & FINISH, or QUICK REFILL to skip the cooldown and roll
  // straight into the next of their 4 daily sessions.
  const handleClaimAndFinish = async () => {
    if (claimAction) {
      return;
    }
    setClaimAction("finish");
    try {
      const saved = await persistWorkoutRewards();
      if (saved) {
        workout.resetWorkout();
      }
    } finally {
      setClaimAction(null);
    }
  };

  const handleClaimAndContinue = async () => {
    if (claimAction) {
      return;
    }
    setClaimAction("continue");
    try {
      const saved = await persistWorkoutRewards();
      if (!saved) {
        return;
      }
      await workout.unlockQuickRefill();
      workout.continueQuickRefillChain();
      // If a watch workout started while the modal was up, stop at the
      // ready state — the GO button will show ON WATCH until it finishes.
      if (!watchWorkoutActive) {
        await workout.toggleRunning();
      }
    } finally {
      setClaimAction(null);
    }
  };

  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View><RNText style={styles.eyebrow}>PILOT FITNESS / SYNC LINK</RNText><RNText style={styles.pageTitle}>SYNC WORKOUT</RNText></View>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerAction} onPress={() => navigation.navigate("Home")} accessibilityRole="button" accessibilityLabel="Go to home dashboard"><GameSurfaceFrame /><RNText style={styles.headerGlyph}>⌂</RNText></Pressable>
            <Pressable style={styles.headerAction} onPress={() => setIsSettingsOpen(true)} accessibilityRole="button" accessibilityLabel="Open Sync settings"><GameSurfaceFrame /><RNText style={styles.headerGlyph}>⚙</RNText></Pressable>
          </View>
        </View>
        <View style={styles.syncPlate}>
          <GameSurfaceFrame strong />
          <View style={styles.headerRow}><RNText style={styles.eyebrow}>SYNC POINTS</RNText><RNText style={styles.liveStatus}>{workout.isRunning ? "● LIVE" : "STANDBY"}</RNText></View>
          <RNText style={styles.syncValue}>+{workout.syncPointsReward}</RNText>
          <View style={styles.headerRow}><RNText style={styles.telemetryLabel}>SESSION PROGRESS</RNText><RNText style={styles.telemetryLabel}>{workout.remainingMinutes} / {TOTAL_SYNC_MINUTES} MIN LEFT</RNText></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0,Math.min(1,workout.progress))*100}%` }]} /></View>
          <RNText style={styles.hudHelp}>{workout.sessionsCompleted}/4 SESSIONS TODAY · {workout.sessionsRemaining} AVAILABLE</RNText>
        </View>
        <HolobotRosterCard holobot={selectedHolobot} slot={selectedHolobotIndex} compact selected live={focused && !isPickerOpen && !isSettingsOpen && !completionResult} onPress={() => setIsPickerOpen(true)} actionLabel="CHANGE WORKOUT PARTNER ›" />
        {readinessUiEnabled() && selectedHolobot ? (
          <View accessibilityLabel={`${selectedHolobot.name} SYNC readiness ${readiness} of 100`}>
            <RNText style={styles.hudHelp}>{`SYNC READINESS · ${selectedHolobot.name.toUpperCase()} · ${readiness}/100`}</RNText>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${readiness}%` }]} /></View>
            <RNText style={styles.hudHelp}>Train this Holobot to fill readiness.</RNText>
          </View>
        ) : null}
        <View style={styles.telemetryRow}>
          <View style={styles.telemetry}><GameSurfaceFrame accent={theme.colors.border} /><RNText style={styles.eyebrow}>DISTANCE</RNText><RNText style={styles.telemetryValue}>{displayDistance.toFixed(3)}</RNText><RNText style={styles.telemetryLabel}>{formatDistanceLabel(distanceUnit).toUpperCase()}</RNText></View>
          <View style={styles.telemetry}><GameSurfaceFrame accent={theme.colors.border} /><RNText style={styles.eyebrow}>MOVEMENT SPEED</RNText><RNText style={styles.telemetryValue}>{Math.round(displaySpeed)}</RNText><RNText style={styles.telemetryLabel}>{distanceUnit === "mi" ? "MILES / HOUR" : "KM / HOUR"}</RNText></View>
        </View>
        <View style={styles.rewardPreview}>
          <GameSurfaceFrame accent={theme.colors.border} />
          <View><RNText style={styles.telemetryLabel}>HOLOS REWARD</RNText><RNText style={styles.rewardPreviewValue}>+{workout.holosReward}</RNText></View>
          <View><RNText style={styles.telemetryLabel}>HOLOBOT EXPERIENCE</RNText><RNText style={styles.rewardPreviewValue}>+{workout.expReward}</RNText></View>
        </View>
        {syncBoostCopy && <RNText style={styles.boostCopy}>{syncBoostCopy}</RNText>}
        {workout.syncMessage && <RNText style={workout.syncState === "error" ? styles.hudError : styles.hudHelp}>{workout.syncMessage}</RNText>}
        {blockedByWatch && <RNText style={styles.hudHelp}>WORKOUT RUNNING ON APPLE WATCH</RNText>}
        {workout.isCooldownActive && <View style={styles.cooldownPlate}><GameSurfaceFrame accent={theme.colors.cursor} /><RNText style={styles.telemetryLabel}>RECOVERY WINDOW</RNText><RNText style={styles.cooldownValue}>{workout.cooldownRemainingMinutes} MIN</RNText><RNText style={styles.hudHelp}>Open Sync settings to use Quick Refill.</RNText></View>}
        <Pressable onPress={handleGoPress} onLongPress={workout.resetWorkout} style={styles.goButton} accessibilityRole="button" accessibilityLabel={blockedByWatch ? "Workout running on Apple Watch" : workout.isRunning ? "Pause workout" : "Start workout"}>
          <GameSurfaceFrame accent={theme.colors.accent} fill={theme.plates.raised} strong /><RNText style={styles.goText}>{goLabel}</RNText><RNText style={styles.goHint}>{workout.isRunning ? "TAP TO PAUSE · HOLD TO RESET" : "MOVEMENT BUILDS YOUR LINK"}</RNText>
        </Pressable>
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
        <Modal
          animationType="fade"
          presentationStyle="overFullScreen"
          transparent
          visible={isSettingsOpen}
          onRequestClose={() => setIsSettingsOpen(false)}
        >
          <View style={styles.settingsBackdrop}>
            <View style={styles.settingsCard}>
              <RNText style={styles.settingsEyebrow}>SYNC SETTINGS</RNText>
              <RNText style={styles.settingsTitle}>Workout Preferences</RNText>
              <RNText style={styles.settingsCopy}>
                Choose how distance is shown and manage the 10 minute cooldown between Sync workouts.
              </RNText>

              <View style={styles.settingsSection}>
                <RNText style={styles.settingsLabel}>DISTANCE UNIT</RNText>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => handleDistanceUnitChange("km")}
                    style={[styles.toggleButton, distanceUnit === "km" ? styles.toggleButtonActive : null]}
                  >
                    <RNText style={[styles.toggleText, distanceUnit === "km" ? styles.toggleTextActive : null]}>KILOMETERS</RNText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDistanceUnitChange("mi")}
                    style={[styles.toggleButton, distanceUnit === "mi" ? styles.toggleButtonActive : null]}
                  >
                    <RNText style={[styles.toggleText, distanceUnit === "mi" ? styles.toggleTextActive : null]}>MILES</RNText>
                  </Pressable>
                </View>
                <RNText style={styles.settingsMeta}>
                  {distanceUnit === "mi" ? "+100 SP for every full mile completed." : "+100 SP for every full kilometer completed."}
                </RNText>
              </View>

              <View style={styles.settingsSection}>
                <View style={styles.settingsTileRow}>
                  <View>
                    <RNText style={styles.settingsLabel}>QUICK REFILL</RNText>
                    <RNText style={styles.settingsCopySmall}>{`${workout.sessionsCompleted}/4 workouts used today`}</RNText>
                    <RNText style={styles.settingsMeta}>
                      {workout.isCooldownActive
                        ? `${workout.cooldownRemainingMinutes} mins until next workout • ${workout.sessionsRemaining} sessions left today`
                        : `${workout.sessionsRemaining} of 4 sessions left • Next workout ready`}
                    </RNText>
                  </View>
                  <Pressable
                    accessibilityLabel="Use Quick Refill"
                    disabled={!workout.canQuickRefill}
                    onPress={workout.unlockQuickRefill}
                    style={[styles.refillButton, !workout.canQuickRefill ? styles.refillButtonDisabled : null]}
                  >
                    <Svg width="18" height="18" viewBox="0 0 24 24">
                      <Path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5a.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1m5-9l-2 4h3l-2 4" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                </View>
              </View>

              <View style={styles.settingsSection}>
                <RNText style={styles.settingsLabel}>APPLE HEALTH</RNText>
                <RNText style={styles.settingsMeta}>
                  Apple Watch Sync workouts are recorded to Apple Health as workout sessions using
                  HealthKit. iPhone workouts use on-device motion and location only.
                </RNText>
              </View>

              <Pressable style={styles.closeSettingsButton} onPress={() => setIsSettingsOpen(false)}>
                <RNText style={styles.closeSettingsText}>CLOSE</RNText>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal
          animationType="fade"
          presentationStyle="overFullScreen"
          transparent
          visible={completionResult != null}
          onRequestClose={() => void handleClaimAndFinish()}
        >
          <View style={styles.settingsBackdrop}>
            <View style={styles.settingsCard}>
              <RNText style={styles.settingsEyebrow}>SYNC RESULT</RNText>
              <RNText style={styles.settingsTitle}>Workout Complete</RNText>

              <View style={styles.rewardsList}>
                <View style={styles.rewardRow}>
                  <RNText style={styles.rewardLabel}>SYNC POINTS</RNText>
                  <RNText style={styles.rewardValue}>{`+${completionResult?.syncPointsReward ?? 0}`}</RNText>
                </View>
                <View style={styles.rewardRow}>
                  <RNText style={styles.rewardLabel}>HOLOS</RNText>
                  <RNText style={styles.rewardValue}>{`+${completionResult?.holosReward ?? 0}`}</RNText>
                </View>
                <View style={styles.rewardRow}>
                  <RNText style={styles.rewardLabel}>EXP</RNText>
                  <RNText style={styles.rewardValue}>{`+${completionResult?.expReward ?? 0}`}</RNText>
                </View>
              </View>

              {readinessUiEnabled() && completionResult ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {completionResult.readiness ? <RNImage source={getHolobotFullImageSource(completionResult.readiness.holobotName)} style={{ width: 36, height: 40 }} resizeMode="contain" /> : null}
                  <RNText style={[styles.settingsMeta, { flex: 1 }]}>
                    {readinessResultCopy(completionResult.readiness, completionResult.rewardsPersisted)}
                  </RNText>
                </View>
              ) : null}

              <RNText style={styles.settingsCopySmall}>
                {`${completionResult?.sessionsCompleted ?? 0}/4 workouts used today`}
              </RNText>
              <RNText style={styles.settingsMeta}>
                {(completionResult?.sessionsRemaining ?? 0) > 0
                  ? `${completionResult?.sessionsRemaining} session${(completionResult?.sessionsRemaining ?? 0) === 1 ? "" : "s"} left • Quick Refill skips the cooldown`
                  : "Daily workout limit reached. Come back tomorrow."}
              </RNText>
              {completionResult && !completionResult.rewardsPersisted ? (
                <RNText style={styles.rewardsSyncWarning}>
                  Rewards not synced yet — CLAIM retries the sync.
                </RNText>
              ) : null}

              {(completionResult?.sessionsRemaining ?? 0) > 0 ? (
                <Pressable
                  disabled={claimAction != null}
                  style={[styles.continueButton, claimAction != null ? styles.claimButtonBusy : null]}
                  onPress={() => void handleClaimAndContinue()}
                >
                  <RNText style={styles.continueButtonText}>
                    {claimAction === "continue" ? "STARTING..." : "REFILL • NEXT WORKOUT"}
                  </RNText>
                </Pressable>
              ) : null}
              <Pressable
                disabled={claimAction != null}
                style={[styles.closeSettingsButton, claimAction != null ? styles.claimButtonBusy : null]}
                onPress={() => void handleClaimAndFinish()}
              >
                <RNText style={styles.closeSettingsText}>
                  {claimAction === "finish" ? "CLAIMING..." : "CLAIM & FINISH"}
                </RNText>
              </Pressable>
            </View>
          </View>
        </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.carbon },
  content: { paddingHorizontal: 18, gap: 16, width: "100%", maxWidth: 620, alignSelf: "center" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  headerActions: { flexDirection: "row", gap: 6 },
  headerAction: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
  headerGlyph: { fontSize: 24, color: theme.colors.accent },
  eyebrow: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1 },
  pageTitle: { ...theme.type.header, color: theme.colors.text },
  syncPlate: { padding: 20, gap: 12 },
  liveStatus: { ...theme.type.micro, color: theme.colors.success, letterSpacing: 1 },
  syncValue: { ...theme.type.display, fontSize: 60, lineHeight: 66, color: theme.colors.text },
  progressTrack: { height: 8, backgroundColor: theme.colors.graphite },
  progressFill: { height: "100%", backgroundColor: theme.colors.accent },
  rewardPreview: { flexDirection: "row", justifyContent: "space-between", padding: 16, gap: 12 },
  rewardPreviewValue: { ...theme.type.header, color: theme.colors.accent, marginTop: 4 },
  telemetryRow: { flexDirection: "row", gap: 12 },
  telemetry: { flex: 1, padding: 16, gap: 10 },
  telemetryValue: { ...theme.type.display, color: theme.colors.text },
  telemetryLabel: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 1 },
  hudHelp: { ...theme.type.caption, color: theme.colors.muted },
  hudError: { ...theme.type.body, color: theme.colors.danger },
  boostCopy: { ...theme.type.label, color: theme.colors.success, textAlign: "center" },
  cooldownPlate: { padding: 16, gap: 6 },
  cooldownValue: { ...theme.type.header, color: theme.colors.cursor },
  goButton: { alignItems: "center", justifyContent: "center", minHeight: 96, gap: 4 },
  goText: { ...theme.type.display, color: theme.colors.accent, letterSpacing: 2 },
  goHint: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 1 },
  closeSettingsButton: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.plates.raised,
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 52,
  },
  closeSettingsText: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  settingsBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  settingsCard: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  settingsCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  settingsCopySmall: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "700",
    marginTop: 4,
  },
  settingsEyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  settingsLabel: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  settingsMeta: {
    color: theme.colors.subtle,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
  },
  settingsSection: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.plates.raised,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  settingsTileRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  settingsTitle: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 8,
  },
  toggleButton: {
    alignItems: "center",
    borderColor: theme.colors.border,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  toggleButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  toggleText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  toggleTextActive: {
    color: theme.colors.carbon,
  },
  refillButton: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 2,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  refillButtonDisabled: {
    opacity: 0.45,
  },
  claimButtonBusy: {
    opacity: 0.55,
  },
  continueButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 52,
  },
  continueButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  rewardLabel: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  rewardRow: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.plates.raised,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  rewardValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  rewardsList: {
    gap: 8,
    marginTop: 16,
  },
  rewardsSyncWarning: {
    color: "#e88a2a",
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "700",
    marginTop: 10,
  },
});
