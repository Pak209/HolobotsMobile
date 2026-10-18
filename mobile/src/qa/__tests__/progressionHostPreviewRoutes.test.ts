import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewScreenFromUrl } from "../previewDeepLink";

const preview = readFileSync(path.resolve(__dirname, "../ProgressionHostPreview.tsx"), "utf8");
const ROUTES = ["ProgressionQuests", "ProgressionTraining", "ProgressionMissions", "ProgressionMissionsPaused"];

describe("lite-progression-host-1 offline QA routes", () => {
  it("registers the cells in the preview registry and resolves their deep links", () => {
    expect(preview).toContain(`export const PROGRESSION_HOST_PREVIEW_ROUTES = [${ROUTES.map((r) => `"${r}"`).join(", ")}] as const;`);
    expect(readFileSync(path.resolve(__dirname, "../HoloCityPreview.tsx"), "utf8")).toContain("...progressionHostPreviewScreens,");
    const screens = Object.fromEntries(["Home", ...ROUTES].map((name) => [name, null]));
    for (const name of ROUTES) expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBe(name);
  });

  it("mounts the real screens on recorded host records only: no listener, callable or structured clone", () => {
    expect(preview).toContain("<QuestsScreen timersPreview={state.timers} />");
    expect(preview).toContain("<TrainingScreen timersPreview={state.timers} />");
    expect(preview).toContain('import timersFixture from "./fixtures/progression-timers-1.json";');
    expect(preview).not.toMatch(/structuredClone\s*\(|httpsCallable|onSnapshot/);
    expect(preview).toContain("QA / OFFLINE / RECORDED REPLIES");
  });
});
