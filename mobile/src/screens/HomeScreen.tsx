import { useMemo, useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { DashboardSettingsModal } from "@/components/DashboardSettingsModal";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { HolobotRosterCard } from "@/components/HolobotRosterCard";
import { UserStatsModal } from "@/components/UserStatsModal";
import { GameDialogFrame, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { UnityLaunchButton } from "@/components/dashboard/UnityLaunchButton";
import { TravelSquadPanel } from "@/components/dashboard/TravelSquadPanel";
import { describePartBoosts, getEquippedPartBoosts } from "@/lib/partStats";
import { getPartImageSource } from "@/config/gameAssets";
import { mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { useRivalStatus, type RivalHudPreview } from "@/hooks/useRivalStatus";
import { itemIcons } from "../../assets/items";
import { theme } from "@/theme";
import type { RootTabs } from "../../App";

type EquippedPartRecord = { id?: string; level?: number; name?: string; rarity?: string; slot?: string; stars?: number };
type DashboardSlot = "head" | "torso" | "arms" | "legs" | "core";

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


export function HomeScreen({ rivalPreview }: { rivalPreview?: RivalHudPreview } = {}) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { profile, updateProfile, user } = useAuth();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isDashboardSettingsOpen, setIsDashboardSettingsOpen] = useState(false);
  const [selectedPartSlot, setSelectedPartSlot] = useState<DashboardSlot | null>(null);
  const roster = useMemo(() => mergeHolobotRoster(profile?.holobots, "full"), [profile?.holobots]);
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
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
  // Equipped-part boosts feed both real combat (buildPlayerFighter) and
  // this chart — same numbers, no display-only fiction.
  const partBoosts = getEquippedPartBoosts(equippedParts);
  const attributeValues = {
    ATK: Math.min(100, selectedHolobot.stats.attack + partBoosts.attack),
    DEF: Math.min(100, selectedHolobot.stats.defense + partBoosts.defense),
    SPECIAL: Math.min(100, selectedHolobot.stats.special + partBoosts.special),
    HP: Math.min(100, selectedHolobot.stats.hp + Math.round(partBoosts.hp / 4)),
    SPEED: Math.min(100, selectedHolobot.stats.speed + partBoosts.speed),
  };
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const rival = useRivalStatus(user?.uid, rivalPreview);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <View><RNText style={styles.eyebrow}>HOLOCITY / PILOT LINK</RNText><RNText style={styles.title}>DASHBOARD</RNText></View>
          <Pressable onPress={() => setIsDashboardSettingsOpen(true)} accessibilityRole="button" accessibilityLabel="Open dashboard settings" style={styles.iconButton}>
            <GameSurfaceFrame /><RNText style={styles.iconGlyph}>⚙</RNText>
          </Pressable>
        </View>
        <View style={styles.pilotRow}><RNText style={styles.pilotName}>{profile?.username || "PILOT"}</RNText><RNText style={styles.pilotMeta}>{profile?.dailyEnergy ?? 0} / {profile?.maxDailyEnergy ?? 100} ENERGY</RNText></View>
        <View style={styles.tierPlate}>
          <GameSurfaceFrame />
          <View style={styles.tierRow}><RNText style={styles.eyebrow}>RIVAL LADDER</RNText><RNText style={styles.tierValue}>TIER {rival.status?.tier ?? "—"}</RNText></View>
          <RNText style={styles.tierTitle}>{rival.status?.tierLabel?.toUpperCase() || "AWAITING PILOT LINK"}</RNText>
          <View style={styles.tierFooter}><RNText style={styles.caption}>{rival.status ? `${rival.status.rivalWins} WINS · ${rival.status.winsToNextTier} TO NEXT TIER` : rival.error || "Connect to view your rival progression"}</RNText>
            <Pressable onPress={() => void rival.refresh()} accessibilityRole="button" accessibilityLabel="Refresh rival tier"><RNText style={styles.refreshText}>↻</RNText></Pressable></View>
        </View>
        <View style={styles.metrics}>
          <View style={styles.metric}><GameSurfaceFrame accent={theme.colors.border} />
            <View style={styles.metricLabelRow}><RNImage source={itemIcons.item_holos_chip} style={styles.holosIcon} /><RNText style={styles.eyebrow}>HOLOS</RNText></View>
            <RNText style={styles.metricValue}>{(profile?.holosTokens ?? 0).toLocaleString()}</RNText>
            <RNText style={styles.caption}>WALLET BALANCE</RNText>
          </View>
          <Pressable style={styles.metric} onPress={() => navigation.navigate("CityHub")} accessibilityRole="button" accessibilityLabel="Open city rivals">
            <GameSurfaceFrame accent={rival.countdown ? theme.colors.cursor : theme.colors.border} />
            <RNText style={styles.eyebrow}>RIVAL COOLDOWN</RNText><RNText style={styles.metricValue}>{rival.countdown || "— : —"}</RNText>
            <RNText style={styles.caption}>{rival.cooldown ? `${rival.cooldown.pilotId.replace(/^citizen-/, "").toUpperCase()} · NEXT REMATCH` : "SELECT A RIVAL IN THE CITY ›"}</RNText>
          </Pressable>
        </View>
        <View style={styles.sectionHeading}><RNText style={styles.sectionTitle}>YOUR HOLOBOT</RNText><Pressable onPress={() => navigation.navigate("Inventory")} accessibilityRole="button"><RNText style={styles.linkText}>COLLECTION ›</RNText></Pressable></View>
        <HolobotRosterCard holobot={selectedHolobot} slot={selectedHolobotIndex} selected live={focused && !isPickerOpen && !isStatsOpen && !isDashboardSettingsOpen && !selectedPartSlot} onPress={() => setIsPickerOpen(true)} actionLabel="CHANGE HOLOBOT  ›" />
        <View style={styles.statRail}>{Object.entries(attributeValues).map(([label,value]) => <View key={label} style={styles.statCell}><RNText style={styles.eyebrow}>{label}</RNText><RNText style={styles.statValue}>{value}</RNText></View>)}</View>
        <View style={styles.sectionHeading}><RNText style={styles.sectionTitle}>EQUIPMENT</RNText><RNText style={styles.caption}>TAP A SLOT TO EQUIP</RNText></View>
        <View style={styles.equipment}>{abilitySlots.map(({part,slot}) => {
          const image = getPartImageSource(part?.name, part?.slot);
          return <Pressable key={slot} onPress={() => setSelectedPartSlot(slot)} style={styles.equipmentSlot} accessibilityRole="button" accessibilityLabel={`Choose ${slot} part`}>
            <GameSurfaceFrame accent={part ? theme.colors.accent : theme.colors.border} />
            {image ? <RNImage source={image} style={styles.partIcon} resizeMode="contain" /> : <RNText style={styles.emptySlot}>+</RNText>}
            <RNText style={styles.equipmentLabel}>{slot.toUpperCase()}</RNText>
          </Pressable>;
        })}</View>
        <Pressable style={styles.cityEntry} onPress={() => navigation.navigate("CityHub")} accessibilityRole="button" accessibilityLabel="Explore HoloCity">
          <GameSurfaceFrame strong /><View><RNText style={styles.eyebrow}>PLAZA · VENDOR · WORKSHOP · ARENA</RNText><RNText style={styles.cityTitle}>EXPLORE HOLOCITY</RNText></View><RNText style={styles.cityArrow}>↗</RNText>
        </Pressable>
        <View style={styles.quickLinks}>{([
          ["Arena", "ARENA"], ["Marketplace", "VENDOR"], ["Fitness", "SYNC"], ["Quests", "QUESTS"], ["Training", "TRAINING"], ["Gacha", "HOLO PACKS"],
        ] as const).map(([route,label]) => <Pressable key={route} style={styles.quickLink} onPress={() => navigation.navigate(route)} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.border} /><RNText style={styles.quickLinkText}>{label}</RNText></Pressable>)}</View>
        <TravelSquadPanel uid={user?.uid} roster={roster} inline />
        <View style={styles.bottomActions}>
          <Pressable style={styles.secondaryAction} onPress={() => setIsStatsOpen(true)} accessibilityRole="button" accessibilityLabel="Open pilot stats"><GameSurfaceFrame accent={theme.colors.border} /><RNText style={styles.linkText}>PILOT STATS</RNText></Pressable>
          <UnityLaunchButton inline />
        </View>
      </ScrollView>
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
              <GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy} />
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
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.carbon },
  content: { paddingHorizontal: 18, gap: 14, width: "100%", maxWidth: 620, alignSelf: "center" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.2 },
  title: { ...theme.type.display, color: theme.colors.text, letterSpacing: 1 },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  iconGlyph: { fontSize: 24, color: theme.colors.accent },
  pilotRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6, borderBottomWidth: 1, borderColor: theme.colors.border },
  pilotName: { ...theme.type.label, color: theme.colors.text, textTransform: "uppercase" },
  pilotMeta: { ...theme.type.micro, color: theme.colors.muted },
  tierPlate: { padding: 16, gap: 4 },
  tierRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tierValue: { ...theme.type.header, color: theme.colors.cursor },
  tierTitle: { ...theme.type.header, color: theme.colors.text },
  tierFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  refreshText: { color: theme.colors.accent, fontSize: 24, paddingHorizontal: 12 },
  caption: { ...theme.type.micro, color: theme.colors.muted, flexShrink: 1 },
  metrics: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, padding: 14, justifyContent: "space-between", minHeight: 116 },
  metricLabelRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  holosIcon: { width: 20, height: 20 },
  metricValue: { ...theme.type.display, color: theme.colors.text, fontVariant: ["tabular-nums"] },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  sectionTitle: { ...theme.type.label, color: theme.colors.text, letterSpacing: 1 },
  linkText: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1 },
  statRail: { flexDirection: "row", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.plates.keycap, paddingVertical: 12 },
  statCell: { flex: 1, alignItems: "center", gap: 3 },
  statValue: { ...theme.type.value, color: theme.colors.text },
  equipment: { flexDirection: "row", gap: 6 },
  equipmentSlot: { flex: 1, minHeight: 80, padding: 6, alignItems: "center", justifyContent: "center", gap: 4 },
  equipmentLabel: { ...theme.type.micro, color: theme.colors.muted },
  partIcon: { width: 40, height: 44 },
  emptySlot: { color: theme.colors.subtle, fontSize: 28 },
  cityEntry: { minHeight: 86, padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cityTitle: { ...theme.type.header, color: theme.colors.text, marginTop: 3 },
  cityArrow: { ...theme.type.display, color: theme.colors.accent },
  quickLinks: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickLink: { width: "31.5%", minHeight: 48, alignItems: "center", justifyContent: "center" },
  quickLinkText: { ...theme.type.micro, color: theme.colors.text, letterSpacing: 1 },
  bottomActions: { flexDirection: "row", gap: 10 },
  secondaryAction: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center" },
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
    backgroundColor: theme.plates.keycap,
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
