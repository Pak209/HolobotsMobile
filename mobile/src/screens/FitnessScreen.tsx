import { useMemo, useState } from "react";
import { Image as RNImage, Pressable, StyleSheet, View } from "react-native";

import { FigmaCanvas } from "@/components/FigmaCanvas";
import { HomeCogButton } from "@/components/HomeCogButton";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { Svg, Defs, G, Image, Mask, Path, Text } from "@/components/FigmaSvg";
import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH, fitnessAssets } from "@/config/figmaAssets";
import { getExpProgress, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkout } from "@/hooks/useWorkout";

const NEEDLE_MIN_ANGLE = -150;
const NEEDLE_MAX_ANGLE = -35;
const NEEDLE_MAX_SPEED = 20;
const NEEDLE_CENTER_X = 918;
const NEEDLE_CENTER_Y = 1733;

function formatGoalTime(remainingMinutes: number) {
  return `Time:  ${String(remainingMinutes).padStart(2, "0")}/20`;
}

function formatSpeed(speedKmh: number) {
  return `${Math.round(speedKmh)} km/h`;
}

export function FitnessScreen() {
  const { user, profile } = useAuth();
  const workout = useWorkout(user?.uid ?? null);
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const needleAngle = NEEDLE_MIN_ANGLE + (Math.min(workout.liveSpeedKmh, NEEDLE_MAX_SPEED) / NEEDLE_MAX_SPEED) * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
  const goalBarWidth = 698.125 * workout.progress;
  const expProgressWidth = 473 * getExpProgress(selectedHolobot);
  return (
    <FigmaCanvas>
      <View style={StyleSheet.absoluteFill}>
        <HomeCogButton />
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
          <Text x={103} y={672} fill="#fff7f7" fontSize={128} fontWeight="400">{formatGoalTime(workout.remainingMinutes)}</Text>

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
          <Text x={729} y={1540.12} fill="#e9dfc5" fontSize={89.466} fontWeight="700">{formatSpeed(workout.liveSpeedKmh)}</Text>
          <Text x={729} y={1608} fill="#e9dfc5" fontSize={37.004} fontWeight="700">Movement speed</Text>

          <Image href={fitnessAssets.distanceFill} x={92} y={1915} width={1639} height={385} preserveAspectRatio="none" mask="url(#distance-mask)" />
          <Text x={788} y={2074.31} fill="#e9dfc5" fontSize={121.544}>{workout.distanceKm.toFixed(3)}</Text>
          <Text x={793} y={2180.08} fill="#e9dfc5" fontSize={45.702} fontWeight="500">Kilometers</Text>

          <Image href={fitnessAssets.bottomElement} x={0} y={2208} width={1800} height={992} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardSync} x={244} y={2429} width={116} height={131} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardHolos} x={740} y={2433} width={109} height={110} preserveAspectRatio="none" />
          <Image href={fitnessAssets.rewardExp} x={1196} y={2433} width={119} height={118} preserveAspectRatio="none" />
          <Text x={410} y={2494} fill="#e9dfc5" fontSize={96.929} fontWeight="700">{`+${workout.syncPointsReward}`}</Text>
          <Text x={882} y={2494} fill="#e9dfc5" fontSize={95.215} fontWeight="700">{`+${workout.holosReward}`}</Text>
          <Text x={1353} y={2493.96} fill="#e9dfc5" fontSize={91.406} fontWeight="700">{`+${workout.expReward}`}</Text>

          <Image href={fitnessAssets.goButton} x={20} y={2606} width={1695} height={446} preserveAspectRatio="none" />
          <Text x={workout.isRunning ? 635 : 740} y={2868} fill="#eeb818" fontSize={204.86} fontWeight="700">{workout.isRunning ? "PAUSE" : "GO"}</Text>
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
  goHotspot: {
    position: "absolute",
    left: "1.111%",
    top: "81.4375%",
    width: "94.1667%",
    height: "13.9375%",
  },
  holobotPortrait: {
    position: "absolute",
    left: "51.6667%",
    top: "12.25%",
    width: "34.4444%",
    height: "22.75%",
  },
  fillImage: {
    width: "100%",
    height: "100%",
  },
});
