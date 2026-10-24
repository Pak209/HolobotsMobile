import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { theme } from "../../theme";

const mobile = resolve(__dirname, "../../../..");
const script = readFileSync(resolve(mobile, "scripts/recolor_og_fitness.py"), "utf8");
const constant = (name: string) => script.match(new RegExp(`^${name} = "(#[0-9A-Fa-f]{6})"`, "m"))?.[1];

describe("OG Sync art re-skin", () => {
  it("bakes the HoloCity theme tokens, so a token change shows up as a failing regenerate", () => {
    expect(constant("BG")).toBe(theme.ogSync.ground);
    expect(constant("STRIPE")).toBe(theme.ogSync.stripe);
    expect(constant("PANEL")).toBe(theme.ogSync.panel);
    expect(constant("ACCENT")).toBe(theme.colors.accent);
  });

  it("ships the recoloured variants beside the untouched OG originals", () => {
    for (const file of ["fitness-lite/syncArtHoloCity.png", "fitness-lite/speedometerNeedleHoloCity.png", "fitness/goButton.png", "fitness/backgroundBase.png"]) {
      expect(existsSync(resolve(mobile, "assets/figma", file)), file).toBe(true);
    }
  });
});
