import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { shouldShowLoadingOverlay } from "@/lib/story/overlayVisibility";

const base = { blocked: false, helloReceived: false, loadError: false, pageLoading: false, storeReady: true };

describe("shouldShowLoadingOverlay (Round G: no touch-eating stuck overlay)", () => {
  it("shows only while the store or page is genuinely loading", () => {
    expect(shouldShowLoadingOverlay({ ...base, pageLoading: true })).toBe(true);
    expect(shouldShowLoadingOverlay({ ...base, storeReady: false })).toBe(true);
    expect(shouldShowLoadingOverlay(base)).toBe(false);
  });

  it("a received BRIDGE_HELLO forces the overlay off even if onLoadEnd was missed", () => {
    expect(shouldShowLoadingOverlay({ ...base, helloReceived: true, pageLoading: true })).toBe(false);
    expect(shouldShowLoadingOverlay({ ...base, helloReceived: true, storeReady: false })).toBe(false);
  });

  it("defers to the blocked and error overlays", () => {
    expect(shouldShowLoadingOverlay({ ...base, blocked: true, pageLoading: true })).toBe(false);
    expect(shouldShowLoadingOverlay({ ...base, loadError: true, pageLoading: true })).toBe(false);
  });
});

describe("transparent Modal hosts are conditionally mounted (Bug 1 regression guard)", () => {
  // A dismissed-but-mounted transparent RN Modal can intercept touches app-wide
  // on iOS. Each modal must bail out with `if (!visible)` BEFORE rendering
  // <Modal so the host view never exists while hidden.
  const MODALS = [
    "../../../components/WatchRewardsSyncModal.tsx",
    "../../../components/UserStatsModal.tsx",
    "../../../components/DashboardSettingsModal.tsx",
  ];

  it.each(MODALS)("%s bails out before rendering <Modal", (relativePath) => {
    const source = readFileSync(
      fileURLToPath(new URL(relativePath, import.meta.url) as unknown as string),
      "utf8",
    );
    const guardIndex = source.indexOf("if (!visible)");
    const modalIndex = source.indexOf("<Modal");
    expect(guardIndex, "conditional-mount guard missing").toBeGreaterThan(-1);
    expect(modalIndex, "component should render a Modal").toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(modalIndex);
  });
});
