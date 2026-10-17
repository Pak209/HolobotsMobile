import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { theme } from "@/lite/theme";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { ArenaTierId } from "@/lib/arenaEconomy";

export const ARENA_TIER_ACCENTS: Record<ArenaTierId, string> = {
  rookie: "#58ef2a",
  challenger: "#20bfff",
  elite: theme.colors.purple,
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

  return <GameSurfaceFrame accent={accent} strong={selected} />;
});

export const ArenaControlFrame = memo(function ArenaControlFrame({
  accent = theme.colors.accent,
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
          fill={selected ? theme.plates.raised : theme.plates.navy}
        />
        <Path
          d="M10 1 H55 M69 1 H150 L159 10 V23 M159 34 V46 L150 55 H104 M90 55 H10 L1 46 V34 M1 23 V10 Z"
          fill="none"
          stroke={accent}
          strokeOpacity={selected ? 1 : 0.64}
          vectorEffect="non-scaling-stroke"
          strokeWidth={selected ? 1.5 : 1}
        />
        <Path
          d="M9 6 H32 M127 50 H150 L154 46 M5 14 V25"
          fill="none"
          stroke={accent}
          strokeOpacity={0.48}
          strokeWidth={1}
        />
        {selected ? <Path d="M68 1 H92 L80 10 Z" fill={theme.colors.cursor} /> : null}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});
