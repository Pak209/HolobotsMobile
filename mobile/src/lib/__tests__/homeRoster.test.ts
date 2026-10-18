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
  });
  it("read answered with no profile document → missing: same words, no RETRY (the live listener updates it)", () => {
    expect(homeRosterState(signedIn)).toBe("missing");
    expect(HOME_ROSTER_COPY.missing).toBe(HOME_ROSTER_COPY.unavailable);
  });
  it("a retry in flight shows LOADING even while the last error is kept", () => {
    expect(homeRosterState({ ...signedIn, profileLoading: true, profileError: "permission-denied" })).toBe("loading");
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
  it("the app covers only a first read; a retry keeps Home mounted, and a sign-in never shows a not-started read", () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");
    expect(read("../../../App.tsx")).toContain("if (bootLoading || (user && profileLoading && !profile && !profileError)) {");
    const auth = read("../../contexts/AuthContext.tsx");
    // Every non-null sign-in starts the profile read in the same update.
    expect(auth.match(/setProfileLoading\(true\);\s*setUser\(nextUser\);/g)).toHaveLength(2);
    expect(auth.match(/setUser\(nextUser\)/g)).toHaveLength(2);
    // A successful read clears the error; a retry does not clear it up front.
    expect(auth).toMatch(/setProfile\(nextProfile\);\s*setProfileError\(null\);\s*setProfileLoading\(false\);/);
    expect(auth).toContain("if (profileUidRef.current !== user.uid) setProfileError(null);");
  });
  it("Home draws RETRY and its tap target only for the unavailable state", () => {
    const home = readFileSync(fileURLToPath(new URL("../../screens/HomeScreen.tsx", import.meta.url) as unknown as string), "utf8");
    expect(home).toContain('rosterState === "unavailable" ? <Text');
    expect(home).toMatch(/\{rosterState === "unavailable" \? \(\s*<Pressable[\s\S]*?onPress=\{retryProfile\}/);
    expect(home.match(/HOME_ROSTER_COPY\.retry/g)).toHaveLength(1);
    expect(home.match(/onPress=\{retryProfile\}/g)).toHaveLength(1);
  });
});
