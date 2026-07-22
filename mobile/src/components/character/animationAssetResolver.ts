export type AnimationAssetLike = {
  androidVideo?: unknown;
  iosVideo?: unknown;
  sheet?: unknown;
  static: unknown;
};

export function resolveAnimationAsset<T extends AnimationAssetLike>(
  assets: Record<string, T>,
  holobotId: string,
  context: string,
  animationState: string,
  staticFallback: T,
) {
  const id = holobotId.trim().toUpperCase();
  return assets[`${id}:${context}:${animationState}`] ?? staticFallback;
}

export function selectPlatformVideo<T extends AnimationAssetLike>(
  asset: T,
  platform: "ios" | "android" | "web" | "windows" | "macos",
) {
  if (platform === "ios") return asset.iosVideo;
  if (platform === "android") return asset.androidVideo;
  return undefined;
}
