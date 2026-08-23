import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameDialogFrame } from "@/components/ui/GameSurfaceFrame";

type StoryDialogueOverlayProps = {
  visible: boolean;
  speakerName: string;
  portrait: ImageSourcePropType;
  lines: string[];
  onFinished: () => void;
};

const TYPEWRITER_MS = 31;
const BLINK_MS = 450;
const NARROW_BREAKPOINT = 380;
const PORTRAIT_NARROW = 96;
const PORTRAIT_WIDE = 128;

/**
 * Native dialogue layer for Story Mode (docs/ART_STYLE_GUIDE.md §3–§4):
 * cyan-trim GameDialogFrame over translucent ink, gold nameplate, cream
 * typewriter body, tap/A to continue. Angular only — no rounded rects.
 */
export function StoryDialogueOverlay({
  visible,
  speakerName,
  portrait,
  lines,
  onFinished,
}: StoryDialogueOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [blinkOn, setBlinkOn] = useState(true);

  const line = lines[index] ?? "";
  const isComplete = revealedCount >= line.length;
  const isLast = lines.length > 0 && index >= lines.length - 1;
  const portraitSize = width < NARROW_BREAKPOINT ? PORTRAIT_NARROW : PORTRAIT_WIDE;

  useEffect(() => {
    setIndex(0);
    setRevealedCount(0);
  }, [visible, lines]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const current = lines[index] ?? "";
    setRevealedCount(0);

    if (current.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      setRevealedCount((count) => {
        if (count + 1 >= current.length) {
          clearInterval(timer);
          return current.length;
        }
        return count + 1;
      });
    }, TYPEWRITER_MS);

    return () => clearInterval(timer);
  }, [visible, lines, index]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = setInterval(() => {
      setBlinkOn((on) => !on);
    }, BLINK_MS);

    return () => clearInterval(timer);
  }, [visible]);

  if (!visible || lines.length === 0) {
    return null;
  }

  const advance = () => {
    if (!isComplete) {
      setRevealedCount(line.length);
      return;
    }
    if (isLast) {
      onFinished();
      return;
    }
    setIndex((value) => Math.min(value + 1, lines.length - 1));
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        {
          bottom: insets.bottom + 16,
          paddingLeft: 12 + insets.left,
          paddingRight: 12 + insets.right,
        },
      ]}
    >
      <Pressable
        accessibilityLabel="Advance dialogue"
        accessibilityRole="button"
        hitSlop={16}
        onPress={advance}
        style={styles.box}
      >
        <GameDialogFrame accent="#17d9ff" fill="rgba(5,6,6,0.78)" />
        <View style={styles.row}>
          <View style={[styles.portraitSlot, { height: portraitSize, width: portraitSize }]}>
            <Image resizeMode="cover" source={portrait} style={styles.portrait} />
          </View>
          <View style={styles.textColumn}>
            <Text numberOfLines={1} style={styles.nameplate}>
              {speakerName.toUpperCase()}
            </Text>
            <Text style={styles.body}>{line.slice(0, revealedCount)}</Text>
            <View style={styles.footer}>
              <Text style={styles.counter}>{`${index + 1}/${lines.length}`}</Text>
              {isComplete ? (
                <Text style={[styles.hint, { opacity: blinkOn ? 1 : 0.2 }]}>
                  {isLast ? "▸ CLOSE" : "▾"}
                </Text>
              ) : (
                <Text style={styles.hintHidden}> </Text>
              )}
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
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 6,
    minHeight: 66,
  },
  box: {
    alignSelf: "center",
    maxHeight: 190,
    maxWidth: 560,
    minHeight: 160,
    position: "relative",
    width: "100%",
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
    color: "#17d9ff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  hintHidden: {
    fontSize: 14,
  },
  layer: {
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
    borderColor: "#17d9ff",
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  textColumn: {
    flex: 1,
    flexShrink: 1,
    justifyContent: "flex-start",
    minWidth: 0,
  },
});
