import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

type GameSurfaceFrameProps = {
  accent?: string;
  fill?: string;
  strong?: boolean;
};

export const GameSurfaceFrame = memo(function GameSurfaceFrame({
  accent = "#f0bf14",
  fill = "#07080a",
  strong = false,
}: GameSurfaceFrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 140" width="100%">
        <Path
          d="M13 2 H347 L358 13 V127 L347 138 H13 L2 127 V13 Z"
          fill={fill}
        />
        <Path
          d="M13 2 H116 M132 2 H347 L358 13 V42 M358 58 V103 M358 119 V127 L347 138 H278 M262 138 H92 M76 138 H13 L2 127 V113 M2 97 V58 M2 42 V13 Z"
          fill="none"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={strong ? 3 : 2}
        />
        <Path
          d="M13 7 H48 L41 13 H20 L8 25 V43 M312 7 H342 L352 17 V39 M8 101 V122 L18 132 H52 M308 132 H342 L352 122 V101"
          fill="none"
          stroke={accent}
          strokeOpacity={0.48}
          strokeWidth={1}
        />
        <Path
          d="M18 6 H62 M298 134 H338 M4 31 V49 M356 91 V109"
          fill="none"
          stroke={accent}
          strokeOpacity={0.88}
          strokeWidth={strong ? 3 : 2}
        />
      </Svg>
    </View>
  );
});

export const GameDialogFrame = memo(function GameDialogFrame({
  accent = "#f0bf14",
  fill = "#0b0c0e",
}: Pick<GameSurfaceFrameProps, "accent" | "fill">) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 620" width="100%">
        <Path
          d="M16 2 H344 L358 16 V604 L344 618 H16 L2 604 V16 Z"
          fill={fill}
        />
        <Path
          d="M16 2 H116 M136 2 H344 L358 16 V90 M358 112 V506 M358 528 V604 L344 618 H276 M256 618 H104 M84 618 H16 L2 604 V530 M2 508 V112 M2 90 V16 Z"
          fill="none"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={2.5}
        />
        <Path
          d="M16 8 H54 L46 15 H22 L9 28 V65 M304 8 H340 L351 19 V62 M9 548 V598 L21 610 H58 M302 610 H339 L351 598 V548"
          fill="none"
          stroke={accent}
          strokeOpacity={0.48}
          strokeWidth={1}
        />
        <Path
          d="M18 6 H70 M290 614 H338 M6 38 V76 M354 542 V580"
          fill="none"
          stroke={accent}
          strokeOpacity={0.9}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
});

export function GameSectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 160 28" width="100%">
        <Path d="M1 1 H141 L159 14 L141 27 H1 Z" fill="#050606" />
        <Path
          d="M1 1 H54 M68 1 H141 L159 14 L151 20 M142 27 H88 M74 27 H1 V19 M1 10 V1 Z"
          fill="none"
          stroke="#f0bf14"
          strokeWidth={1.5}
        />
        <Path d="M8 5 H32 M132 23 H144" fill="none" stroke="#f0bf14" strokeOpacity={0.55} />
      </Svg>
      <Text style={styles.sectionLabelText}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  sectionLabel: {
    height: 28,
    justifyContent: "center",
    marginBottom: 6,
    position: "relative",
    width: 160,
  },
  sectionLabelText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    left: 12,
    letterSpacing: 0.9,
    position: "absolute",
  },
});
