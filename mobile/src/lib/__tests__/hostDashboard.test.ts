import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import identityFixture from "../../qa/fixtures/desktop-account-3-identity.json";
import beforeIdentityFixture from "../../qa/fixtures/desktop-account-3-before-identity.json";
import arenaLifecycle from "../../qa/fixtures/arena-admitted-lifecycle.json";
import { readArenaReply } from "../arenaMatchFlow";
import {
  arenaEconomyChange,
  createHostDashboardStore,
  formatCount,
  IDLE_DASHBOARD_STATE,
  invalidateOnEconomyChange,
  notifyHostEconomyChanged,
  presentHostDashboard,
  presentSquadTitle,
  readDashboardAccount,
  readDashboardHolos,
  readDashboardZones,
  UNAVAILABLE_DASHBOARD_STATE,
  type HostDashboardState,
} from "../hostDashboard";
import { itemSnapshot } from "../../../test-fixtures/host-pin/src/lib/desktopItems";

/**
 * Fixtures are byte copies of the host's #124 unit fixtures (Pak209/HolobotsMobile origin/main, commit 46bf0c3,
 * Documentation/QA/2026-10-17-desktop-snapshot-identity-1/{desktop-account-3,known-bad-before}.json):
 * desktop-account-3 with the identity fields, and the same reply before them (the old shape).
 */
const FIXTURE_SHA256 = {
  "desktop-account-3-identity.json": "1c10048438ea409b3f350202f491f7d9a366235c48f0a826fed4e9a4596928eb",
  "desktop-account-3-before-identity.json": "9c97d4caa1cd7eddf7abf30c30192dea23418835356f271229383941072264ae",
};
const UID = identityFixture.uid;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
/** The host's own desktop-items-2 read reply (functions/src/lib/desktopItems.ts itemSnapshot). */
const hostItemsRead = (holosTokens: number) => itemSnapshot({ holosTokens, holobots: [{ name: "ACE", level: 2 }] }, null, 1792266848592);

describe("host fixtures", () => {
  it.each(Object.entries(FIXTURE_SHA256))("%s is the host's byte copy", (name, sha) => {
    const bytes = readFileSync(path.resolve(__dirname, "../../qa/fixtures", name));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  });
});

describe("readDashboardAccount", () => {
  it("reads the #124 identity fields and the four zone rows in host order", () => {
    const account = readDashboardAccount(identityFixture, UID);
    expect(account.username).toBe("Throwaway Pilot");
    expect(account.syncPoints).toBe(37);
    expect(account.levels).toEqual({ ace: 2 });
    expect(account.zones?.map(z => [z.zoneId, z.displayName, z.statusLabel, z.isOpen])).toEqual([
      ["holocity", "HoloCity", "OPEN", true],
      ["neonforest", "Neon Forest", "OPEN", true],
      ["tide_hollow", "Tide Hollow", "NOT YET AVAILABLE", false],
      ["sky_reach", "Sky Reach", "NOT YET AVAILABLE", false],
    ]);
  });

  it("still accepts the old shape; the missing identity fields read UNAVAILABLE, never a default", () => {
    const account = readDashboardAccount(beforeIdentityFixture, beforeIdentityFixture.uid);
    expect(account).toMatchObject({ username: null, syncPoints: null, zones: null, levels: { ace: 2 } });
    const view = presentHostDashboard({ account, accountStatus: "ready", holos: 0, holosStatus: "ready" });
    expect([view.pilot, view.sync, view.zonesSummary, view.holos]).toEqual(["PILOT UNAVAILABLE", "SYNC UNAVAILABLE", "ZONES UNAVAILABLE", "0 HOLOS"]);
    expect(view.zones).toBeNull();
    for (const version of ["desktop-account-1", "desktop-account-2"]) {
      expect(readDashboardAccount({ ...clone(beforeIdentityFixture), schemaVersion: version }, beforeIdentityFixture.uid).schemaVersion).toBe(version);
    }
  });

  it("rejects another account, an unknown version and non-objects", () => {
    expect(() => readDashboardAccount(identityFixture, "someone-else")).toThrow("invalid_account_reply");
    expect(() => readDashboardAccount({ ...clone(identityFixture), schemaVersion: "desktop-account-4" }, UID)).toThrow();
    expect(() => readDashboardAccount(null, UID)).toThrow();
    expect(() => readDashboardAccount([identityFixture], UID)).toThrow();
    expect(() => readDashboardAccount(identityFixture, "")).toThrow();
  });

  it("keeps a stored zero SYNC and nulls anything the host would not send", () => {
    expect(readDashboardAccount({ ...clone(identityFixture), syncPoints: 0 }, UID).syncPoints).toBe(0);
    for (const bad of [-1, 1.5, "37", Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
      expect(readDashboardAccount({ ...clone(identityFixture), syncPoints: bad }, UID).syncPoints).toBeNull();
    }
    for (const bad of ["", "   ", 7, null]) {
      expect(readDashboardAccount({ ...clone(identityFixture), username: bad }, UID).username).toBeNull();
    }
  });

  it("drops levels that are not positive integers and keys bots by lowercase id", () => {
    const raw = { ...clone(identityFixture), holobots: [{ name: "Shadow", level: 4 }, { name: "KUMA" }, { name: "TORA", level: 0 }, { level: 9 }, "ACE"] };
    expect(readDashboardAccount(raw, UID).levels).toEqual({ shadow: 4 });
  });
});

describe("readDashboardZones", () => {
  const rows = () => clone(identityFixture.zones) as Array<Record<string, unknown>>;
  it("makes the whole list unavailable when any row disagrees with itself or the contract", () => {
    const flagDisagrees = rows(); flagDisagrees[2].isOpen = true;
    const unknownLabel = rows(); unknownLabel[3].statusLabel = "LOCKED";
    const duplicate = rows(); duplicate[1].zoneId = "holocity";
    const badScene = rows(); badScene[0].sceneName = 4;
    const noName = rows(); noName[1].displayName = " ";
    for (const bad of [flagDisagrees, unknownLabel, duplicate, badScene, noName, [], "zones", null, undefined]) {
      expect(readDashboardZones(bad)).toBeNull();
    }
  });
  it("renders a fifth host row rather than pinning the count", () => {
    const five = [...rows(), { zoneId: "harbor_deep", displayName: "Harbor Deep", statusLabel: "NOT YET AVAILABLE", isOpen: false, cardImageId: "harbor_deep", sceneName: null }];
    expect(readDashboardZones(five)?.map(z => z.zoneId)).toEqual(["holocity", "neonforest", "tide_hollow", "sky_reach", "harbor_deep"]);
  });
});

describe("readDashboardHolos", () => {
  it("reads holosTokens from the host's own desktop-items-2 read reply", () => {
    expect(readDashboardHolos(hostItemsRead(950))).toBe(950);
    expect(readDashboardHolos(hostItemsRead(0))).toBe(0);
  });
  it("throws (UNAVAILABLE) on any other shape", () => {
    for (const bad of [{ ...hostItemsRead(950), schemaVersion: "desktop-items-1" }, { ...hostItemsRead(950), holosTokens: -5 }, { schemaVersion: "desktop-items-2" }, null, 950]) {
      expect(() => readDashboardHolos(bad)).toThrow();
    }
  });
});

describe("presentHostDashboard", () => {
  const ready: HostDashboardState = { account: readDashboardAccount(identityFixture, UID), accountStatus: "ready", holos: 1234567, holosStatus: "ready" };
  it("shows the host values", () => {
    const view = presentHostDashboard(ready);
    expect(view).toMatchObject({ pilot: "PILOT Throwaway Pilot", holos: "1,234,567 HOLOS", sync: "37 SYNC", unavailable: false, zonesSummary: "2 OF 4 OPEN", levels: { ace: 2 } });
    expect(view.zones?.map(z => `${z.name}: ${z.status}`)).toEqual(["HoloCity: OPEN", "Neon Forest: OPEN", "Tide Hollow: NOT YET AVAILABLE", "Sky Reach: NOT YET AVAILABLE"]);
  });
  it("shows a loading mark before the first read and UNAVAILABLE after a failure — no sample, default or zero", () => {
    const loading = presentHostDashboard(IDLE_DASHBOARD_STATE);
    expect([loading.pilot, loading.holos, loading.sync, loading.zonesSummary, loading.unavailable]).toEqual(["PILOT …", "HOLOS …", "SYNC …", "ZONES …", false]);
    const failed = presentHostDashboard(UNAVAILABLE_DASHBOARD_STATE);
    expect([failed.pilot, failed.holos, failed.sync, failed.zonesSummary, failed.unavailable, failed.zones, failed.levels]).toEqual(["PILOT UNAVAILABLE", "HOLOS UNAVAILABLE", "SYNC UNAVAILABLE", "ZONES UNAVAILABLE", true, null, null]);
    const text = JSON.stringify([loading, failed]);
    for (const sample of ["Preview Pilot", "pilot_", "2,480", "1,250", "Pilot\"", "0 HOLOS", "0 SYNC"]) expect(text).not.toContain(sample);
  });
  it("keeps one lane's value when only the other read failed", () => {
    const view = presentHostDashboard({ ...ready, holos: null, holosStatus: "unavailable" });
    expect([view.pilot, view.sync, view.holos, view.unavailable]).toEqual(["PILOT Throwaway Pilot", "37 SYNC", "HOLOS UNAVAILABLE", true]);
  });
  it("formats counts without locale dependence", () => {
    expect([0, 999, 1000, 2480, 1234567].map(formatCount)).toEqual(["0", "999", "1,000", "2,480", "1,234,567"]);
  });
});

describe("presentSquadTitle", () => {
  it("joins travel squad membership with snapshot LV", () => {
    expect(presentSquadTitle(["ace", "kuma"], { ace: 12, kuma: 8 })).toBe("ACE LV 12 · KUMA LV 8");
    expect(presentSquadTitle(["ace", "wolf"], { ace: 12 })).toBe("ACE LV 12 · WOLF");
    expect(presentSquadTitle(["ace"], null)).toBe("ACE · LV UNAVAILABLE");
    expect(presentSquadTitle([], { ace: 12 })).toBe("NO HOLOBOTS ASSIGNED");
    expect(presentSquadTitle(null, { ace: 12 })).toBe("CONNECT TO VIEW SQUAD");
  });
});

describe("createHostDashboardStore", () => {
  afterEach(() => vi.useRealTimers());

  it("reads both lanes; one failing lane never blanks the other", async () => {
    const store = createHostDashboardStore(UID, async () => clone(identityFixture), async () => { throw new Error("functions/unavailable"); });
    const seen: HostDashboardState[] = [];
    store.subscribe(state => seen.push(state));
    await store.refresh();
    expect(seen[0]).toMatchObject({ accountStatus: "loading" });
    expect(store.getState()).toMatchObject({ accountStatus: "ready", holos: null, holosStatus: "unavailable" });
    expect(store.getState().account?.username).toBe("Throwaway Pilot");
  });

  it("joins a focus read already in flight instead of calling twice", async () => {
    const account = vi.fn(async () => clone(identityFixture)), items = vi.fn(async () => hostItemsRead(950));
    const store = createHostDashboardStore(UID, account, items);
    await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
    expect([account.mock.calls.length, items.mock.calls.length]).toEqual([1, 1]);
  });

  it("an invalidation during a read drops that (possibly pre-settle) result and reads again", async () => {
    const first = deferred<unknown>();
    const items = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(hostItemsRead(1050));
    const store = createHostDashboardStore(UID, async () => clone(identityFixture), items);
    const shown: Array<number | null> = [];
    store.subscribe(state => shown.push(state.holos));
    const reading = store.refresh();
    await flush();
    void store.invalidate();
    first.resolve(hostItemsRead(950));
    await reading;
    expect(items).toHaveBeenCalledTimes(2);
    expect(store.getState().holos).toBe(1050);
    expect(shown).not.toContain(950);
  });

  it("a failed re-read replaces the last value with UNAVAILABLE", async () => {
    const items = vi.fn().mockResolvedValueOnce(hostItemsRead(950)).mockRejectedValueOnce(new Error("internal"));
    const store = createHostDashboardStore(UID, async () => clone(identityFixture), items);
    await store.refresh();
    expect(presentHostDashboard(store.getState()).holos).toBe("950 HOLOS");
    await store.refresh();
    expect(presentHostDashboard(store.getState()).holos).toBe("HOLOS UNAVAILABLE");
  });

  it("times out a hung callable to UNAVAILABLE", async () => {
    vi.useFakeTimers();
    const store = createHostDashboardStore(UID, () => new Promise(() => {}), () => new Promise(() => {}), 1000);
    const reading = store.refresh();
    await vi.advanceTimersByTimeAsync(1001);
    await reading;
    expect(store.getState()).toMatchObject({ accountStatus: "unavailable", holosStatus: "unavailable" });
  });

  it("rejects another account's reply and publishes nothing after dispose", async () => {
    const wrong = createHostDashboardStore("pilot-b", async () => clone(identityFixture), async () => hostItemsRead(1));
    await wrong.refresh();
    expect(wrong.getState().accountStatus).toBe("unavailable");
    const late = deferred<unknown>();
    const store = createHostDashboardStore(UID, () => late.promise, async () => hostItemsRead(1));
    const listener = vi.fn();
    store.subscribe(listener);
    const reading = store.refresh();
    store.dispose();
    late.resolve(clone(identityFixture));
    await reading;
    expect(store.getState().account).toBeNull();
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("Arena settle -> dashboard re-read (#121 lifecycle, no relaunch)", () => {
  it("one notification per economy transition of the recorded lifecycle", () => {
    const keys = arenaLifecycle.steps.map(step => arenaEconomyChange(readArenaReply(step.reply)));
    const notified: string[] = [];
    let seen: string | null = null;
    for (const key of keys) if (key && key !== seen) { seen = key; notified.push(key.split(":")[1]); }
    expect(arenaLifecycle.steps.map(step => step.request.operation)).toEqual(["resume", "issue", "issue", "resume", "start", "settle", "resume", "settle"]);
    expect(notified).toEqual(["issued", "settled"]);
  });

  it("the mounted store shows the settled Holos and SYNC after the settle notification", async () => {
    const steps = arenaLifecycle.steps;
    const entry = readArenaReply(steps[1].reply).match!.entryReceipt as { balanceBefore: number; balanceAfter: number };
    const paid = (readArenaReply(steps[5].reply).match!.settlementReceipt as { settlement: { holos: number; syncPoints: number } }).settlement;
    // Fake host state, advanced only by the recorded host receipts.
    let host = { holos: entry.balanceBefore, sync: 37 };
    const store = createHostDashboardStore(UID, async () => ({ ...clone(identityFixture), syncPoints: host.sync }), async () => hostItemsRead(host.holos));
    const off = invalidateOnEconomyChange(store, UID);
    await store.refresh();
    expect(presentHostDashboard(store.getState())).toMatchObject({ holos: "1,000 HOLOS", sync: "37 SYNC" });

    host = { ...host, holos: entry.balanceAfter };
    notifyHostEconomyChanged(UID);
    await flush(); await flush();
    expect(presentHostDashboard(store.getState()).holos).toBe("950 HOLOS");

    host = { holos: entry.balanceAfter + paid.holos, sync: host.sync + paid.syncPoints };
    notifyHostEconomyChanged("another-pilot");
    await flush();
    expect(presentHostDashboard(store.getState()).holos).toBe("950 HOLOS");
    notifyHostEconomyChanged(UID);
    await flush(); await flush();
    expect(presentHostDashboard(store.getState())).toMatchObject({ holos: "1,050 HOLOS", sync: "72 SYNC" });
    off();
  });
});
