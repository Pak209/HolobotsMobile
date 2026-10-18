import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_ROSTER_COPY, homeRosterState } from "../homeRoster";

const signedIn = { signedIn: true, ownsHolobot: false, profileLoaded: false, profileLoading: false, profileError: null };

describe("Home roster state (L20: only a real failure claims one)", () => {
  it("loaded roster → ready (also when signed out: the catalog preview)", () => {
    expect(homeRosterState({ ...signedIn, ownsHolobot: true, profileLoaded: true })).toBe("ready");
    expect(homeRosterState({ ...signedIn, signedIn: false })).toBe("ready");
  });
  it("profile read failed → unavailable, the only state that offers RETRY", () => {
    expect(homeRosterState({ ...signedIn, profileError: "permission-denied" })).toBe("unavailable");
    // Not loading, no profile and no error: the read ended without a profile.
    expect(homeRosterState(signedIn)).toBe("unavailable");
  });
  it("loaded profile with no Holobots → empty, never a failure and never RETRY", () => {
    expect(homeRosterState({ ...signedIn, profileLoaded: true })).toBe("empty");
    // A retry re-subscribes while the old profile is still shown: still empty, not loading or failed.
    expect(homeRosterState({ ...signedIn, profileLoaded: true, profileLoading: true })).toBe("empty");
    expect(HOME_ROSTER_COPY.empty).toBe("NO HOLOBOTS YET");
  });
  it("first read in flight → loading", () => {
    expect(homeRosterState({ ...signedIn, profileLoading: true })).toBe("loading");
  });
  it("Home draws RETRY and its tap target only for the unavailable state", () => {
    const home = readFileSync(fileURLToPath(new URL("../../screens/HomeScreen.tsx", import.meta.url) as unknown as string), "utf8");
    expect(home).toContain('rosterState === "unavailable" ? <Text');
    expect(home).toMatch(/\{rosterState === "unavailable" \? \(\s*<Pressable[\s\S]*?onPress=\{retryProfile\}/);
    expect(home.match(/HOME_ROSTER_COPY\.retry/g)).toHaveLength(1);
    expect(home.match(/onPress=\{retryProfile\}/g)).toHaveLength(1);
  });
});
