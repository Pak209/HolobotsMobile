import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";

import { getExpProgress, type HolobotRosterEntry } from "@/config/holobots";
import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { GameDialogFrame, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";

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
          <GameDialogFrame accent="#f0bf14" fill="#07080a" />
          <View style={styles.header}>
            <Text style={styles.headerEyebrow}>ARENA LOADOUT</Text>
            <Text style={styles.headerTitle}>SELECT HOLOBOT</Text>
            <View style={styles.headerRail} />
          </View>
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
                  <GameSurfaceFrame
                    accent={isSelected ? "#31e75f" : holobot.owned ? "#f0bf14" : "#525762"}
                    fill={isSelected ? "#07140b" : "#090a0d"}
                    strong={isSelected}
                  />
                  <View style={styles.portraitWell}>
                    <Image source={holobot.imageSource} style={styles.portrait} resizeMode="contain" />
                    <Text style={styles.slotIndex}>{String(index + 1).padStart(2, "0")}</Text>
                  </View>
                  <View style={styles.card}>
                    {isSelected ? (
                      <View style={styles.selectedBadge}>
                        <Text style={styles.selectedBadgeText}>SELECTED</Text>
                      </View>
                    ) : null}

                    <Text style={styles.name}>{holobot.name}</Text>
                    <Text style={styles.expText}>
                      {holobot.owned ? `EXP ${holobot.experience}/${holobot.nextLevelExp}` : "BLUEPRINTS REQUIRED"}
                    </Text>
                    <View style={styles.expTrack}>
                      <View style={[styles.expProgress, { width: `${getExpProgress(holobot) * 100}%` }]} />
                    </View>
                    <Text style={[styles.level, !holobot.owned ? styles.levelLocked : null]}>
                      {holobot.owned ? `LV ${holobot.level}` : "LOCKED"}
                    </Text>
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
            <ArenaControlFrame accent="#f0bf14" selected />
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
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 16,
    position: "relative",
  },
  header: {
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  headerEyebrow: {
    color: "#f0bf14",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  headerRail: {
    backgroundColor: "#f0bf14",
    height: 2,
    marginTop: 8,
    width: 72,
  },
  headerTitle: {
    color: "#fef1e0",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 3,
  },
  listContent: {
    paddingBottom: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 92,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 8,
    position: "relative",
  },
  rowDisabled: {
    opacity: 0.62,
  },
  portraitWell: {
    alignItems: "center",
    borderRightColor: "#343841",
    borderRightWidth: 1,
    height: 72,
    justifyContent: "center",
    marginRight: 12,
    position: "relative",
    width: 80,
  },
  portrait: {
    width: 66,
    height: 66,
  },
  slotIndex: {
    color: "#f0bf14",
    fontSize: 7,
    fontWeight: "900",
    left: 1,
    position: "absolute",
    top: 0,
  },
  card: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    position: "relative",
  },
  selectedBadge: {
    position: "absolute",
    top: -4,
    right: 0,
    backgroundColor: "#31e75f",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectedBadgeText: {
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  name: {
    color: "#fef1e0",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  expText: {
    color: "#9ca3af",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 5,
  },
  expTrack: {
    width: "88%",
    height: 5,
    backgroundColor: "#2d3038",
    marginTop: 5,
  },
  expProgress: {
    width: "68%",
    height: "100%",
    backgroundColor: "#f1c316",
  },
  level: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 6,
  },
  levelLocked: {
    color: "#777d88",
  },
  backButton: {
    alignSelf: "center",
    marginTop: 2,
    minHeight: 48,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  backButtonText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
