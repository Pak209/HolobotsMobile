import { describe, expect, it } from "vitest";

import { resolveAnimationAsset, selectPlatformVideo } from "../animationAssetResolver";

const fallback = { static: "canonical-profile" };
const assets = {
  "ACE:companion:idle": { androidVideo: "webm-companion", iosVideo: "hevc-companion", sheet: "sheet", static: "canonical-profile" },
  "ACE:arena:idle": { androidVideo: "webm-arena", iosVideo: "hevc-arena", sheet: "sheet", static: "canonical-profile" },
};

describe("holobot animation asset resolution", () => {
  it("selects HEVC for iOS and WebM for Android", () => {
    const asset = resolveAnimationAsset(assets, "ace", "companion", "idle", fallback);
    expect(selectPlatformVideo(asset, "ios")).toBe("hevc-companion");
    expect(selectPlatformVideo(asset, "android")).toBe("webm-companion");
  });

  it("swaps assets from context and state inputs", () => {
    expect(resolveAnimationAsset(assets, "ACE", "companion", "idle", fallback)).not.toBe(
      resolveAnimationAsset(assets, "ACE", "arena", "idle", fallback),
    );
  });

  it("degrades an unavailable state to canonical static art", () => {
    expect(resolveAnimationAsset(assets, "ACE", "arena", "victory", fallback)).toBe(fallback);
  });
});
