import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DashboardSettingsModal } from "@/lite/components/DashboardSettingsModal";
import { UserStatsModal } from "@/lite/components/UserStatsModal";
import { isStoryOverworldAvailable } from "@/lite/config/storyMode";
import { useAuth } from "@/contexts/AuthContext";
import { theme } from "@/lite/theme";
import { Svg, Path } from "@/components/FigmaSvg";
import type { RootTabs } from "../../../LiteApp";

type HomeCogButtonProps = { onOpenPvp?: () => void; showSettings?: boolean; showStats?: boolean; topOffset?: number; onHome?: () => void };

/** Keep the OG navigation silhouettes; only the ring and ink take the City palette. */
function NavIcon({ kind }: { kind: string }) {
  const ink = theme.colors.accent;
  if (kind === "STORY") return <Text style={styles.storyLabel}>STORY</Text>;
  const paths: Record<string, string[]> = {
    HOME: ["M9 21v-6a2 2 0 0 1 2-2h1.6", "m20 11-8-8-9 9h2v7a2 2 0 0 0 2 2h4.159", "M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M18 14.5V16m0 4v1.5m3.032-5.25-1.299.75m-3.464 3 1.299.75m-1.299-3.5 1.299-.75m3.464 2.75-1.299-.75"],
    STATS: ["M17 17v-4l-5 3-5-3v4l5 3zm0-9V4l-5 3-5-3v4l5 3z"],
    SET: ["M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065", "M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0"],
    PVP: ["M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-17.87a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"],
    CITY: ["M3 21V8l6-3v16M9 21V3l12 4v14M6 10v2m0 3v2m7-9v2m4 0v2m-4 3v2m4 0v2M2 21h20"],
  };
  return <Svg width="29" height="29" viewBox="0 0 24 24">{paths[kind]?.map((d, i) => <Path key={i} d={d} stroke={ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}</Svg>;
}

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
          <View style={styles.ring}><NavIcon kind={key.label} /></View>
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
  ring: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: theme.colors.accent, backgroundColor: theme.plates.keycap, alignItems: "center", justifyContent: "center" },
  storyLabel: { ...theme.type.micro, color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
});
