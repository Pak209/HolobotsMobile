import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: "pilot-a" } as { uid: string } | null }, call: vi.fn(), callable: vi.fn() }));
vi.mock("@/config/firebase", () => ({ auth: fixture.auth, functions: {}, httpsCallable: (...args: unknown[]) => { fixture.callable(...args); return fixture.call; } }));
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cityHubClient from "../cityHubClient";
import { readHostLevelAccount, loadCityHub, meetCityPilots, issueCityRival, craftCityItem, healCitySquad, CITY_LIVE_DUEL_HOLD, CITY_LIVE_DUELS_HELD, cityChallengeEnabled } from "../cityHubClient";
import { CITY_GATHERING_FIXTURE } from "../cityHubFixtures";
describe("live citizen duel hold (L11)", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  it("closes every live Challenge CTA while held; the offline preview keeps its fixture duel", () => {
    expect(CITY_LIVE_DUELS_HELD).toBe(true);
    expect(cityChallengeEnabled(false)).toBe(false);
    expect(cityChallengeEnabled(true)).toBe(true);
    expect(cityChallengeEnabled(false, false)).toBe(true);
  });
  it("keeps the CTA closed exactly while issueCityRival refuses: one switch for both", async () => {
    fixture.call.mockResolvedValue({ data: {} });
    const refuses = await issueCityRival("pilot-a", CITY_GATHERING_FIXTURE.roster[0])
      .then(() => false, (error) => error instanceof Error && error.message === CITY_LIVE_DUEL_HOLD);
    expect(cityChallengeEnabled(false)).toBe(!refuses);
    fixture.call.mockReset();
  });
  it("wires both hub Challenge CTAs to the hold: pins open the roster panel, rows are disabled", () => {
    const hub = readFileSync(fileURLToPath(new URL("../../screens/EnabledCityHubScreen.tsx", import.meta.url) as unknown as string), "utf8");
    expect(hub).toContain("const challengeOpen = cityChallengeEnabled(!!fixture);");
    // Both CTAs (map pins, roster rows) go through pickRival, which never opens a duel while held.
    expect(hub.match(/onPress=\{\(\) => pickRival\(rival\)\}/g)).toHaveLength(2);
    expect(hub).toMatch(/function pickRival\(rival: ArenaCitizen\) \{\s*\/\/[^\n]*\n\s*if \(!challengeOpen\) \{ setPanel\("rivals"\); return; \}/);
    expect(hub).toMatch(/disabled=\{!challengeOpen \|\| !!cooldowns\[rival\.citizenId\]\}/);
  });
  it("F8: has no client-decided settle; live duels can only settle through the City's resolver", () => {
    expect("settleCityRival" in cityHubClient).toBe(false);
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");
    // No City request carries didWin (as `didWin: x` or shorthand `{ …, didWin, … }`); the pre-F8 client had two.
    expect(read("../cityHubClient.ts")).not.toMatch(/settleCityRival\(|\bdidWin\s*:|[{,]\s*didWin\s*[,}]/);
    // The battle screen settles only its offline preview: it imports no settle call at all.
    expect(read("../../components/city/CityRivalBattle.tsx")).not.toMatch(/import[^;]*settleCity|settleCity\w*\(/);
  });
});

describe("city authenticated host actions", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  afterEach(() => vi.useRealTimers());
  it("reads only a verified host level account and rejects stale sessions", async () => {
    const account = { schemaVersion: "desktop-account-3", uid: "pilot-a", holobots: [{ name: "ACE", level: 12 }] };
    fixture.call.mockResolvedValueOnce({ data: account });
    expect(await readHostLevelAccount("pilot-a")).toEqual(account);
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "desktopAccountSnapshot");
    fixture.call.mockResolvedValueOnce({ data: { ...account, uid: "pilot-b" } });
    await expect(readHostLevelAccount("pilot-a")).rejects.toThrow("could not be verified");
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return { data: account }; });
    await expect(readHostLevelAccount("pilot-a")).rejects.toEqual({ code: "unauthenticated" });
  });
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
});

import { settleCityResolver } from '../cityHubClient';
import receiptFixture from '../../qa/fixtures/duel-receipt-1.json';
const resolverIssue = { schemaVersion: 'rival-battle-3', battleId: 'rb_0123456789abcdef01234567', duel: { mode: 'resolver', schemaVersion: 'duel-receipt-1', maxRounds: 120, player: receiptFixture.input.player, opponent: receiptFixture.input.opponent } };
const resolverReply = { schemaVersion: 'rival-battle-3', battleId: resolverIssue.battleId, didWin: true, alreadyProcessed: false, holosGranted: 100, status: { tier: 0, tierLabel: 'Rookie', rivalWins: 1, winsToNextTier: 9 }, duelReceipt: receiptFixture.receipt };
describe('live resolver settlement transport', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: 'pilot-a' }; });
  it('sends only pinned battle and intent plan, preserves receipt for playback/replay', async () => {
    fixture.call.mockResolvedValue({ data: resolverReply });
    const result = await settleCityResolver('pilot-a', resolverIssue, ['strike', 'defend']);
    expect(result.duelReceipt).toEqual(receiptFixture.receipt);
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: 'rival-battle-3', operation: 'settle', battleId: resolverIssue.battleId, playerIntents: ['strike', 'defend'] });
    await settleCityResolver('pilot-a', resolverIssue, ['strike', 'defend']);
    expect(fixture.call.mock.calls[1]).toEqual(fixture.call.mock.calls[0]);
  });
  it('rejects legacy/unknown mode and empty/invalid/overlong plans before network', async () => {
    for (const duel of [{ mode: 'legacy' }, { mode: 'future' }]) await expect(settleCityResolver('pilot-a', { ...resolverIssue, duel }, ['strike'])).rejects.toThrow();
    for (const plan of [[], ['tampered'], Array(121).fill('strike')]) await expect(settleCityResolver('pilot-a', resolverIssue, plan as ['strike'])).rejects.toThrow();
    expect(fixture.call).not.toHaveBeenCalled();
  });
  it('rejects missing receipt, foreign session and delayed response after account change', async () => {
    fixture.call.mockResolvedValueOnce({ data: { ...resolverReply, duelReceipt: undefined } });
    await expect(settleCityResolver('pilot-a', resolverIssue, ['strike'])).rejects.toThrow();
    await expect(settleCityResolver('pilot-b', resolverIssue, ['strike'])).rejects.toEqual({ code: 'unauthenticated' });
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: 'pilot-b' }; return { data: resolverReply }; });
    await expect(settleCityResolver('pilot-a', resolverIssue, ['strike'])).rejects.toEqual({ code: 'unauthenticated' });
  });
});
