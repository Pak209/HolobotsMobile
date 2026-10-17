import { useEffect, useRef, useState } from "react";
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
import { createDialogueSequencer, type DialogueSequencer } from "@/lib/story/dialogueSequencer";

type StoryDialogueOverlayProps = {
  visible: boolean;
  speakerName: string;
  portrait: ImageSourcePropType;
  lines: string[];
  onFinished: () => void;
};

const TICK_MS = 33;
const NARROW_BREAKPOINT = 380;
const PORTRAIT_NARROW = 96;
const PORTRAIT_WIDE = 128;

/**
 * Round E hardening: the component's hook set is FIXED and lives entirely in
 * useDialogueOverlayState below (insets, dimensions, one state counter, one
 * sequencer ref, one interval effect). Sequencing logic is the pure
 * dialogueSequencer module. The component body calls exactly ONE hook and has
 * no return statement before it — guarded by dialogueSequencer.test.ts.
 */
function useDialogueOverlayState(visible: boolean, lines: string[]) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [, setFrame] = useState(0);
  const sequencerRef = useRef<DialogueSequencer | null>(null);

  useEffect(() => {
    if (!visible || lines.length === 0) {
      sequencerRef.current = null;
      return undefined;
    }
    const sequencer = createDialogueSequencer(lines);
    sequencerRef.current = sequencer;
    setFrame((frame) => frame + 1);
    const interval = setInterval(() => {
      if (sequencer.tick(Date.now())) {
        setFrame((frame) => frame + 1);
      }
    }, TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, [visible, lines]);

  const rerender = () => setFrame((frame) => frame + 1);
  const sequencer = visible && lines.length > 0 ? sequencerRef.current : null;
  return { insets, rerender, sequencer, width };
}

export function StoryDialogueOverlay({
  visible,
  speakerName,
  portrait,
  lines,
  onFinished,
}: StoryDialogueOverlayProps) {
  const overlay = useDialogueOverlayState(visible, lines);

  const sequencer = overlay.sequencer;
  const state = sequencer?.getState();
  const line = state ? lines[state.index] ?? "" : "";
  const portraitSize = overlay.width < NARROW_BREAKPOINT ? PORTRAIT_NARROW : PORTRAIT_WIDE;

  const advance = () => {
    if (!sequencer) {
      return;
    }
    const result = sequencer.tap();
    if (result === "finished") {
      onFinished();
      return;
    }
    overlay.rerender();
  };

  const content =
    sequencer && state ? (
      <View
        pointerEvents="box-none"
        style={[
          styles.layer,
          {
            bottom: overlay.insets.bottom + 16,
            paddingLeft: 12 + overlay.insets.left,
            paddingRight: 12 + overlay.insets.right,
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
              <Text style={styles.body}>{line.slice(0, state.revealed)}</Text>
              <View style={styles.footer}>
                <Text style={styles.counter}>{`${state.index + 1}/${lines.length}`}</Text>
                {state.isComplete ? (
                  <Text style={[styles.hint, { opacity: state.blinkOn ? 1 : 0.2 }]}>
                    {state.isLast ? "▸ CLOSE" : "▾"}
                  </Text>
                ) : (
                  <Text style={styles.hintHidden}> </Text>
                )}
              </View>
            </View>
          </View>
        </Pressable>
      </View>
    ) : null;

  return content;
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
