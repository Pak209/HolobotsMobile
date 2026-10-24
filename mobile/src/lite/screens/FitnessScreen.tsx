import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { FigmaCanvas } from "@/components/FigmaCanvas";
import { Svg, G, Image, Path, Text } from "@/components/FigmaSvg";
import { NavIcon } from "@/lite/components/HomeCogButton";
import { HolobotPickerModal } from "@/lite/components/HolobotPickerModal";
import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH, fitnessAssets, fitnessHoloCityAssets } from "@/lite/config/figmaAssets";
import { theme } from "@/lite/theme";
import { getExpProgress, getHolobotFullImageSource, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useWatchWorkoutPresence } from "@/hooks/useWatchBridge";
import { useWorkout, type DistanceUnit } from "@/hooks/useWorkout";
import { normalizeProgressionSystem } from "@/lib/progressionSystems";
import { readinessDisplayValue, readinessResultCopy, readinessUiEnabled } from "@/lib/readiness";
import type { RootTabs } from "../../../LiteApp";

/**
 * The OG Sync page (src/screens/FitnessScreen.tsx) — same artboard, same layer
 * positions, same proportions — re-skinned to the HoloCity palette. Only colours
 * differ: the static OG layers come pre-recoloured (fitnessHoloCityAssets), the
 * dynamic layers take theme tokens. Lite keeps a static bot portrait (no 3D).
 */
const NEEDLE_MIN_ANGLE = -150;
const NEEDLE_MAX_ANGLE = -35;
const NEEDLE_MAX_SPEED = 20;
const NEEDLE_CENTER_X = 918;
const NEEDLE_CENTER_Y = 1733;
const KM_TO_MILES = 0.621371;
const TOTAL_SYNC_MINUTES = 5;

/** OG colour -> HoloCity token. Shapes and positions are the OG's. */
export const OG_SYNC_RESKIN = {
  ground: theme.plates.raised,
  ink: theme.colors.text,
  syncPlus: theme.hud.hpRival,
  goalFill: theme.colors.accent,
  expTrack: theme.colors.graphite,
  expFill: theme.colors.warning,
  boost: theme.colors.warning,
  goLabel: theme.colors.accent,
} as const;

function formatGoalTime(remainingMinutes: number) {
  return `Time:  ${String(remainingMinutes).padStart(2, "0")}/${String(TOTAL_SYNC_MINUTES).padStart(2, "0")}`;
}

function formatSpeed(speed: number, unit: DistanceUnit) {
  return `${Math.round(speed)} ${unit === "mi" ? "mph" : "km/h"}`;
}

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
  const needleAngle = NEEDLE_MIN_ANGLE + (Math.min(displaySpeed, NEEDLE_MAX_SPEED) / NEEDLE_MAX_SPEED) * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
  const goalBarWidth = 698.125 * workout.progress;
  const expProgressWidth = 473 * (selectedHolobot ? getExpProgress(selectedHolobot) : 0);
  const showReadiness = readinessUiEnabled() && selectedHolobot != null;

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


  const c = OG_SYNC_RESKIN;
  return (
    <FigmaCanvas backgroundColor={c.ground} fitToParent>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.utilityStack}>
          <Pressable accessibilityLabel="Go to home dashboard" accessibilityRole="button" onPress={() => navigation.navigate("Home")} style={styles.utilityButton}>
            <View style={styles.utilityInner}><NavIcon kind="HOME" /></View>
          </Pressable>
          <Pressable accessibilityLabel="Open Sync settings" accessibilityRole="button" onPress={() => setIsSettingsOpen(true)} style={styles.utilityButton}>
            <View style={styles.utilityInner}><NavIcon kind="SET" /></View>
          </Pressable>
        </View>
        <Svg width="100%" height="100%" viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`}>
          <Image href={fitnessHoloCityAssets.syncArt} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
          <Text x={193} y={198.04} fill={c.ink} fontSize={106.012} fontWeight="700">SYNC POINT</Text>
          <Text x={315} y={418.99} fill={c.syncPlus} fontSize={105.805} fontWeight="700">{`+${workout.syncPointsReward}`}</Text>

          <Path d={`M 90 686.25 H ${90 + goalBarWidth} L ${Math.max(90, 90 + goalBarWidth - 40)} 766.25 H 90 Z`} fill={c.goalFill} />
          <Text x={103} y={672} fill={c.ink} fontSize={116} fontWeight="400">{formatGoalTime(workout.remainingMinutes)}</Text>

          <Text x={72} y={921.5} fill={c.ink} fontSize={49.915}>{selectedHolobot?.name ?? "HOLOBOT"}</Text>
          <Path d="M 72 1018 H 545 V 1043 H 72 Z" fill={c.expTrack} />
          <Path d={`M 72 1018 H ${72 + expProgressWidth} V 1043 H 72 Z`} fill={c.expFill} />
          <Text x={89} y={1009} fill={c.ink} fontSize={24.794} fontWeight="700">{`EXP ${selectedHolobot?.experience ?? 0}/${selectedHolobot?.nextLevelExp ?? 0}`}</Text>
          <Text x={71} y={1119.3} fill={c.ink} fontSize={100.722}>{`Lv ${selectedHolobot?.level ?? 1}`}</Text>
          {showReadiness ? (
            <G>
              <Text x={72} y={1262} fill={c.ink} fontSize={30} fontWeight="700">{`SYNC READINESS ${readiness}/100`}</Text>
              <Path d="M 72 1278 H 545 V 1296 H 72 Z" fill={c.expTrack} />
              <Path d={`M 72 1278 H ${72 + 4.73 * readiness} V 1296 H 72 Z`} fill={c.goalFill} />
            </G>
          ) : null}

          <Text x={900} y={1160} fill={c.ink} fontSize={55} fontWeight="700">CHANGE HOLOBOT</Text>

          <G transform={`rotate(${needleAngle} ${NEEDLE_CENTER_X} ${NEEDLE_CENTER_Y})`}>
            <Image href={fitnessHoloCityAssets.speedometerNeedle} x={811} y={1621} width={366} height={211} preserveAspectRatio="none" />
          </G>
          <Text x={729} y={1540.12} fill={c.ink} fontSize={89.466} fontWeight="700">{formatSpeed(displaySpeed, distanceUnit)}</Text>
          <Text x={729} y={1608} fill={c.ink} fontSize={37.004} fontWeight="700">Movement speed</Text>

          {workout.syncPointBoostCount > 0 ? (
            <G transform="translate(610 2020)">
              <Path d="M9 12H5.414a1 1 0 0 1-.707-1.707l6.586-6.586a1 1 0 0 1 1.414 0l6.586 6.586A1 1 0 0 1 18.586 12H15v3H9zm0 9h6m-6-3h6" stroke={c.boost} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </G>
          ) : null}
          <Text x={788} y={2074.31} fill={c.ink} fontSize={121.544}>{displayDistance.toFixed(3)}</Text>
          <Text x={793} y={2180.08} fill={c.ink} fontSize={45.702} fontWeight="500">{formatDistanceLabel(distanceUnit)}</Text>
          {syncBoostCopy ? <Text x={794} y={2232} fill={c.boost} fontSize={34} fontWeight="700">{syncBoostCopy}</Text> : null}

          <Image href={fitnessAssets.rewardSync} x={244} y={2429} width={116} height={131} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardHolos} x={740} y={2433} width={109} height={110} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardExp} x={1196} y={2433} width={119} height={118} preserveAspectRatio="none" />
          <Text x={410} y={2494} fill={c.ink} fontSize={96.929} fontWeight="700">{`+${workout.syncPointsReward}`}</Text>
          <Text x={882} y={2494} fill={c.ink} fontSize={95.215} fontWeight="700">{`+${workout.holosReward}`}</Text>
          <Text x={1353} y={2493.96} fill={c.ink} fontSize={91.406} fontWeight="700">{`+${workout.expReward}`}</Text>

          {blockedByWatch ? <Text x={430} y={2588} fill={c.boost} fontSize={52} fontWeight="700">WORKOUT RUNNING ON APPLE WATCH</Text> : null}
          <Text
            x={goLabel === "PAUSE" ? 635 : goLabel === "RESUME" ? 610 : goLabel === "ON WATCH" ? 480 : 740}
            y={2868}
            fill={c.goLabel}
            fontSize={goLabel === "ON WATCH" ? 160 : 204.86}
            fontWeight="700"
          >
            {goLabel}
          </Text>
          {workout.syncMessage ? (
            <Text x={900} y={3130} fill={workout.syncState === "error" ? theme.colors.danger : theme.colors.muted} fontSize={40} fontWeight="700" textAnchor="middle">
              {workout.syncMessage}
            </Text>
          ) : null}
        </Svg>

        <Pressable
          accessibilityLabel={blockedByWatch ? "Workout running on Apple Watch" : workout.isRunning ? "Pause workout" : "Start workout"}
          accessibilityRole="button"
          onLongPress={workout.resetWorkout}
          onPress={handleGoPress}
          style={styles.goHotspot}
        />
        <Pressable accessibilityLabel="Change active holobot" accessibilityRole="button" onPress={() => setIsPickerOpen(true)} style={styles.changeHolobotHotspot} />
        <View pointerEvents="none" style={styles.holobotPortrait}>
          {selectedHolobot ? <RNImage source={getHolobotFullImageSource(selectedHolobot.name)} style={styles.fillImage} resizeMode="contain" /> : null}
        </View>
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
    </FigmaCanvas>
  );
}

const styles = StyleSheet.create({
  /** OG hotspot and overlay rectangles, as artboard percentages. */
  changeHolobotHotspot: { position: "absolute", left: "43.6111%", top: "34.125%", width: "51.6667%", height: "9.0625%" },
  goHotspot: { position: "absolute", left: "1.111%", top: "81.4375%", width: "94.1667%", height: "13.9375%" },
  holobotPortrait: { position: "absolute", left: "51.2%", top: "9.6%", width: "34.4444%", height: "21.5%" },
  fillImage: { width: "100%", height: "100%" },
  utilityStack: { gap: 10, position: "absolute", right: 18, top: 72, zIndex: 20 },
  utilityButton: {},
  utilityInner: {
    alignItems: "center",
    backgroundColor: theme.plates.keycap,
    borderColor: theme.colors.accent,
    borderRadius: 26,
    borderWidth: 2,
    height: 52,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: 52,
  },
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
