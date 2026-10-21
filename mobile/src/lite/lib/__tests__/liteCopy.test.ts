import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DECISIONS #71 copy rules for the lite surfaces this lane owns (Home, city hub, rival entry, market,
 * dashboard panels, 3D city entry, overworld): the word "host" never reaches the screen, and no field
 * shows a bare placeholder dash. Checks string literals and JSX text, not comments or identifiers.
 */
const FILES = [
  "../../screens/HomeScreen.tsx", "../../screens/EnabledCityHubScreen.tsx", "../../screens/CityMarketplaceScreen.tsx", "../../screens/OverworldScreen.tsx",
  "../../components/city/CityRivalBattle.tsx", "../../components/dashboard/UnityLaunchButton.tsx", "../../components/dashboard/TravelSquadPanel.tsx",
  "../../components/dashboard/DashboardZonesPanel.tsx", "../cityHub.ts", "../cityHubClient.ts", "../cityRivalBattle.ts", "../cityMarket.ts",
  "../cityMarketClient.ts", "../hostDashboard.ts", "../unity/nativeUnitySession.ts", "../homeRoster.ts",
  // lite-arena-polish-1 (D): the CPU Arena and duel surfaces.
  "../../screens/ArenaScreen.tsx", "../../components/arena/ArenaInterstitial.tsx", "../../components/arena/BattleArenaView.tsx",
  "../../components/arena/BattleResultsModal.tsx", "../../components/arena/arenaResultPresenter.ts", "../../components/arena/ArenaPrebattleMenu.tsx",
  "../arenaCopy.ts", "../arenaMatchFlow.ts", "../arenaSettleConfirm.ts", "../arenaHostBattle.ts", "../../screens/EnabledDuelPlaybackScreen.tsx",
  "../bots/liveRivalPlayback.ts", "../bots/hostDuelReceipt.ts", "../bots/duelPlayback.ts",
  // lite-arena-stage-1: the shared park-arena 3D stage the CPU Arena round now renders.
  "../../components/duel/LiveDuelStage.tsx", "../../components/duel/liveDuelCommands.ts", "../../components/city/CityLiveBattleView.tsx",
  // lite-battle-ui-1: the HoloCity battle HUD (hex command plates, fighter cards, readiness chip).
  "../../components/HoloCityCommandBar.tsx", "../../components/duel/HoloHudArt.tsx", "../../components/duel/commandPlateLayout.ts",
  // lite-vfx-port-1: the combat-VFX player and its action mapping (no on-screen copy; pinned so none creeps in).
  "../../vfx/vfxPlayer.ts", "../../vfx/liveDuelVfx.ts", "../../vfx/vfxCurves.ts",
] as const;
/** Type tags that never reach the screen: the receipt/trace discriminator `"host"` and the move template id prefix. */
const NOT_ON_SCREEN = new Set(["'host'", '"host"', "`host.${id}`"]);
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
    expect(onScreenText(read(path)).filter((text) => /\bhost\b/i.test(text) && !NOT_ON_SCREEN.has(text))).toEqual([]);
  });
  it("known-bad control: the allowlist is exact-match only, so pre-fix Arena copy is still caught", () => {
    const caught = onScreenText(`receipt={{ kind: 'host' }} <Text>RESUME HOST MATCH</Text> subtitle("HOST RECEIPT")`).filter((text) => /\bhost\b/i.test(text) && !NOT_ON_SCREEN.has(text));
    expect(caught).toEqual(['"HOST RECEIPT"', "RESUME HOST MATCH"]);
  });
  it("known-bad control: the pre-fix hub copy is caught", () => {
    expect(onScreenText('<Text>{loading ? "REFRESHING…" : "REFRESH HOST ROSTER"}</Text>').filter((text) => /\bhost\b/i.test(text))).toEqual(['"REFRESH HOST ROSTER"']);
  });
  it.each(FILES)("shows no bare placeholder dash: %s", (path) => {
    const dashes = onScreenText(read(path)).filter((text) => /(^["'`>]?\s*—\s*["'`]?$)|LV —|Lv —|EXP —|— HOLOS|TIER —/.test(text));
    expect(dashes).toEqual([]);
  });
  it.each(FILES)("Lex packet 3: the level badge is LV, never Lv: %s", (path) => {
    expect(onScreenText(read(path)).filter((text) => /\bLv\b/.test(text))).toEqual([]);
  });
  it("L20: Home never says ROSTER UNAVAILABLE; its roster copy comes from one honest state (homeRoster.ts)", () => {
    const home = read("../../screens/HomeScreen.tsx");
    expect(home).not.toContain("ROSTER UNAVAILABLE");
    expect(home).toContain("HOME_ROSTER_COPY[rosterState]");
  });
  it("L20: the market prints no product codename and no raw refusal code", () => {
    for (const path of ["../../screens/CityMarketplaceScreen.tsx", "../../screens/EnabledCityHubScreen.tsx"]) expect(read(path)).not.toContain("HOLOCITY LITE");
    expect(read("../cityMarket.ts")).not.toMatch(/REFUSED · \$\{code\}/);
  });
  it("L17: no NATIVE CITY dev label; the entry hides without the native module", () => {
    expect(read("../../screens/HomeScreen.tsx")).not.toContain("NATIVE CITY");
    const button = read("../../components/dashboard/UnityLaunchButton.tsx");
    expect(button).not.toContain("NATIVE CITY");
    expect(button).toContain("if(!hasNativeUnity())return null;");
  });
});
