import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DashboardSettingsModal } from "@/lite/components/DashboardSettingsModal";
import { UserStatsModal } from "@/lite/components/UserStatsModal";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { isStoryOverworldAvailable } from "@/lite/config/storyMode";
import { useAuth } from "@/contexts/AuthContext";
import { theme } from "@/lite/theme";
import type { RootTabs } from "../../../LiteApp";

type HomeCogButtonProps = { onOpenPvp?: () => void; showSettings?: boolean; showStats?: boolean; topOffset?: number; onHome?: () => void };

/** OG's visible one-tap 52 pt key column, with the HoloCity plate treatment. */
export function HomeCogButton({ onOpenPvp, showSettings = true, showStats = true, topOffset, onHome }: HomeCogButtonProps) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const top = topOffset ?? (route.name === "Overworld" ? insets.top + 124 : insets.top + 10);
  const keys = [
    { label: "HOME", accessibility: "Go to home dashboard", action: () => onHome ? onHome() : navigation.navigate("Home") },
    ...(showStats ? [{ label: "STATS", accessibility: "Open pilot stats", action: () => setIsStatsOpen(true) }] : []),
    ...(showSettings ? [{ label: "SET", accessibility: "Open dashboard settings", action: () => setIsDashboardSettingsOpen(true) }] : []),
    ...(isStoryOverworldAvailable() ? [{ label: "STORY", accessibility: "Open story mode overworld", action: () => navigation.navigate("Overworld") }] : []),
    ...(onOpenPvp ? [{ label: "PVP", accessibility: "Open PVP arena menu", action: onOpenPvp }] : []),
    { label: "CITY", accessibility: "Explore HoloCity", action: () => navigation.navigate("CityHub") },
  ];
  return <>
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={[styles.cluster, { top, right: 18 + insets.right }]}>
        {keys.map(key => <Pressable key={key.label} style={styles.key} accessibilityRole="button" accessibilityLabel={key.accessibility} onPress={key.action}>
          <GameSurfaceFrame fill={theme.plates.keycap} accent={theme.colors.accent} strong />
          <Text style={styles.label} numberOfLines={1}>{key.label}</Text>
        </Pressable>)}
      </View>
    </View>
    {showStats && <UserStatsModal visible={isStatsOpen} onClose={() => setIsStatsOpen(false)} profile={profile}
      onOpenGacha={() => { setIsStatsOpen(false); navigation.navigate("Gacha"); }}
      onOpenLeaderboard={() => { setIsStatsOpen(false); navigation.navigate("Leaderboard"); }} />}
    {showSettings && <DashboardSettingsModal visible={isDashboardSettingsOpen} onClose={() => setIsDashboardSettingsOpen(false)} />}
  </>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  cluster: { position: "absolute", gap: 10 },
  key: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  label: { ...theme.type.micro, color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: 10, fontWeight: "900", letterSpacing: 0.1 },
});
