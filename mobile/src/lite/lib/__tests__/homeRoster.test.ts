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
    const app = read("../../../../LiteApp.tsx");
    expect(app).toContain("if (bootLoading || (user && profileLoading && !profile && !profileError)) {");
    // HELD on main (lite-main-port-2): lite #142's AuthContext hunk (retryProfile, same-batch profile read) edits an
    // original-app file. Main's shared AuthContext has neither, so Home offers no RETRY. When that change lands this
    // goes red: restore lite's AuthContext assertions here and drop HomeScreen's `retryProfile = undefined`.
    const auth = read("../../../contexts/AuthContext.tsx");
    expect(auth).not.toContain("retryProfile");
    expect(read("../../screens/HomeScreen.tsx")).toContain("profileError: retryProfile ? profileError : null");
    // The shared AuthContext sets the user one render before it starts the read, so LiteApp covers that render
    // itself: a signed-in account whose read has not started gets the loading screen, never Home.
    expect(app).toContain("else if (profileLoading || profile || profileError) profileReadFor.current = user.uid;");
    expect(app).toContain("const profileReadPending = !!user && profileReadFor.current !== user.uid;");
    expect(app).toMatch(/if \(profileReadPending\) \{\s*return <AppLoadingScreen \/>;/);
  });
  it("Home draws RETRY and its tap target only for the unavailable state", () => {
    // On main "unavailable" is unreachable while lite #142's AuthContext hunk is HELD (see the tripwire above).
    const home = readFileSync(fileURLToPath(new URL("../../screens/HomeScreen.tsx", import.meta.url) as unknown as string), "utf8");
    expect(home).toContain('rosterState === "unavailable" ? <Text');
    expect(home).toMatch(/\{rosterState === "unavailable" \? \(\s*<Pressable[\s\S]*?onPress=\{retryProfile\}/);
    expect(home.match(/HOME_ROSTER_COPY\.retry/g)).toHaveLength(1);
    expect(home.match(/onPress=\{retryProfile\}/g)).toHaveLength(1);
  });
});
