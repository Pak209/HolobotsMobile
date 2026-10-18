import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: "demo-identity-pilot" } as { uid: string } | null }, calls: [] as Array<[string, unknown]>, replies: {} as Record<string, () => Promise<unknown>> }));
vi.mock("@/config/firebase", () => ({
  auth: fixture.auth,
  functions: {},
  httpsCallable: (_functions: unknown, name: string) => async (request: unknown) => { fixture.calls.push([name, request]); return { data: await fixture.replies[name]() }; },
}));

import identityFixture from "../../qa/fixtures/desktop-account-3-identity.json";
import { presentHostDashboard } from "../hostDashboard";
import { hostDashboardStoreForUid } from "../hostDashboardFirebase";
import { itemSnapshot } from "../../../test-fixtures/host-pin/src/lib/desktopItems";

const UID = identityFixture.uid;

describe("hostDashboardStoreForUid", () => {
  beforeEach(() => {
    fixture.auth.currentUser = { uid: UID };
    fixture.calls.length = 0;
    fixture.replies = {
      desktopAccountSnapshot: async () => identityFixture,
      desktopItemsHost: async () => itemSnapshot({ holosTokens: 2480, holobots: [{ name: "ACE", level: 2 }] }, null, 1792266848592),
    };
  });

  it("sends only the two read requests, never a uid, balance or result", async () => {
    const store = hostDashboardStoreForUid(UID);
    await store.refresh();
    expect(fixture.calls).toEqual([
      ["desktopAccountSnapshot", { schemaVersion: "desktop-account-3" }],
      ["desktopItemsHost", { schemaVersion: "desktop-items-2", operation: "read" }],
    ]);
    expect(presentHostDashboard(store.getState())).toMatchObject({ pilot: "PILOT Throwaway Pilot", sync: "37 SYNC", holos: "2,480 HOLOS", zonesSummary: "2 OF 4 OPEN" });
  });

  it("drops a reply that lands after the session changed, and never calls signed out", async () => {
    fixture.replies.desktopAccountSnapshot = async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return identityFixture; };
    const store = hostDashboardStoreForUid(UID);
    await store.refresh();
    expect(store.getState()).toMatchObject({ account: null, accountStatus: "unavailable", holosStatus: "unavailable" });

    fixture.auth.currentUser = null;
    fixture.calls.length = 0;
    const signedOut = hostDashboardStoreForUid(UID);
    await signedOut.refresh();
    expect(fixture.calls).toEqual([]);
    expect(presentHostDashboard(signedOut.getState())).toMatchObject({ pilot: "PILOT UNAVAILABLE", holos: "HOLOS UNAVAILABLE", sync: "SYNC UNAVAILABLE" });
  });
});
