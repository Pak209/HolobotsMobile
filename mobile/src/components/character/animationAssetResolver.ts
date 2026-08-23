export type AnimationAssetLike = {
  androidVideo?: unknown;
  iosVideo?: unknown;
  sheet?: unknown;
  static: unknown;
};

function animationKey(holobotId: string, context: string, animationState: string) {
  return `${holobotId.trim().toUpperCase()}:${context}:${animationState}`;
}

export function hasAnimationAsset<T>(assets: Record<string, T>, holobotId: string, context: string) {
  return animationKey(holobotId, context, "idle") in assets;
}

export function resolveAnimationState<State extends string, T>(
  assets: Record<string, T>,
  holobotId: string,
  context: string,
  desired: State,
): State | "idle" {
  return animationKey(holobotId, context, desired) in assets ? desired : "idle";
}

export function resolveAnimationAsset<T extends AnimationAssetLike>(
  assets: Record<string, T>,
  holobotId: string,
  context: string,
  animationState: string,
  staticFallback: T,
) {
  return assets[animationKey(holobotId, context, animationState)] ?? staticFallback;
}

export function selectPlatformVideo<T extends AnimationAssetLike>(
  asset: T,
  platform: "ios" | "android" | "web" | "windows" | "macos",
) {
  if (platform === "ios") return asset.iosVideo;
  if (platform === "android") return asset.androidVideo;
  return undefined;
}
