import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { getExpProgress, getHolobotBaseProfile, getHolobotRank } from "@/config/holobots";
import type { UserHolobot } from "@/types/profile";

type Props = {
  holobot: UserHolobot | null;
  onClose: () => void;
  onUpgrade: (attribute: "attack" | "defense" | "speed" | "health") => void;
  visible: boolean;
};

export function HolobotStatsModal({ holobot, onClose, onUpgrade, visible }: Props) {
  if (!holobot) {
    return null;
  }

  const base = getHolobotBaseProfile(holobot.name);
  const boosts = holobot.boostedAttributes || {};
  const availablePoints = holobot.attributePoints || 0;
  const rank = holobot.rank || getHolobotRank(holobot.level || 1);

  const stats = [
    { baseValue: base.hp, bonus: boosts.health || 0, label: "HP", upgrade: "+10 HP", valueLabel: `${base.hp}`, key: "health" as const },
    { baseValue: base.attack, bonus: boosts.attack || 0, label: "Attack", upgrade: "+1 ATK", valueLabel: `${base.attack}`, key: "attack" as const },
    { baseValue: base.defense, bonus: boosts.defense || 0, label: "Defense", upgrade: "+1 DEF", valueLabel: `${base.defense}`, key: "defense" as const },
    { baseValue: base.speed, bonus: boosts.speed || 0, label: "Speed", upgrade: "+1 SPD", valueLabel: `${base.speed}`, key: "speed" as const },
  ];

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={styles.section}>
            <View style={styles.levelRow}>
              <Text style={styles.levelText}>{`LV ${holobot.level || 1}`}</Text>
              <View style={styles.rankBadge}>
                <Text style={styles.rankText}>{rank}</Text>
              </View>
            </View>

            <View style={styles.expRow}>
              <Text style={styles.mutedLabel}>XP</Text>
              <Text style={styles.expValue}>{`${holobot.experience || 0}/${holobot.nextLevelExp || 100}`}</Text>
            </View>
            <View style={styles.expTrack}>
              <View
                style={[
                  styles.expFill,
                  {
                    width: `${getExpProgress({
                      experience: holobot.experience || 0,
                      nextLevelExp: holobot.nextLevelExp || 100,
                    }) * 100}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>STATS</Text>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.statRow}>
                <Text style={styles.statLabel}>{`${stat.label}: ${stat.valueLabel}`}</Text>
                {stat.bonus ? <Text style={styles.statBonus}>{`+${stat.bonus}`}</Text> : null}
              </View>
            ))}
            <Text style={styles.specialText}>{`Special: ${base.specialMove}`}</Text>
          </View>

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

          <Text style={styles.closeHint}>TAP OUTSIDE TO CLOSE</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    gap: 14,
    maxWidth: 380,
    padding: 18,
    width: "92%",
  },
  closeHint: {
    color: "#f0bf14",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "center",
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
    fontSize: 18,
    fontWeight: "700",
  },
  levelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  levelText: {
    color: "#f0bf14",
    fontSize: 28,
    fontWeight: "900",
  },
  mutedLabel: {
    color: "#f1efea",
    fontSize: 22,
    fontWeight: "700",
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
    backgroundColor: "#3f2817",
    borderColor: "#f08a14",
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rankText: {
    color: "#f5b36b",
    fontSize: 18,
    fontWeight: "800",
  },
  section: {
    borderColor: "#f0bf14",
    borderWidth: 1.5,
    padding: 14,
  },
  sectionTitle: {
    color: "#f0bf14",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 10,
  },
  specialText: {
    borderTopColor: "#3f4659",
    borderTopWidth: 1,
    color: "#42b9ff",
    fontSize: 18,
    marginTop: 12,
    paddingTop: 12,
  },
  statBonus: {
    color: "#8e75ff",
    fontSize: 18,
    fontWeight: "800",
  },
  statLabel: {
    color: "#f4f4f2",
    fontSize: 18,
    fontWeight: "700",
  },
  statRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
});
