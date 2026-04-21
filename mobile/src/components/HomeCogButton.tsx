import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { DashboardSettingsModal } from "@/components/DashboardSettingsModal";
import { Svg, Path } from "@/components/FigmaSvg";
import { UserStatsModal } from "@/components/UserStatsModal";
import { useAuth } from "@/contexts/AuthContext";
import type { RootTabs } from "../../App";

type HomeCogButtonProps = {
  onOpenPvp?: () => void;
  showSettings?: boolean;
  showStats?: boolean;
};

export function HomeCogButton({
  onOpenPvp,
  showSettings = true,
  showStats = true,
}: HomeCogButtonProps) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { profile } = useAuth();
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);

  return (
    <>
      <View style={styles.cluster}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to home dashboard"
          onPress={() => navigation.navigate("Home")}
          style={styles.button}
        >
          <View style={styles.inner}>
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
        {showStats ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open pilot stats"
            onPress={() => setIsStatsOpen(true)}
            style={styles.button}
          >
            <View style={styles.inner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path
                  d="M17 17v-4l-5 3l-5-3v4l5 3zm0-9V4l-5 3l-5-3v4l5 3z"
                  stroke="#f5c40d"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </Pressable>
        ) : null}
        {showSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open dashboard settings"
            onPress={() => setIsDashboardSettingsOpen(true)}
            style={styles.button}
          >
            <View style={styles.inner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        ) : null}
        {onOpenPvp ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open PVP arena menu"
            onPress={onOpenPvp}
            style={styles.button}
          >
            <View style={styles.inner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-17.87a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        ) : null}
      </View>
      {showStats ? (
        <UserStatsModal
          onClose={() => setIsStatsOpen(false)}
          onOpenGacha={() => {
            setIsStatsOpen(false);
            navigation.navigate("Gacha");
          }}
          onOpenLeaderboard={() => {
            setIsStatsOpen(false);
            navigation.navigate("Leaderboard");
          }}
          profile={profile}
          visible={isStatsOpen}
        />
      ) : null}
      {showSettings ? (
        <DashboardSettingsModal
          onClose={() => setIsDashboardSettingsOpen(false)}
          visible={isDashboardSettingsOpen}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cluster: {
    gap: 10,
    position: "absolute",
    right: 18,
    top: 72,
    zIndex: 20,
  },
  button: {},
  inner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#050606",
    borderWidth: 2,
    borderColor: "#f0bf14",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
