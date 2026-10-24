import { ReactNode, useState } from "react";
import { View, useWindowDimensions, StyleSheet, type LayoutChangeEvent } from "react-native";

import { ARTBOARD_HEIGHT, ARTBOARD_WIDTH } from "@/config/figmaAssets";

type FigmaCanvasProps = {
  children: ReactNode;
  /** Letterbox colour for a re-skinned artboard (lite); OG default unchanged. */
  backgroundColor?: string;
  /** Fit the artboard to the parent's measured box instead of the window (lite, which may host QA chrome). */
  fitToParent?: boolean;
};

export function FigmaCanvas({ children, backgroundColor, fitToParent = false }: FigmaCanvasProps) {
  const windowSize = useWindowDimensions();
  const [parentSize, setParentSize] = useState<{ width: number; height: number } | null>(null);
  const { width, height } = fitToParent && parentSize ? parentSize : windowSize;
  const portraitRatio = ARTBOARD_WIDTH / ARTBOARD_HEIGHT;
  const canvasWidth = Math.min(width, height * portraitRatio);
  const canvasHeight = Math.min(height, width / portraitRatio);
  const onLayout = fitToParent
    ? (event: LayoutChangeEvent) => {
        const next = event.nativeEvent.layout;
        setParentSize(prev => (prev && prev.width === next.width && prev.height === next.height ? prev : { width: next.width, height: next.height }));
      }
    : undefined;

  return (
    <View onLayout={onLayout} style={[styles.page, backgroundColor ? { backgroundColor } : null]}>
      <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }, backgroundColor ? { backgroundColor } : null]}>
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
