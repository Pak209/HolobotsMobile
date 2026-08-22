import { ReactNode } from "react";
import { View, useWindowDimensions, StyleSheet } from "react-native";

import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH } from "@/config/figmaAssets";

export function FigmaCanvas({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const portraitRatio = ARTBOARD_WIDTH / ARTBOARD_HEIGHT;
  const canvasWidth = Math.min(width, height * portraitRatio);
  const canvasHeight = Math.min(height, width / portraitRatio);

  return (
    <View style={styles.page}>
      <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f5c40d",
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    overflow: "hidden",
    backgroundColor: "#f5c40d",
  },
});
