import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: "pilot-a" } as { uid: string } | null }, call: vi.fn(), callable: vi.fn() }));
vi.mock("@/config/firebase", () => ({ auth: fixture.auth, functions: {}, httpsCallable: (...args: unknown[]) => { fixture.callable(...args); return fixture.call; } }));
import { loadCityHub, meetCityPilots, issueCityRival, settleCityRival, craftCityItem, healCitySquad } from "../cityHubClient";
import { CITY_GATHERING_FIXTURE } from "../cityHubFixtures";
describe("city authenticated host actions", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  afterEach(() => vi.useRealTimers());
  it("calls the exact #80 gathering and citizen admission contracts", async () => {
    fixture.call.mockResolvedValueOnce({ data: CITY_GATHERING_FIXTURE });
    expect((await meetCityPilots("pilot-a")).roster).toHaveLength(8);
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "arenaGatheringHost");
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "arena-gathering-1" });
    fixture.call.mockClear();
    await expect(issueCityRival("pilot-a", CITY_GATHERING_FIXTURE.roster[0])).rejects.toThrow("aren’t available");
    expect(fixture.call).not.toHaveBeenCalled();
  });
  it("loads host snapshot and dynamic roster, without sending a uid", async () => {
    const roster = CITY_GATHERING_FIXTURE.roster.map((row, i) => ({ ...row, pilotName: `Host pilot ${i}` }));
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "desktop-account-3", uid: "pilot-a", storyFlags: CITY_GATHERING_FIXTURE.storyFlags } })
      .mockResolvedValueOnce({ data: { ...CITY_GATHERING_FIXTURE, roster } });
    expect((await loadCityHub("pilot-a")).roster).toEqual(roster);
    expect(fixture.callable.mock.calls.map(c => c[1])).toEqual(["desktopAccountSnapshot", "arenaGatheringHost"]);
    expect(fixture.call.mock.calls.map(c => c[0])).toEqual([{ schemaVersion: "desktop-account-3" }, { schemaVersion: "arena-gathering-1" }]);
  });
  it("does not implicitly join an unseen gathering", async () => {
    fixture.call.mockResolvedValue({ data: { schemaVersion: "desktop-account-3", uid: "pilot-a", storyFlags: { ...CITY_GATHERING_FIXTURE.storyFlags, arenaGatheringSeen: false } } });
    const result = await loadCityHub("pilot-a");
    expect(result.storyFlags.arenaGatheringSeen).toBe(false);
    expect(result.roster).toEqual([]);
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });
  it("keeps missing flags closed and rejects foreign/malformed snapshots", async () => {
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "desktop-account-3", uid: "pilot-a" } });
    expect((await loadCityHub("pilot-a")).storyFlags.arenaArcBuilt).toBe(false);
    for (const reply of [{ schemaVersion: "desktop-account-2", uid: "pilot-a" }, { schemaVersion: "desktop-account-3", uid: "pilot-b" }]) {
      fixture.call.mockResolvedValueOnce({ data: reply });
      await expect(loadCityHub("pilot-a")).rejects.toThrow("could not be verified");
    }
  });
  it("offline fixtures never authenticate or call the host", async () => {
    fixture.auth.currentUser = null;
    expect(await loadCityHub("offline", CITY_GATHERING_FIXTURE)).toEqual({ roster: CITY_GATHERING_FIXTURE.roster, storyFlags: CITY_GATHERING_FIXTURE.storyFlags });
    expect(fixture.callable).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });
  it("rejects a foreign session before calling and after a delayed response", async () => {
    await expect(meetCityPilots("pilot-b")).rejects.toEqual({ code: "unauthenticated" });
    expect(fixture.call).not.toHaveBeenCalled();
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return { data: CITY_GATHERING_FIXTURE }; });
    await expect(meetCityPilots("pilot-a")).rejects.toEqual({ code: "unauthenticated" });
  });
  it("bounds a stalled read and does not invent roster data", async () => {
    vi.useFakeTimers(); fixture.call.mockReturnValueOnce(new Promise(() => {}));
    const reply = meetCityPilots("pilot-a");
    const assertion = expect(reply).rejects.toThrow("taking too long");
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
  });
  it("retains the caller request id for workshop receipt retries", async () => {
    fixture.call.mockResolvedValue({ data: { schemaVersion: "healing-workshop-1", operation: "craft", itemId: "item.repair_kit", quantity: 1 } });
    await craftCityItem("pilot-a", "item.repair_kit", "retry_123");
    await craftCityItem("pilot-a", "item.repair_kit", "retry_123");
    expect(fixture.call.mock.calls[0]).toEqual(fixture.call.mock.calls[1]);
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "healing-workshop-1", operation: "craft", itemId: "item.repair_kit", requestId: "retry_123" });
  });
  it("heals through the free workshop host and validates its receipt", async () => {
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "healing-workshop-1", operation: "heal", holobotIds: ["ace"], cost: 0 } });
    await healCitySquad("pilot-a", "heal_123");
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "workshopHealHost");
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "healing-workshop-1", operation: "heal", requestId: "heal_123" });
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "healing-workshop-2" } });
    await expect(healCitySquad("pilot-a", "heal_123")).rejects.toThrow("could not be verified");
    for (const invalid of [{ holobotIds: [7], cost: 0 }, { holobotIds: ["ace"], cost: 50 }]) {
      fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "healing-workshop-1", operation: "heal", ...invalid } });
      await expect(healCitySquad("pilot-a", "heal_123")).rejects.toThrow("could not be verified");
    }
  });
  it("settles the admitted battle without resending gathering or reward fields", async () => {
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "rival-battle-3", battleId: "rb_123", didWin: true, alreadyProcessed: false, status: { tier: 0, tierLabel: "Rookie", rivalWins: 1, winsToNextTier: 9 } } });
    const reply = await settleCityRival("pilot-a", "rb_123", true, ["ace"]);
    expect(reply.status.rivalWins).toBe(1);
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "rival-battle-3", operation: "settle", battleId: "rb_123", didWin: true, fielded: ["ace"] });
  });
});
