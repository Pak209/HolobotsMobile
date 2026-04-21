import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  getExpProgress,
  getHolobotBaseProfile,
  getHolobotRank,
  normalizeUserHolobot,
  type HolobotRosterEntry,
} from "@/config/holobots";
import type { UserHolobot } from "@/types/profile";

const BLUEPRINT_TIERS = [
  { attributePoints: 10, key: "common", label: "Common", required: 5, startLevel: 1 },
  { attributePoints: 10, key: "champion", label: "Champion", required: 10, startLevel: 11 },
  { attributePoints: 20, key: "rare", label: "Rare", required: 20, startLevel: 21 },
  { attributePoints: 30, key: "elite", label: "Elite", required: 40, startLevel: 31 },
  { attributePoints: 40, key: "legendary", label: "Legendary", required: 80, startLevel: 41 },
] as const;

type UpgradeTierLabel = (typeof BLUEPRINT_TIERS)[number]["label"];

type Props = {
  blueprintCount: number;
  holobot: HolobotRosterEntry | null;
  ownedHolobot: UserHolobot | null;
  onClose: () => void;
  onMint: (tierLabel: UpgradeTierLabel) => void;
  onRankUpgrade: (tierLabel: UpgradeTierLabel) => void;
  onUpgrade: (attribute: "attack" | "defense" | "speed" | "health") => void;
  visible: boolean;
};

function getTierColor(label: UpgradeTierLabel) {
  switch (label) {
    case "Common":
      return styles.tierCommon;
    case "Champion":
      return styles.tierChampion;
    case "Rare":
      return styles.tierRare;
    case "Elite":
      return styles.tierElite;
    case "Legendary":
      return styles.tierLegendary;
  }
}

function getTierNumber(label?: string) {
  switch ((label || "").toLowerCase()) {
    case "legendary":
      return 5;
    case "elite":
      return 4;
    case "rare":
      return 3;
    case "champion":
      return 2;
    case "common":
    case "starter":
    case "rookie":
    default:
      return 1;
  }
}

function getMintTier(blueprintCount: number) {
  return [...BLUEPRINT_TIERS].reverse().find((tier) => blueprintCount >= tier.required) ?? null;
}

export function HolobotStatsModal({
  blueprintCount,
  holobot,
  ownedHolobot,
  onClose,
  onMint,
  onRankUpgrade,
  onUpgrade,
  visible,
}: Props) {
  const [activeTab, setActiveTab] = useState<"stats" | "blueprints">("stats");

  useEffect(() => {
    if (visible) {
      setActiveTab("stats");
    }
  }, [visible]);

  if (!holobot) {
    return null;
  }

  const normalizedOwnedHolobot = ownedHolobot ? normalizeUserHolobot(ownedHolobot) : null;
  const base = getHolobotBaseProfile(holobot.name);
  const boosts = normalizedOwnedHolobot?.boostedAttributes || {};
  const availablePoints = normalizedOwnedHolobot?.attributePoints || 0;
  const currentRank = normalizedOwnedHolobot?.rank || holobot.rank || getHolobotRank(holobot.level || 1);
  const currentTierNumber = getTierNumber(currentRank);
  const mintTier = getMintTier(blueprintCount);
  const progress = normalizedOwnedHolobot
    ? getExpProgress(normalizedOwnedHolobot)
    : mintTier
      ? 1
      : Math.min(1, blueprintCount / BLUEPRINT_TIERS[0].required);

  const stats = [
    { baseValue: base.hp, bonus: boosts.health || 0, key: "health" as const, label: "HP", upgrade: "+10 HP" },
    { baseValue: base.attack, bonus: boosts.attack || 0, key: "attack" as const, label: "Attack", upgrade: "+1 ATK" },
    { baseValue: base.defense, bonus: boosts.defense || 0, key: "defense" as const, label: "Defense", upgrade: "+1 DEF" },
    { baseValue: base.speed, bonus: boosts.speed || 0, key: "speed" as const, label: "Speed", upgrade: "+1 SPD" },
  ];

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <View style={styles.levelRow}>
                <Text style={styles.levelText}>
                  {normalizedOwnedHolobot ? `LV ${normalizedOwnedHolobot.level || 1}` : "UNMINTED"}
                </Text>
                <View style={[styles.rankBadge, getTierColor((normalizedOwnedHolobot?.rank as UpgradeTierLabel) || "Common")]}>
                  <Text style={styles.rankText}>
                    {normalizedOwnedHolobot ? currentRank : mintTier?.label || "Blueprint"}
                  </Text>
                </View>
              </View>

              <Text style={styles.nameText}>{holobot.name}</Text>

              <View style={styles.expRow}>
                <Text style={styles.mutedLabel}>{normalizedOwnedHolobot ? "XP" : "BLUEPRINTS"}</Text>
                <Text style={styles.expValue}>
                  {normalizedOwnedHolobot
                    ? `${normalizedOwnedHolobot.experience || 0}/${normalizedOwnedHolobot.nextLevelExp || 100}`
                    : `${blueprintCount}/${mintTier?.required || BLUEPRINT_TIERS[0].required}`}
                </Text>
              </View>
              <View style={styles.expTrack}>
                <View style={[styles.expFill, { width: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.metaText}>
                {normalizedOwnedHolobot
                  ? `${blueprintCount} blueprints available for rank upgrades`
                  : mintTier
                    ? `${mintTier.label} mint unlocked with blueprints`
                    : `Collect ${BLUEPRINT_TIERS[0].required - blueprintCount} more blueprints to mint`}
              </Text>
            </View>

            <View style={styles.tabRow}>
              <Pressable
                onPress={() => setActiveTab("stats")}
                style={[styles.tabButton, activeTab === "stats" ? styles.tabButtonActive : null]}
              >
                <Text style={[styles.tabButtonText, activeTab === "stats" ? styles.tabButtonTextActive : null]}>
                  STATS
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveTab("blueprints")}
                style={[styles.tabButton, activeTab === "blueprints" ? styles.tabButtonActive : null]}
              >
                <Text style={[styles.tabButtonText, activeTab === "blueprints" ? styles.tabButtonTextActive : null]}>
                  BLUEPRINTS
                </Text>
              </Pressable>
            </View>

            {activeTab === "stats" ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>STATS</Text>
                  {stats.map((stat) => (
                    <View key={stat.label} style={styles.statRow}>
                      <Text style={styles.statLabel}>{`${stat.label}: ${stat.baseValue}`}</Text>
                      {stat.bonus ? <Text style={styles.statBonus}>{`+${stat.bonus}`}</Text> : null}
                    </View>
                  ))}
                  <Text style={styles.specialText}>{`Special: ${base.specialMove}`}</Text>
                </View>

                {normalizedOwnedHolobot ? (
                  <View style={styles.section}>
                    <View style={styles.boostHeader}>
                      <Text style={styles.sectionTitle}>AVAILABLE BOOSTS</Text>
                      <View style={styles.pointsBadge}>
                        <Text style={styles.pointsText}>{availablePoints}</Text>
                      </View>
                    </View>

                    <View style={styles.boostGrid}>
                      {stats.map((stat) => (
                        <Pressable
                          key={stat.key}
                          disabled={availablePoints <= 0}
                          onPress={() => onUpgrade(stat.key)}
                          style={[styles.boostButton, availablePoints <= 0 ? styles.boostButtonDisabled : null]}
                        >
                          <Text style={[styles.boostButtonText, availablePoints <= 0 ? styles.boostButtonTextDisabled : null]}>
                            {stat.upgrade}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>AVAILABLE BOOSTS</Text>
                    <Text style={styles.emptyStateText}>
                      Mint this holobot first, then use blueprint rank-ups and level progress to unlock stat boosts.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {normalizedOwnedHolobot ? "BLUEPRINT RANK UP" : "MINT WITH BLUEPRINTS"}
                </Text>
                <Text style={styles.blueprintSummary}>{`${holobot.name} blueprints: ${blueprintCount}`}</Text>
                <View style={styles.tierList}>
                  {BLUEPRINT_TIERS.map((tier) => {
                    const unlocked = blueprintCount >= tier.required;
                    const upgradeBlocked = normalizedOwnedHolobot ? getTierNumber(tier.label) <= currentTierNumber : false;

                    return (
                      <Pressable
                        key={tier.key}
                        disabled={!unlocked || upgradeBlocked}
                        onPress={() => {
                          if (normalizedOwnedHolobot) {
                            onRankUpgrade(tier.label);
                          } else {
                            onMint(tier.label);
                          }
                        }}
                        style={[
                          styles.tierButton,
                          getTierColor(tier.label),
                          (!unlocked || upgradeBlocked) ? styles.tierButtonDisabled : null,
                        ]}
                      >
                        <View style={styles.tierHeader}>
                          <Text style={styles.tierTitle}>{tier.label}</Text>
                          <Text style={styles.tierMeta}>{`LV ${tier.startLevel}`}</Text>
                        </View>
                        <View style={styles.tierDetailRow}>
                          <Text style={styles.tierCost}>{`${tier.required} blueprints`}</Text>
                          <Text style={styles.tierBonus}>{`+${tier.attributePoints} boosts`}</Text>
                        </View>
                        <Text style={styles.tierAction}>
                          {!unlocked
                            ? `Need ${tier.required - blueprintCount} more`
                            : upgradeBlocked
                              ? "Already unlocked"
                              : normalizedOwnedHolobot
                                ? "Rank Up"
                                : "Mint"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <Text style={styles.closeHint}>TAP OUTSIDE TO CLOSE</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  blueprintSummary: {
    color: "#ddd2b5",
    fontSize: 14,
    marginBottom: 12,
  },
  boostButton: {
    backgroundColor: "#141b28",
    borderColor: "#44516b",
    borderWidth: 2,
    flex: 1,
    minWidth: "47%",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  boostButtonDisabled: {
    borderColor: "#373737",
    opacity: 0.45,
  },
  boostButtonText: {
    color: "#d7dde8",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  boostButtonTextDisabled: {
    color: "#7b7b7b",
  },
  boostGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  boostHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  card: {
    backgroundColor: "#080b11",
    borderColor: "#f0bf14",
    borderWidth: 2,
    maxHeight: "92%",
    maxWidth: 410,
    width: "92%",
  },
  closeHint: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "center",
  },
  emptyStateText: {
    color: "#d5cbb2",
    fontSize: 14,
    lineHeight: 20,
  },
  expFill: {
    backgroundColor: "#4cc6ff",
    borderRadius: 999,
    height: "100%",
  },
  expRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  expTrack: {
    backgroundColor: "#394154",
    borderRadius: 999,
    height: 10,
    marginTop: 8,
    overflow: "hidden",
  },
  expValue: {
    color: "#f1efea",
    fontSize: 17,
    fontWeight: "700",
  },
  levelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  levelText: {
    color: "#f0bf14",
    fontSize: 26,
    fontWeight: "900",
  },
  metaText: {
    color: "#d5cbb2",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  mutedLabel: {
    color: "#f1efea",
    fontSize: 20,
    fontWeight: "700",
  },
  nameText: {
    color: "#f4f4f2",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 8,
  },
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  pointsBadge: {
    backgroundColor: "#16345d",
    borderColor: "#4cc6ff",
    borderWidth: 1.5,
    borderRadius: 999,
    minWidth: 42,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pointsText: {
    color: "#dff7ff",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  rankBadge: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rankText: {
    color: "#f5f3eb",
    fontSize: 15,
    fontWeight: "800",
  },
  scrollContent: {
    gap: 12,
    padding: 16,
    paddingBottom: 22,
  },
  section: {
    borderColor: "#f0bf14",
    borderWidth: 1.5,
    padding: 12,
  },
  sectionTitle: {
    color: "#f0bf14",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
  },
  specialText: {
    borderTopColor: "#3f4659",
    borderTopWidth: 1,
    color: "#42b9ff",
    fontSize: 17,
    marginTop: 10,
    paddingTop: 10,
  },
  statBonus: {
    color: "#8e75ff",
    fontSize: 17,
    fontWeight: "800",
  },
  statLabel: {
    color: "#f4f4f2",
    fontSize: 17,
    fontWeight: "700",
  },
  statRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  tabButton: {
    alignItems: "center",
    borderColor: "#6a5718",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  tabButtonActive: {
    backgroundColor: "#f0bf14",
    borderColor: "#f0bf14",
  },
  tabButtonText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  tabButtonTextActive: {
    color: "#080b11",
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
  },
  tierAction: {
    color: "#f5f3eb",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    textTransform: "uppercase",
  },
  tierBonus: {
    color: "#fff7da",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  tierButton: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 9,
  },
  tierButtonDisabled: {
    opacity: 0.38,
  },
  tierChampion: {
    backgroundColor: "#1d4d2c",
    borderColor: "#3bb563",
  },
  tierCommon: {
    backgroundColor: "#173a68",
    borderColor: "#4ea0ff",
  },
  tierCost: {
    color: "#f5f3eb",
    fontSize: 11,
    fontWeight: "700",
  },
  tierDetailRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
  },
  tierElite: {
    backgroundColor: "#5f4b08",
    borderColor: "#f0bf14",
  },
  tierHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tierLegendary: {
    backgroundColor: "#7a3d08",
    borderColor: "#ff9b39",
  },
  tierList: {
    gap: 10,
  },
  tierMeta: {
    color: "#f5f3eb",
    fontSize: 10,
    fontWeight: "800",
  },
  tierRare: {
    backgroundColor: "#4b266c",
    borderColor: "#ab67ff",
  },
  tierTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
});
