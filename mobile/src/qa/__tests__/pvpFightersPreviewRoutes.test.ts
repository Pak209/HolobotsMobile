import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { previewInitialScreen } from "../previewRoutes";
import { previewScreenFromUrl } from "../previewDeepLink";
import { PVP_FIGHTERS_PREVIEW_ROUTES, pvpFightersFixtures } from "../pvpFightersFixtures";
import { pvpSeatBadge } from "../../lib/bots/pvpFighterLevel";

// Same shape as HoloCityPreview's registry: the PvP routes are spread in as own keys.
const screens = { Home: null, ...Object.fromEntries(PVP_FIGHTERS_PREVIEW_ROUTES.map((name) => [name, null])) };
const badges = (name: keyof typeof pvpFightersFixtures) => {
  const cell = pvpFightersFixtures[name];
  return (["p1", "p2"] as const).map((role) => pvpSeatBadge(cell.view, cell.room, role, cell.room.players[role].holobotName, cell.pending[role]).text);
};

describe("lite PvP level-badge offline QA routes", () => {
  it("registers three cells, known-bad first, in the preview registry", () => {
    expect(PVP_FIGHTERS_PREVIEW_ROUTES).toEqual(["PvpFightersKnownBad", "PvpFightersPending", "PvpFightersCity"]);
    expect(Object.keys(pvpFightersFixtures)).toEqual([...PVP_FIGHTERS_PREVIEW_ROUTES]);
    expect(readFileSync(path.resolve(__dirname, "../HoloCityPreview.tsx"), "utf8")).toContain("...pvpFightersPreviewScreens,");
  });
  it.each(PVP_FIGHTERS_PREVIEW_ROUTES)("opens %s by env and by holobotsmobile://qa deep link", (name) => {
    expect(previewInitialScreen(name, screens)).toBe(name);
    expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBe(name);
    expect(previewScreenFromUrl(`holobotsw64://qa/${name}`, screens)).toBe(name);
  });
  it.each(["PvpFighters", "pvpfighterscity", "PvpFightersHost", "PvpFightersCity?uid=real", "PvpFightersCity/extra", "__proto__"])("rejects %s", (name) => {
    expect(previewInitialScreen(name, screens)).toBe("Home");
    expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBeNull();
  });
  it("cells: known-bad shows no level at all; pending shows only YOU; host shows both host levels", () => {
    expect(pvpFightersFixtures.PvpFightersKnownBad.room.players.p1.level).toBe(99); // The local value the cell must not print.
    expect(badges("PvpFightersKnownBad")).toEqual(["LV —", "LV —"]);
    expect(badges("PvpFightersPending")).toEqual(["LV 21", "LV …"]);
    expect(badges("PvpFightersCity")).toEqual(["LV 21", "LV 12"]);
  });
  it("DECISIONS #71: no cell title, caption or banner says host on screen", () => {
    for (const cell of Object.values(pvpFightersFixtures)) expect(`${cell.title} ${cell.caption}`).not.toMatch(/host/i);
    expect(readFileSync(path.resolve(__dirname, "../PvpFightersPreview.tsx"), "utf8")).toContain("QA / OFFLINE / NO CITY CALL");
  });
});
