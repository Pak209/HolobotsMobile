import { theme } from "@/lite/theme";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";

import { getExpProgress, type HolobotRosterEntry } from "@/config/holobots";
import { ArenaControlFrame } from "@/lite/components/arena/ArenaTierFrames";
import { GameDialogFrame, GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";

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
      animationType="none"
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy} />
          <View style={styles.header}>
            <Text style={styles.headerEyebrow}>ARENA LOADOUT</Text>
            <Text style={styles.headerTitle}>SELECT HOLOBOT</Text>
            <View style={styles.headerRail} />
          </View>
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {roster.map((holobot, index) => (
              <Pressable key={holobot.key} accessibilityRole="button" accessibilityLabel={`${holobot.name}, ${holobot.owned ? `level ${holobot.level}` : "blueprints required"}`} accessibilityState={{ selected: index === selectedIndex, disabled: !holobot.owned }}
                disabled={!holobot.owned} onPress={() => onSelect(index)} style={styles.pickerRow}>
                <GameSurfaceFrame accent={index === selectedIndex ? theme.colors.accent : theme.colors.border} fill={theme.plates.navy} strong={index === selectedIndex} />
                <Image source={holobot.imageSource} style={styles.portrait} resizeMode="contain" />
                <View style={styles.rowCopy}><Text style={styles.rowName} numberOfLines={1}>{holobot.name}</Text><Text style={styles.rowMeta}>{holobot.owned ? `LV ${holobot.level}` : "BLUEPRINTS REQUIRED"}</Text></View>
                <Text style={styles.rowSelect}>{index === selectedIndex ? "ACTIVE" : holobot.owned ? "SELECT ›" : "LOCKED"}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Close holobot picker"
          >
            <ArenaControlFrame accent={theme.colors.accent} selected />
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
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  headerRail: {
    backgroundColor: theme.colors.accent,
    height: 2,
    marginTop: 8,
    width: 72,
  },
  headerTitle: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 3,
  },
  listContent: {
    paddingBottom: 12,
    gap: 4,
  },
  pickerRow: { height: 72, position: "relative", flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 8 },
  portrait: { width: 58, height: 66 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { ...theme.type.label, color: theme.colors.text },
  rowMeta: { ...theme.type.micro, color: theme.colors.muted },
  rowSelect: { ...theme.type.micro, color: theme.colors.accent },
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
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
