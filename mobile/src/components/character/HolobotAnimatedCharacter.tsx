import { useEffect, useRef, useState } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

import {
  getHolobotAnimationAsset,
  getPlatformVideoAsset,
  type HolobotAnimationContext,
  type HolobotAnimationState,
} from "./holobotAnimationAssets";

export type HolobotAnimationTier = "video" | "sheet" | "static";

type Props = {
  animationState: HolobotAnimationState;
  context: HolobotAnimationContext;
  holobotId: string;
  onFirstFrame?: (measurement: { decodeMs: number; tier: HolobotAnimationTier }) => void;
  staticFallback?: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
};

function SpriteSheet({
  columns,
  fps,
  frameCount,
  rows,
  source,
  onFirstFrame,
}: {
  columns: number;
  fps: number;
  frameCount: number;
  rows: number;
  source: ImageSourcePropType;
  onFirstFrame?: () => void;
}) {
  const [frame, setFrame] = useState(0);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    onFirstFrame?.();
    const interval = setInterval(() => setFrame((value) => (value + 1) % frameCount), 1000 / fps);
    return () => clearInterval(interval);
  }, [fps, frameCount, onFirstFrame]);

  const onLayout = (event: LayoutChangeEvent) => setSize(event.nativeEvent.layout);
  const column = frame % columns;
  const row = Math.floor(frame / columns);

  return (
    <View onLayout={onLayout} style={styles.fill}>
      {size.width > 0 ? (
        <Image
          resizeMode="stretch"
          source={source}
          style={{
            height: size.height * rows,
            left: -column * size.width,
            position: "absolute",
            top: -row * size.height,
            width: size.width * columns,
          }}
        />
      ) : null}
    </View>
  );
}

export function HolobotAnimatedCharacter({
  animationState,
  context,
  holobotId,
  onFirstFrame,
  staticFallback,
  style,
}: Props) {
  const asset = getHolobotAnimationAsset(holobotId, context, animationState);
  const videoSource = getPlatformVideoAsset(asset, Platform.OS);
  const [tier, setTier] = useState<HolobotAnimationTier>(videoSource ? "video" : asset.sheet ? "sheet" : "static");
  const startedAt = useRef(global.performance?.now?.() ?? Date.now());
  const reported = useRef(false);
  const player = useVideoPlayer(videoSource ?? null, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  useEffect(() => {
    setTier(videoSource ? "video" : asset.sheet ? "sheet" : "static");
    startedAt.current = global.performance?.now?.() ?? Date.now();
    reported.current = false;
  }, [animationState, asset.sheet, context, holobotId, videoSource]);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") setTier(asset.sheet ? "sheet" : "static");
    });
    return () => subscription.remove();
  }, [asset.sheet, player]);

  const reportFirstFrame = (renderedTier: HolobotAnimationTier) => {
    if (reported.current) return;
    reported.current = true;
    const now = global.performance?.now?.() ?? Date.now();
    onFirstFrame?.({ decodeMs: Math.round(now - startedAt.current), tier: renderedTier });
  };

  return (
    <View accessibilityLabel={`${holobotId} ${context} ${animationState}`} style={[styles.root, style]}>
      {tier === "video" ? (
        <VideoView
          allowsFullscreen={false}
          allowsVideoFrameAnalysis={false}
          contentFit="contain"
          nativeControls={false}
          onFirstFrameRender={() => reportFirstFrame("video")}
          player={player}
          style={styles.fill}
          surfaceType="textureView"
          useExoShutter={false}
        />
      ) : tier === "sheet" && asset.sheet ? (
        <SpriteSheet
          columns={asset.sheetColumns}
          fps={asset.fps}
          frameCount={asset.frameCount}
          onFirstFrame={() => reportFirstFrame("sheet")}
          rows={asset.sheetRows}
          source={asset.sheet}
        />
      ) : (
        <Image
          onLoad={() => reportFirstFrame("static")}
          resizeMode="contain"
          source={staticFallback ?? asset.static}
          style={styles.fill}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { height: "100%", width: "100%" },
  root: { backgroundColor: "transparent", overflow: "hidden" },
});
