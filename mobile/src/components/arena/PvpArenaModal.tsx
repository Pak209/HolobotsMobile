import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { mergeHolobotRoster } from "@/config/holobots";
import type { UserHolobot } from "@/types/profile";

type PvpArenaModalProps = {
  onClose: () => void;
  userHolobots: UserHolobot[];
  visible: boolean;
};

function buildRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function PvpArenaModal({ onClose, userHolobots, visible }: PvpArenaModalProps) {
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [friendCode, setFriendCode] = useState(buildRoomCode());
  const [feedback, setFeedback] = useState<{
    accent?: string;
    lines?: string[];
    message?: string;
    title: string;
  } | null>(null);
  const roster = useMemo(
    () => mergeHolobotRoster(userHolobots).filter((holobot) => holobot.owned),
    [userHolobots],
  );
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];

  useEffect(() => {
    if (!visible) {
      setJoinCode("");
      setFriendCode(buildRoomCode());
      setFeedback(null);
    }
  }, [visible]);

  const handleQuickMatch = () => {
    if (!selectedHolobot) return;

    setFeedback({
      accent: "#17d9ff",
      message: "In queue for next match.",
      title: "Quick Match Queue",
    });
  };

  const handleJoinRoom = () => {
    if (!selectedHolobot) return;

    if (!joinCode.trim()) {
      setFeedback({
        accent: "#f0bf14",
        message: "Enter a room code to join a private PVP arena.",
        title: "Room Code Needed",
      });
      return;
    }

    setFeedback({
      accent: "#17d9ff",
      message: `${selectedHolobot.name} is ready to join room ${joinCode.trim().toUpperCase()}. The room-sync backend is the next step behind this UI.`,
      title: "Join Room",
    });
  };

  const handleFriendBattle = () => {
    if (!selectedHolobot) return;

    setFeedback({
      accent: "#ae4cff",
      lines: [`Room Code: ${friendCode}`],
      message: `${selectedHolobot.name} is set as your pilot for this room. Share the code with your friend to sync the battle.`,
      title: "Friend Battle Ready",
    });
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
            <Text style={styles.eyebrow}>PVP ARENA</Text>
            <Text style={styles.title}>Battle Other Pilots</Text>

            {selectedHolobot ? (
              <Pressable onPress={() => setIsPickerOpen(true)} style={styles.holobotBar}>
                <Image source={selectedHolobot.imageSource} style={styles.holobotArt} resizeMode="contain" />
                <View style={styles.holobotBody}>
                  <Text style={styles.holobotName}>{selectedHolobot.name}</Text>
                  <Text style={styles.holobotMeta}>{`Lv ${selectedHolobot.level} • Tap to change Holobot`}</Text>
                </View>
              </Pressable>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No Holobots Ready</Text>
                <Text style={styles.emptyCopy}>Own at least one Holobot before entering live Arena battles.</Text>
              </View>
            )}

            <View style={styles.optionColumn}>
              <Pressable
                disabled={!selectedHolobot}
                onPress={handleQuickMatch}
                style={[styles.optionCard, !selectedHolobot && styles.optionCardDisabled]}
              >
                <Text style={styles.optionTitle}>Quick Match</Text>
                <Text style={styles.optionCopy}>Sync with the next pilot who is looking for a live battle.</Text>
              </Pressable>

              <View style={styles.optionCard}>
                <Text style={styles.optionTitle}>Join Room</Text>
                <Text style={styles.optionCopy}>Use a room code from another pilot to jump straight into a private battle.</Text>
                <View style={styles.joinRow}>
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={(value) => setJoinCode(value.toUpperCase())}
                    placeholder="ROOM CODE"
                    placeholderTextColor="#9c927b"
                    style={styles.codeInput}
                    value={joinCode}
                  />
                  <Pressable
                    disabled={!selectedHolobot}
                    onPress={handleJoinRoom}
                    style={[styles.inlineButton, !selectedHolobot && styles.optionCardDisabled]}
                  >
                    <Text style={styles.inlineButtonText}>JOIN</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.optionCard}>
                <Text style={styles.optionTitle}>Friend Battle</Text>
                <Text style={styles.optionCopy}>Create a room code and send it to a friend for a direct challenge.</Text>
                <View style={styles.friendRow}>
                  <View style={styles.roomCodeBadge}>
                    <Text style={styles.roomCodeText}>{friendCode}</Text>
                  </View>
                  <Pressable
                    disabled={!selectedHolobot}
                    onPress={handleFriendBattle}
                    style={[styles.inlineButton, !selectedHolobot && styles.optionCardDisabled]}
                  >
                    <Text style={styles.inlineButtonText}>CREATE</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>CLOSE</Text>
            </Pressable>
          </View>
          {feedback ? (
            <View style={styles.feedbackBackdrop}>
              <View style={[styles.feedbackCard, { borderColor: feedback.accent || "#f0bf14" }]}>
                <Text style={[styles.feedbackEyebrow, { color: feedback.accent || "#f0bf14" }]}>
                  SYSTEM UPDATE
                </Text>
                <Text style={styles.feedbackTitle}>{feedback.title}</Text>
                {feedback.message ? <Text style={styles.feedbackMessage}>{feedback.message}</Text> : null}
                {feedback.lines?.length ? (
                  <View style={styles.feedbackLineGroup}>
                    {feedback.lines.map((line) => (
                      <Text key={line} style={styles.feedbackLine}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  style={[styles.feedbackButton, { backgroundColor: feedback.accent || "#f0bf14" }]}
                  onPress={() => setFeedback(null)}
                >
                  <Text style={styles.feedbackButtonText}>OK</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <HolobotPickerModal
        visible={isPickerOpen}
        roster={roster}
        selectedIndex={selectedHolobotIndex}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(index) => {
          setSelectedHolobotIndex(index);
          setIsPickerOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 430,
    padding: 22,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 52,
  },
  closeText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  codeInput: {
    backgroundColor: "#050606",
    borderColor: "#4f4220",
    borderWidth: 1,
    color: "#fef1e0",
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    height: 46,
    letterSpacing: 1.2,
    paddingHorizontal: 14,
  },
  emptyCopy: {
    color: "#b6a98a",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  emptyState: {
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  emptyTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  feedbackBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 28,
    position: "absolute",
    right: 0,
    top: 0,
  },
  feedbackButton: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    minHeight: 50,
  },
  feedbackButtonText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  feedbackCard: {
    backgroundColor: "#111111",
    borderWidth: 3,
    maxWidth: 360,
    padding: 20,
    width: "100%",
  },
  feedbackEyebrow: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
    textAlign: "center",
  },
  feedbackLine: {
    color: "#fef1e0",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
  },
  feedbackLineGroup: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    gap: 8,
    marginTop: 16,
    padding: 12,
  },
  feedbackMessage: {
    color: "#d5cbb2",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  feedbackTitle: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center",
  },
  friendRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  holobotArt: {
    backgroundColor: "#050606",
    height: 68,
    width: 68,
  },
  holobotBar: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  holobotBody: {
    flex: 1,
  },
  holobotMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    marginTop: 4,
  },
  holobotName: {
    color: "#fef1e0",
    fontSize: 20,
    fontWeight: "900",
  },
  inlineButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 14,
  },
  inlineButtonText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  joinRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  optionCard: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    padding: 14,
  },
  optionCardDisabled: {
    opacity: 0.45,
  },
  optionColumn: {
    gap: 12,
    marginTop: 18,
  },
  optionCopy: {
    color: "#c3bba6",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  optionTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  roomCodeBadge: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  roomCodeText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 8,
  },
});
