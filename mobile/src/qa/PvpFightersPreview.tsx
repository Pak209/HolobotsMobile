import { StyleSheet, Text, View } from "react-native";

import { PvpSeatBadges } from "@/components/arena/PvpSeatBadges";
import { theme } from "@/theme";
import { pvpFightersFixtures } from "./pvpFightersFixtures";

/** Offline QA routes for lite PvP level badges (holobotsmobile://qa/PvpFighters…). Recorded replies only; no network call. */
export const pvpFightersPreviewScreens = Object.fromEntries(Object.entries(pvpFightersFixtures).map(([name, cell]) => [
  name,
  function PvpFightersPreview() {
    return (
      <View style={styles.root}>
        <Text style={styles.banner}>QA / OFFLINE / RECORDED REPLIES</Text>
        <Text style={styles.title}>{`PVP LEVELS · ${cell.title}`}</Text>
        <Text style={styles.caption}>{cell.caption}</Text>
        <Text style={styles.section}>ROOM PANEL</Text>
        <PvpSeatBadges room={cell.room} myRole="p1" view={cell.view} pending={cell.pending} />
        <Text style={styles.section}>LIVE BATTLE TOP BAR</Text>
        <PvpSeatBadges room={cell.room} myRole="p1" view={cell.view} pending={cell.pending} compact />
      </View>
    );
  },
]));

const styles = StyleSheet.create({
  root: { backgroundColor: "#101820", flex: 1, paddingHorizontal: 16, paddingTop: 64 },
  banner: { ...theme.type.micro, color: "#62DDE8", textAlign: "center" },
  title: { ...theme.type.micro, color: theme.colors.text, fontSize: 16, lineHeight: 22, marginTop: 14, textAlign: "center" },
  caption: { ...theme.type.micro, color: theme.colors.muted, marginTop: 6, textAlign: "center" },
  section: { ...theme.type.micro, color: theme.colors.muted, marginTop: 22 },
});
