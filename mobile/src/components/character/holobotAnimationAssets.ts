import type { ImageSourcePropType } from "react-native";

import { getHolobotFullImageSource } from "@/config/holobots";
import { resolveAnimationAsset, selectPlatformVideo } from "./animationAssetResolver";

export type HolobotAnimationContext = "companion" | "arena";
export type HolobotAnimationState =
  | "idle"
  | "attention"
  | "reaction"
  | "attackBasic"
  | "ability"
  | "hit"
  | "victory"
  | "defeat";

export type HolobotAnimationAsset = {
  fps: number;
  frameCount: number;
  sheetColumns: number;
  sheetRows: number;
  static: ImageSourcePropType;
  sheet?: ImageSourcePropType;
  iosVideo?: number;
  androidVideo?: number;
};

// Metro requires literal require() calls. Add future state assets here; callers
// remain data-driven and never need platform or filename knowledge.
const ANIMATION_ASSETS: Record<string, HolobotAnimationAsset> = {
  "ACE:companion:idle": {
    androidVideo: require("../../../assets/holobot-animations/HB_ACE_Companion_Idle.webm"),
    fps: 30,
    frameCount: 50,
    iosVideo: require("../../../assets/holobot-animations/HB_ACE_Companion_Idle.mov"),
    sheet: require("../../../assets/holobot-animations/HB_ACE_Companion_Idle_sheet.png"),
    sheetColumns: 8,
    sheetRows: 7,
    static: getHolobotFullImageSource("ACE"),
  },
  "ACE:arena:idle": {
    androidVideo: require("../../../assets/holobot-animations/HB_ACE_Arena_Idle.webm"),
    fps: 30,
    frameCount: 50,
    iosVideo: require("../../../assets/holobot-animations/HB_ACE_Arena_Idle.mov"),
    sheet: require("../../../assets/holobot-animations/HB_ACE_Arena_Idle_sheet.png"),
    sheetColumns: 8,
    sheetRows: 7,
    static: getHolobotFullImageSource("ACE"),
  },
};

export function getHolobotAnimationAsset(
  holobotId: string,
  context: HolobotAnimationContext,
  animationState: HolobotAnimationState,
): HolobotAnimationAsset {
  return resolveAnimationAsset(
    ANIMATION_ASSETS,
    holobotId,
    context,
    animationState,
    {
      fps: 0,
      frameCount: 1,
      sheetColumns: 1,
      sheetRows: 1,
      static: getHolobotFullImageSource(holobotId),
    },
  );
}

export function getPlatformVideoAsset(
  asset: HolobotAnimationAsset,
  platform: "ios" | "android" | "web" | "windows" | "macos",
) {
  return selectPlatformVideo(asset, platform);
}
