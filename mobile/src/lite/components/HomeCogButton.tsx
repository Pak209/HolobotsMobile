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

// Build-time config: a release build without an allowed overworld host never offers STORY (L10).
const STORY_AVAILABLE = isStoryOverworldAvailable();

type HomeCogButtonProps = { onOpenPvp?: () => void; showSettings?: boolean; showStats?: boolean; topOffset?: number };

/** One unobtrusive HUD key opens the shared navigation, rather than covering screen content. */
export function HomeCogButton({ onOpenPvp, showSettings = true, showStats = true, topOffset }: HomeCogButtonProps) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const top = topOffset ?? (route.name === "Overworld" ? insets.top + 124 : insets.top + 10);
  const choose = (action: () => void) => { setMenuOpen(false); action(); };
  const actions = [
    { label: "DASHBOARD", accessibility: "Go to home dashboard", action: () => navigation.navigate("Home") },
    { label: "HOLOCITY", accessibility: "Explore HoloCity", action: () => navigation.navigate("CityHub") },
    ...(showStats ? [{ label: "PILOT STATS", accessibility: "Open pilot stats", action: () => setIsStatsOpen(true) }] : []),
    ...(showSettings ? [{ label: "SETTINGS", accessibility: "Open dashboard settings", action: () => setIsDashboardSettingsOpen(true) }] : []),
    ...(STORY_AVAILABLE ? [{ label: "STORY", accessibility: "Open story mode overworld", action: () => navigation.navigate("Overworld") }] : []),
    ...(onOpenPvp ? [{ label: "PVP ARENA", accessibility: "Open PVP arena menu", action: onOpenPvp }] : []),
  ];
  return <>
    <View pointerEvents="box-none" style={styles.overlay}>
      {menuOpen && <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Close pilot menu" />}
      <Pressable style={[styles.trigger, { top, right: 18 + insets.right }]} accessibilityRole="button" accessibilityLabel={menuOpen ? "Close pilot menu" : "Open pilot menu"} accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(!menuOpen)}>
        <GameSurfaceFrame fill={theme.plates.keycap} /><Text style={styles.glyph}>{menuOpen ? "×" : "≡"}</Text>
      </Pressable>
      {menuOpen && <View style={[styles.menu, { top: top + 56, right: 18 + insets.right }]}>
        <GameSurfaceFrame fill={theme.plates.keycap} />
        <Text style={styles.eyebrow}>PILOT MENU</Text>
        {actions.map(item => <Pressable key={item.label} onPress={() => choose(item.action)} style={styles.action} accessibilityRole="button" accessibilityLabel={item.accessibility}>
          <Text style={styles.actionLabel}>{item.label}</Text><Text style={styles.chevron}>›</Text>
        </Pressable>)}
      </View>}
    </View>
    {showStats && <UserStatsModal visible={isStatsOpen} onClose={() => setIsStatsOpen(false)} profile={profile}
      onOpenGacha={() => { setIsStatsOpen(false); navigation.navigate("Gacha"); }}
      onOpenLeaderboard={() => { setIsStatsOpen(false); navigation.navigate("Leaderboard"); }} />}
    {showSettings && <DashboardSettingsModal visible={isDashboardSettingsOpen} onClose={() => setIsDashboardSettingsOpen(false)} />}
  </>;
}
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  trigger: { position: "absolute", width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  glyph: { color: theme.colors.accent, fontSize: 28 },
  menu: { position: "absolute", width: 224, padding: 16 },
  eyebrow: { ...theme.type.micro, letterSpacing: 1.4, color: theme.colors.accent, marginBottom: 6 },
  action: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: theme.colors.border },
  actionLabel: { ...theme.type.label, color: theme.colors.text, letterSpacing: 0.8 },
  chevron: { ...theme.type.header, color: theme.colors.accent },
});
