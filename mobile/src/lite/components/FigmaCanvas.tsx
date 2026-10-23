import { theme } from "@/lite/theme";
import { createContext, ReactNode, useContext, useState } from "react";
import { View, useWindowDimensions, StyleSheet } from "react-native";

import { fitArtboard, homeCompactFactor } from "@/lite/config/homeLayout";

/** The artboard scale of the enclosing FigmaCanvas, or null outside one. */
const ArtboardScaleContext = createContext<number | null>(null);
/** 1 outside a FigmaCanvas or at >= 402 pt; below that, the factor points-sized overlays shrink by (homeCompactFactor). */
export function useHomeCompactFactor(): number {
  const scale = useContext(ArtboardScaleContext);
  return scale === null ? 1 : homeCompactFactor(scale);
}
type TextMetrics = { fontSize?: number; marginTop?: number };
/** Shrinks a points-sized overlay text style by the compact factor (null, i.e. unchanged, at factor 1). */
export function useCompactText(): (style: TextMetrics) => TextMetrics | null {
  const k = useHomeCompactFactor();
  return (style) => k >= 1 ? null : {
    ...(style.fontSize !== undefined ? { fontSize: Math.round(style.fontSize * k * 10) / 10 } : {}),
    ...(style.marginTop !== undefined ? { marginTop: Math.round(style.marginTop * k * 10) / 10 } : {}),
  };
}

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
        <ArtboardScaleContext.Provider value={frame.scale}>{children}</ArtboardScaleContext.Provider>
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
