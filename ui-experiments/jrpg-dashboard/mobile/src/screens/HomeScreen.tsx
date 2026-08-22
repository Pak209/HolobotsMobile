import { useMemo, useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View, type DimensionValue, type ImageSourcePropType } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { DashboardSettingsModal } from "@/components/DashboardSettingsModal";
import { HologramPlatform } from "@/components/dashboard/HologramPlatform";
import { getBondPercent, getGradeColor, getHolobotPresentation, getRarity, getStatGrade, getSyncPercent } from "@/components/dashboard/holobotPresentation";
import { FigmaCanvas } from "@/components/FigmaCanvas";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { UserStatsModal } from "@/components/UserStatsModal";
import { Circle, Ellipse, Svg, G, Line, Path, Rect, Text } from "@/components/FigmaSvg";
import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH, homeAssets } from "@/config/figmaAssets";
import { getPartImageSource } from "@/config/gameAssets";
import { getExpProgress, getHolobotFullImageSource, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import type { RootTabs } from "../../App";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

const ATTRIBUTE_LABELS = ["ATK", "DEF", "SPECIAL", "HP", "SPEED"] as const;
const ATTRIBUTE_CENTER_X = 415;
const ATTRIBUTE_CENTER_Y = 1330;
const ATTRIBUTE_RADIUS = 220;
const ATTRIBUTE_LABEL_RADIUS = 286;
const HOME_INFO_CARD_Y = 1845;
const HOME_CHANGE_BAR_Y = 1900;
const DASHBOARD_SLOT_Y = 2205;
const DASHBOARD_SLOT_WIDTH = 248;
const DASHBOARD_SLOT_HEIGHT = 410;
const DASHBOARD_SLOT_OVERLAY_WIDTH = 220;
const DASHBOARD_SLOT_OVERLAY_HEIGHT = 285;
type EquippedPartRecord = { id?: string; level?: number; name?: string; rarity?: string; slot?: string; stars?: number };
type ResolvedDashboardPart = { key: string; level: number | undefined; name: string; rarity: string | undefined; slot: string; stars: number | undefined };
type DashboardSlot = "head" | "torso" | "arms" | "legs" | "core";

function getAttributePoint(index: number, scale = 1) {
  const angle = (index * 2 * Math.PI) / 5 - Math.PI / 2 + Math.PI / 10;

  return {
    x: ATTRIBUTE_CENTER_X + ATTRIBUTE_RADIUS * scale * Math.cos(angle),
    y: ATTRIBUTE_CENTER_Y + ATTRIBUTE_RADIUS * scale * Math.sin(angle),
  };
}

function buildPolygonPath(scale: number) {
  const points = ATTRIBUTE_LABELS.map((_, index) => getAttributePoint(index, scale));

  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")} Z`;
}

function buildValuePolygonPath(values: Record<(typeof ATTRIBUTE_LABELS)[number], number>) {
  const points = ATTRIBUTE_LABELS.map((label, index) => {
    const value = values[label];
    return getAttributePoint(index, value / 100);
  });

  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")} Z`;
}

function getAttributeLabelPosition(index: number) {
  const angle = (index * 2 * Math.PI) / 5 - Math.PI / 2 + Math.PI / 10;

  return {
    x: ATTRIBUTE_CENTER_X + ATTRIBUTE_LABEL_RADIUS * Math.cos(angle),
    y: ATTRIBUTE_CENTER_Y + ATTRIBUTE_LABEL_RADIUS * Math.sin(angle),
  };
}

function normalizeToken(value?: string) {
  return (value || "").trim().toLowerCase();
}

function resolveDashboardParts(equippedParts: Record<string, EquippedPartRecord>) {
  const entries = Object.entries(equippedParts)
    .map(([key, part]) => {
      const hasRealData = Boolean(part?.name || part?.id);

      if (!hasRealData) {
        return null;
      }

      return {
        key,
        level: part?.level,
        name: part?.name || key,
        rarity: part?.rarity,
        slot: part?.slot || key,
        stars: part?.stars,
      };
    })
    .filter((entry): entry is ResolvedDashboardPart => entry !== null);

  const takeFirst = (matcher: (entry: { key: string; name: string; slot: string }) => boolean) => {
    const index = entries.findIndex(matcher);
    if (index === -1) return null;
    const [entry] = entries.splice(index, 1);
    return entry;
  };

  const head = takeFirst((entry) => {
    const blob = `${normalizeToken(entry.key)} ${normalizeToken(entry.slot)} ${normalizeToken(entry.name)}`;
    return blob.includes("head") || blob.includes("mask") || blob.includes("visor") || blob.includes("scanner");
  });

  const torso = takeFirst((entry) => {
    const blob = `${normalizeToken(entry.key)} ${normalizeToken(entry.slot)} ${normalizeToken(entry.name)}`;
    return blob.includes("torso") || blob.includes("body") || blob.includes("chassis") || blob.includes("chest");
  });

  const core = takeFirst((entry) => {
    const blob = `${normalizeToken(entry.key)} ${normalizeToken(entry.slot)} ${normalizeToken(entry.name)}`;
    return blob.includes("core");
  });

  const armParts = entries.filter((entry) => {
    const blob = `${normalizeToken(entry.key)} ${normalizeToken(entry.slot)} ${normalizeToken(entry.name)}`;
    return blob.includes("arm") || blob.includes("cannon") || blob.includes("boxer") || blob.includes("claw") || blob.includes("weapon");
  });

  const remaining = entries.filter((entry) => !armParts.includes(entry));
  const fourthPart =
    armParts[1] ??
    remaining.find((entry) => {
      const blob = `${normalizeToken(entry.key)} ${normalizeToken(entry.slot)} ${normalizeToken(entry.name)}`;
      return blob.includes("leg");
    }) ??
    remaining[0] ??
    null;

  return [head, torso, armParts[0] ?? null, fourthPart, core];
}

function getArtboardFrame(x: number, y: number, width: number, height: number) {
  return {
    left: `${(x / ARTBOARD_WIDTH) * 100}%` as DimensionValue,
    top: `${(y / ARTBOARD_HEIGHT) * 100}%` as DimensionValue,
    width: `${(width / ARTBOARD_WIDTH) * 100}%` as DimensionValue,
    height: `${(height / ARTBOARD_HEIGHT) * 100}%` as DimensionValue,
  };
}

function buildPartFramePath(x: number, inset = 0) {
  const left = x + inset;
  const top = DASHBOARD_SLOT_Y + inset;
  const right = x + DASHBOARD_SLOT_WIDTH - inset;
  const bottom = DASHBOARD_SLOT_Y + DASHBOARD_SLOT_HEIGHT - inset;
  const cut = 28;

  return `M ${left + cut} ${top} H ${right - cut} L ${right} ${top + cut} V ${bottom - cut} L ${right - cut} ${bottom} H ${left + cut} L ${left} ${bottom - cut} V ${top + cut} Z`;
}

function ArtImage({
  height,
  resizeMode = "stretch",
  source,
  width,
  x,
  y,
  zIndex = 1,
}: {
  height: number;
  resizeMode?: "contain" | "cover" | "stretch";
  source: ImageSourcePropType;
  width: number;
  x: number;
  y: number;
  zIndex?: number;
}) {
  return (
    <View pointerEvents="none" style={[styles.artImageFrame, getArtboardFrame(x, y, width, height), { zIndex }]}>
      <RNImage source={source} style={styles.fillImage} resizeMode={resizeMode} />
    </View>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const [selectedPartSlot, setSelectedPartSlot] = useState<DashboardSlot | null>(null);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots, "full"), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const profileHolobot = profile?.holobots?.find((holobot) => holobot.name.trim().toUpperCase() === selectedHolobot.name);
  const presentation = getHolobotPresentation(selectedHolobot.name);
  const flavorWords = presentation.flavor.split(" ");
  const flavorBreak = Math.ceil(flavorWords.length / 2);
  const flavorLines = [flavorWords.slice(0, flavorBreak).join(" "), flavorWords.slice(flavorBreak).join(" ")];
  const rarity = getRarity(selectedHolobot.rank);
  const bondPercent = getBondPercent(profileHolobot);
  const syncPercent = getSyncPercent(profile);
  const expProgressWidth = 460.193 * getExpProgress(selectedHolobot);
  const equippedParts =
    (profile?.equippedParts?.[selectedHolobot.name] as Record<string, EquippedPartRecord> | undefined) ??
    (profile?.equippedParts?.[selectedHolobot.name.toLowerCase()] as Record<string, EquippedPartRecord> | undefined) ??
    {};
  const dashboardParts = resolveDashboardParts(equippedParts);
  const abilitySlots = [
    { part: dashboardParts[0], slot: "head", x: 68 },
    { part: dashboardParts[1], slot: "torso", x: 338 },
    { part: dashboardParts[2], slot: "arms", x: 608 },
    { part: dashboardParts[3], slot: "legs", x: 878 },
    { part: dashboardParts[4], slot: "core", x: 1148 },
  ] as const;
  const inventoryParts = useMemo(
    () =>
      (profile?.parts || [])
        .map((part, index) => ({
          id: String((part as EquippedPartRecord).id || `${(part as EquippedPartRecord).name || "part"}-${index}`),
          name: String((part as EquippedPartRecord).name || `Part ${index + 1}`),
          rarity: String((part as EquippedPartRecord).rarity || ""),
          slot: String((part as EquippedPartRecord).slot || ""),
        }))
        .filter((part) => part.name.trim().length > 0),
    [profile?.parts],
  );
  const compatibleParts = useMemo(() => {
    if (!selectedPartSlot) return [];

    return inventoryParts.filter((part) => {
      const blob = `${part.slot} ${part.name}`.toLowerCase();
      if (selectedPartSlot === "head") return blob.includes("head") || blob.includes("mask") || blob.includes("visor") || blob.includes("scanner");
      if (selectedPartSlot === "torso") return blob.includes("torso") || blob.includes("body") || blob.includes("chassis") || blob.includes("chest");
      if (selectedPartSlot === "arms") return blob.includes("arm") || blob.includes("cannon") || blob.includes("boxer") || blob.includes("claw") || blob.includes("weapon");
      if (selectedPartSlot === "legs") return blob.includes("leg") || blob.includes("lower") || blob.includes("boot") || blob.includes("thruster") || blob.includes("mobility");
      if (selectedPartSlot === "core") return blob.includes("core");
      return true;
    });
  }, [inventoryParts, selectedPartSlot]);
  const attributeValues = {
    ATK: selectedHolobot.stats.attack,
    DEF: selectedHolobot.stats.defense,
    SPECIAL: selectedHolobot.stats.special,
    HP: selectedHolobot.stats.hp,
    SPEED: selectedHolobot.stats.speed,
  };
  return (
    <FigmaCanvas>
      <View style={StyleSheet.absoluteFill}>
        <ArtImage source={homeAssets.backgroundBase} x={0} y={0} width={1800} height={3200} />
        <ArtImage source={homeAssets.backgroundDetail} x={0} y={0} width={1800} height={3200} />
        <ArtImage source={homeAssets.topBackground} x={0} y={100} width={1800} height={409} />
        <ArtImage source={homeAssets.attributeChartBase} x={0} y={560} width={825} height={1080} zIndex={2} />
        {abilitySlots.map(({ part, x }, index) => (
          <ArtImage
            key={`ability-bg-${part?.name || "empty"}:${index}`}
            source={index % 2 === 0 ? homeAssets.abilityChipBackground1 : homeAssets.abilityChipBackground3}
            x={x}
            y={DASHBOARD_SLOT_Y}
            width={DASHBOARD_SLOT_WIDTH}
            height={DASHBOARD_SLOT_HEIGHT}
            zIndex={2}
          />
        ))}
        <ArtImage source={homeAssets.bottomBackground} x={0} y={2585} width={1800} height={615} zIndex={2} />
        <Svg width="100%" height="100%" viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`} style={styles.vectorLayer}>
          <Path d="M0 500 H980" stroke="#f5c40d" strokeWidth={8} />
          <Path d="M1270 440 L1780 440 L1780 1160" fill="none" stroke="#6d4b00" strokeWidth={3} opacity={0.7} />
          <Text x={126} y={228} fill="#fef1e0" fontSize={114} fontStyle="italic" fontWeight="900">HOLOBOTS</Text>

          <Text x={92} y={650} fill="#ffffff" fontSize={118} fontWeight="900">{selectedHolobot.name}</Text>
          <Text x={96} y={730} fill="#f5c40d" fontSize={43} fontWeight="800">{presentation.subtitle}</Text>
          <Rect x={530} y={555} width={330} height={150} fill="#0c0d0e" stroke="#ff526d" strokeWidth={3} />
          <Text x={695} y={613} fill="#ff6d9d" fontSize={38} fontWeight="800" textAnchor="middle">{rarity.label.toUpperCase()}</Text>
          <Text x={695} y={672} fill="#ff6d9d" fontSize={45} textAnchor="middle">{"★".repeat(rarity.stars)}</Text>
          {[presentation.type, presentation.core, presentation.archetype].map((label, index) => (
            <G key={label}>
              <Rect x={92} y={780 + index * 82} width={420} height={60} fill="#111315" stroke="#343638" strokeWidth={2} />
              <Rect x={92} y={780 + index * 82} width={12} height={60} fill="#f5c40d" />
              <Text x={130} y={822 + index * 82} fill="#f4f1e9" fontSize={34} fontWeight="800">{label.toUpperCase()}</Text>
            </G>
          ))}

          <HologramPlatform centerX={1185} centerY={1605} />

          <G>
            {[0.2, 0.4, 0.6, 0.8].map((scale) => (
              <Path
                key={scale}
                d={buildPolygonPath(scale)}
                fill="none"
                stroke="#333333"
                strokeWidth={2}
                opacity={0.28}
              />
            ))}
            {ATTRIBUTE_LABELS.map((_, index) => {
              const point = getAttributePoint(index);
              return (
                <Line
                  key={`axis-${index}`}
                  x1={ATTRIBUTE_CENTER_X}
                  y1={ATTRIBUTE_CENTER_Y}
                  x2={point.x}
                  y2={point.y}
                  stroke="#333333"
                  strokeWidth={2}
                  opacity={0.28}
                />
              );
            })}
            <Path d={buildPolygonPath(1)} fill="none" stroke="#fdb813" strokeWidth={6} />
            <Path d={buildPolygonPath(0.85)} fill="none" stroke="#fdb813" strokeWidth={3} />
            <Path d={buildValuePolygonPath(attributeValues)} fill="#7a1508" fillOpacity={0.94} stroke="#c61d14" strokeWidth={4} />
            {ATTRIBUTE_LABELS.map((label, index) => {
              const position = getAttributeLabelPosition(index);
              return (
                <Text
                  key={label}
                  x={position.x}
                  y={position.y}
                  fill="#f4f1e9"
                  fontSize={index === 1 ? 47.259 : index === 0 ? 40.69 : 41.667}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {`${label}  ${getStatGrade(attributeValues[label])}`}
                </Text>
              );
            })}
          </G>

          {[{ label: "BOND", value: `${bondPercent}%`, meta: `Lv. ${profileHolobot?.syncLevel ?? 1}` }, { label: "SYNC", value: `${syncPercent}%`, meta: profile?.syncRank ?? "Rookie" }].map((card, index) => {
            const x = 90 + index * 355;
            return (
              <G key={card.label}>
                <Path d={`M${x} 1628 H${x + 320} V1800 H${x + 20} L${x} 1780 Z`} fill="#0c0d0e" stroke="#705900" strokeWidth={3} />
                <Text x={x + 28} y={1678} fill="#f5c40d" fontSize={30} fontWeight="800">{card.label}</Text>
                <Text x={x + 28} y={1742} fill="#ffffff" fontSize={50} fontWeight="900">{card.value.toUpperCase()}</Text>
                <Text x={x + 28} y={1782} fill="#aaa79f" fontSize={25}>{card.meta.toUpperCase()}</Text>
              </G>
            );
          })}

          <Path
            d={`M 90 ${HOME_INFO_CARD_Y} H 610 V ${HOME_INFO_CARD_Y + 245} H 90 Z`}
            fill="#0c0d0e"
            stroke="#f5c40d"
            strokeWidth={3}
          />
          <Text x={125} y={HOME_INFO_CARD_Y + 76} fill="#ffffff" fontSize={72} fontWeight="900">{`Lv ${selectedHolobot.level}`}</Text>
          <Text x={125} y={HOME_INFO_CARD_Y + 132} fill="#ffffff" fontSize={29} fontWeight="700">{`EXP ${selectedHolobot.experience} / ${selectedHolobot.nextLevelExp}`}</Text>
          <Rect x={125} y={HOME_INFO_CARD_Y + 166} width={430} height={26} fill="#252627" />
          <Rect x={125} y={HOME_INFO_CARD_Y + 166} width={expProgressWidth * (430 / 460.193)} height={26} fill="#f4c312" />

          <Path d="M640 1845 H1165 V2090 H680 L640 2050 Z" fill="#0c0d0e" stroke="#705900" strokeWidth={3} />
          <Text x={902} y={1935} fill="#f4f1e9" fontSize={31} textAnchor="middle">{flavorLines[0]}</Text>
          <Text x={902} y={1984} fill="#f4f1e9" fontSize={31} textAnchor="middle">{flavorLines[1]}</Text>

          <Path
            d={`M 1210 ${HOME_CHANGE_BAR_Y} H 1690 L 1640 ${HOME_CHANGE_BAR_Y + 185} H 1170 L 1210 ${HOME_CHANGE_BAR_Y + 145} Z`}
            fill="#0b0c0d"
            stroke="#f5c40d"
            strokeWidth={5}
          />
          <Text x={1240} y={HOME_CHANGE_BAR_Y + 78} fill="#ffffff" fontSize={43} fontWeight="900">CHANGE</Text>
          <Text x={1240} y={HOME_CHANGE_BAR_Y + 132} fill="#ffffff" fontSize={43} fontWeight="900">HOLOBOT</Text>

          <Text x={900} y={2180} fill="#090a0b" fontSize={48} fontWeight="900" textAnchor="middle">EQUIPPED PARTS</Text>
          <Line x1={100} y1={2158} x2={650} y2={2158} stroke="#090a0b" strokeWidth={4} />
          <Line x1={1150} y1={2158} x2={1700} y2={2158} stroke="#090a0b" strokeWidth={4} />
          {abilitySlots.map(({ part, x }, index) => {
            const stars = part?.stars ?? getRarity(part?.rarity).stars;
            const strong = index === 3 || stars >= 4;
            const borderColor = strong ? "#ffd227" : stars >= 3 ? "#ff596f" : "#24d5dc";
            return (
              <G key={`part-frame-${x}`}>
                {strong ? <Path d={buildPartFramePath(x)} fill="none" stroke="#ffd227" strokeWidth={20} opacity={0.18} /> : null}
                <Path d={buildPartFramePath(x)} fill="#080b0c" stroke={borderColor} strokeWidth={strong ? 8 : 5} />
                <Path d={buildPartFramePath(x, 14)} fill="none" stroke="#5e530f" strokeWidth={2} opacity={0.9} />
                <Text x={x + 24} y={DASHBOARD_SLOT_Y + 46} fill={borderColor} fontSize={32} fontWeight="800">{"★".repeat(stars)}</Text>
                <Path d={`M ${x + 22} ${DASHBOARD_SLOT_Y + 322} H ${x + 226} V ${DASHBOARD_SLOT_Y + 384} H ${x + 38} L ${x + 22} ${DASHBOARD_SLOT_Y + 368} Z`} fill="#050606" stroke={borderColor} strokeWidth={2} />
                <Text x={x + 124} y={DASHBOARD_SLOT_Y + 365} fill="#ffffff" fontSize={39} fontWeight="800" textAnchor="middle">{part?.level ? `Lv ${part.level}` : "Lv —"}</Text>
                <Circle cx={x + 124} cy={DASHBOARD_SLOT_Y + 400} r={8} fill={borderColor} />
              </G>
            );
          })}

          <Text x={210} y={3072} fill="#ffffff" fontSize={50} fontWeight="700" textAnchor="middle">ARENA</Text>
          <Text x={622} y={3072} fill="#ffffff" fontSize={50} fontWeight="700" textAnchor="middle">INVENTORY</Text>
          <Text x={1008} y={3072} fill="#ffffff" fontSize={50} fontWeight="700" textAnchor="middle">SYNC</Text>
          <Text x={1398} y={3072} fill="#ffffff" fontSize={50} fontWeight="700" textAnchor="middle">MARKET</Text>
        </Svg>
        <ArtImage source={homeAssets.changeIconBack} x={1518} y={HOME_CHANGE_BAR_Y + 10} width={130} height={123} zIndex={11} />
        <ArtImage source={homeAssets.changeIconFront} x={1502} y={HOME_CHANGE_BAR_Y - 5} width={168} height={163} zIndex={12} />
        <ArtImage source={homeAssets.arenaIcon} x={-50} y={2638} width={432} height={392} resizeMode="contain" zIndex={11} />
        <ArtImage source={homeAssets.inventoryIcon} x={462} y={2680} width={320} height={320} resizeMode="contain" zIndex={11} />
        <ArtImage source={homeAssets.syncIcon} x={858} y={2690} width={300} height={300} resizeMode="contain" zIndex={11} />
        <ArtImage source={homeAssets.marketplaceIcon} x={1248} y={2690} width={300} height={300} resizeMode="contain" zIndex={11} />

        <Pressable
          style={styles.syncHotspot}
          onPress={() => navigation.navigate("Fitness")}
          accessibilityRole="button"
          accessibilityLabel="Open Sync fitness page"
        />
        <Pressable
          style={styles.changeHolobotHotspot}
          onPress={() => setIsPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change active holobot"
        />
        <Pressable
          style={styles.marketplaceHotspot}
          accessibilityRole="button"
          accessibilityLabel="Open marketplace portal"
          onPress={() => navigation.navigate("Marketplace")}
        />
        <Pressable
          style={styles.inventoryHotspot}
          accessibilityRole="button"
          accessibilityLabel="Open inventory portal"
          onPress={() => navigation.navigate("Inventory")}
        />
        <Pressable
          style={styles.arenaHotspot}
          accessibilityRole="button"
          accessibilityLabel="Open arena portal"
          onPress={() => navigation.navigate("Arena")}
        />
        <View style={styles.utilityStack}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open pilot stats"
            onPress={() => setIsStatsOpen(true)}
            style={styles.statsButton}
          >
            <View style={styles.statsButtonInner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path
                  d="M17 17v-4l-5 3l-5-3v4l5 3zm0-9V4l-5 3l-5-3v4l5 3z"
                  stroke="#f5c40d"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open quests page"
            onPress={() => navigation.navigate("Quests")}
            style={styles.statsButton}
          >
            <View style={styles.statsButtonInner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path d="m3 7l6-3l6 3l6-3v13l-6 3l-6-3l-6 3z" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12v.01" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M6 13v.01" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m17 15-4-4" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m13 15 4-4" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open training page"
            onPress={() => navigation.navigate("Training")}
            style={styles.statsButton}
          >
            <View style={styles.statsButtonInner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path d="M10 3a1 1 0 1 0 2 0a1 1 0 0 0-2 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m3 14 4 1 .5-.5" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M12 18v-3l-3-2.923L9.75 7" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M6 10V8l4-1 2.5 2.5 2.5.5" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M21 22a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m18 21 1-11 2-1" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open dashboard settings"
            onPress={() => setIsDashboardSettingsOpen(true)}
            style={styles.statsButton}
          >
            <View style={styles.statsButtonInner}>
              <Svg width="30" height="30" viewBox="0 0 24 24">
                <Path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        </View>
        <View pointerEvents="none" style={styles.holobotPortrait}>
          <RNImage source={getHolobotFullImageSource(selectedHolobot.name)} style={styles.fillImage} resizeMode="contain" />
        </View>
        {abilitySlots.map(({ part, x }, index) => {
          const source = getPartImageSource(part?.name, part?.slot);

          if (!source) {
            return null;
          }

          return (
            <View
              key={`part-overlay-${part?.name || "empty"}:${index}`}
              style={[
                styles.partOverlay,
                {
                  left: `${((x + 18) / ARTBOARD_WIDTH) * 100}%`,
                },
              ]}
              pointerEvents="none"
            >
              <RNImage source={source} resizeMode="contain" style={styles.fillImage} />
            </View>
          );
        })}
        {abilitySlots.map(({ slot, x }, index) => (
          <Pressable
            key={`part-hotspot-${slot}:${index}`}
            accessibilityLabel={`Choose ${slot} part`}
            accessibilityRole="button"
            onPress={() => setSelectedPartSlot(slot)}
            style={[
              styles.partHotspot,
              {
                left: `${(x / ARTBOARD_WIDTH) * 100}%`,
              },
            ]}
          />
        ))}
        <HolobotPickerModal
          onClose={() => setIsPickerOpen(false)}
          onSelect={(index) => {
            setSelectedHolobotIndex(index);
            setIsPickerOpen(false);
          }}
          roster={roster}
          selectedIndex={selectedHolobotIndex}
          visible={isPickerOpen}
        />
        <UserStatsModal
          onClose={() => setIsStatsOpen(false)}
          onOpenGacha={() => {
            setIsStatsOpen(false);
            navigation.navigate("Gacha");
          }}
          onOpenLeaderboard={() => {
            setIsStatsOpen(false);
            navigation.navigate("Leaderboard");
          }}
          profile={profile}
          visible={isStatsOpen}
        />
        <DashboardSettingsModal
          onClose={() => setIsDashboardSettingsOpen(false)}
          visible={isDashboardSettingsOpen}
        />
        <Modal
          animationType="fade"
          onRequestClose={() => setSelectedPartSlot(null)}
          transparent
          visible={selectedPartSlot !== null}
        >
          <View style={styles.partModalBackdrop}>
            <View style={styles.partModalSheet}>
              <RNText style={styles.partModalTitle}>
                {selectedPartSlot ? `Equip ${selectedPartSlot.toUpperCase()} Part` : "Equip Part"}
              </RNText>
              <ScrollView contentContainerStyle={styles.partModalList} showsVerticalScrollIndicator={false}>
                {compatibleParts.length ? (
                  compatibleParts.map((part, index) => {
                    const source = getPartImageSource(part.name, part.slot);

                    return (
                      <Pressable
                        key={`${part.id}:${index}`}
                        style={styles.partOption}
                        onPress={async () => {
                          if (!profile || !selectedPartSlot) return;

                          const targetSlot = selectedPartSlot;
                          const nextEquippedParts = {
                            ...(profile.equippedParts || {}),
                            [selectedHolobot.name]: {
                              ...(profile.equippedParts?.[selectedHolobot.name] || {}),
                              [targetSlot]: {
                                id: part.id,
                                name: part.name,
                                rarity: part.rarity,
                                slot: targetSlot,
                              },
                            },
                          };

                          try {
                            await updateProfile({ equippedParts: nextEquippedParts });
                            setSelectedPartSlot(null);
                          } catch (error) {
                            Alert.alert("Equip failed", error instanceof Error ? error.message : "Please try again.");
                          }
                        }}
                      >
                        <View style={styles.partOptionIcon}>
                          {source ? <RNImage source={source} style={styles.fillImage} resizeMode="contain" /> : null}
                        </View>
                        <View style={styles.partOptionBody}>
                          <RNText style={styles.partOptionName}>{part.name}</RNText>
                          <RNText style={styles.partOptionMeta}>{part.slot || selectedPartSlot}</RNText>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <RNText style={styles.partEmptyText}>No compatible owned parts found for this slot yet.</RNText>
                )}
              </ScrollView>
              <Pressable style={styles.partBackButton} onPress={() => setSelectedPartSlot(null)}>
                <RNText style={styles.partBackText}>BACK</RNText>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </FigmaCanvas>
  );
}

const styles = StyleSheet.create({
  artImageFrame: {
    position: "absolute",
  },
  vectorLayer: {
    position: "absolute",
    zIndex: 10,
  },
  arenaHotspot: {
    position: "absolute",
    left: "4%",
    top: "82%",
    width: "20%",
    height: "12%",
    zIndex: 20,
  },
  changeHolobotHotspot: {
    position: "absolute",
    left: "65%",
    top: "59.375%",
    width: "29%",
    height: "6.25%",
    zIndex: 20,
  },
  inventoryHotspot: {
    position: "absolute",
    left: "24.5%",
    top: "82%",
    width: "20%",
    height: "12%",
    zIndex: 20,
  },
  marketplaceHotspot: {
    position: "absolute",
    left: "66.5%",
    top: "82%",
    width: "24%",
    height: "12%",
    zIndex: 20,
  },
  syncHotspot: {
    left: "46.5%",
    top: "82%",
    width: "18%",
    height: "12%",
    position: "absolute",
    zIndex: 20,
  },
  utilityStack: {
    gap: 10,
    position: "absolute",
    right: 18,
    top: 72,
    zIndex: 25,
  },
  statsButton: {
    zIndex: 25,
  },
  statsButtonInner: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderRadius: 26,
    borderWidth: 2,
    height: 52,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: 52,
  },
  holobotPortrait: {
    position: "absolute",
    left: "41%",
    top: "23.5%",
    width: "50%",
    height: "28.5%",
    zIndex: 20,
  },
  partOverlay: {
    position: "absolute",
    top: `${((DASHBOARD_SLOT_Y + 48) / ARTBOARD_HEIGHT) * 100}%`,
    width: `${(DASHBOARD_SLOT_OVERLAY_WIDTH / ARTBOARD_WIDTH) * 100}%`,
    height: `${(DASHBOARD_SLOT_OVERLAY_HEIGHT / ARTBOARD_HEIGHT) * 100}%`,
    zIndex: 20,
  },
  partHotspot: {
    position: "absolute",
    top: `${(DASHBOARD_SLOT_Y / ARTBOARD_HEIGHT) * 100}%`,
    width: `${(DASHBOARD_SLOT_WIDTH / ARTBOARD_WIDTH) * 100}%`,
    height: `${(DASHBOARD_SLOT_HEIGHT / ARTBOARD_HEIGHT) * 100}%`,
    zIndex: 20,
  },
  fillImage: {
    width: "100%",
    height: "100%",
  },
  partBackButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#050606",
    borderColor: "#1b1b1b",
    borderWidth: 2,
    marginTop: 16,
    minWidth: 180,
    paddingHorizontal: 34,
    paddingVertical: 16,
  },
  partBackText: {
    color: "#f0bf14",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1,
  },
  partEmptyText: {
    color: "#ddd2b5",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  partModalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(8, 8, 8, 0.9)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  partModalList: {
    gap: 12,
    paddingBottom: 8,
  },
  partModalSheet: {
    backgroundColor: "#252525",
    borderRadius: 12,
    maxHeight: "82%",
    maxWidth: 420,
    padding: 20,
    width: "100%",
  },
  partModalTitle: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  partOption: {
    alignItems: "center",
    backgroundColor: "#050606",
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  partOptionBody: {
    flex: 1,
  },
  partOptionIcon: {
    backgroundColor: "#101010",
    height: 72,
    width: 72,
  },
  partOptionMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    marginTop: 4,
    textTransform: "uppercase",
  },
  partOptionName: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
});
