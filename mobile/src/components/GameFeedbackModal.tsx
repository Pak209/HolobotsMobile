import { theme } from "@/theme";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";

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
  accent = theme.colors.accent,
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
          <GameSurfaceFrame accent={accent} strong />
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
    color: theme.colors.carbon,
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: "transparent",
    maxWidth: 420,
    overflow: "hidden",
    padding: 22,
    position: "relative",
    width: "100%",
  },
  eyebrow: {
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  lineGroup: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.plates.raised,
    borderWidth: 1,
    gap: 8,
    marginTop: 18,
    padding: 14,
  },
  lineText: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  message: {
    color: theme.colors.muted,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    lineHeight: 23,
    marginTop: 12,
    textAlign: "center",
  },
  title: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.display.fontSize,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center",
  },
});
