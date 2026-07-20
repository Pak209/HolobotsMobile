import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  ARENA_TIER_ACCENTS,
  ArenaTierOutline,
} from "@/components/arena/ArenaTierFrames";
import type { ArenaTierId } from "@/lib/arenaEconomy";

const TIER_ICONS: Record<ArenaTierId, number> = {
  challenger: require("../../../assets/game/arena-tiers/challenger-tier.png"),
  elite: require("../../../assets/game/arena-tiers/elite-tier.png"),
  legend: require("../../../assets/game/arena-tiers/legend-tier.png"),
  rookie: require("../../../assets/game/arena-tiers/rookie-tier.png"),
};

type ArenaTierCardProps = {
  compact?: boolean;
  entryFeeHolos: number;
  label: string;
  level: number;
  onPress: () => void;
  selected: boolean;
  tier: ArenaTierId;
};

export function ArenaTierCard({
  compact = false,
  entryFeeHolos,
  label,
  level,
  onPress,
  selected,
  tier,
}: ArenaTierCardProps) {
  const accent = ARENA_TIER_ACCENTS[tier];

  return (
    <Pressable
      accessibilityLabel={`${label}, level ${level}, ${entryFeeHolos} Holos`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.cardCompact : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <ArenaTierOutline selected={selected} tier={tier} />
      <View style={[styles.iconWell, compact ? styles.iconWellCompact : null]}>
        <View style={[styles.iconRing, compact ? styles.iconRingCompact : null, { borderColor: accent }]} />
        <Image
          source={TIER_ICONS[tier]}
          resizeMode="contain"
          style={[styles.icon, compact ? styles.iconCompact : null]}
        />
      </View>
      <View style={styles.copy}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={2}
          style={[styles.name, compact ? styles.nameCompact : null]}
        >
          {label.toUpperCase()}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.level}>{`LV ${level}`}</Text>
          <Text style={[styles.fee, { color: accent }]}>{`${entryFeeHolos} Holos`}</Text>
        </View>
      </View>
      {selected ? (
        <View style={[styles.selectedMark, { backgroundColor: accent }]}>
          <Svg height={12} viewBox="0 0 12 12" width={12}>
            <Path
              d="M2 6.2 L4.7 8.8 L10 3"
              fill="none"
              stroke="#020304"
              strokeLinecap="square"
              strokeLinejoin="miter"
              strokeWidth={2}
            />
          </Svg>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    flexBasis: "48%",
    flexDirection: "row",
    flexGrow: 1,
    gap: 5,
    height: 88,
    minWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 6,
    position: "relative",
  },
  cardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  cardCompact: {
    gap: 2,
    height: 78,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  fee: {
    fontSize: 9,
    fontWeight: "900",
    marginTop: 4,
  },
  icon: {
    height: 63,
    width: 63,
    zIndex: 1,
  },
  iconCompact: {
    height: 50,
    width: 50,
  },
  iconRing: {
    borderRadius: 31,
    borderWidth: 1,
    height: 62,
    opacity: 0.35,
    position: "absolute",
    width: 62,
  },
  iconRingCompact: {
    borderRadius: 25,
    height: 50,
    width: 50,
  },
  iconWell: {
    alignItems: "center",
    height: 66,
    justifyContent: "center",
    width: 66,
  },
  iconWellCompact: {
    height: 52,
    width: 52,
  },
  level: {
    color: "#8f96a4",
    fontSize: 9,
    fontWeight: "800",
  },
  metaRow: {
    marginTop: 3,
  },
  name: {
    color: "#f3f5f8",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 12,
  },
  nameCompact: {
    fontSize: 9,
    lineHeight: 10,
  },
  selectedMark: {
    alignItems: "center",
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 5,
    transform: [{ rotate: "45deg" }],
    width: 18,
  },
});
