import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
const loads = vi.hoisted(() => ({ main: 0, lite: 0, city: 0 }));
vi.mock("../../../MainApp", () => { loads.main++; return { default: () => createElement("main-flow") }; });
vi.mock("../../../LiteApp", () => { loads.lite++; return { default: () => createElement("lite-flow") }; });
vi.mock("../../lite/screens/EnabledCityHubScreen", () => { loads.city++; return { CityHubScreen: () => createElement("city-flow") }; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); loads.main = loads.lite = loads.city = 0; });
describe("lite rollout evaluation boundary", () => {
  it.each([undefined, "0", "true", "01"])("keeps main and never evaluates lite for %s", async flag => {
    if (flag !== undefined) vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", flag); else vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "");
    const App = (await import("../../../App")).default;
    let view: ReturnType<typeof create>;
    await act(async () => { view = create(createElement(App)); });
    expect(view!.toJSON()).toMatchObject({ type: "main-flow" });
    expect(loads.lite).toBe(0);
    await act(async () => view!.unmount());
  });
  it("loads the enabled application only for exact 1", async () => {
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1");
    const App = (await import("../../../App")).default;
    let view: ReturnType<typeof create>;
    await act(async () => { view = create(createElement(App)); });
    expect(view!.toJSON()).toMatchObject({ type: "lite-flow" });
    expect(loads.main).toBe(0);
    await act(async () => view!.unmount());
  });
  it("direct disabled CityHub mount never evaluates its consumer module", async () => {
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "0");
    const { CityHubScreen } = await import("../../lite/screens/CityHubScreen");
    expect(CityHubScreen()).toBeNull(); expect(loads.city).toBe(0);
  });
  it("preview additionally requires development and its separate flag", async () => {
    const { isLitePreviewEnabled } = await import("../liteFeature");
    vi.stubGlobal("__DEV__", true); vi.stubEnv("EXPO_PUBLIC_HOLOCITY_PREVIEW", "1");
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "0"); expect(isLitePreviewEnabled()).toBe(false);
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1"); expect(isLitePreviewEnabled()).toBe(true);
    vi.stubGlobal("__DEV__", false); expect(isLitePreviewEnabled()).toBe(false);
  });
});
