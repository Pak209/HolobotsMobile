import { theme } from "@/lite/theme";
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
  // Round G: never keep a dismissed transparent Modal host mounted — on iOS it
  // can linger over the app and silently eat every touch (Bug 1 root cause).
  if (!visible) {
    return null;
  }

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
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  errorText: {
    color: "#ff8370",
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 14,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    opacity: 0.68,
  },
  primaryButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  rewardLabel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
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
    backgroundColor: theme.colors.carbon,
    borderColor: "#25291c",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  rewardValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.plates.raised,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButtonText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 10,
  },
  title: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 10,
  },
});
