import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

function formatCooldown(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

type SyncCooldownModalProps = {
  onClose: () => void;
  remainingSeconds: number;
  visible: boolean;
};

export function SyncCooldownModal({
  onClose,
  remainingSeconds,
  visible,
}: SyncCooldownModalProps) {
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
          <View style={styles.header}>
            <Text style={styles.eyebrow}>SYNC STATUS</Text>
            <Text style={styles.title}>COOLDOWN ACTIVE</Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.copy}>
              Your next Sync workout is charging back up. Once the timer finishes, you can jump right back in.
            </Text>
            <View style={styles.timerPanel}>
              <Text style={styles.timerLabel}>NEXT WORKOUT READY IN</Text>
              <Text style={styles.timerValue}>{formatCooldown(remainingSeconds)}</Text>
            </View>
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
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.86)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  body: {
    gap: 18,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 10,
  },
  card: {
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    margin: 18,
    minHeight: 56,
  },
  closeText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  copy: {
    color: "#ddd2b5",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23,
    textAlign: "center",
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 3,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },
  timerLabel: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  timerPanel: {
    alignItems: "center",
    backgroundColor: "#0b0d10",
    borderColor: "#25291c",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  timerValue: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 8,
  },
  title: {
    color: "#fef1e0",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 6,
    textAlign: "center",
  },
});
