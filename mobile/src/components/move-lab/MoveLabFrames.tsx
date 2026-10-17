import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

type FrameProps = {
  accent: string;
};

type TabFrameProps = FrameProps & {
  active: boolean;
  edge: "left" | "middle" | "right";
};

type ActionFrameProps = {
  accent?: string;
  variant: "primary" | "secondary" | "equip";
};

export const MoveDetailFrame = memo(function MoveDetailFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 300" width="100%">
        <Path
          d="M14 2 H344 L358 16 V284 L344 298 H14 L2 286 V16 Z"
          fill="#020304"
        />
        <Path
          d="M14 2 H126 M142 2 H344 L358 16 V78 M358 95 V214 M358 232 V284 L344 298 H280 M264 298 H96 M80 298 H14 L2 286 V226 M2 208 V92 M2 74 V16 Z"
          fill="none"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={2.5}
        />
        <Path
          d="M18 8 H140 L126 24 H18 L8 34 V74 M8 218 V282 L18 292 H58 M302 292 H342 L352 282 V226 M352 76 V18 L342 8 H286"
          fill="none"
          stroke={accent}
          strokeOpacity={0.72}
          strokeWidth={1}
        />
        <Path
          d="M14 2 H55 L47 9 H21 L8 22 V52 M305 2 H344 L358 16 V52"
          fill="none"
          stroke={accent}
          strokeWidth={4}
        />
        <Path
          d="M16 286 H46 L54 278 H102 M258 286 H306 L314 278 H344"
          fill="none"
          stroke={accent}
          strokeOpacity={0.8}
          strokeWidth={2}
        />
        <Path
          d="M22 31 H117 M246 12 H323 M22 267 H112 M284 267 H337"
          fill="none"
          stroke={accent}
          strokeOpacity={0.25}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
});

export const MoveCategoryFrame = memo(function MoveCategoryFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 150 38" width="100%">
        <Path
          d="M10 1 H132 L149 16 V30 L141 37 H1 V10 Z"
          fill="#080a0d"
        />
        <Path
          d="M10 1 H56 M70 1 H132 L149 16 V24 M145 32 L140 37 H94 M80 37 H1 V25 M1 16 V10 Z"
          fill="none"
          stroke={accent}
          strokeWidth={1.5}
        />
        <Path
          d="M12 5 H34 M118 5 H130 L143 17 M5 14 V27"
          fill="none"
          stroke={accent}
          strokeOpacity={0.5}
          strokeWidth={1}
        />
        <Path d="M1 10 L10 1 H24 L17 7 H11 L6 12 V19" fill="none" stroke={accent} strokeWidth={3} />
      </Svg>
    </View>
  );
});

export const MoveListFrame = memo(function MoveListFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 420" width="100%">
        <Path
          d="M14 2 H344 L358 16 V404 L344 418 H14 L2 406 V16 Z"
          fill="#020304"
        />
        <Path
          d="M14 2 H128 M144 2 H344 L358 16 V74 M358 92 V330 M358 348 V404 L344 418 H286 M270 418 H92 M76 418 H14 L2 406 V346 M2 328 V92 M2 74 V16 Z"
          fill="none"
          stroke={accent}
          strokeLinejoin="miter"
          strokeWidth={2.5}
        />
        <Path
          d="M16 8 H132 L120 22 H17 L8 32 V67 M8 348 V402 L18 412 H70 M290 412 H342 L352 402 V349 M352 70 V18 L342 8 H288"
          fill="none"
          stroke={accent}
          strokeOpacity={0.62}
          strokeWidth={1}
        />
        <Path
          d="M14 2 H52 L45 9 H21 L8 22 V48 M310 2 H344 L358 16 V49"
          fill="none"
          stroke={accent}
          strokeWidth={4}
        />
        <Path
          d="M18 408 H54 L62 400 H104 M254 408 H298 L306 400 H342"
          fill="none"
          stroke="#ffc51b"
          strokeOpacity={0.72}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
});

export const MoveRowFrame = memo(function MoveRowFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 74" width="100%">
        <Path
          d="M8 1 H350 L359 10 V64 L350 73 H8 L1 66 V8 Z"
          fill="#060709"
        />
        <Path
          d="M8 1 H118 M132 1 H350 L359 10 V26 M359 40 V64 L350 73 H278 M262 73 H8 L1 66 V51 M1 37 V8 Z"
          fill="none"
          stroke={accent}
          strokeOpacity={0.82}
          strokeLinejoin="miter"
          strokeWidth={1.5}
        />
        <Path
          d="M8 5 H62 M294 69 H348 L355 62 V50"
          fill="none"
          stroke={accent}
          strokeOpacity={0.32}
          strokeWidth={1}
        />
        <Path
          d="M342 30 H359 M342 36 H359"
          fill="none"
          stroke="#ffc51b"
          strokeOpacity={0.75}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
});

export const MoveTabFrame = memo(function MoveTabFrame({
  accent,
  active,
  edge,
}: TabFrameProps) {
  const d =
    edge === "left"
      ? "M8 1 H100 V43 H0 V9 Z"
      : edge === "right"
        ? "M0 1 H92 L100 9 V43 H0 Z"
        : "M0 1 H100 V43 H0 Z";

  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 100 44" width="100%">
        <Path
          d={d}
          fill={active ? "#ffc51b" : "#111008"}
          stroke={active ? "#ffe678" : "#514719"}
          strokeLinejoin="miter"
          strokeWidth={active ? 1.5 : 1}
        />
        <Path
          d="M12 4 H48 M54 4 H88"
          fill="none"
          stroke={active ? "#fff2a0" : accent}
          strokeOpacity={active ? 0.72 : 0.28}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
});

export const MoveActionFrame = memo(function MoveActionFrame({
  accent = "#ffc51b",
  variant,
}: ActionFrameProps) {
  const primary = variant === "primary";
  const equip = variant === "equip";
  const viewBox = equip ? "0 0 80 48" : "0 0 160 64";
  const d = equip
    ? "M8 1 H72 L79 8 V40 L72 47 H8 L1 40 V8 Z"
    : "M12 1 H148 L159 12 V52 L148 63 H12 L1 52 V12 Z";

  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox={viewBox} width="100%">
        <Path
          d={d}
          fill={primary ? "#ffc51b" : "#07080b"}
          stroke={primary ? "#ffe678" : equip ? accent : "#5b606b"}
          strokeLinejoin="miter"
          strokeWidth={primary ? 1.5 : 1.3}
        />
        <Path
          d={equip ? "M12 4 H38 M43 44 H68" : "M16 5 H70 M90 59 H144"}
          fill="none"
          stroke={primary ? "#fff2a0" : accent}
          strokeOpacity={primary ? 0.8 : 0.72}
          strokeWidth={primary ? 1.5 : 1}
        />
        {!primary ? (
          <Path
            d={equip ? "M76 13 V23 M76 29 V36" : "M155 16 V29 M155 35 V48"}
            fill="none"
            stroke={accent}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        ) : null}
      </Svg>
    </View>
  );
});

export const BattleLoadoutFrame = memo(function BattleLoadoutFrame() {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 360 310" width="100%">
        <Path
          d="M14 2 H346 L358 14 V296 L346 308 H14 L2 296 V14 Z"
          fill="#020405"
        />
        <Path
          d="M14 2 H84 M100 2 H346 L358 14 V58 M358 74 V246 M358 262 V296 L346 308 H284 M268 308 H88 M72 308 H14 L2 296 V262 M2 246 V75 M2 58 V14 Z"
          fill="none"
          stroke="#f4c719"
          strokeLinejoin="miter"
          strokeWidth={2.5}
        />
        <Path
          d="M12 10 H108 L96 24 H19 L9 34 V66 M9 248 V289 L19 299 H68 M291 299 H341 L351 289 V252 M351 64 V19 L341 9 H298"
          fill="none"
          stroke="#f4c719"
          strokeOpacity={0.42}
          strokeWidth={1}
        />
        <Path
          d="M16 2 H46 L39 9 H20 L8 21 V44 M315 2 H346 L358 14 V44"
          fill="none"
          stroke="#f4c719"
          strokeWidth={4}
        />
        <Path
          d="M18 302 H51 L58 295 H104 M258 302 H304 L311 295 H342"
          fill="none"
          stroke="#f4c719"
          strokeOpacity={0.82}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
});

export const InnateSystemFrame = memo(function InnateSystemFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 330 72" width="100%">
        <Path
          d="M11 1 H319 L329 11 V61 L319 71 H11 L1 61 V11 Z"
          fill="#05090c"
        />
        <Path
          d="M11 1 H112 M128 1 H319 L329 11 V27 M329 42 V61 L319 71 H238 M222 71 H11 L1 61 V45 M1 29 V11 Z"
          fill="none"
          stroke={accent}
          strokeOpacity={0.72}
          strokeWidth={1.25}
        />
        <Path
          d="M8 8 H54 M276 64 H320 L325 59 V48"
          fill="none"
          stroke={accent}
          strokeOpacity={0.28}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
});

export const EquippedMoveFrame = memo(function EquippedMoveFrame({
  accent,
  active = false,
}: FrameProps & { active?: boolean }) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 82 132" width="100%">
        <Path
          d="M8 1 H73 L81 9 V123 L73 131 H8 L1 124 V9 Z"
          fill={active ? "#090b0e" : "#050709"}
        />
        <Path
          d="M8 1 H32 M42 1 H73 L81 9 V33 M81 44 V101 M81 112 V123 L73 131 H52 M42 131 H8 L1 124 V111 M1 100 V35 M1 24 V9 Z"
          fill="none"
          stroke={accent}
          strokeWidth={active ? 2.2 : 1.5}
        />
        <Path
          d="M7 7 H25 M57 125 H74 L77 122 V108"
          fill="none"
          stroke={accent}
          strokeOpacity={0.42}
          strokeWidth={1}
        />
        {active ? (
          <Path d="M33 1 L41 9 L49 1 Z" fill="#f4c719" />
        ) : null}
      </Svg>
    </View>
  );
});

export const MoveTelemetryFrame = memo(function MoveTelemetryFrame({ accent }: FrameProps) {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 180 46" width="100%">
        <Path
          d="M8 1 H172 L179 8 V38 L172 45 H8 L1 38 V8 Z"
          fill="#090b0e"
        />
        <Path
          d="M8 1 H58 M72 1 H172 L179 8 V18 M179 28 V38 L172 45 H118 M104 45 H8 L1 38 V28 M1 18 V8 Z"
          fill="none"
          stroke="#363d48"
          strokeWidth={1}
        />
        <Path
          d="M8 5 H30 M150 41 H172 L175 38"
          fill="none"
          stroke={accent}
          strokeOpacity={0.75}
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
