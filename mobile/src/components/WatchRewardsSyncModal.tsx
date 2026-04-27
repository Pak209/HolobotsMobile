import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

type WatchRewardsSyncModalProps = {
  error: string | null;
  onClose: () => void;
  onSync: () => void;
  pendingCount: number;
  processing: boolean;
  rewards: {
    exp: number;
    holos: number;
    syncPoints: number;
  };
  visible: boolean;
};

export function WatchRewardsSyncModal({
  error,
  onClose,
  onSync,
  pendingCount,
  processing,
  rewards,
  visible,
}: WatchRewardsSyncModalProps) {
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
          <Text style={styles.eyebrow}>WATCH REWARDS READY</Text>
          <Text style={styles.title}>
            {pendingCount > 1 ? `${pendingCount} Workouts Waiting` : "Workout Waiting"}
          </Text>
          <Text style={styles.subtitle}>
            Sync these claimed watch rewards to your account now.
          </Text>

          <View style={styles.rewardList}>
            <View style={styles.rewardRow}>
              <Text style={styles.rewardLabel}>SYNC POINTS</Text>
              <Text style={styles.rewardValue}>+{rewards.syncPoints}</Text>
            </View>
            <View style={styles.rewardRow}>
              <Text style={styles.rewardLabel}>HOLOS</Text>
              <Text style={styles.rewardValue}>+{rewards.holos}</Text>
            </View>
            <View style={styles.rewardRow}>
              <Text style={styles.rewardLabel}>EXP</Text>
              <Text style={styles.rewardValue}>+{rewards.exp}</Text>
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              disabled={processing}
              onPress={onSync}
              style={[styles.primaryButton, processing ? styles.primaryButtonDisabled : null]}
            >
              <Text style={styles.primaryButtonText}>
                {processing ? "SYNCING..." : "SYNC WATCH REWARDS"}
              </Text>
            </Pressable>
            <Pressable disabled={processing} onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>LATER</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
    marginTop: 18,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.82)",
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
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  errorText: {
    color: "#ff8370",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 14,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    opacity: 0.68,
  },
  primaryButtonText: {
    color: "#050606",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  rewardLabel: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  rewardList: {
    gap: 8,
    marginTop: 18,
  },
  rewardRow: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#25291c",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  rewardValue: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButtonText: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  subtitle: {
    color: "#ddd2b5",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 10,
  },
  title: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 10,
  },
});
