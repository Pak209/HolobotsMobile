import { theme } from "@/theme";
import React from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Svg, Path } from "@/components/FigmaSvg";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type SyncRewardsModalProps = {
  canQuickRefill: boolean;
  cooldownCopy: string;
  onClose: () => void;
  onQuickRefill: () => void;
  sessionsCopy: string;
  visible: boolean;
  rewards: {
    exp: number;
    holos: number;
    syncPoints: number;
  };
};

export function SyncRewardsModal({
  canQuickRefill,
  cooldownCopy,
  onClose,
  onQuickRefill,
  rewards,
  sessionsCopy,
  visible,
}: SyncRewardsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={[styles.resultHeader, styles.victoryHeader]}>
            <Text style={styles.resultEyebrow}>SYNC RESULT</Text>
            <Text style={styles.resultText}>WORKOUT COMPLETE</Text>
          </View>

          <View style={styles.rewardsSection}>
            <Text style={styles.subtitle}>{cooldownCopy}</Text>
            <Text style={styles.rewardsTitle}>REWARDS</Text>

            <View style={styles.rewardsList}>
              <View style={styles.rewardItem}>
                <Text style={styles.rewardIcon}>SP</Text>
                <Text style={styles.rewardLabel}>Sync Points</Text>
                <Text style={styles.rewardValue}>+{rewards.syncPoints}</Text>
              </View>

              <View style={styles.rewardItem}>
                <Text style={styles.rewardIcon}>H</Text>
                <Text style={styles.rewardLabel}>Holos</Text>
                <Text style={styles.rewardValue}>+{rewards.holos}</Text>
              </View>

              <View style={styles.rewardItem}>
                <Text style={styles.rewardIcon}>EXP</Text>
                <Text style={styles.rewardLabel}>Experience</Text>
                <Text style={styles.rewardValue}>+{rewards.exp}</Text>
              </View>
            </View>

            <View style={styles.sessionsRow}>
              <Text style={styles.sessionsCopy}>{sessionsCopy}</Text>
              <Pressable
                accessibilityLabel="Use Quick Refill"
                disabled={!canQuickRefill}
                onPress={onQuickRefill}
                style={[styles.refillButton, !canQuickRefill ? styles.refillButtonDisabled : null]}
              >
                <Svg width="16" height="16" viewBox="0 0 24 24">
                  <Path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5a.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1m5-9l-2 4h3l-2 4" stroke={theme.colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>
            {canQuickRefill ? (
              <Text style={styles.refillMeta}>Quick Refill also collects these rewards before your next 5 minute Sync starts.</Text>
            ) : null}
          </View>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={[styles.button, styles.collectButton]}
              onPress={onClose}
            >
              <Text style={styles.collectButtonText}>COLLECT REWARDS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.88)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  container: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: theme.colors.carbon,
    borderRadius: 0,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: theme.colors.accent,
  },
  resultHeader: {
    backgroundColor: theme.colors.carbon,
    borderBottomWidth: 3,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 6,
  },
  victoryHeader: {
    borderBottomColor: theme.colors.accent,
  },
  resultEyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 2,
  },
  resultText: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 1.4,
    textAlign: "center",
  },
  rewardsSection: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 6,
  },
  subtitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 10,
    textAlign: "center",
  },
  rewardsTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 12,
    textAlign: "center",
  },
  rewardsList: {
    gap: 8,
  },
  rewardItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: "#25291c",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rewardIcon: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginRight: 12,
    minWidth: 32,
  },
  rewardLabel: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  rewardValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "900",
  },
  sessionsRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
  },
  sessionsCopy: {
    color: theme.colors.subtle,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "700",
    textAlign: "center",
  },
  refillButton: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  refillButtonDisabled: {
    opacity: 0.38,
  },
  refillMeta: {
    color: theme.colors.subtle,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 8,
    textAlign: "center",
  },
  buttonsContainer: {
    padding: 18,
    gap: 10,
  },
  button: {
    paddingVertical: 14,
    alignItems: "center",
  },
  collectButton: {
    backgroundColor: theme.colors.accent,
  },
  collectButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
