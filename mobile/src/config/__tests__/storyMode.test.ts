import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isStoryOverworldAvailable, STORY_OVERWORLD_URL } from "../storyMode";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");

describe("L10 · STORY appears only when the overworld would load", () => {
  it("hides STORY in a release build with the shipped localhost default", () => {
    expect(process.env.EXPO_PUBLIC_OVERWORLD_URL).toBeUndefined();
    expect(STORY_OVERWORLD_URL).toBe("http://localhost:5173/overworld.html");
    expect(isStoryOverworldAvailable({ dev: false })).toBe(false);
  });
  it("accepts only an allowed https host in release", () => {
    expect(isStoryOverworldAvailable({ dev: false, url: "https://play.holobots.fun/overworld/v1/" })).toBe(true);
    expect(isStoryOverworldAvailable({ dev: false, url: "http://192.168.1.23:5173/overworld.html" })).toBe(false);
    expect(isStoryOverworldAvailable({ dev: false, url: "http://play.holobots.fun/overworld/v1/" })).toBe(false);
    expect(isStoryOverworldAvailable({ dev: false, url: "https://holobots.fun.evil.example/overworld.html" })).toBe(false);
    expect(isStoryOverworldAvailable({ dev: false, url: "file:///overworld.html" })).toBe(false);
  });
  it("keeps the local overworld for development builds only", () => {
    expect(isStoryOverworldAvailable({ dev: true })).toBe(true);
    expect(isStoryOverworldAvailable({ dev: true, url: "file:///overworld.html" })).toBe(false);
  });
  it("gates the pilot menu entry and never prints the address on the blocked screen", () => {
    expect(source("../../components/HomeCogButton.tsx")).toContain('...(STORY_AVAILABLE ? [{ label: "STORY"');
    const overworld = source("../../screens/OverworldScreen.tsx").split("\n");
    const printed = overworld.filter((line) => line.includes("${STORY_OVERWORLD_URL}") || line.includes("{STORY_OVERWORLD_URL}"));
    // The only remaining mention is the developer hint, compiled out of release builds.
    for (const line of printed) expect(line).toMatch(/\{__DEV__ \?/);
    expect(overworld.join("\n")).toContain("The overworld address is not on the allowed origin list.</Text>");
  });
});
