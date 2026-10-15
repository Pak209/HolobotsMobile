import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: "pilot-a" } as { uid: string } | null }, call: vi.fn(), callable: vi.fn() }));
vi.mock("@/config/firebase", () => ({ auth: fixture.auth, functions: {}, httpsCallable: (...args: unknown[]) => { fixture.callable(...args); return fixture.call; } }));
import { meetCityPilots, issueCityRival, settleCityRival, craftCityItem, healCitySquad } from "../cityHubClient";
import { CITY_GATHERING_FIXTURE } from "../cityHubFixtures";
describe("city authenticated host actions", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  afterEach(() => vi.useRealTimers());
  it("calls the exact #80 gathering and citizen admission contracts", async () => {
    fixture.call.mockResolvedValueOnce({ data: CITY_GATHERING_FIXTURE });
    expect((await meetCityPilots("pilot-a")).roster).toHaveLength(8);
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "arenaGatheringHost");
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "arena-gathering-1" });
    fixture.call.mockResolvedValueOnce({ data: { battleId: "test" } });
    await issueCityRival("pilot-a", CITY_GATHERING_FIXTURE.roster[0]);
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "rival-battle-3", operation: "issue", storySchema: "arena-gathering-1", rivalId: "CV1_HB_CITIZEN3_StallLinen_13" });
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
