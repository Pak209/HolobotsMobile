import { Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "@/theme";
import { CHIP_HEIGHT, PLATE_POSITION, READINESS_TEXT, commandPlateLayout, hexPoints, plateCut, type FinisherReadiness } from "./duel/commandPlateLayout";
import { HoloCommandGlyph, LineFrame, PlateFrame, useBoxSize } from "./duel/HoloHudArt";
import { HOLO_COMMAND_GLYPHS } from "./duel/holoCommandGlyphs";

export type { FinisherReadiness } from "./duel/commandPlateLayout";

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
  /** Which HoloCity plate this command is drawn as (glyph and row slot) when its id is not one of the four plate ids
   * (PvP passes its own move ids). */
  art?: "strike" | "heavy" | "defend" | "finisher";
  /** FINISHER only: the engine's readiness, shown as the LOCKED / HALF READY / FULL READY chip. */
  readiness?: FinisherReadiness;
};

/** HoloCombatHudView command parity + InputBindings Command0/1/2/3.
 * Unity reads costs from the host; none are invented by this presentation view.
 * R1/L2/R2/X are Unity's PlayStation/generic-pad glyphs, used in replay mode.
 * lite-battle-ui-1: plate colours follow Pak's 10-14 concept (cyan STRIKE, orange HEAVY, yellow DEFEND, gold FINISHER).
 */
export const HOLOCITY_COMMANDS: readonly HoloCityCommand[] = [
  { id: "strike", label: "STRIKE", glyph: "R1", accent: theme.hud.plate.strike },
  { id: "heavy", label: "HEAVY", glyph: "L2", accent: theme.hud.plate.heavy },
  { id: "defend", label: "DEFEND", glyph: "R2", accent: theme.hud.plate.defend },
  { id: "finisher", label: "FINISHER", glyph: "X", accent: theme.hud.plate.finisher },
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

/** The FINISHER readiness chip (Unity's badge above the finisher tile): dim slate / amber outline / solid gold. */
export function FinisherReadinessChip({ readiness }: { readiness: FinisherReadiness }) {
  const tone = theme.hud.readiness[readiness];
  const [box, onLayout] = useBoxSize();
  return <View onLayout={onLayout} testID={`finisher-readiness-${readiness}`} accessibilityLabel={`Finisher ${READINESS_TEXT[readiness].toLowerCase()}`} style={styles.readiness}>
    <LineFrame width={box.width} height={box.height} points={hexPoints(box.width, box.height, 6)} fill={tone.fill} stroke={readiness === "locked" ? theme.colors.border : theme.hud.plate.finisher} />
    <Text numberOfLines={1} style={[styles.readinessText, { color: tone.text }]}>{READINESS_TEXT[readiness]}</Text>
  </View>;
}

/** HoloCity's four command plates in ONE row, as the HoloCity fight HUD draws them (lite-hud-row-1, Pak 2026-10-22):
 * STRIKE · HEAVY · DEFEND · FINISHER, each a hex plate with the Unity glyph, command, move name and the STA cost chip in
 * the bottom notch. Presentation of the commands it is given; it decides nothing. */
export function HoloCityCommandBar({ commands = HOLOCITY_COMMANDS, selected, disabled = false, compact = false, onPress, style }: HoloCityCommandBarProps) {
  const window = useWindowDimensions();
  // The duel stages inset the bar 14 pt each side; measure the real width once laid out.
  const [box, onLayout] = useBoxSize({ width: window.width - 28, height: 0 });
  const layout = commandPlateLayout(box.width, { compact, count: commands.length });
  const ordered = commands.map((command, index) => ({ command, index, position: PLATE_POSITION[command.art ?? command.id] ?? index })).sort((a, b) => a.position - b.position);
  return <View onLayout={onLayout} style={[styles.bar, { height: layout.height }, style]}>
    {ordered.map(({ command, index }, slotIndex) => {
      const slot = layout.slots[slotIndex];
      const active = selected === command.id;
      const blocked = disabled || command.disabled;
      const accent = command.accent ?? theme.hud.plate.strike;
      const plate = slot.plate;
      const glyph = HOLO_COMMAND_GLYPHS[(command.art ?? command.id) as keyof typeof HOLO_COMMAND_GLYPHS];
      const side = plateCut(plate.width, plate.height);
      const chipWidth = slot.chip.width;
      const glyphSize = Math.round(plate.height * 0.3);
      const dim = !!blocked && !active;
      const body = <>
        <PlateFrame width={plate.width} height={plate.height} points={hexPoints(plate.width, plate.height, side)} accent={accent} lit={active} dim={dim} />
        <View pointerEvents="none" style={[styles.face, { left: side * 0.6, right: side * 0.6, height: plate.height - CHIP_HEIGHT / 2 }, dim && styles.disabled]}>
          {glyph ? <HoloCommandGlyph id={glyph.id} size={glyphSize} /> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.category, { color: accent }]}>{command.label}</Text>
          {command.detail ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.detail}>{command.detail}</Text> : null}
        </View>
        <View pointerEvents="none" style={[styles.chip, { left: (plate.width - chipWidth) / 2, top: plate.height - CHIP_HEIGHT / 2, width: chipWidth }, dim && styles.chipDim]}>
          <LineFrame width={chipWidth} height={CHIP_HEIGHT} points={hexPoints(chipWidth, CHIP_HEIGHT, 7)} fill={theme.hud.chipFill} stroke={theme.hud.chipStroke} />
          {/* Replay only: the pad glyph this command maps to in HoloCity, as a keycap in the chip (touch play shows none). */}
          {!onPress && command.glyph ? <View style={[styles.socket, { borderColor: active ? accent : theme.colors.border }]}><Text style={styles.glyph}>{command.glyph}</Text></View> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.cost}>{command.cost ?? "UNAVAILABLE"}</Text>
        </View>
      </>;
      const accessibilityLabel = `${command.label}, ${command.detail ? `${command.detail}, ` : ""}${command.cost ?? "cost unavailable"}${command.readiness ? `, ${READINESS_TEXT[command.readiness].toLowerCase()}` : ""}${active ? ", current action" : ""}`;
      const position = { left: slot.x, top: slot.y, width: slot.width, height: slot.height };
      return onPress ? <Pressable key={command.id} testID={`command-plate-${command.id}`} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!blocked, selected: active }} disabled={!!blocked} onPress={() => onPress(command.id)} style={({ pressed }) => [styles.slot, position, pressed && styles.pressed]}>{body}</Pressable> :
        <View key={command.id ?? index} testID={`command-plate-${command.id}`} accessible accessibilityLabel={accessibilityLabel} style={[styles.slot, position]}>{body}</View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  bar: { position: "relative", width: "100%" },
  slot: { position: "absolute" },
  face: { position: "absolute", top: 0, alignItems: "center", justifyContent: "center", gap: 1 },
  category: { ...theme.type.label, fontSize: 12, lineHeight: 15, letterSpacing: 1 },
  detail: { ...theme.type.caption, color: theme.colors.text, fontSize: 9.5, lineHeight: 12 },
  chip: { position: "absolute", height: CHIP_HEIGHT, flexDirection: "row", gap: 3, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  cost: { ...theme.type.micro, flexShrink: 1, color: theme.hud.chipText, fontSize: 9, lineHeight: 12, letterSpacing: 0.6 },
  socket: { minWidth: 16, height: 12, paddingHorizontal: 2, backgroundColor: theme.plates.keycap, borderWidth: 1, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  glyph: { ...theme.type.micro, fontSize: 7, lineHeight: 9, color: theme.colors.text },
  readiness: { minWidth: 76, height: 22, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  readinessText: { ...theme.type.micro, fontSize: 9, lineHeight: 12, letterSpacing: 1 },
  /** Unavailable or in flight: dimmed as before (0.45), but only the plate's contents, so the carbon face stays solid. */
  disabled: { opacity: 0.45 },
  chipDim: { opacity: 0.7 },
  pressed: { opacity: 0.75 },
});
