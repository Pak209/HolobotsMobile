import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { buildDailyMissions, markMissionClaimed } from "@/lib/dailyMissions";

type DailyMissionsModalProps = {
  onClose: () => void;
};

export function DailyMissionsModal({ onClose }: DailyMissionsModalProps) {
  const { profile, updateProfile } = useAuth();
  const missions = buildDailyMissions(profile);
  const completed = missions.filter((mission) => mission.completed).length;
  const unclaimed = missions.filter((mission) => mission.completed && !mission.claimed).length;

  const handleClaim = async (missionId: string, reward: { gachaTickets: number; holosTokens?: number }) => {
    if (!profile) return;

    try {
      await updateProfile({
        gachaTickets: (profile.gachaTickets || 0) + reward.gachaTickets,
        holosTokens: (profile.holosTokens || 0) + (reward.holosTokens || 0),
        rewardSystem: markMissionClaimed(profile.rewardSystem, missionId),
      });
    } catch (error) {
      Alert.alert("Claim failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>DAILY MISSIONS</Text>
        <Text style={styles.title}>Daily Missions</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillText}>{`${completed}/${missions.length}`}</Text>
          </View>
          <View style={[styles.summaryPill, styles.summaryPillActive]}>
            <Text style={[styles.summaryPillText, styles.summaryPillActiveText]}>{`${unclaimed} Tickets`}</Text>
          </View>
        </View>
      </View>

      <View style={styles.list}>
        {missions.map((mission) => {
          const progressPercent = Math.max(0, Math.min(100, (mission.progress / mission.target) * 100));
          const canClaim = mission.completed && !mission.claimed;

          return (
            <View key={mission.id} style={[styles.missionCard, mission.completed ? styles.missionCardDone : null]}>
              <View style={styles.missionTopRow}>
                <View style={styles.missionMeta}>
                  <Text style={styles.missionName}>{mission.name}</Text>
                  <Text style={styles.missionDescription}>{mission.description}</Text>
                </View>
                <Pressable
                  disabled={!canClaim}
                  onPress={() => void handleClaim(mission.id, mission.reward)}
                  style={[styles.claimButton, !canClaim ? styles.claimButtonDisabled : null]}
                >
                  <Text style={[styles.claimButtonText, !canClaim ? styles.claimButtonTextDisabled : null]}>
                    {mission.claimed ? "Claimed" : "Claim"}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.progressHeader}>
                <Text style={styles.progressText}>{`Progress: ${mission.progress}/${mission.target}`}</Text>
                <Text style={styles.progressText}>{`${Math.round(progressPercent)}%`}</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>

              <View style={styles.rewardRow}>
                <Text style={styles.rewardText}>{`${mission.reward.gachaTickets} Tickets`}</Text>
                {mission.reward.holosTokens ? <Text style={styles.rewardHolos}>{`${mission.reward.holosTokens} Holos`}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      <Pressable style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeText}>BACK</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 430,
    padding: 18,
    width: "100%",
  },
  header: {
    marginBottom: 12,
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  title: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  summaryPill: {
    backgroundColor: "#0f2343",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  summaryPillActive: {
    backgroundColor: "#18a64b",
  },
  summaryPillText: {
    color: "#8cc5ff",
    fontSize: 12,
    fontWeight: "800",
  },
  summaryPillActiveText: {
    color: "#fef1e0",
  },
  list: {
    gap: 12,
  },
  missionCard: {
    backgroundColor: "#090b0f",
    borderColor: "#1d2d39",
    borderWidth: 1,
    padding: 14,
  },
  missionCardDone: {
    borderColor: "#1f8b47",
    backgroundColor: "#07160d",
  },
  missionTopRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  missionMeta: {
    flex: 1,
    minWidth: 0,
  },
  missionName: {
    color: "#fef1e0",
    fontSize: 15,
    fontWeight: "900",
  },
  missionDescription: {
    color: "#b6bcc6",
    fontSize: 13,
    marginTop: 4,
  },
  claimButton: {
    alignItems: "center",
    backgroundColor: "#18a64b",
    justifyContent: "center",
    minHeight: 42,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  claimButtonDisabled: {
    backgroundColor: "#151922",
    borderColor: "#2c3240",
    borderWidth: 1,
  },
  claimButtonText: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "900",
  },
  claimButtonTextDisabled: {
    color: "#596170",
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  progressText: {
    color: "#c8c6be",
    fontSize: 12,
    fontWeight: "700",
  },
  progressBar: {
    backgroundColor: "#163649",
    height: 10,
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#2fbfff",
    height: "100%",
  },
  rewardRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 14,
  },
  rewardText: {
    color: "#39d98a",
    fontSize: 13,
    fontWeight: "800",
  },
  rewardHolos: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 16,
    minHeight: 48,
  },
  closeText: {
    color: "#f0bf14",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
