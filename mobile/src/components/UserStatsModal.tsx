import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Svg, Path } from "@/components/FigmaSvg";
import { DailyMissionsModal } from "@/components/DailyMissionsModal";
import { useAuth } from "@/contexts/AuthContext";
import { getDailyMissionSummary } from "@/lib/dailyMissions";
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
  const { updateProfile } = useAuth();
  const [isMissionsOpen, setIsMissionsOpen] = useState(false);
  const missionSummary = getDailyMissionSummary(profile);
  const playerRank = getPlayerRank(profile);

  const handleRefillEnergy = async () => {
    if (!profile) return;

    if ((profile.energy_refills || 0) <= 0) {
      Alert.alert("No Energy Refills", "You need an Energy Refill item to top up daily energy.");
      return;
    }

    if ((profile.dailyEnergy || 0) >= (profile.maxDailyEnergy || 100)) {
      Alert.alert("Energy Full", "Daily energy is already full.");
      return;
    }

    try {
      await updateProfile({
        dailyEnergy: profile.maxDailyEnergy || 100,
        energy_refills: Math.max(0, (profile.energy_refills || 0) - 1),
      });
    } catch (error) {
      Alert.alert("Refill failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <>
      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent
        visible={visible}
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {isMissionsOpen ? (
              <DailyMissionsModal onClose={() => setIsMissionsOpen(false)} />
            ) : (
              <>
                <Text style={styles.eyebrow}>PILOT DATA</Text>
                <Text style={styles.title}>{profile?.username || "Pilot"}</Text>

                <View style={styles.grid}>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Player Rank</Text>
                    <Text style={styles.statValue}>{playerRank}</Text>
                  </View>
                  <View style={styles.statTile}>
                    <View style={styles.tileHeaderRow}>
                      <Text style={styles.statLabel}>Daily Energy</Text>
                      <Pressable accessibilityLabel="Refill daily energy" onPress={() => void handleRefillEnergy()} style={styles.miniIconButton}>
                        <Svg width="18" height="18" viewBox="0 0 24 24">
                          <Path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5a.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1m5-9l-2 4h3l-2 4" stroke="#f0bf14" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </Pressable>
                    </View>
                    <Text style={styles.statValue}>{`${profile?.dailyEnergy || 0}/${profile?.maxDailyEnergy || 100}`}</Text>
                    <Text style={styles.statMeta}>{`${profile?.energy_refills || 0} refills ready`}</Text>
                  </View>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Gacha Tickets</Text>
                    <Text style={styles.statValue}>{`${profile?.gachaTickets || 0}`}</Text>
                  </View>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Holos</Text>
                    <Text style={styles.statValue}>{`${profile?.holosTokens || 0}`}</Text>
                  </View>
                </View>

                <View style={styles.actionColumn}>
                  <Pressable style={styles.actionButton} onPress={onOpenGacha}>
                    <Text style={styles.actionText}>OPEN GACHA</Text>
                  </Pressable>
                  <Pressable style={styles.missionButton} onPress={() => setIsMissionsOpen(true)}>
                    <View>
                      <Text style={styles.missionButtonTitle}>DAILY MISSIONS</Text>
                      <Text style={styles.missionButtonMeta}>{`${missionSummary.completed}/${missionSummary.available} complete`}</Text>
                    </View>
                    <Text style={styles.missionButtonMeta}>{missionSummary.unclaimed ? `${missionSummary.unclaimed} ready` : "View"}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={onOpenLeaderboard}>
                    <Text style={styles.secondaryText}>LEADERBOARD</Text>
                  </Pressable>
                </View>

                <Pressable style={styles.closeButton} onPress={onClose}>
                  <Text style={styles.closeText}>CLOSE</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
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
  miniIconButton: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  missionButton: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  missionButtonMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "700",
  },
  missionButtonTitle: {
    color: "#f0bf14",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
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
  statMeta: {
    color: "#8f866f",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  statValue: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
  },
  tileHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8,
  },
});
