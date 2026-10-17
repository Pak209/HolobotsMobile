import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon, Rect } from "react-native-svg";

type QuestBannerProps = {
  zone: string;
  objective: string | null;
};

// Reserved width for the minimap column on the right (96 map + 18 margin + 12 gap).
const MINIMAP_COLUMN = 96 + 18 + 12;

/**
 * Round D quest banner (docs/ART_STYLE_GUIDE.md): top-left zone plate with a cyan ring glyph and
 * an objective chip with a gold diamond marker. Translucent ink glass, cyan trim, angular only.
 */
export function QuestBanner({ zone, objective }: QuestBannerProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = Math.max(140, width - MINIMAP_COLUMN - 24 - insets.left - insets.right);

  return (
    <View
      pointerEvents="none"
      style={[styles.layer, { left: 12 + insets.left, maxWidth, top: insets.top + 12 }]}
    >
      <View style={styles.zonePlate}>
        <Svg height={14} viewBox="0 0 16 16" width={14}>
          <Polygon fill="none" points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5" stroke="#17d9ff" strokeWidth={1.5} />
          <Rect fill="#17d9ff" height={4} width={4} x={6} y={6} />
        </Svg>
        <Text numberOfLines={1} style={styles.zoneText}>
          {zone.toUpperCase()}
        </Text>
      </View>
      {objective ? (
        <View style={styles.objectiveChip}>
          <Svg height={12} viewBox="0 0 12 12" width={12}>
            <Polygon fill="#f0bf14" points="6,0.5 11.5,6 6,11.5 0.5,6" />
            <Polygon fill="#050606" points="6,3.5 8.5,6 6,8.5 3.5,6" />
          </Svg>
          <Text numberOfLines={1} style={styles.objectiveText}>
            {objective}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: "flex-start",
    position: "absolute",
    zIndex: 25,
  },
  objectiveChip: {
    alignItems: "center",
    backgroundColor: "rgba(5,6,6,0.62)",
    borderColor: "rgba(23,217,255,0.55)",
    borderTopWidth: 0,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  objectiveText: {
    color: "#ddd2b5",
    flexShrink: 1,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  zonePlate: {
    alignItems: "center",
    backgroundColor: "rgba(5,6,6,0.62)",
    borderColor: "#17d9ff",
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  zoneText: {
    color: "#fef1e0",
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
  },
});
