import { useMemo, useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { DashboardSettingsModal } from "@/components/DashboardSettingsModal";
import { FigmaCanvas } from "@/components/FigmaCanvas";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { UserStatsModal } from "@/components/UserStatsModal";
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
const HOME_INFO_CARD_Y = 1638;
const HOME_CHANGE_BAR_Y = 1878;
const DASHBOARD_SLOT_Y = 2216;
const DASHBOARD_SLOT_WIDTH = 248;
const DASHBOARD_SLOT_HEIGHT = 260;
const DASHBOARD_SLOT_OVERLAY_WIDTH = 208;
const DASHBOARD_SLOT_OVERLAY_HEIGHT = 200;
type EquippedPartRecord = { id?: string; name?: string; rarity?: string; slot?: string };
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
  height,
  x,
  width,
  y,
}: {
  background: string;
  height: number;
  x: number;
  width: number;
  y: number;
}) {
  return <Image href={background} x={x} y={y} width={width} height={height} preserveAspectRatio="none" />;
}

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { profile, updateProfile } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const [selectedPartSlot, setSelectedPartSlot] = useState<DashboardSlot | null>(null);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const expProgressWidth = 460.193 * getExpProgress(selectedHolobot);
  const equippedParts =
    (profile?.equippedParts?.[selectedHolobot.name] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
    (profile?.equippedParts?.[selectedHolobot.name.toLowerCase()] as Record<string, { id?: string; name?: string; slot?: string }> | undefined) ??
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
            d={`M 110.2 ${HOME_INFO_CARD_Y} H 814.6 V ${HOME_INFO_CARD_Y + 231.1} L 699.7 ${HOME_INFO_CARD_Y + 347.1} H 110.2 Z`}
            fill="#050606"
          />
          <Image
            href={homeAssets.mechCardFill}
            x={110.2}
            y={HOME_INFO_CARD_Y}
            width={704.418}
            height={347.163}
            preserveAspectRatio="none"
          />
          <Text x={153} y={HOME_INFO_CARD_Y + 67.62} fill="#ffffff" fontSize={49.915}>{selectedHolobot.name}</Text>
          <Image href={homeAssets.expBarTotal} x={140.48} y={HOME_INFO_CARD_Y + 177.61} width={460.193} height={22.202} preserveAspectRatio="none" />
          <Image href={homeAssets.expBarProgress} x={140.48} y={HOME_INFO_CARD_Y + 177.61} width={expProgressWidth} height={22.202} preserveAspectRatio="none" />
          <Text x={153} y={HOME_INFO_CARD_Y + 147.62} fill="#ffffff" fontSize={24.794} fontWeight="700">{`EXP ${selectedHolobot.experience}/${selectedHolobot.nextLevelExp}`}</Text>
          <Text x={141} y={HOME_INFO_CARD_Y + 268.92} fill="#ffffff" fontSize={100.722}>{`Lv ${selectedHolobot.level}`}</Text>

          <Path
            d={`M 932 ${HOME_CHANGE_BAR_Y} H 1677.5 L 1625.5 ${HOME_CHANGE_BAR_Y + 112.5} H 815 Z`}
            fill="#050606"
          />
          <Image
            href={homeAssets.changeBar}
            x={815}
            y={HOME_CHANGE_BAR_Y}
            width={862.5}
            height={112.5}
            preserveAspectRatio="none"
          />
          <Image href={homeAssets.changeIconBack} x={1511} y={HOME_CHANGE_BAR_Y - 78.75} width={168} height={159} preserveAspectRatio="none" />
          <Image href={homeAssets.changeIconFront} x={1491} y={HOME_CHANGE_BAR_Y - 98.75} width={218} height={211} preserveAspectRatio="none" />
          <Text x={902} y={HOME_CHANGE_BAR_Y + 62.5} fill="#e9dfc5" fontSize={55} fontWeight="700">CHANGE HOLOBOT</Text>

          {abilitySlots.map(({ part, x }, index) => {
            const background = index % 2 === 0 ? homeAssets.abilityChipBackground1 : homeAssets.abilityChipBackground3;

            return (
              <AbilityChip
                key={`${part?.name || "empty"}:${index}`}
                background={background}
                x={x}
                y={DASHBOARD_SLOT_Y}
                width={DASHBOARD_SLOT_WIDTH}
                height={DASHBOARD_SLOT_HEIGHT}
              />
            );
          })}

          <Image href={homeAssets.bottomBackground} x={0} y={2375} width={1800} height={857} preserveAspectRatio="none" />
          <Rect x={0} y={2942} width={1800} height={258} fill="#050606" />
          <Image href={homeAssets.arenaIcon} x={-50} y={2638} width={432} height={392} preserveAspectRatio="xMidYMid meet" />
          <Text x={210} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">ARENA</Text>
          <Image href={homeAssets.inventoryIcon} x={462} y={2680} width={320} height={320} preserveAspectRatio="xMidYMid meet" />
          <Text x={622} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">INVENTORY</Text>
          <Image href={homeAssets.syncIcon} x={858} y={2690} width={300} height={300} preserveAspectRatio="xMidYMid meet" />
          <Text x={1008} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">SYNC</Text>
          <Image href={homeAssets.marketplaceIcon} x={1248} y={2690} width={300} height={300} preserveAspectRatio="xMidYMid meet" />
          <Text x={1398} y={3072} fill="#ffffff" fontSize={50} textAnchor="middle">MARKET</Text>
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
          <RNImage source={selectedHolobot.imageSource} style={styles.fillImage} resizeMode="contain" />
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
    top: "55.9375%",
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
    left: "46.3889%",
    top: "22.5%",
    width: "39.4444%",
    height: "30.3125%",
  },
  partOverlay: {
    position: "absolute",
    top: `${((DASHBOARD_SLOT_Y + 24) / ARTBOARD_HEIGHT) * 100}%`,
    width: `${(DASHBOARD_SLOT_OVERLAY_WIDTH / ARTBOARD_WIDTH) * 100}%`,
    height: `${(DASHBOARD_SLOT_OVERLAY_HEIGHT / ARTBOARD_HEIGHT) * 100}%`,
  },
  partHotspot: {
    position: "absolute",
    top: `${(DASHBOARD_SLOT_Y / ARTBOARD_HEIGHT) * 100}%`,
    width: `${(DASHBOARD_SLOT_WIDTH / ARTBOARD_WIDTH) * 100}%`,
    height: `${(DASHBOARD_SLOT_HEIGHT / ARTBOARD_HEIGHT) * 100}%`,
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
