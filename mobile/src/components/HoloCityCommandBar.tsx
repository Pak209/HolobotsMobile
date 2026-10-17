import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "@/theme";

export type HoloCityCommand = {
  id: string;
  label: string;
  /** Already-formatted host/engine cost. Absent values remain unavailable. */
  cost?: string | null;
  detail?: string;
  /** Display-only input socket; supplying a glyph does not bind a controller. */
  glyph?: string;
  accent?: string;
  disabled?: boolean;
};

/** HoloCombatHudView command parity + InputBindings Command0/1/2/3.
 * Unity reads costs from the host; none are invented by this presentation view.
 * R1/L2/R2/X are Unity's PlayStation/generic-pad glyphs, used in replay mode.
 */
export const HOLOCITY_COMMANDS: readonly HoloCityCommand[] = [
  { id: "strike", label: "STRIKE", glyph: "R1", accent: theme.rings.player[0] },
  { id: "heavy", label: "HEAVY", glyph: "L2", accent: theme.rings.rival[0] },
  { id: "defend", label: "DEFEND", glyph: "R2", accent: theme.rings.rival[2] },
  { id: "finisher", label: "FINISHER", glyph: "X", accent: theme.rings.player[2] },
];

export type HoloCityCommandBarProps = {
  commands?: readonly HoloCityCommand[];
  selected?: string | null;
  disabled?: boolean;
  compact?: boolean;
  /** Omit for an informational replay: the bar never changes combat state. */
  onPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

/** A portrait 2×2 adaptation of HoloCity's four command plates. */
export function HoloCityCommandBar({ commands = HOLOCITY_COMMANDS, selected, disabled = false, compact = false, onPress, style }: HoloCityCommandBarProps) {
  return <View style={[styles.bar, style]}>
    {commands.map((command, index) => {
      const active = selected === command.id;
      const blocked = disabled || command.disabled;
      const accent = command.accent ?? theme.rings.player[index % 3];
      // Touch controls must describe the input this component actually handles.
      const glyph = onPress ? "TAP" : command.glyph;
      const tileStyle = [styles.tile, compact && styles.compactTile, { borderColor: active ? accent : theme.colors.border }, active && styles.activeTile, blocked && !active && styles.disabled];
      const body = <>
        <View pointerEvents="none" style={[styles.accent, { backgroundColor: accent }]} />
        <View style={styles.heading}>
          <Text numberOfLines={1} style={[styles.category, { color: accent }]}>{command.label}</Text>
          {glyph ? <View style={[styles.socket, { borderColor: active ? accent : theme.colors.border }]}><Text style={styles.glyph}>{glyph}</Text></View> : null}
        </View>
        {command.detail ? <Text numberOfLines={1} style={styles.detail}>{command.detail}</Text> : null}
        <View style={styles.footer}>
          <Text numberOfLines={1} style={styles.cost}>{command.cost ?? "UNAVAILABLE"}</Text>
          {active ? <Text style={[styles.state, { color: accent }]}>{onPress ? "SELECTED" : "PLAYING"}</Text> : null}
        </View>
      </>;
      const accessibilityLabel = `${command.label}, ${command.detail ? `${command.detail}, ` : ""}${command.cost ?? "cost unavailable"}${active ? ", current action" : ""}`;
      return onPress ? <Pressable key={command.id} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!blocked, selected: active }} disabled={!!blocked} onPress={() => onPress(command.id)} style={({ pressed }) => [...tileStyle, pressed && styles.pressed]}>{body}</Pressable> :
        <View key={command.id} accessible accessibilityLabel={accessibilityLabel} style={tileStyle}>{body}</View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexBasis: "48%", flexGrow: 1, minWidth: 0, minHeight: 86, backgroundColor: theme.colors.carbon, borderWidth: 1, borderRadius: theme.radius.sm, paddingHorizontal: 11, paddingVertical: 9, gap: 5, position: "relative", overflow: "hidden" },
  compactTile: { minHeight: 68, paddingVertical: 7 },
  activeTile: { backgroundColor: theme.plates.raised },
  accent: { position: "absolute", left: 0, top: 10, bottom: 10, width: 2 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  category: { ...theme.type.label, letterSpacing: 1, flexShrink: 1 },
  socket: { minWidth: 27, height: 24, paddingHorizontal: 4, backgroundColor: theme.plates.keycap, borderWidth: 1, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  glyph: { ...theme.type.micro, color: theme.colors.text },
  detail: { ...theme.type.caption, color: theme.colors.muted, fontSize: 10, lineHeight: 14 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, marginTop: "auto" },
  cost: { ...theme.type.micro, color: theme.colors.muted, flexShrink: 1 },
  state: { ...theme.type.micro, fontSize: 8, letterSpacing: 0.5 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
