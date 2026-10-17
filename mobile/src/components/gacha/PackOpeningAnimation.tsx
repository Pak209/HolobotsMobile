import { theme } from "@/theme";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type GachaRevealItem = {
  id: string;
  label: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  subtitle: string;
};

type PackOpeningAnimationProps = {
  accentColor: string;
  isOpen: boolean;
  items: GachaRevealItem[];
  onComplete: () => void;
  packName: string;
};

const rarityGlow = {
  common: "#7b8597",
  rare: theme.colors.accent,
  epic: "#9d4edd",
  legendary: "#ff3366",
} as const;

export function PackOpeningAnimation({
  accentColor,
  isOpen,
  items,
  onComplete,
  packName,
}: PackOpeningAnimationProps) {
  const pulse = useRef(new Animated.Value(0.92)).current;
  const [revealedCount, setRevealedCount] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRevealedCount(0);
      setIsComplete(false);
      return;
    }

    setIsComplete(false);
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 420,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.92,
          duration: 420,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();

    const timers: ReturnType<typeof setTimeout>[] = [];
    items.forEach((_, index) => {
      timers.push(
        setTimeout(() => {
          setRevealedCount(index + 1);
        }, 1100 + index * 360),
      );
    });

    timers.push(
      setTimeout(() => {
        pulseLoop.stop();
        setIsComplete(true);
      }, 1100 + items.length * 360 + 600),
    );

    return () => {
      pulseLoop.stop();
      timers.forEach(clearTimeout);
    };
  }, [isOpen, items, pulse]);

  const visibleItems = useMemo(() => items.slice(0, revealedCount), [items, revealedCount]);

  return (
    <Modal transparent visible={isOpen} animationType="fade">
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.packFrame,
            {
              borderColor: accentColor,
              transform: [{ scale: pulse }],
            },
          ]}
        >
          <Text style={[styles.packTitle, { color: accentColor }]}>{packName}</Text>
          <Text style={styles.packSubtitle}>{isComplete ? "Rewards ready" : "Opening pack..."}</Text>
        </Animated.View>

        {/* Big packs (Elite = 10 drops) overflow the screen: the column must
            scroll and COLLECT must stay reachable below it, or the reveal
            becomes an inescapable overlay (found in sim QA). */}
        <ScrollView
          style={styles.revealScroll}
          contentContainerStyle={styles.revealColumn}
          showsVerticalScrollIndicator={false}
        >
          {visibleItems.map((item) => (
            <View
              key={item.id}
              style={[
                styles.revealCard,
                { borderColor: rarityGlow[item.rarity] },
              ]}
            >
              <Text style={[styles.revealRarity, { color: rarityGlow[item.rarity] }]}>
                {item.rarity.toUpperCase()}
              </Text>
              <Text style={styles.revealLabel}>{item.label}</Text>
              <Text style={styles.revealSubtitle}>{item.subtitle}</Text>
            </View>
          ))}
        </ScrollView>

        {isComplete ? (
          <Pressable style={[styles.collectButton, { borderColor: accentColor }]} onPress={onComplete}>
            <Text style={[styles.collectText, { color: accentColor }]}>COLLECT</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  packFrame: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderWidth: 4,
    height: 170,
    justifyContent: "center",
    marginBottom: 26,
    width: 170,
  },
  packSubtitle: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    marginTop: 10,
  },
  packTitle: {
    fontFamily: "HoloDisplay",
    fontSize: theme.type.header.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  collectButton: {
    backgroundColor: theme.colors.carbon,
    borderWidth: 2,
    marginTop: 18,
    minHeight: 52,
    minWidth: 190,
    alignItems: "center",
    justifyContent: "center",
  },
  collectText: {
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  revealCard: {
    backgroundColor: theme.colors.carbon,
    borderWidth: 2,
    padding: 14,
  },
  revealColumn: {
    gap: 10,
    paddingBottom: 4,
    width: "100%",
  },
  revealScroll: {
    flexGrow: 0,
    flexShrink: 1,
    marginVertical: 10,
    width: "100%",
  },
  revealLabel: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },
  revealRarity: {
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  revealSubtitle: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    marginTop: 4,
  },
});
