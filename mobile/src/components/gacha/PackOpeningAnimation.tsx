import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
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
  rare: "#00d9ff",
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

        <View style={styles.revealColumn}>
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
        </View>

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
    backgroundColor: "#111111",
    borderWidth: 4,
    height: 170,
    justifyContent: "center",
    marginBottom: 26,
    width: 170,
  },
  packSubtitle: {
    color: "#ddd2b5",
    fontSize: 14,
    marginTop: 10,
  },
  packTitle: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  collectButton: {
    backgroundColor: "#050606",
    borderWidth: 2,
    marginTop: 18,
    minHeight: 52,
    minWidth: 190,
    alignItems: "center",
    justifyContent: "center",
  },
  collectText: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  revealCard: {
    backgroundColor: "#111111",
    borderWidth: 2,
    padding: 14,
  },
  revealColumn: {
    gap: 10,
    width: "100%",
  },
  revealLabel: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },
  revealRarity: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  revealSubtitle: {
    color: "#ddd2b5",
    fontSize: 13,
    marginTop: 4,
  },
});
