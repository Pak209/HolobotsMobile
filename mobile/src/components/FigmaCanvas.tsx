import { theme } from "@/theme";
import { ReactNode, useState } from "react";
import { View, useWindowDimensions, StyleSheet } from "react-native";

import { fitArtboard } from "@/config/homeLayout";

/**
 * The artboard at one scale for both axes, centred in the space this page is given; the rest is
 * carbon letterbox. Overlays positioned in artboard percent stay on their art at every phone size.
 */
export function FigmaCanvas({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const [page, setPage] = useState<{ width: number; height: number } | null>(null);
  const frame = fitArtboard(page?.width ?? window.width, page?.height ?? window.height);

  return (
    <View style={styles.page} onLayout={event => { const { width, height } = event.nativeEvent.layout; setPage({ width, height }); }}>
      <View style={[styles.canvas, { width: frame.width, height: frame.height }]}>
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
