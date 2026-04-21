import { useEffect, useMemo, useState } from "react";
import {
  Image as RNImage,
  Modal,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { FigmaCanvas } from "@/components/FigmaCanvas";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { SyncRewardsModal } from "@/components/fitness/SyncRewardsModal";
import { Svg, Defs, G, Image, Mask, Path, Text } from "@/components/FigmaSvg";
import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH, fitnessAssets } from "@/config/figmaAssets";
import { applyHolobotExperience, getExpProgress, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkout, type DistanceUnit } from "@/hooks/useWorkout";
import type { UserHolobot } from "@/types/profile";
import type { RootTabs } from "../../App";

const NEEDLE_MIN_ANGLE = -150;
const NEEDLE_MAX_ANGLE = -35;
const NEEDLE_MAX_SPEED = 20;
const NEEDLE_CENTER_X = 918;
const NEEDLE_CENTER_Y = 1733;
const KM_TO_MILES = 0.621371;
const TOTAL_SYNC_MINUTES = 5;

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

function formatCooldownCopy(remainingMinutes: number, sessionsRemaining: number) {
  if (sessionsRemaining <= 0) {
    return "Daily Sync limit reached. More workouts reset tomorrow.";
  }

  if (remainingMinutes <= 0) {
    return "Next workout is ready now.";
  }

  return `Next Sync workout unlocks in ${remainingMinutes} min. Quick Refill skips the wait.`;
}

export function FitnessScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { user, profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localDistanceUnit, setLocalDistanceUnit] = useState<DistanceUnit>("km");

  useEffect(() => {
    if (profile?.syncDistanceUnit) {
      setLocalDistanceUnit(profile.syncDistanceUnit);
    }
  }, [profile?.syncDistanceUnit]);

  const distanceUnit = profile?.syncDistanceUnit ?? localDistanceUnit;
  const workout = useWorkout(user?.uid ?? null, distanceUnit);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const displayDistance = distanceUnit === "mi" ? workout.distanceKm * KM_TO_MILES : workout.distanceKm;
  const displaySpeed = distanceUnit === "mi" ? workout.liveSpeedKmh * KM_TO_MILES : workout.liveSpeedKmh;
  const needleAngle = NEEDLE_MIN_ANGLE + (Math.min(displaySpeed, NEEDLE_MAX_SPEED) / NEEDLE_MAX_SPEED) * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
  const goalBarWidth = 698.125 * workout.progress;
  const expProgressWidth = 473 * getExpProgress(selectedHolobot);

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
  const rewardCooldownCopy = completionResult
    ? formatCooldownCopy(workout.cooldownRemainingMinutes, completionResult.sessionsRemaining)
    : "";
  const rewardSessionsCopy = completionResult
    ? `${completionResult.sessionsCompleted}/4 workouts completed today`
    : "";
  const syncBoostCopy = formatSyncBoostCopy(workout.syncPointBoostCount, distanceUnit);
  const goLabel = workout.isRunning
    ? "PAUSE"
    : workout.elapsedSeconds > 0
      ? "RESUME"
      : "GO";

  const persistWorkoutRewards = async () => {
    if (!completionResult) {
      return true;
    }

    if (!profile || !user) {
      return false;
    }

    const nextHolobots = [...(profile.holobots || [])];
    const targetName = selectedHolobot.name.trim().toUpperCase();
    const targetIndex = nextHolobots.findIndex(
      (holobot) => holobot.name.trim().toUpperCase() === targetName,
    );

    if (targetIndex >= 0) {
      nextHolobots[targetIndex] = applyHolobotExperience(nextHolobots[targetIndex], completionResult.expReward);
    } else {
      const fallbackHolobot: UserHolobot = {
        attributePoints: selectedHolobot.attributePoints ?? 0,
        boostedAttributes: selectedHolobot.boostedAttributes,
        experience: selectedHolobot.experience,
        level: selectedHolobot.level,
        name: selectedHolobot.name,
        nextLevelExp: selectedHolobot.nextLevelExp,
        rank: selectedHolobot.rank,
      };
      nextHolobots.push(applyHolobotExperience(fallbackHolobot, completionResult.expReward));
    }

    try {
      await updateProfile({
        holobots: nextHolobots,
        holosTokens: (profile.holosTokens || 0) + completionResult.holosReward,
        syncPoints: completionResult.totalSyncPoints ?? (profile.syncPoints || 0) + completionResult.syncPointsReward,
      });
      workout.clearCompletionResult();
      return true;
    } catch (error) {
      console.error("[Fitness] Failed to persist workout rewards", error);
      return false;
    }
  };

  const handleCollectRewards = async () => {
    await persistWorkoutRewards();
  };

  const handleRewardQuickRefill = async () => {
    const saved = await persistWorkoutRewards();
    if (!saved) {
      return;
    }

    workout.resetWorkout();
    await workout.unlockQuickRefill();
    await workout.toggleRunning();
  };

  return (
    <FigmaCanvas>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.utilityStack}>
          <Pressable
            accessibilityLabel="Go to home dashboard"
            accessibilityRole="button"
            onPress={() => navigation.navigate("Home")}
            style={styles.utilityButton}
          >
            <View style={styles.utilityInner}>
              <Svg width="28" height="28" viewBox="0 0 24 24">
                <Path d="M9 21v-6a2 2 0 0 1 2-2h1.6" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m20 11l-8-8l-9 9h2v7a2 2 0 0 0 2 2h4.159" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M18 14.5V16" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M18 20v1.5" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m21.032 16.25-1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m16.269 19 1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m16.269 16.25 1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m21.032 19-1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="Open Sync settings"
            accessibilityRole="button"
            onPress={() => setIsSettingsOpen(true)}
            style={styles.utilityButton}
          >
            <View style={styles.utilityInner}>
              <Svg width="28" height="28" viewBox="0 0 24 24">
                <Path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        </View>
        <Svg width="100%" height="100%" viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`}>
          <Defs>
            <Mask
              id="goal-mask"
              x={35}
              y={537}
              width={1800}
              height={3200}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
            >
              <Image href={fitnessAssets.goalMask} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
            </Mask>
            <Mask
              id="speedometer-mask"
              x={0}
              y={0}
              width={1800}
              height={3200}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
            >
              <Image href={fitnessAssets.speedometerMask} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
            </Mask>
            <Mask
              id="distance-mask"
              x={0}
              y={0}
              width={1800}
              height={3200}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
            >
              <Image href={fitnessAssets.distanceMask} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
            </Mask>
          </Defs>

          <Image href={fitnessAssets.backgroundBase} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
          <Image href={fitnessAssets.backgroundDesign} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
          <Image href={fitnessAssets.syncPointBar} x={0} y={101} width={1747} height={237} preserveAspectRatio="none" />
          <Image href={fitnessAssets.syncPointAccent} x={0} y={337} width={892} height={166} preserveAspectRatio="none" />
          <Text x={193} y={198.04} fill="#e9dfc5" fontSize={106.012} fontWeight="700">SYNC POINT</Text>
          <Text x={315} y={418.99} fill="#e83a2a" fontSize={105.805} fontWeight="700">{`+${workout.syncPointsReward}`}</Text>

          <Image href={fitnessAssets.goalFill} x={35} y={537} width={914} height={267} preserveAspectRatio="none" mask="url(#goal-mask)" />
          <Path
            d={`M 90 686.25 H ${90 + goalBarWidth} L ${Math.max(90, 90 + goalBarWidth - 40)} 766.25 H 90 Z`}
            fill="#f4c312"
          />
          <Text x={103} y={672} fill="#fff7f7" fontSize={116} fontWeight="400">{formatGoalTime(workout.remainingMinutes)}</Text>

          <Path
            d="M 40 835 L 705 835 L 705 1068 L 545 1210 L 40 1210 Z"
            fill="#020303"
          />
          <Text x={72} y={921.5} fill="#ffffff" fontSize={49.915}>{selectedHolobot.name}</Text>
          <Path d="M 72 1018 H 545 V 1043 H 72 Z" fill="#171717" />
          <Path d={`M 72 1018 H ${72 + expProgressWidth} V 1043 H 72 Z`} fill="#f4c312" />
          <Text x={89} y={1009} fill="#ffffff" fontSize={24.794} fontWeight="700">{`EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
          <Text x={71} y={1119.3} fill="#ffffff" fontSize={100.722}>{`Lv ${selectedHolobot.level}`}</Text>

          <Path
            d="M 838 1091 L 1600 1091 L 1700 1091 L 1648 1204 L 785 1204 Z"
            fill="#020303"
          />
          <Image href={fitnessAssets.changeIconBack} x={1533} y={1012} width={169} height={160} preserveAspectRatio="none" />
          <Image href={fitnessAssets.changeIconFront} x={1514} y={993} width={218} height={211} preserveAspectRatio="none" />
          <Text x={900} y={1160} fill="#e9dfc5" fontSize={55} fontWeight="700">CHANGE HOLOBOT</Text>

          <Image href={fitnessAssets.speedometerFill} x={406} y={1265} width={954} height={954} preserveAspectRatio="none" mask="url(#speedometer-mask)" />
          <G transform={`rotate(${needleAngle} ${NEEDLE_CENTER_X} ${NEEDLE_CENTER_Y})`}>
            <Image href={fitnessAssets.speedometerNeedle} x={811} y={1621} width={366} height={211} preserveAspectRatio="none" />
          </G>
          <Text x={729} y={1540.12} fill="#e9dfc5" fontSize={89.466} fontWeight="700">{formatSpeed(displaySpeed, distanceUnit)}</Text>
          <Text x={729} y={1608} fill="#e9dfc5" fontSize={37.004} fontWeight="700">Movement speed</Text>

          <Image href={fitnessAssets.distanceFill} x={92} y={1915} width={1639} height={385} preserveAspectRatio="none" mask="url(#distance-mask)" />
          {workout.syncPointBoostCount > 0 ? (
            <G transform="translate(610 2020)">
              <Path
                d="M9 12H5.414a1 1 0 0 1-.707-1.707l6.586-6.586a1 1 0 0 1 1.414 0l6.586 6.586A1 1 0 0 1 18.586 12H15v3H9zm0 9h6m-6-3h6"
                stroke="#f0bf14"
                strokeWidth={2.6}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </G>
          ) : null}
          <Text x={788} y={2074.31} fill="#e9dfc5" fontSize={121.544}>{displayDistance.toFixed(3)}</Text>
          <Text x={793} y={2180.08} fill="#e9dfc5" fontSize={45.702} fontWeight="500">{formatDistanceLabel(distanceUnit)}</Text>
          {syncBoostCopy ? (
            <Text x={794} y={2232} fill="#f0bf14" fontSize={34} fontWeight="700">
              {syncBoostCopy}
            </Text>
          ) : null}

          <Image href={fitnessAssets.bottomElement} x={0} y={2208} width={1800} height={992} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardSync} x={244} y={2429} width={116} height={131} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardHolos} x={740} y={2433} width={109} height={110} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardExp} x={1196} y={2433} width={119} height={118} preserveAspectRatio="none" />
          <Text x={410} y={2494} fill="#e9dfc5" fontSize={96.929} fontWeight="700">{`+${workout.syncPointsReward}`}</Text>
          <Text x={882} y={2494} fill="#e9dfc5" fontSize={95.215} fontWeight="700">{`+${workout.holosReward}`}</Text>
          <Text x={1353} y={2493.96} fill="#e9dfc5" fontSize={91.406} fontWeight="700">{`+${workout.expReward}`}</Text>

          <Image href={fitnessAssets.goButton} x={20} y={2606} width={1695} height={446} preserveAspectRatio="none" />
          <Text x={goLabel === "PAUSE" ? 635 : goLabel === "RESUME" ? 610 : 740} y={2868} fill="#eeb818" fontSize={204.86} fontWeight="700">{goLabel}</Text>
        </Svg>

        <Pressable
          accessibilityLabel={workout.isRunning ? "Pause workout" : "Start workout"}
          accessibilityRole="button"
          onLongPress={workout.resetWorkout}
          onPress={workout.toggleRunning}
          style={styles.goHotspot}
        />
        <Pressable
          accessibilityLabel="Change active holobot"
          accessibilityRole="button"
          onPress={() => setIsPickerOpen(true)}
          style={styles.changeHolobotHotspot}
        />
        <View pointerEvents="none" style={styles.holobotPortrait}>
          <RNImage source={selectedHolobot.imageSource} style={styles.fillImage} resizeMode="contain" />
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
        <SyncRewardsModal
          canQuickRefill={workout.canQuickRefill}
          cooldownCopy={rewardCooldownCopy}
          onClose={() => void handleCollectRewards()}
          onQuickRefill={() => void handleRewardQuickRefill()}
          rewards={{
            exp: completionResult?.expReward ?? 0,
            holos: completionResult?.holosReward ?? 0,
            syncPoints: completionResult?.syncPointsReward ?? 0,
          }}
          sessionsCopy={rewardSessionsCopy}
          visible={Boolean(completionResult)}
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
                      <Path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5a.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1m5-9l-2 4h3l-2 4" stroke="#f0bf14" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                </View>
              </View>

              <Pressable style={styles.closeSettingsButton} onPress={() => setIsSettingsOpen(false)}>
                <RNText style={styles.closeSettingsText}>CLOSE</RNText>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </FigmaCanvas>
  );
}

const styles = StyleSheet.create({
  changeHolobotHotspot: {
    position: "absolute",
    left: "43.6111%",
    top: "34.125%",
    width: "51.6667%",
    height: "9.0625%",
  },
  closeSettingsButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 52,
  },
  closeSettingsText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  fillImage: {
    width: "100%",
    height: "100%",
  },
  goHotspot: {
    position: "absolute",
    left: "1.111%",
    top: "81.4375%",
    width: "94.1667%",
    height: "13.9375%",
  },
  holobotPortrait: {
    position: "absolute",
    left: "51.2%",
    top: "9.6%",
    width: "34.4444%",
    height: "21.5%",
  },
  settingsBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  settingsCard: {
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  settingsCopy: {
    color: "#d5cbb2",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  settingsCopySmall: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  settingsEyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  settingsLabel: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  settingsMeta: {
    color: "#8f866f",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
  },
  settingsSection: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
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
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 8,
  },
  toggleButton: {
    alignItems: "center",
    borderColor: "#5b4b18",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  toggleButtonActive: {
    backgroundColor: "#f0bf14",
    borderColor: "#f0bf14",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  toggleText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  toggleTextActive: {
    color: "#050606",
  },
  utilityButton: {},
  utilityInner: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
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
  utilityStack: {
    gap: 10,
    position: "absolute",
    right: 18,
    top: 72,
    zIndex: 20,
  },
  refillButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 2,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  refillButtonDisabled: {
    opacity: 0.45,
  },
});
