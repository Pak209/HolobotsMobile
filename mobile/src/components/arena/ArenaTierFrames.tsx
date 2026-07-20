import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { ArenaTierId } from "@/lib/arenaEconomy";

export const ARENA_TIER_ACCENTS: Record<ArenaTierId, string> = {
  rookie: "#58ef2a",
  challenger: "#20bfff",
  elite: "#b34cff",
  legend: "#ffc21c",
};

type ArenaTierOutlineProps = {
  selected?: boolean;
  tier: ArenaTierId;
};

/**
 * Scalable angular frame for the Arena tier cards.
 *
 * The frame intentionally contains no card content so it can sit behind any
 * tier-card layout while preserving the same silhouette at different sizes.
 */
export const ArenaTierOutline = memo(function ArenaTierOutline({
  selected = false,
  tier,
}: ArenaTierOutlineProps) {
  const accent = ARENA_TIER_ACCENTS[tier];

  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 176 84" width="100%">
        <Path
          d="M12 2 H162 L174 14 V69 L161 82 H12 L2 72 V14 Z"
          fill="#05080a"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={selected ? 3.5 : 2.5}
        />

        <Path
          d="M15 7 H157 L168 18 V35 M168 49 V66 L157 77 H119 M70 77 H16 L8 69 V50 M8 34 V17 L17 8"
          fill="none"
          stroke={accent}
          strokeOpacity={selected ? 0.76 : 0.38}
          strokeWidth={1}
        />

        <Path
          d="M13 2 H43 L37 8 H18 L8 18 V32 M143 2 H161 L174 15 V29"
          fill="none"
          stroke={accent}
          strokeWidth={selected ? 4 : 3}
        />

        <Path
          d="M2 57 V71 L12 82 H32 M136 82 H161 L174 69 V55"
          fill="none"
          stroke={accent}
          strokeOpacity={0.9}
          strokeWidth={2}
        />

        <Path
          d="M18 12 H66 M71 12 H92 M114 72 H143 M148 72 H159"
          fill="none"
          stroke={accent}
          strokeOpacity={0.34}
          strokeWidth={1}
        />

        <Path
          d="M19 78 H31 L38 72 H50 M130 78 H141 L148 72 H160"
          fill="none"
          stroke={accent}
          strokeOpacity={selected ? 1 : 0.62}
          strokeWidth={2.5}
        />

        {selected ? (
          <Path
            d="M16 5 H159 L171 17 V68 L158 79 H15 L5 69 V16 Z"
            fill="none"
            stroke={accent}
            strokeOpacity={0.26}
            strokeWidth={5}
          />
        ) : null}
      </Svg>
    </View>
  );
});

export const ArenaControlFrame = memo(function ArenaControlFrame({
  accent = "#f0bf14",
  selected = false,
}: {
  accent?: string;
  selected?: boolean;
}) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 160 56" width="100%">
        <Path
          d="M10 1 H150 L159 10 V46 L150 55 H10 L1 46 V10 Z"
          fill={selected ? "#050606" : "#12140f"}
        />
        <Path
          d="M10 1 H55 M69 1 H150 L159 10 V23 M159 34 V46 L150 55 H104 M90 55 H10 L1 46 V34 M1 23 V10 Z"
          fill="none"
          stroke={accent}
          strokeOpacity={selected ? 1 : 0.64}
          strokeWidth={selected ? 2.5 : 1.5}
        />
        <Path
          d="M9 6 H32 M127 50 H150 L154 46 M5 14 V25"
          fill="none"
          stroke={accent}
          strokeOpacity={0.48}
          strokeWidth={1}
        />
        {selected ? <Path d="M68 1 H92 L80 10 Z" fill={accent} /> : null}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});
