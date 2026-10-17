import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";

const logoImage = require("../../assets/loading-logo.png");

type AppLoadingScreenProps = {
  ready?: boolean;
};

export function AppLoadingScreen({ ready = false }: AppLoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const glow = useRef(new Animated.Value(0.45)).current;
  const dots = useMemo(
    () => [new Animated.Value(0.35), new Animated.Value(0.55), new Animated.Value(0.75)],
    [],
  );

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 0.9,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.45,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const dotLoops = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 180),
          Animated.timing(dot, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.35,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    pulse.start();
    dotLoops.forEach((loop) => loop.start());

    return () => {
      pulse.stop();
      dotLoops.forEach((loop) => loop.stop());
    };
  }, [dots, glow]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((current) => {
        if (ready) {
          return current >= 100 ? 100 : Math.min(100, current + 8);
        }

        if (current >= 92) {
          return 92;
        }

        return current + 3;
      });
    }, 70);

    return () => clearInterval(interval);
  }, [ready]);

  return (
    <View style={styles.container}>
      <View style={styles.stripeOverlay} />
      <Animated.View style={[styles.borderLine, styles.borderTop, { transform: [{ scaleX: glow }] }]} />
      <Animated.View style={[styles.borderLine, styles.borderBottom, { transform: [{ scaleX: glow }] }]} />

      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.glowWrap, { opacity: glow }]}>
            <Image source={logoImage} style={styles.logo} resizeMode="contain" />
          </Animated.View>
          <Image source={logoImage} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={styles.title}>HOLOBOTS</Text>
        <Text style={styles.subtitle}>SYNC • TRAIN • BATTLE</Text>

        <View style={styles.progressWrap}>
          <View style={styles.progressFrame}>
            <View style={[styles.progressFill, { width: `${progress}%` }]}>
              <View style={styles.progressScan} />
            </View>
          </View>
          <View style={styles.progressMeta}>
            <Text style={styles.progressLabel}>LOADING</Text>
            <Text style={styles.progressValue}>{progress}%</Text>
          </View>
        </View>

        <View style={styles.dotsRow}>
          {dots.map((dot, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  opacity: dot,
                  transform: [
                    {
                      scale: dot.interpolate({
                        inputRange: [0.35, 1],
                        outputRange: [0.9, 1.2],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={[styles.corner, styles.cornerTopLeft]} />
      <View style={[styles.corner, styles.cornerTopRight]} />
      <View style={[styles.corner, styles.cornerBottomLeft]} />
      <View style={[styles.corner, styles.cornerBottomRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  borderBottom: {
    bottom: 0,
  },
  borderLine: {
    backgroundColor: "#ffc107",
    height: 4,
    left: 0,
    position: "absolute",
    right: 0,
  },
  borderTop: {
    top: 0,
  },
  container: {
    alignItems: "center",
    backgroundColor: "#050606",
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 28,
    zIndex: 2,
  },
  corner: {
    borderColor: "#ffc107",
    height: 60,
    position: "absolute",
    width: 60,
  },
  cornerBottomLeft: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: 0,
    left: 0,
  },
  cornerBottomRight: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: 0,
    right: 0,
  },
  cornerTopLeft: {
    borderLeftWidth: 4,
    borderTopWidth: 4,
    left: 0,
    top: 0,
  },
  cornerTopRight: {
    borderRightWidth: 4,
    borderTopWidth: 4,
    right: 0,
    top: 0,
  },
  dot: {
    backgroundColor: "#ffc107",
    height: 8,
    width: 8,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 28,
  },
  glowWrap: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  logo: {
    height: 196,
    width: 196,
  },
  logoWrap: {
    height: 196,
    marginBottom: 26,
    width: 196,
  },
  progressFill: {
    backgroundColor: "#ffc107",
    height: "100%",
    overflow: "hidden",
  },
  progressFrame: {
    backgroundColor: "#1a1a1a",
    borderColor: "#ffc107",
    borderWidth: 2,
    height: 24,
    overflow: "hidden",
    width: "100%",
  },
  progressLabel: {
    color: "#6d6d6d",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    width: "100%",
  },
  progressScan: {
    backgroundColor: "#fff7d1",
    height: "100%",
    marginLeft: "auto",
    width: 4,
  },
  progressValue: {
    color: "#ffc107",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  progressWrap: {
    marginTop: 10,
    width: 320,
  },
  stripeOverlay: {
    backgroundColor: "transparent",
    bottom: -200,
    left: -180,
    position: "absolute",
    right: -180,
    top: -200,
    transform: [{ rotate: "-28deg" }],
  },
  subtitle: {
    color: "#8b8b8b",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 4,
    marginBottom: 42,
  },
  title: {
    color: "#ffc107",
    fontSize: 48,
    fontStyle: "italic",
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
    textShadowColor: "rgba(255, 193, 7, 0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
});
