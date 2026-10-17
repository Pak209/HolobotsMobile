import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

export type BoosterTier = "common" | "champion" | "rare" | "elite";

export const BOOSTER_TIER_ACCENTS: Record<BoosterTier, string> = {
  common: "#17d9ff",
  champion: "#2f87ff",
  rare: "#ae4cff",
  elite: "#ff3b4d",
};

type FrameProps = {
  tier: BoosterTier;
};

export const BoosterPackOutline = memo(function BoosterPackOutline({ tier }: FrameProps) {
  const accent = BOOSTER_TIER_ACCENTS[tier];

  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 112" width="100%">
        <Path
          d="M14 2 H344 L358 16 V96 L344 110 H14 L2 98 V16 Z"
          fill="rgba(4, 6, 10, 0.96)"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={3}
        />
        <Path
          d="M18 7 H338 M352 20 V53 M352 79 V92 L339 104 H307 M53 104 H18 L8 94 V72 M8 49 V20 L19 9"
          fill="none"
          stroke={accent}
          strokeOpacity={0.42}
          strokeWidth={1}
        />
        <Path
          d="M14 2 H42 L35 8 H20 L8 20 V38 M318 2 H343 L358 17 V39"
          fill="none"
          stroke={accent}
          strokeWidth={4}
        />
        <Path
          d="M253 106 H270 L279 98 H312 M286 106 H302 L311 98 H327 M18 106 H35 L28 100 H12"
          fill="none"
          stroke={accent}
          strokeWidth={3}
        />
      </Svg>
    </View>
  );
});

export const BoosterPriceOutline = memo(function BoosterPriceOutline({ tier }: FrameProps) {
  const accent = BOOSTER_TIER_ACCENTS[tier];

  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 100 42" width="100%">
        <Path
          d="M9 2 H86 L98 12 V31 L88 40 H8 L2 34 V10 Z"
          fill="#05070b"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={2.5}
        />
        <Path
          d="M15 2 H38 L42 5 H65 L69 2 H86 M3 31 L10 38 H31 M69 39 H87 L96 31"
          fill="none"
          stroke={accent}
          strokeOpacity={0.58}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});
