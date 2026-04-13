import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";

import { getExpProgress, type HolobotRosterEntry } from "@/config/holobots";

type HolobotPickerModalProps = {
  onClose: () => void;
  onSelect: (index: number) => void;
  roster: HolobotRosterEntry[];
  selectedIndex: number;
  visible: boolean;
};

export function HolobotPickerModal({
  onClose,
  onSelect,
  roster,
  selectedIndex,
  visible,
}: HolobotPickerModalProps) {
  return (
    <Modal
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {roster.map((holobot, index) => {
              const isSelected = index === selectedIndex;

              return (
                <Pressable
                  key={`${holobot.key}:${index}`}
                  onPress={() => holobot.owned && onSelect(index)}
                  style={[styles.row, !holobot.owned ? styles.rowDisabled : null]}
                  accessibilityRole="button"
                  accessibilityLabel={`${holobot.owned ? "Select" : "View"} ${holobot.name}`}
                >
                  <Image source={{ uri: holobot.imageUrl }} style={styles.portrait} resizeMode="contain" />
                  <View style={styles.card}>
                    {isSelected ? (
                      <View style={styles.selectedBadge}>
                        <Text style={styles.selectedBadgeText}>SELECTED</Text>
                      </View>
                    ) : null}

                    <Text style={styles.name}>{holobot.name}</Text>
                    <Text style={styles.expText}>{`EXP ${holobot.experience}/${holobot.nextLevelExp}`}</Text>
                    <View style={styles.expTrack}>
                      <View style={[styles.expProgress, { width: `${getExpProgress(holobot) * 100}%` }]} />
                    </View>
                    <Text style={styles.level}>{holobot.owned ? `Lv ${holobot.level}` : "UNOWNED"}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Close holobot picker"
          >
            <Text style={styles.backButtonText}>BACK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 8, 8, 0.92)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "92%",
    backgroundColor: "#252525",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 24,
  },
  listContent: {
    paddingBottom: 20,
    gap: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  rowDisabled: {
    opacity: 0.58,
  },
  portrait: {
    width: 92,
    height: 92,
    backgroundColor: "#111111",
  },
  card: {
    flex: 1,
    backgroundColor: "#050505",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    position: "relative",
    overflow: "hidden",
  },
  selectedBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#1ca942",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  name: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "500",
    marginTop: 2,
  },
  expText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 8,
  },
  expTrack: {
    width: "78%",
    height: 6,
    backgroundColor: "#4c4538",
    marginTop: 6,
  },
  expProgress: {
    width: "68%",
    height: "100%",
    backgroundColor: "#f1c316",
  },
  level: {
    color: "#ffffff",
    fontSize: 26,
    marginTop: 8,
  },
  backButton: {
    alignSelf: "center",
    marginTop: 8,
    backgroundColor: "#060606",
    paddingHorizontal: 38,
    paddingVertical: 18,
    minWidth: 190,
    alignItems: "center",
    borderColor: "#1b1b1b",
    borderWidth: 2,
  },
  backButtonText: {
    color: "#edbe17",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
