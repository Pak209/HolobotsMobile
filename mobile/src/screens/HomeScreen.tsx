import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { FigmaCanvas } from "@/components/FigmaCanvas";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { Svg, G, Image, Line, Path, Rect, Text } from "@/components/FigmaSvg";
import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH, homeAssets } from "@/config/figmaAssets";
import { getPartImageSource } from "@/config/gameAssets";
import { getExpProgress, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import type { RootTabs } from "../../App";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

const ATTRIBUTE_LABELS = ["ATK", "DEF", "SPECIAL", "HP", "SPEED"] as const;
const ATTRIBUTE_CENTER_X = 415;
const ATTRIBUTE_CENTER_Y = 1055;
const ATTRIBUTE_RADIUS = 252;
const ATTRIBUTE_LABEL_RADIUS = 330;
type EquippedPartRecord = { id?: string; name?: string; slot?: string };

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
        name: part?.name || key,
        slot: part?.slot || key,
      };
    })
    .filter((entry): entry is { key: string; name: string; slot: string } => Boolean(entry));

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

function AbilityChip({
  background,
  detail,
  detailOffsetX,
  detailOffsetY,
  detailWidth,
  detailHeight,
  height,
  x,
  width,
  y,
}: {
  background: string;
  detail: number | string | null;
  detailOffsetX: number;
  detailOffsetY: number;
  detailWidth: number;
  detailHeight: number;
  height: number;
  x: number;
  width: number;
  y: number;
}) {
  return (
    <>
      <Image href={background} x={x} y={y} width={width} height={height} preserveAspectRatio="none" />
      {detail ? (
        <Image
          href={detail}
          x={x + detailOffsetX}
          y={y + detailOffsetY}
          width={detailWidth}
          height={detailHeight}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}
    </>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { profile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const expProgressWidth = 460.193 * getExpProgress(selectedHolobot);
  const equippedParts =
    (profile?.equippedParts?.[selectedHolobot.name] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
    (profile?.equippedParts?.[selectedHolobot.name.toLowerCase()] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
    {};
  const dashboardParts = resolveDashboardParts(equippedParts);
  const abilitySlots = [
    { part: dashboardParts[0], x: 78 },
    { part: dashboardParts[1], x: 338 },
    { part: dashboardParts[2], x: 598 },
    { part: dashboardParts[3], x: 858 },
    { part: dashboardParts[4], x: 1118 },
  ] as const;
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
        <Svg width="100%" height="100%" viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`}>
          <Image href={homeAssets.backgroundBase} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
          <Image href={homeAssets.backgroundDetail} x={0} y={0} width={1800} height={3200} preserveAspectRatio="none" />
          <Image href={homeAssets.topBackground} x={0} y={100} width={1800} height={409} preserveAspectRatio="none" />
          <Text x={126} y={228} fill="#fef1e0" fontSize={114} fontStyle="italic" fontWeight="900">HOLOBOTS</Text>

          <Image href={homeAssets.attributeChartBase} x={0} y={628} width={825} height={971} preserveAspectRatio="none" />
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
                  fill="#fbdb01"
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
            d="M 110.2 1594.4 H 814.6 V 1825.5 L 699.7 1941.5 H 110.2 Z"
            fill="#050606"
          />
          <Image
            href={homeAssets.mechCardFill}
            x={110.2}
            y={1594.38}
            width={704.418}
            height={347.163}
            preserveAspectRatio="none"
          />
          <Image
            href={selectedHolobot.imageUrl}
            x={835}
            y={720}
            width={710}
            height={970}
            preserveAspectRatio="xMidYMid meet"
          />
          <Text x={153} y={1662} fill="#ffffff" fontSize={49.915}>{selectedHolobot.name}</Text>
          <Image href={homeAssets.expBarTotal} x={140.48} y={1771.99} width={460.193} height={22.202} preserveAspectRatio="none" />
          <Image href={homeAssets.expBarProgress} x={140.48} y={1771.99} width={expProgressWidth} height={22.202} preserveAspectRatio="none" />
          <Text x={153} y={1742} fill="#ffffff" fontSize={24.794} fontWeight="700">{`EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
          <Text x={141} y={1863.3} fill="#ffffff" fontSize={100.722}>{`Lv ${selectedHolobot.level}`}</Text>

          <Path
            d="M 932 1833.75 H 1677.5 L 1625.5 1946.25 H 815 Z"
            fill="#050606"
          />
          <Image
            href={homeAssets.changeBar}
            x={815}
            y={1833.75}
            width={862.5}
            height={112.5}
            preserveAspectRatio="none"
          />
          <Image href={homeAssets.changeIconBack} x={1511} y={1755} width={168} height={159} preserveAspectRatio="none" />
          <Image href={homeAssets.changeIconFront} x={1491} y={1735} width={218} height={211} preserveAspectRatio="none" />
          <Text x={902} y={1896.25} fill="#e9dfc5" fontSize={55} fontWeight="700">CHANGE HOLOBOT</Text>

          {abilitySlots.map(({ part, x }, index) => {
            const detail = getPartImageSource(part?.name, part?.slot);
            const background = index % 2 === 0 ? homeAssets.abilityChipBackground1 : homeAssets.abilityChipBackground3;

            return (
              <AbilityChip
                key={`${part?.name || "empty"}:${index}`}
                background={background}
                detail={detail}
                x={x}
                y={2168}
                width={228}
                height={240}
                detailOffsetX={18}
                detailOffsetY={18}
                detailWidth={190}
                detailHeight={182}
              />
            );
          })}

          <Image href={homeAssets.bottomBackground} x={0} y={2375} width={1800} height={857} preserveAspectRatio="none" />
          <Rect x={0} y={2942} width={1800} height={258} fill="#050606" />
          <Image href={homeAssets.arenaIcon} x={8} y={2638} width={432} height={392} preserveAspectRatio="xMidYMid meet" />
          <Text x={224} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">ARENA</Text>
          <Image href={homeAssets.inventoryIcon} x={438} y={2680} width={320} height={320} preserveAspectRatio="xMidYMid meet" />
          <Text x={598} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">INVENTORY</Text>
          <Image href={homeAssets.syncIcon} x={815} y={2680} width={320} height={320} preserveAspectRatio="xMidYMid meet" />
          <Text x={975} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">SYNC</Text>
          <Image href={homeAssets.marketplaceIcon} x={1188} y={2680} width={320} height={320} preserveAspectRatio="xMidYMid meet" />
          <Text x={1348} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">MARKET</Text>
        </Svg>

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
      </View>
    </FigmaCanvas>
  );
}

const styles = StyleSheet.create({
  arenaHotspot: {
    position: "absolute",
    left: "4%",
    top: "82%",
    width: "20%",
    height: "12%",
  },
  changeHolobotHotspot: {
    position: "absolute",
    left: "45.2778%",
    top: "54.5625%",
    width: "48.3333%",
    height: "10.625%",
  },
  inventoryHotspot: {
    position: "absolute",
    left: "24.5%",
    top: "82%",
    width: "20%",
    height: "12%",
  },
  marketplaceHotspot: {
    position: "absolute",
    left: "66.5%",
    top: "82%",
    width: "24%",
    height: "12%",
  },
  syncHotspot: {
    left: "46.5%",
    top: "82%",
    width: "18%",
    height: "12%",
    position: "absolute",
  },
});
