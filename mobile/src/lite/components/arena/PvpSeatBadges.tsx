import { Image, StyleSheet, Text, View } from "react-native";

import { getHolobotFullImageSource } from "@/config/holobots";
import { pvpSeatBadge, type PvpHostView } from "@/lite/lib/bots/pvpFighterLevel";
import { theme } from "@/lite/theme";
import type { BattleRoom, PlayerRole } from "@/types/battle-room";

/**
 * PvP seat cards: each seat's live Holobot with ONLY the seat-snapshot level from pvp-room-fighters-1 replies.
 * DECISIONS #71 (10): the LV badge is a tab on the portrait's lower-left corner. With no snapshot there is no tab
 * at all (lite critic L22: no bare placeholder).
 */
export function PvpSeatBadges({ room, myRole, view, pending, compact = false }: {
  room: BattleRoom;
  myRole: PlayerRole;
  /** Merged pvpRoomFighterHost replies; null until it answers (or while it is not deployed). */
  view: PvpHostView | null;
  pending: Record<PlayerRole, boolean>;
  compact?: boolean;
}) {
  const seats: Array<[PlayerRole, string]> = [[myRole, "YOU"], [myRole === "p1" ? "p2" : "p1", "RIVAL"]];
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {seats.map(([role, label]) => {
        const name = room.players[role]?.holobotName || "";
        const badge = name ? pvpSeatBadge(view, room, role, name, pending[role]) : null;
        return (
          <View key={role} style={[styles.seat, compact && styles.seatCompact]}>
            <View style={[styles.portrait, compact && styles.portraitCompact]}>
              {name ? <Image source={getHolobotFullImageSource(name)} style={styles.art} resizeMode="contain" /> : null}
              {badge ? (
                <Text accessibilityLabel={badge.accessibilityLabel} style={[styles.tab, badge.kind === "pending" && styles.tabMuted]}>
                  {badge.text}
                </Text>
              ) : null}
            </View>
            <View style={styles.body}>
              <Text style={styles.label}>{label}</Text>
              <Text numberOfLines={1} style={styles.name}>{name || "WAITING"}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  rowCompact: { marginTop: 0, paddingHorizontal: 14, paddingBottom: 6 },
  seat: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    padding: 6,
  },
  seatCompact: { gap: 6, padding: 3 },
  portrait: { borderColor: theme.colors.border, borderWidth: 1, height: 64, overflow: "hidden", width: 64 },
  portraitCompact: { height: 40, width: 40 },
  art: { height: "100%", width: "100%" },
  // Lower-left corner tab, flush with the portrait's bottom and left edges.
  tab: { ...theme.type.micro, backgroundColor: theme.colors.carbon, bottom: 0, color: theme.colors.text, left: 0, paddingHorizontal: 4, position: "absolute" },
  tabMuted: { color: theme.colors.muted },
  body: { flexShrink: 1 },
  label: { ...theme.type.micro, color: theme.colors.muted },
  name: { ...theme.type.micro, color: theme.colors.text },
});
