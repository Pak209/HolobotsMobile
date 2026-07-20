import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { MoveRank } from "@/features/arena/moveProgression";
import type { CardType } from "@/types/arena";
import {
  MoveActionFrame,
  MoveListFrame,
  MoveRowFrame,
} from "@/components/move-lab/MoveLabFrames";
import { getMoveIcon } from "@/components/move-lab/moveIconRegistry";

const MOVE_ACCENTS: Record<CardType, string> = {
  combo: "#2ce8ef",
  defense: "#3296ff",
  finisher: "#ffc51b",
  strike: "#ff453f",
};

export type AvailableMoveItem = {
  baseDamage: number;
  description: string;
  equipped: boolean;
  name: string;
  pending: boolean;
  rank: MoveRank;
  staminaCost: number;
  templateId: string;
  type: CardType;
};

type AvailableMovesPanelProps = {
  disabled: boolean;
  items: AvailableMoveItem[];
  onEquip: (templateId: string) => void;
  slotLabel: string;
};

export function AvailableMovesPanel({
  disabled,
  items,
  onEquip,
  slotLabel,
}: AvailableMovesPanelProps) {
  const accent = MOVE_ACCENTS[items[0]?.type || "strike"];

  return (
    <View style={[styles.panel, { shadowColor: accent }]}>
      <MoveListFrame accent={accent} />
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Image
            source={getMoveIcon(items[0]?.templateId, items[0]?.type || "strike")}
            resizeMode="contain"
            style={styles.headerIcon}
          />
          <View style={[styles.headerDivider, { backgroundColor: accent }]} />
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={[styles.title, { color: accent }]}
          >
            {`AVAILABLE ${slotLabel.toUpperCase()} MOVES`}
          </Text>
          <View style={[styles.countBadge, { borderColor: accent }]}>
            <Text style={[styles.countText, { color: accent }]}>
              {String(items.length).padStart(2, "0")}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.list}>
        {items.length ? (
          items.map((item, index) => (
            <View
              key={item.templateId}
              style={[
                styles.row,
                item.equipped ? { shadowColor: accent, shadowOpacity: 0.34 } : null,
              ]}
            >
              <MoveRowFrame accent={accent} />
              <View style={[styles.iconFrame, { borderColor: accent }]}>
                <View style={[styles.iconHalo, { borderColor: accent }]} />
                <Text style={[styles.rowIndex, { color: accent }]}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Image
                  source={getMoveIcon(item.templateId, item.type)}
                  resizeMode="contain"
                  style={styles.icon}
                />
              </View>
              <View style={styles.moveBody}>
                <Text numberOfLines={1} style={styles.moveName}>{item.name.toUpperCase()}</Text>
                <Text numberOfLines={2} style={styles.moveDescription}>{item.description}</Text>
                <View style={styles.telemetryRow}>
                  <View style={styles.telemetryGroup}>
                    <Text style={styles.telemetryKey}>COST</Text>
                    <Text style={styles.telemetryValue}>{item.staminaCost}</Text>
                  </View>
                  <View style={styles.telemetryDivider} />
                  <View style={styles.telemetryGroup}>
                    <Text style={styles.telemetryKey}>RANK</Text>
                    <Text style={[styles.telemetryValue, { color: accent }]}>{item.rank}</Text>
                  </View>
                  <View style={styles.telemetryDivider} />
                  <View style={[styles.telemetryGroup, styles.typeTelemetry]}>
                    <Text style={styles.telemetryKey}>TYPE</Text>
                    <Text numberOfLines={1} style={styles.telemetryValue}>
                      {item.type === "defense" ? "TACTICAL" : "PHYSICAL"}
                    </Text>
                  </View>
                  <View style={styles.miniPips}>
                    {[1, 2, 3].map((step) => (
                      <View
                        key={step}
                        style={[
                          styles.miniPip,
                          item.rank >= step ? { backgroundColor: accent } : null,
                        ]}
                      />
                    ))}
                  </View>
                </View>
              </View>
              <Pressable
                accessibilityLabel={`${item.equipped ? "Equipped" : "Equip"} ${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: disabled || item.equipped }}
                disabled={disabled || item.equipped}
                onPress={() => onEquip(item.templateId)}
                style={({ pressed }) => [
                  styles.equipButton,
                  disabled || item.equipped ? styles.equipButtonDisabled : null,
                  pressed ? styles.controlPressed : null,
                ]}
              >
                <MoveActionFrame accent="#ffc51b" variant="equip" />
                <Text style={styles.equipText}>
                  {item.pending ? "…" : item.equipped ? "EQUIPPED" : "EQUIP"}
                </Text>
              </Pressable>
            </View>
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NO AVAILABLE MOVES</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controlPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.985 }],
  },
  countBadge: {
    alignItems: "center",
    backgroundColor: "#08090b",
    borderWidth: 1,
    justifyContent: "center",
    marginLeft: 7,
    minHeight: 23,
    minWidth: 27,
    paddingHorizontal: 5,
  },
  countText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 22,
  },
  emptyText: {
    color: "#8e939d",
    fontSize: 11,
    fontWeight: "800",
  },
  equipButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 62,
    overflow: "hidden",
    paddingHorizontal: 8,
    position: "relative",
  },
  equipButtonDisabled: {
    opacity: 0.55,
  },
  equipText: {
    color: "#ffc51b",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    zIndex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    paddingBottom: 11,
    paddingHorizontal: 4,
    paddingTop: 3,
  },
  headerDivider: {
    height: 24,
    width: 2,
  },
  headerIcon: {
    height: 26,
    width: 26,
  },
  headerTitle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  icon: {
    height: "86%",
    width: "86%",
    zIndex: 2,
  },
  iconFrame: {
    alignItems: "center",
    backgroundColor: "#020304",
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    overflow: "hidden",
    width: 50,
  },
  iconHalo: {
    borderRadius: 23,
    borderWidth: 1,
    height: 42,
    opacity: 0.28,
    position: "absolute",
    width: 42,
  },
  list: {
    gap: 6,
  },
  miniPip: {
    backgroundColor: "#303239",
    height: 5,
    width: 9,
  },
  miniPips: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    marginLeft: 2,
  },
  moveBody: {
    flex: 1,
    minWidth: 0,
  },
  moveDescription: {
    color: "#c2c5cc",
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 3,
  },
  moveName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  panel: {
    backgroundColor: "transparent",
    padding: 12,
    position: "relative",
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  rowIndex: {
    fontSize: 7,
    fontWeight: "900",
    left: 3,
    letterSpacing: 0.4,
    opacity: 0.72,
    position: "absolute",
    top: 2,
    zIndex: 3,
  },
  row: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 8,
    minHeight: 82,
    paddingHorizontal: 9,
    paddingVertical: 8,
    position: "relative",
    shadowOffset: { height: 0, width: 0 },
    shadowRadius: 8,
  },
  telemetryDivider: {
    backgroundColor: "#3f444e",
    height: 13,
    opacity: 0.85,
    width: 1,
  },
  telemetryGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
  },
  telemetryKey: {
    color: "#777e8b",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.55,
  },
  telemetryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 6,
    minHeight: 14,
  },
  telemetryValue: {
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.25,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
    textShadowColor: "rgba(255,255,255,0.12)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 4,
  },
  typeTelemetry: {
    flexShrink: 1,
  },
});
