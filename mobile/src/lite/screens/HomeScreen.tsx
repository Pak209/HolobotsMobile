import { type ReactNode, useMemo, useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View, type DimensionValue, type ImageSourcePropType } from "react-native";
import { Defs, Filter, FeColorMatrix, Image as SvgImage } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { DashboardSettingsModal } from "@/lite/components/DashboardSettingsModal";
import { FigmaCanvas, useHomeCompactFactor } from "@/lite/components/FigmaCanvas";
import { HolobotPickerModal } from "@/lite/components/HolobotPickerModal";
import { UserStatsModal } from "@/lite/components/UserStatsModal";
import { GameDialogFrame, GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { ArenaControlFrame } from "@/lite/components/arena/ArenaTierFrames";
import { UnityLaunchButton } from "@/lite/components/dashboard/UnityLaunchButton";
import { TravelSquadPanel } from "@/lite/components/dashboard/TravelSquadPanel";
import { HologramPlatform } from "@/lite/components/dashboard/HologramPlatform";
import { DashboardZonesPanel } from "@/lite/components/dashboard/DashboardZonesPanel";
import { getRarity, getRarityShortLabel } from "@/lite/components/dashboard/holobotPresentation";
import { describePartBoosts, getEquippedPartBoosts, getPartStars } from "@/lib/partStats";
import { Svg, G, Line, Path, Rect, Text } from "@/components/FigmaSvg";
import { homeAssets } from "@/lite/config/figmaAssets";
import {
  ARTBOARD_HEIGHT, ARTBOARD_WIDTH, FOOTER_LABEL_SIZE, FOOTER_LABEL_Y, HEADER_PLATE_PATH, HOME_FOOTER_ITEMS, HOME_NATIVE_CITY_ENTRY, HOME_PAGE_PADDING, HOME_STATUS_STRIP,
  PART_OVERLAY, PART_SLOT_HEIGHT, PART_SLOT_WIDTH, PART_SLOT_XS, PART_SLOT_Y, STATUS_STRIP_TEXT_PT, artboardPercentX, artboardPercentY, type HomeFooterKey,
} from "@/lite/config/homeLayout";
import { getPartImageSource } from "@/lite/config/gameAssets";
import { getExpProgress, getHolobotFullImageSource, mergeHolobotRoster } from "@/config/holobots";
import { theme } from "@/lite/theme";
import { useRivalStatus, type RivalHudPreview } from "@/lite/hooks/useRivalStatus";
import { useAuth } from "@/contexts/AuthContext";
import { useHostDashboard } from "@/lite/hooks/useHostDashboard";
import { presentHostDashboard, type HostDashboardState } from "@/lite/lib/hostDashboard";
import { HOME_ROSTER_COPY, homeRosterState } from "@/lite/lib/homeRoster";
import type { RootTabs } from "../../../LiteApp";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Overlay only the gold pixels (green without blue), retaining the original
// red Arena blade, blue bag and white basket. Core Image works in linear RGB.
const iconAccent = [1, 3, 5].map(offset => {
  const channel = parseInt(theme.colors.accent.slice(offset, offset + 2), 16) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});
const ICON_PALETTE = `0 0 0 0 ${iconAccent[0]}  0 0 0 0 ${iconAccent[1]}  0 0 0 0 ${iconAccent[2]}  0 3 -3 0 0`;

// Every SVG label on Home uses the HUD face (L16); without it they fell back to the system font.
const HUD_FONT = theme.type.display.fontFamily;
const FOOTER_ICONS: Record<HomeFooterKey, ImageSourcePropType> = {
  arena: homeAssets.arenaIcon, inventory: homeAssets.inventoryIcon, sync: homeAssets.syncIcon, market: homeAssets.marketplaceIcon,
};

const ATTRIBUTE_LABELS = ["ATK", "DEF", "SPECIAL", "HP", "SPEED"] as const;
const ATTRIBUTE_CENTER_X = 415;
const ATTRIBUTE_CENTER_Y = 1055;
const ATTRIBUTE_RADIUS = 252;
const ATTRIBUTE_LABEL_RADIUS = 330;
const HOME_INFO_CARD_Y = 1638;
const HOME_CHANGE_BAR_Y = 1878;

/** Angular corner-cut frame for the equipped-part slots (JRPG handoff). */
function buildPartFramePath(x: number, inset = 0) {
  const left = x + inset;
  const top = PART_SLOT_Y + inset;
  const right = x + PART_SLOT_WIDTH - inset;
  const bottom = PART_SLOT_Y + PART_SLOT_HEIGHT - inset;
  const cut = 26;

  return `M ${left + cut} ${top} H ${right - cut} L ${right} ${top + cut} V ${bottom - cut} L ${right - cut} ${bottom} H ${left + cut} L ${left} ${bottom - cut} V ${top + cut} Z`;
}
type EquippedPartRecord = { id?: string; level?: number; name?: string; rarity?: string; slot?: string; stars?: number };
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
  const angle = (index * 2 * Math.PI) / 5 - Math.PI / 2;

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
    .filter(
      (entry): entry is { key: string; level: number | undefined; name: string; rarity: string | undefined; slot: string; stars: number | undefined } =>
        entry !== null,
    );

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

function ArtImage({
  height,
  resizeMode = "stretch",
  source,
  width,
  x,
  y,
  zIndex = 1,
  tintColor,
  recolorGold = false,
}: {
  height: number;
  tintColor?: string;
  recolorGold?: boolean;
  resizeMode?: "contain" | "cover" | "stretch";
  source: ImageSourcePropType;
  width: number;
  x: number;
  y: number;
  zIndex?: number;
}) {
  return (
    <View pointerEvents="none" style={[styles.artImageFrame, getArtboardFrame(x, y, width, height), { zIndex }]}>
      {recolorGold ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          <Defs><Filter id="cityIconPalette">
            <FeColorMatrix type="matrix" values={ICON_PALETTE} />
          </Filter></Defs>
          <SvgImage href={source} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
          <SvgImage href={source} width={width} height={height} preserveAspectRatio="xMidYMid meet" filter="url(#cityIconPalette)" />
        </Svg>
      ) : <RNImage source={source} style={[styles.fillImage, tintColor ? { tintColor } : undefined]} resizeMode={resizeMode} />}
    </View>
  );
}

/** `rivalPreview` / `dashboardPreview` are the offline QA harness only (no session, no network). */
export function HomeScreen({ rivalPreview, dashboardPreview }: { rivalPreview?: RivalHudPreview; dashboardPreview?: HostDashboardState } = {}) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const insets = useSafeAreaInsets();
  const { profile, profileError, profileLoading, retryProfile, updateProfile, user } = useAuth();
  const rival = useRivalStatus(user?.uid, rivalPreview);
  // Header pilot / SYNC / HOLOS, squad LV and zone rows: host reads only (desktopAccountSnapshot + desktopItemsHost).
  const host = useHostDashboard(user?.uid, dashboardPreview);
  const dashboard = useMemo(() => presentHostDashboard(host.state), [host.state]);
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const [selectedPartSlot, setSelectedPartSlot] = useState<DashboardSlot | null>(null);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots, "full"), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  // Signed in with no owned Holobot: never present the catalog fallback as the account's bot. Only a failed
  // profile read says "can't load" and offers RETRY; a loaded profile with no Holobots says so (L20).
  const rosterState = homeRosterState({ signedIn: !!user, ownsHolobot: roster.some((holobot) => holobot.owned), profileLoaded: !!profile, profileLoading, profileError });
  const rosterAvailable = rosterState === "ready";
  const expProgressWidth = rosterAvailable ? 460.193 * getExpProgress(selectedHolobot) : 0;
  const equippedParts =
    (profile?.equippedParts?.[selectedHolobot.name] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
    (profile?.equippedParts?.[selectedHolobot.name.toLowerCase()] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
    {};
  const dashboardParts = resolveDashboardParts(equippedParts);
  const rarity = getRarity(selectedHolobot.rank);
  const abilitySlots = [
    { part: dashboardParts[0], slot: "head", x: PART_SLOT_XS[0] },
    { part: dashboardParts[1], slot: "torso", x: PART_SLOT_XS[1] },
    { part: dashboardParts[2], slot: "arms", x: PART_SLOT_XS[2] },
    { part: dashboardParts[3], slot: "legs", x: PART_SLOT_XS[3] },
    { part: dashboardParts[4], slot: "core", x: PART_SLOT_XS[4] },
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
  // Equipped-part boosts feed both real combat (buildPlayerFighter) and
  // this chart — same numbers, no display-only fiction.
  const partBoosts = getEquippedPartBoosts(equippedParts);
  const attributeValues = !rosterAvailable ? { ATK: 0, DEF: 0, SPECIAL: 0, HP: 0, SPEED: 0 } : {
    ATK: Math.min(100, selectedHolobot.stats.attack + partBoosts.attack),
    DEF: Math.min(100, selectedHolobot.stats.defense + partBoosts.defense),
    SPECIAL: Math.min(100, selectedHolobot.stats.special + partBoosts.special),
    HP: Math.min(100, selectedHolobot.stats.hp + Math.round(partBoosts.hp / 4)),
    SPEED: Math.min(100, selectedHolobot.stats.speed + partBoosts.speed),
  };
  return (
    <View style={{ flex: 1, paddingTop: insets.top + HOME_PAGE_PADDING.top, paddingBottom: insets.bottom + HOME_PAGE_PADDING.bottom, backgroundColor: theme.colors.carbon }}>
    <FigmaCanvas>
      <View style={StyleSheet.absoluteFill}>
        <ArtImage tintColor={theme.colors.carbon} source={homeAssets.backgroundBase} x={0} y={0} width={1800} height={3200} />
        <ArtImage tintColor={theme.plates.navy} source={homeAssets.backgroundDetail} x={0} y={0} width={1800} height={3200} />
        <ArtImage source={homeAssets.attributeChartBase} x={0} y={628} width={825} height={971} zIndex={2} />
        {abilitySlots.map(({ part, x }, index) => (
          <ArtImage
            key={`ability-bg-${part?.name || "empty"}:${index}`}
            source={index % 2 === 0 ? homeAssets.abilityChipBackground1 : homeAssets.abilityChipBackground3}
            x={x}
            y={PART_SLOT_Y}
            width={PART_SLOT_WIDTH}
            height={PART_SLOT_HEIGHT}
            zIndex={2}
          />
        ))}
        <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`} style={styles.vectorLayer}>
          <G fill="none" stroke={theme.colors.accent} strokeWidth={5}>

            <Path d="M20 910 L280 650 H810 V1350 L580 1570 H20 M40 925 L295 675 H790 V1340 L570 1545 H40" />
            <Path d={`M110 ${HOME_INFO_CARD_Y + 50} L155 ${HOME_INFO_CARD_Y} H814 V${HOME_INFO_CARD_Y + 260} L720 ${HOME_INFO_CARD_Y + 347} H110 Z`} />
            <Path d={`M815 ${HOME_CHANGE_BAR_Y + 112} L940 ${HOME_CHANGE_BAR_Y - 15} H1645 L1695 ${HOME_CHANGE_BAR_Y + 30} V${HOME_CHANGE_BAR_Y + 112} Z`} />

          </G>
          {/* Layered header plate follows the original silhouette. */}
          <Path d={HEADER_PLATE_PATH} fill={theme.plates.navy} fillOpacity={0.88} />
          <G fill="none" stroke={theme.colors.accent}>
            <Path d="M0 100 H145 L168 124 H995 L1045 170 H1800 M0 450 H230 L260 425 H1410 L1530 300 H1800" strokeWidth={5} />
            <Path d="M0 118 H140 L165 142 H986 L1035 188 H1470 M0 468 H237 L268 443 H1120 M1450 400 L1550 282 H1740" strokeWidth={2} opacity={0.55} />
            <Path d="M22 125 H135 M195 135 H930 L972 135 M1060 170 H1210 M480 425 H740 M35 450 H125 M1550 300 H1715" strokeWidth={12} />
            <Path d="M0 360 H36 L75 400 H205 L235 425 M1250 170 L1320 105 H1720" strokeWidth={2} opacity={0.45} />
          </G>
          {[1185,1206,1227,1248].map(x => <Rect key={`header-dot-${x}`} x={x} y={145} width={8} height={8} fill={theme.colors.accent} opacity={0.7} />)}
          <Text fontFamily={HUD_FONT} x={126} y={268} fill={theme.colors.text} fontSize={114} fontStyle="italic" fontWeight="900">HOLOBOTS</Text>

          {/* Hologram glow centered under the Holobot (portrait is zIndex 20,
              this vector layer is zIndex 10, so the bot stands on it). */}
          <HologramPlatform centerX={1183} centerY={1630} />

          <G>
            {[0.2, 0.4, 0.6, 0.8].map((scale) => (
              <Path
                key={scale}
                d={buildPolygonPath(scale)}
                fill="none"
                stroke={theme.colors.border}
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
                  stroke={theme.colors.border}
                  strokeWidth={2}
                  opacity={0.28}
                />
              );
            })}
            <Path d={buildPolygonPath(1)} fill="none" stroke={theme.colors.accent} strokeWidth={6} />
            <Path d={buildPolygonPath(0.85)} fill="none" stroke={theme.colors.accent} strokeWidth={3} />
            <Path d={buildValuePolygonPath(attributeValues)} fill={theme.colors.accent} fillOpacity={0.55} stroke={theme.colors.accent} strokeWidth={4} />
            {ATTRIBUTE_LABELS.map((label, index) => {
              const position = getAttributeLabelPosition(index);
              return (
                <Text
                  key={label}
                  fontFamily={HUD_FONT}
                  x={position.x}
                  y={position.y}
                  fill={theme.colors.muted}
                  fontSize={index === 1 ? 47.259 : index === 0 ? 40.69 : 41.667}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {label}
                </Text>
              );
            })}
          </G>

          <Path
            d={`M 110.2 ${HOME_INFO_CARD_Y} H 814.6 V ${HOME_INFO_CARD_Y + 231.1} L 699.7 ${HOME_INFO_CARD_Y + 347.1} H 110.2 Z`}
            fill={theme.colors.carbon}
          />
          <Text fontFamily={HUD_FONT} x={153} y={HOME_INFO_CARD_Y + 67.62} fill={theme.colors.text} fontSize={rosterAvailable ? 49.915 : 34}>{rosterState === "ready" ? selectedHolobot.name : HOME_ROSTER_COPY[rosterState]}</Text>
          {/* Ranking tag: the Holobot's ACTUAL rank with its star tier. */}
          {rosterAvailable ? <G>
            <Rect x={560} y={HOME_INFO_CARD_Y + 18} width={235} height={112} fill={theme.plates.navy} stroke={theme.colors.border} strokeWidth={3} />
            <Text fontFamily={HUD_FONT} x={677} y={HOME_INFO_CARD_Y + 62} fill={theme.colors.accent} fontSize={30} fontWeight="800" textAnchor="middle">{rarity.label.toUpperCase()}</Text>
            <Text fontFamily={HUD_FONT} x={677} y={HOME_INFO_CARD_Y + 106} fill={theme.colors.accent} fontSize={34} textAnchor="middle">{"★".repeat(rarity.stars)}</Text>
          </G> : null}
          {/* No EXP or level without a roster; only a failed read offers a retry (L20/L22). */}
          {rosterAvailable ? <G>
            <Rect x={140.48} y={HOME_INFO_CARD_Y + 177.61} width={460.193} height={22.202} fill={theme.plates.raised} />
            <Rect x={140.48} y={HOME_INFO_CARD_Y + 177.61} width={expProgressWidth} height={22.202} fill={theme.colors.accent} />
            <Text fontFamily={HUD_FONT} x={153} y={HOME_INFO_CARD_Y + 147.62} fill={theme.colors.text} fontSize={24.794} fontWeight="700">{`EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
            <Text fontFamily={HUD_FONT} x={141} y={HOME_INFO_CARD_Y + 268.92} fill={theme.colors.text} fontSize={100.722}>{`LV ${selectedHolobot.level}`}</Text>
          </G> : rosterState === "unavailable" ? <Text fontFamily={HUD_FONT} x={153} y={HOME_INFO_CARD_Y + 250} fill={theme.colors.accent} fontSize={64}>{HOME_ROSTER_COPY.retry}</Text> : null}

          <Path
            d={`M 932 ${HOME_CHANGE_BAR_Y} H 1677.5 L 1625.5 ${HOME_CHANGE_BAR_Y + 112.5} H 815 Z`}
            fill={theme.colors.carbon}
          />
          <Text fontFamily={HUD_FONT} x={902} y={HOME_CHANGE_BAR_Y + 62.5} fill={theme.colors.text} fontSize={55} fontWeight="700">CHANGE HOLOBOT</Text>

          {/* JRPG part frames: rarity-tinted corner-cut outline, star tier,
              and a level plate. Icons render above at zIndex 20. */}
          {abilitySlots.map(({ part, x }) => {
            const stars = part?.stars ?? getPartStars(part);
            const strong = stars >= 4;
            const borderColor = strong ? theme.colors.warning : stars >= 3 ? theme.colors.magenta : theme.colors.accent;
            return (
              <G key={`part-frame-${x}`}>
                {strong ? <Path d={buildPartFramePath(x)} fill="none" stroke={theme.colors.warning} strokeWidth={18} opacity={0.18} /> : null}
                <Path d={buildPartFramePath(x)} fill={theme.plates.navy} stroke={borderColor} strokeWidth={strong ? 7 : 4} />
                {!part ? <Text fontFamily={HUD_FONT} x={x + 124} y={PART_SLOT_Y + 150} fill={theme.colors.subtle} fontSize={64} textAnchor="middle">+</Text> : null}
                <Path d={buildPartFramePath(x, 12)} fill="none" stroke={theme.colors.border} strokeWidth={2} opacity={0.9} />
                {/* Star tier centered ABOVE the part art. */}
                <Text fontFamily={HUD_FONT} x={x + 124} y={PART_SLOT_Y + 42} fill={borderColor} fontSize={30} fontWeight="800" textAnchor="middle">{"★".repeat(stars)}</Text>
                {/* Rarity plate: every part carries its tier label. */}
                <Path d={`M ${x + 22} ${PART_SLOT_Y + 198} H ${x + 226} V ${PART_SLOT_Y + 250} H ${x + 38} L ${x + 22} ${PART_SLOT_Y + 236} Z`} fill={theme.colors.carbon} stroke={borderColor} strokeWidth={2} />
                <Text fontFamily={HUD_FONT} x={x + 124} y={PART_SLOT_Y + 236} fill={borderColor} fontSize={31} fontWeight="800" textAnchor="middle">{getRarityShortLabel(part?.rarity)}</Text>
              </G>
            );
          })}

          <G transform={`translate(1510 ${HOME_CHANGE_BAR_Y - 70})`} fill="none" stroke={theme.colors.accent} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M155 60 A70 70 0 0 0 30 45 M30 15 V60 H75 M25 105 A70 70 0 0 0 150 120 M150 150 V105 H105" />
          </G>
          {/* A complete plate behind BOTH icons and labels; no opaque label strip clipping its rim. */}
          <Path d="M0 2600 L60 2540 H410 L438 2565 H1740 L1800 2510 V3070 L1700 3170 H96 L0 3074 Z" fill={theme.plates.navy} fillOpacity={0.92} />
          <G fill="none" stroke={theme.colors.accent}>
            <Path d="M0 2600 L60 2540 H410 L438 2565 H1740 L1800 2510 M1800 3070 L1700 3170 H96 L0 3074" strokeWidth={6} />
            <Path d="M36 2650 V3060 L112 3140 H1685 L1762 3060 V2620 M8 2615 L70 2558 H340 M500 2582 H1520 M115 3154 H370 M1420 3154 H1687 L1740 3100" strokeWidth={2} opacity={0.7} />
            <Path d="M0 3088 L89 3178 H220 M230 3170 H530 M1510 3170 H1680 M45 2550 H155 M1380 2565 H1660" strokeWidth={11} />
          </G>
          {[2680,2702,2724,2746].map(y => <Rect key={`footer-dot-${y}`} x={34} y={y} width={7} height={7} fill={theme.colors.accent} opacity={0.6} />)}
          {[575,597,619,641].map(x => <Rect key={`footer-dot-${x}`} x={x} y={3186} width={7} height={7} fill={theme.colors.accent} opacity={0.6} />)}
          {HOME_FOOTER_ITEMS.map((item) => (
            <Text key={`footer-label-${item.key}`} fontFamily={HUD_FONT} x={item.labelX} y={FOOTER_LABEL_Y} fill={theme.colors.text} fontSize={FOOTER_LABEL_SIZE} textAnchor="middle">{item.label}</Text>
          ))}
        </Svg>
        {HOME_FOOTER_ITEMS.map((item) => (
          <ArtImage
            key={`footer-icon-${item.key}`}
            recolorGold={item.key !== "sync"}
            tintColor={item.key === "sync" ? theme.colors.accent : undefined}
            source={FOOTER_ICONS[item.key]}
            {...item.icon}
            resizeMode="contain"
            zIndex={11}
          />
        ))}

        {/* Each footer hotspot is its own column: icon art and label, never a neighbour's (homeLayout.ts). */}
        {HOME_FOOTER_ITEMS.map((item) => (
          <Pressable
            key={`footer-hotspot-${item.key}`}
            style={[styles.footerHotspot, getArtboardFrame(item.hotspot.x, item.hotspot.y, item.hotspot.width, item.hotspot.height)]}
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel}
            onPress={() => { if (item.route === "CityMarket") navigation.navigate("CityMarket", { from: "Home" }); else navigation.navigate(item.route); }}
          />
        ))}
        {rosterState === "unavailable" ? (
          <Pressable
            style={[styles.footerHotspot, getArtboardFrame(110, HOME_INFO_CARD_Y, 705, 347)]}
            accessibilityRole="button"
            // PLACEHOLDER copy (Lex, DECISIONS #71).
            accessibilityLabel="Can't load your roster. Retry"
            onPress={retryProfile}
          />
        ) : null}
        <Pressable
          style={styles.changeHolobotHotspot}
          onPress={() => setIsPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change active holobot"
        />
        <HomeUtilityRail>
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
                  stroke={theme.colors.accent}
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
                <Path d="m3 7l6-3l6 3l6-3v13l-6 3l-6-3l-6 3z" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12v.01" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M6 13v.01" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m17 15-4-4" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m13 15 4-4" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
                <Path d="M10 3a1 1 0 1 0 2 0a1 1 0 0 0-2 0" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m3 14 4 1 .5-.5" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M12 18v-3l-3-2.923L9.75 7" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M6 10V8l4-1 2.5 2.5 2.5.5" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M21 22a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="m18 21 1-11 2-1" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
                <Path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        </HomeUtilityRail>
        {rosterAvailable ? <View pointerEvents="none" style={styles.holobotPortrait}>
          <RNImage source={getHolobotFullImageSource(selectedHolobot.name)} style={styles.fillImage} resizeMode="contain" />
        </View> : null}
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
                  left: artboardPercentX(x + PART_OVERLAY.dx),
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
                left: artboardPercentX(x),
              },
            ]}
          />
        ))}
        <View style={styles.statusStrip}>
          <View style={styles.statusRow}>
            {/* HOLOS = desktopItemsHost read; SYNC = desktopAccountSnapshot.syncPoints. PLACEHOLDER copy. */}
            <RNText testID="dashboard-header-counters" style={[styles.statusText, styles.statusCounters]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{[rival.status ? `TIER ${rival.status.tier}` : null, dashboard.holos, dashboard.sync].filter(Boolean).join(" · ")}</RNText>
            <Pressable accessibilityRole="button" accessibilityLabel="Explore HoloCity and rivals" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} onPress={() => navigation.navigate("CityHub")}>
              <RNText style={styles.cityText}>CITY › {rival.countdown || "RIVALS"}</RNText>
            </Pressable>
          </View>
          {/* desktopAccountSnapshot.username; a failed read offers a retry, never a fallback name. PLACEHOLDER copy. */}
          <Pressable disabled={!dashboard.unavailable} accessibilityRole={dashboard.unavailable ? "button" : "text"} accessibilityLabel={dashboard.unavailable ? `${dashboard.pilot}. Retry account read` : dashboard.pilot} hitSlop={6} onPress={host.retry} style={styles.pilotRow}>
            <RNText testID="dashboard-header-pilot" style={[styles.statusText, styles.pilotText]} numberOfLines={1}>{dashboard.pilot}{dashboard.unavailable ? " · RETRY" : ""}</RNText>
          </Pressable>
        </View>
        <HomeCityEntry />
        <TravelSquadPanel uid={user?.uid} roster={roster} levels={dashboard.levels} />
        <DashboardZonesPanel summary={dashboard.zonesSummary} zones={dashboard.zones} onRetry={host.retry} />
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
          hostAccount={dashboard}
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
              <GameDialogFrame accent={theme.colors.accent} fill={theme.colors.carbon} />
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
                        <GameSurfaceFrame accent={part.rarity?.toLowerCase().includes("epic") ? theme.colors.purple : theme.colors.accent} />
                        <View style={styles.partOptionIcon}>
                          {source ? <RNImage source={source} style={styles.fillImage} resizeMode="contain" /> : null}
                        </View>
                        <View style={styles.partOptionBody}>
                          <RNText style={styles.partOptionName}>{part.name}</RNText>
                          <RNText style={styles.partOptionMeta}>{part.slot || selectedPartSlot}</RNText>
                          <RNText style={styles.partOptionBoost}>
                            {describePartBoosts({ ...part, slot: part.slot || selectedPartSlot || undefined }) || "No boost"}
                          </RNText>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <RNText style={styles.partEmptyText}>No compatible owned parts found for this slot yet.</RNText>
                )}
              </ScrollView>
              <Pressable style={styles.partBackButton} onPress={() => setSelectedPartSlot(null)}>
                <ArenaControlFrame accent={theme.colors.accent} selected />
                <RNText style={styles.partBackText}>BACK</RNText>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </FigmaCanvas>
    </View>
  );
}

/** ENTER HOLOCITY over the status strip: HOME_NATIVE_CITY_ENTRY.heightPt (32) at 402 / 430 pt; lite-sim-fixes-1 scales it
 * with the compact factor (and keeps the label on one line) so on a 375 pt artboard it no longer covers the CITY countdown. */
function HomeCityEntry() {
  const k = useHomeCompactFactor();
  return <View testID="home-city-entry" style={[styles.nativeCityEntry, { height: Math.round(HOME_NATIVE_CITY_ENTRY.heightPt * k) }]}><UnityLaunchButton inline compact /></View>;
}

/** The right-hand rail (pilot stats, quests, training, settings) is sized in points. lite-sim-fixes-1: on a smaller
 * artboard (iPhone SE) it shrinks with the art from its top-right corner, so the settings gear stays above the CHANGE
 * HOLOBOT bar instead of covering its swap icon. Factor 1 (unchanged) at 402 and 430 pt. */
function HomeUtilityRail({ children }: { children: ReactNode }) {
  const k = useHomeCompactFactor();
  return <View testID="home-utility-rail" style={[styles.utilityStack, k < 1 ? { transform: [{ scale: k }], transformOrigin: "top right" } : null]}>{children}</View>;
}

const styles = StyleSheet.create({
  nativeCityEntry: { position: "absolute", left: artboardPercentX(HOME_NATIVE_CITY_ENTRY.left), right: artboardPercentX(ARTBOARD_WIDTH - HOME_NATIVE_CITY_ENTRY.right), top: artboardPercentY(HOME_NATIVE_CITY_ENTRY.top), height: HOME_NATIVE_CITY_ENTRY.heightPt, zIndex: 35 },
  // Ends left of the header plate's diagonal and keeps both lines above its lower edge (L14); it used
  // to run under the diagonal to x 1674, and the PILOT line sat on the edge.
  statusStrip: { position: "absolute", left: artboardPercentX(HOME_STATUS_STRIP.left), right: artboardPercentX(ARTBOARD_WIDTH - HOME_STATUS_STRIP.right), top: artboardPercentY(HOME_STATUS_STRIP.top), zIndex: 30 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  statusText: { color: theme.colors.muted, fontFamily: HUD_FONT, fontSize: STATUS_STRIP_TEXT_PT, fontWeight: "700" },
  statusCounters: { flexShrink: 1 },
  pilotRow: { alignSelf: "flex-start", maxWidth: "70%" },
  pilotText: { color: theme.colors.text },
  cityText: { color: theme.colors.accent, fontFamily: HUD_FONT, fontSize: STATUS_STRIP_TEXT_PT, fontWeight: "800" },
  artImageFrame: {
    position: "absolute",
  },
  vectorLayer: {
    position: "absolute",
    zIndex: 10,
  },
  footerHotspot: {
    position: "absolute",
    zIndex: 20,
  },
  changeHolobotHotspot: {
    position: "absolute",
    left: "45.2778%",
    top: "55.9375%",
    width: "48.3333%",
    height: "10.625%",
    zIndex: 20,
  },
  utilityStack: {
    gap: 10,
    position: "absolute",
    right: 18,
    top: "14.5%",
    zIndex: 25,
  },
  statsButton: {
    zIndex: 25,
  },
  statsButtonInner: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
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
    left: "43.5%",
    top: "20.75%",
    width: "44.5%",
    height: "34.5%",
    zIndex: 20,
  },
  partOverlay: {
    position: "absolute",
    top: artboardPercentY(PART_SLOT_Y + PART_OVERLAY.dy),
    width: `${(PART_OVERLAY.width / ARTBOARD_WIDTH) * 100}%`,
    height: `${(PART_OVERLAY.height / ARTBOARD_HEIGHT) * 100}%`,
    zIndex: 20,
  },
  partHotspot: {
    position: "absolute",
    top: `${(PART_SLOT_Y / ARTBOARD_HEIGHT) * 100}%`,
    width: `${(PART_SLOT_WIDTH / ARTBOARD_WIDTH) * 100}%`,
    height: `${(PART_SLOT_HEIGHT / ARTBOARD_HEIGHT) * 100}%`,
    zIndex: 20,
  },
  fillImage: {
    width: "100%",
    height: "100%",
  },
  partBackButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "transparent",
    marginTop: 16,
    minWidth: 180,
    minHeight: 52,
    paddingHorizontal: 34,
    position: "relative",
  },
  partBackText: {
    color: theme.colors.accent,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1,
  },
  partEmptyText: {
    color: theme.colors.muted,
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
    backgroundColor: "transparent",
    maxHeight: "82%",
    maxWidth: 420,
    overflow: "hidden",
    padding: 20,
    position: "relative",
    width: "100%",
  },
  partModalTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  partOption: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 12,
    padding: 12,
    position: "relative",
  },
  partOptionBody: {
    flex: 1,
  },
  partOptionIcon: {
    backgroundColor: theme.plates.raised,
    height: 72,
    width: 72,
  },
  partOptionBoost: {
    color: theme.colors.success,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  partOptionMeta: {
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: 4,
    textTransform: "uppercase",
  },
  partOptionName: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
});
