import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import type { UserProfile } from "@/types/profile";

function getPlayerRank(profile: UserProfile | null) {
  if (!profile) return "Rookie";

  const maxLevel = Math.max(0, ...(profile.holobots || []).map((holobot) => holobot.level || 0));
  const wins = profile.stats?.wins || 0;
  const score = maxLevel + wins * 0.35 + (profile.prestigeCount || 0) * 8;

  if (score >= 80) return "Legend";
  if (score >= 55) return "Elite";
  if (score >= 30) return "Champion";
  return "Rookie";
}

function getDailyMissionSummary(profile: UserProfile | null) {
  if (!profile) {
    return { available: 3, completed: 0 };
  }

  let completed = 0;

  if ((profile.todaySteps || 0) > 0) completed += 1;
  if ((profile.syncPoints || 0) > 0) completed += 1;
  if ((profile.stats?.wins || 0) > 0) completed += 1;

  return { available: 3, completed: Math.min(3, completed) };
}

type UserStatsModalProps = {
  onClose: () => void;
  onOpenGacha: () => void;
  onOpenLeaderboard: () => void;
  profile: UserProfile | null;
  visible: boolean;
};

export function UserStatsModal({
  onClose,
  onOpenGacha,
  onOpenLeaderboard,
  profile,
  visible,
}: UserStatsModalProps) {
  const missionSummary = getDailyMissionSummary(profile);
  const playerRank = getPlayerRank(profile);

  return (
    <Modal
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>PILOT DATA</Text>
          <Text style={styles.title}>{profile?.username || "Pilot"}</Text>

          <View style={styles.grid}>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Player Rank</Text>
              <Text style={styles.statValue}>{playerRank}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Daily Energy</Text>
              <Text style={styles.statValue}>{`${profile?.dailyEnergy || 0}/${profile?.maxDailyEnergy || 100}`}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Daily Missions</Text>
              <Text style={styles.statValue}>{`${missionSummary.completed}/${missionSummary.available}`}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Gacha Tickets</Text>
              <Text style={styles.statValue}>{`${profile?.gachaTickets || 0}`}</Text>
            </View>
          </View>

          <View style={styles.actionColumn}>
            <Pressable style={styles.actionButton} onPress={onOpenGacha}>
              <Text style={styles.actionText}>OPEN GACHA</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onOpenLeaderboard}>
              <Text style={styles.secondaryText}>LEADERBOARD</Text>
            </Pressable>
          </View>

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    minHeight: 54,
    justifyContent: "center",
  },
  actionColumn: {
    gap: 12,
    marginTop: 22,
  },
  actionText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    marginTop: 18,
    minHeight: 52,
    justifyContent: "center",
  },
  closeText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 18,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fef1e0",
    minHeight: 50,
    justifyContent: "center",
  },
  secondaryText: {
    color: "#050606",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  statLabel: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  statTile: {
    backgroundColor: "#050606",
    borderColor: "#2b2b2b",
    borderWidth: 1,
    minHeight: 82,
    padding: 12,
    width: "47%",
  },
  statValue: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
  },
  title: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8,
  },
});
