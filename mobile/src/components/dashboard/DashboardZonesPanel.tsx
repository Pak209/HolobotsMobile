import { theme } from "@/theme";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GameDialogFrame, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import type { DashboardZoneRow } from "@/lib/hostDashboard";

/**
 * Dashboard ZONES entry (mirrors the TRAVEL SQUAD entry) and the host's destination rows. Rows, names and
 * OPEN / NOT YET AVAILABLE labels are the desktopAccountSnapshot zones verbatim; this never unlocks or routes.
 * Copy marked PLACEHOLDER is for Lex.
 */
export function DashboardZonesPanel({ summary, zones, onRetry }: { summary: string; zones: readonly DashboardZoneRow[] | null; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable style={styles.entry} testID="dashboard-zones-entry" accessibilityRole="button" accessibilityLabel={`Zones. ${summary}`} onPress={() => setOpen(true)}>
      <GameSurfaceFrame accent={theme.colors.accent} fill={theme.plates.navy} />
      {/* PLACEHOLDER copy */}
      <Text style={styles.entryTitle}>ZONES</Text>
      <Text style={styles.entrySummary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{summary}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy} />
        {/* PLACEHOLDER copy */}
        <Text style={styles.heading}>ZONES</Text>
        <Text style={styles.help}>Destination status from your account.</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {zones ? zones.map(zone => <View key={zone.zoneId} testID={`dashboard-zone-${zone.zoneId}`} style={styles.row} accessible accessibilityLabel={`${zone.name}: ${zone.status}`}>
            <GameSurfaceFrame accent={zone.open ? theme.colors.accent : theme.colors.border} fill={theme.plates.navy} />
            <Text style={styles.name} numberOfLines={1}>{zone.name}</Text>
            <Text style={[styles.status, !zone.open && styles.closed]} numberOfLines={1}>{zone.status}</Text>
          </View>) : <Text style={styles.unavailable} accessibilityLiveRegion="polite">{summary}</Text>}
        </ScrollView>
        <View style={styles.actions}>
          {!zones && onRetry ? <Pressable style={styles.action} onPress={onRetry} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.accent} /><Text style={styles.actionText}>RETRY</Text></Pressable> : null}
          <Pressable style={styles.action} onPress={() => setOpen(false)} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.accent} /><Text style={styles.actionText}>BACK</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  // Left twin of the TRAVEL SQUAD entry (left 47%, top 62.8%, 46% x 5.2%), in the empty band under the info card.
  entry: { position: "absolute", left: "6.5%", top: "62.8%", width: "38%", height: "5.2%", zIndex: 30, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  entryTitle: { color: theme.colors.accent, fontFamily: "HoloBody", fontSize: 11, fontWeight: "800" },
  entrySummary: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: theme.type.micro.fontSize, marginTop: 3 },
  backdrop: { flex: 1, backgroundColor: "#000b", padding: 20, alignItems: "center", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 620, maxHeight: "92%", padding: 24, gap: 12 },
  heading: { color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: 24, fontWeight: "900" },
  help: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: 13, lineHeight: 19 },
  list: { flexShrink: 1 }, listContent: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingHorizontal: 16, gap: 12 },
  name: { flex: 1, color: theme.colors.text, fontFamily: "HoloDisplay", fontSize: 18, fontWeight: "800" },
  status: { color: theme.colors.accent, fontFamily: "HoloBody", fontSize: 12, fontWeight: "800" },
  closed: { color: theme.colors.muted },
  unavailable: { color: "#f0cf70", fontFamily: "HoloBody", fontSize: 13, lineHeight: 19, minHeight: 38 },
  actions: { flexDirection: "row", gap: 10 }, action: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center" },
  actionText: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: 13, fontWeight: "800" },
});
