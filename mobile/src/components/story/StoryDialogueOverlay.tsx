import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

import { GameDialogFrame } from "@/components/ui/GameSurfaceFrame";

type StoryDialogueOverlayProps = {
  visible: boolean;
  speakerName: string;
  portrait: ImageSourcePropType;
  lines: string[];
  onFinished: () => void;
};

/**
 * Native dialogue layer for Story Mode (docs/ART_STYLE_GUIDE.md §3–§4):
 * GameDialogFrame box, 128×128 portrait on the left over ink, gold eyebrow
 * nameplate, cream body copy advancing line-by-line on tap. Angular only.
 */
export function StoryDialogueOverlay({ visible, speakerName, portrait, lines, onFinished }: StoryDialogueOverlayProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible, lines]);

  if (!visible || lines.length === 0) {
    return null;
  }

  const isLast = index >= lines.length - 1;

  const advance = () => {
    if (isLast) {
      onFinished();
      return;
    }
    setIndex((value) => Math.min(value + 1, lines.length - 1));
  };

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Advance dialogue" onPress={advance} style={styles.box}>
        <GameDialogFrame accent="#f0bf14" fill="#0b0c0e" />
        <View style={styles.row}>
          <View style={styles.portraitSlot}>
            <Image resizeMode="cover" source={portrait} style={styles.portrait} />
          </View>
          <View style={styles.textColumn}>
            <Text numberOfLines={1} style={styles.nameplate}>
              {speakerName.toUpperCase()}
            </Text>
            <Text style={styles.body}>{lines[index]}</Text>
            <View style={styles.footer}>
              <Text style={styles.counter}>{`${index + 1}/${lines.length}`}</Text>
              <Text style={styles.hint}>{isLast ? "A ▸ CLOSE" : "A ▸"}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: "#fef1e0",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
    minHeight: 63,
  },
  box: {
    marginHorizontal: 12,
    minHeight: 168,
    position: "relative",
  },
  counter: {
    color: "#ddd2b5",
    fontSize: 11,
    letterSpacing: 1,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  hint: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  layer: {
    bottom: 24,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
  nameplate: {
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 1,
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.5,
    paddingBottom: 4,
  },
  portrait: {
    height: "100%",
    width: "100%",
  },
  portraitSlot: {
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 1,
    height: 128,
    overflow: "hidden",
    width: 128,
  },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 18,
  },
  textColumn: {
    flex: 1,
    justifyContent: "flex-start",
  },
});
