import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DECISIONS #71 copy rules for the lite surfaces this lane owns (Home, city hub, rival entry, market,
 * dashboard panels, 3D city entry, overworld): the word "host" never reaches the screen, and no field
 * shows a bare placeholder dash. Checks string literals and JSX text, not comments or identifiers.
 */
const FILES = [
  "../../screens/HomeScreen.tsx", "../../screens/CityHubScreen.tsx", "../../screens/CityMarketplaceScreen.tsx", "../../screens/OverworldScreen.tsx",
  "../../components/city/CityRivalBattle.tsx", "../../components/dashboard/UnityLaunchButton.tsx", "../../components/dashboard/TravelSquadPanel.tsx",
  "../../components/dashboard/DashboardZonesPanel.tsx", "../cityHub.ts", "../cityHubClient.ts", "../cityRivalBattle.ts", "../cityMarket.ts",
  "../cityMarketClient.ts", "../hostDashboard.ts", "../unity/nativeUnitySession.ts", "../homeRoster.ts",
] as const;
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");
/** Source with comments removed, then every string literal and JSX text run. */
function onScreenText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  const literals = [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((match) => match[0]);
  const jsx = [...code.matchAll(/>([^<>{}=;()]+)</g)].map((match) => match[1]);
  return [...literals, ...jsx];
}

describe("lite copy rules (DECISIONS #71)", () => {
  it.each(FILES)("never puts the word host on screen: %s", (path) => {
    expect(onScreenText(read(path)).filter((text) => /\bhost\b/i.test(text))).toEqual([]);
  });
  it("known-bad control: the pre-fix hub copy is caught", () => {
    expect(onScreenText('<Text>{loading ? "REFRESHING…" : "REFRESH HOST ROSTER"}</Text>').filter((text) => /\bhost\b/i.test(text))).toEqual(['"REFRESH HOST ROSTER"']);
  });
  it.each(FILES)("shows no bare placeholder dash: %s", (path) => {
    const dashes = onScreenText(read(path)).filter((text) => /(^["'`>]?\s*—\s*["'`]?$)|LV —|Lv —|EXP —|— HOLOS|TIER —/.test(text));
    expect(dashes).toEqual([]);
  });
  it("L20: Home never says ROSTER UNAVAILABLE; its roster copy comes from one honest state (homeRoster.ts)", () => {
    const home = read("../../screens/HomeScreen.tsx");
    expect(home).not.toContain("ROSTER UNAVAILABLE");
    expect(home).toContain("HOME_ROSTER_COPY[rosterState]");
  });
  it("L20: the market prints no product codename and no raw refusal code", () => {
    for (const path of ["../../screens/CityMarketplaceScreen.tsx", "../../screens/CityHubScreen.tsx"]) expect(read(path)).not.toContain("HOLOCITY LITE");
    expect(read("../cityMarket.ts")).not.toMatch(/REFUSED · \$\{code\}/);
  });
  it("L17: no NATIVE CITY dev label; the entry hides without the native module", () => {
    expect(read("../../screens/HomeScreen.tsx")).not.toContain("NATIVE CITY");
    const button = read("../../components/dashboard/UnityLaunchButton.tsx");
    expect(button).not.toContain("NATIVE CITY");
    expect(button).toContain("if(!hasNativeUnity())return null;");
  });
});
