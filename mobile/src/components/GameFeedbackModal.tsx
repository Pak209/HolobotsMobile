import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

type GameFeedbackModalProps = {
  confirmLabel?: string;
  message?: string;
  onClose: () => void;
  title: string;
  visible: boolean;
  lines?: string[];
  accent?: string;
};

export function GameFeedbackModal({
  accent = "#f0bf14",
  confirmLabel = "OK",
  lines,
  message,
  onClose,
  title,
  visible,
}: GameFeedbackModalProps) {
  return (
    <Modal
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: accent }]}>
          <Text style={[styles.eyebrow, { color: accent }]}>SYSTEM UPDATE</Text>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {lines?.length ? (
            <View style={styles.lineGroup}>
              {lines.map((line) => (
                <Text key={line} style={styles.lineText}>
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
          <Pressable style={[styles.button, { backgroundColor: accent }]} onPress={onClose}>
            <Text style={styles.buttonText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.82)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    minHeight: 54,
  },
  buttonText: {
    color: "#050606",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: "#111111",
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  lineGroup: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    gap: 8,
    marginTop: 18,
    padding: 14,
  },
  lineText: {
    color: "#fef1e0",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  message: {
    color: "#d5cbb2",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12,
    textAlign: "center",
  },
  title: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center",
  },
});
