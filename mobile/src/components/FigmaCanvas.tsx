import { theme } from "@/theme";
import { ReactNode, useState } from "react";
import { View, useWindowDimensions, StyleSheet } from "react-native";

import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH } from "@/config/figmaAssets";

export function FigmaCanvas({ children, fillHeight = false }: { children: ReactNode; fillHeight?: boolean }) {
  const [availableHeight, setAvailableHeight] = useState(0);
  const { width, height } = useWindowDimensions();
  const portraitRatio = ARTBOARD_WIDTH / ARTBOARD_HEIGHT;
  const canvasWidth = Math.min(width, height * portraitRatio);
  const canvasHeight = fillHeight && availableHeight ? availableHeight : Math.min(height, width / portraitRatio);

  return (
    <View style={styles.page} onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
      <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: theme.colors.carbon,
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    overflow: "hidden",
    backgroundColor: theme.colors.carbon,
  },
});
