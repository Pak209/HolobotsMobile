import { afterEach, describe, expect, it, vi } from "vitest";

const firebase = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; data: unknown }>,
  updateDoc: vi.fn(async (..._args: unknown[]) => undefined),
  reply: {} as Record<string, unknown>,
  fail: null as unknown,
}));
vi.mock("@/config/firebase", () => ({
  db: {},
  functions: {},
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  updateDoc: firebase.updateDoc,
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    firebase.calls.push({ name, data });
    if (firebase.fail) throw firebase.fail;
    return { data: firebase.reply };
  },
}));

import { BUSY_REFRESH_INTERVAL_MS, IDLE_REFRESH_BACKOFF_MS, shouldRefreshEnergy } from "../energy";
import { deviceTimeZone, refreshEnergyOnHost } from "../energyClient";
import {
  isUnknownStartOutcome,
  makeStartRequestId,
  startQuestRunAuthoritative,
  startTrainingSessionAuthoritative,
  updateRewardSystemPreferences,
} from "../progressionClient";

afterEach(() => {
  firebase.calls.length = 0;
  firebase.updateDoc.mockClear();
  firebase.fail = null;
});

/**
 * energy-quest-server-1: energy regen is the host's (refreshEnergy); main-app quest / training starts are the host's
 * (startQuestRun / startTrainingSession). The client sends requests only: a zone proposal, never a time or a balance.
 */
describe("refreshEnergy client", () => {
  it("sends only the device zone (never a time, a day or a balance)", async () => {
    firebase.reply = { schemaVersion: "energy-regen-1", changed: true, dailyEnergy: 100, nextResetAt: "2026-10-25T07:00:00.000Z" };
    const reply = await refreshEnergyOnHost("America/Los_Angeles");
    expect(firebase.calls).toEqual([{ name: "refreshEnergy", data: { timeZone: "America/Los_Angeles" } }]);
    expect(reply.dailyEnergy).toBe(100);
    await refreshEnergyOnHost(null);
    expect(firebase.calls[1]).toEqual({ name: "refreshEnergy", data: {} });
    expect(firebase.updateDoc).not.toHaveBeenCalled();
  });

  it("reads the device zone from Intl", () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("shouldRefreshEnergy", () => {
  const base = { force: false, nowMs: 10_000_000, lastCallAtMs: 10_000_000 - BUSY_REFRESH_INTERVAL_MS, lastReplyChanged: true, nextResetAtMs: null, locallyDue: false };
  it("always on mount / first call", () => {
    expect(shouldRefreshEnergy({ ...base, force: true, lastCallAtMs: base.nowMs })).toBe(true);
    expect(shouldRefreshEnergy({ ...base, lastCallAtMs: null })).toBe(true);
  });
  it("at most once a minute otherwise", () => {
    expect(shouldRefreshEnergy({ ...base, locallyDue: true, lastCallAtMs: base.nowMs - 1000 })).toBe(false);
    expect(shouldRefreshEnergy({ ...base, locallyDue: true })).toBe(true);
  });
  it("when the host's nextResetAt passed, even if nothing looks due locally", () => {
    expect(shouldRefreshEnergy({ ...base, nextResetAtMs: base.nowMs })).toBe(true);
    expect(shouldRefreshEnergy({ ...base, nextResetAtMs: base.nowMs + 1 })).toBe(false);
  });
  it("backs off after a no-op reply (device and account zone can disagree)", () => {
    expect(shouldRefreshEnergy({ ...base, locallyDue: true, lastReplyChanged: false })).toBe(false);
    expect(shouldRefreshEnergy({ ...base, locallyDue: true, lastReplyChanged: false, lastCallAtMs: base.nowMs - IDLE_REFRESH_BACKOFF_MS })).toBe(true);
  });
});

describe("main-app starts go to the host", () => {
  it("startQuestRun / startTrainingSession get exactly {id, holobotName, requestId}", async () => {
    firebase.reply = {};
    const requestId = makeStartRequestId(1_700_000_000_000, () => 0.123456789);
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    await startQuestRunAuthoritative({ questId: "forest_patrol", holobotName: "ACE", requestId });
    await startTrainingSessionAuthoritative({ courseId: "attack", holobotName: "ACE", requestId });
    expect(firebase.calls).toEqual([
      { name: "startQuestRun", data: { questId: "forest_patrol", holobotName: "ACE", requestId } },
      { name: "startTrainingSession", data: { courseId: "attack", holobotName: "ACE", requestId } },
    ]);
    expect(firebase.updateDoc).not.toHaveBeenCalled();
  });

  it("a host refusal passes through and settles the request; a network failure keeps it for a replay", async () => {
    firebase.fail = Object.assign(new Error("Not enough energy."), { code: "functions/failed-precondition" });
    const refused = await startQuestRunAuthoritative({ questId: "forest_patrol", holobotName: "ACE", requestId: "ms_test_0001" }).catch((e) => e);
    expect(refused.message).toBe("Not enough energy.");
    expect(isUnknownStartOutcome(refused)).toBe(false);
    firebase.fail = Object.assign(new Error("offline"), { code: "functions/unavailable" });
    const unknown = await startQuestRunAuthoritative({ questId: "forest_patrol", holobotName: "ACE", requestId: "ms_test_0001" }).catch((e) => e);
    expect(unknown.message).toMatch(/needs a connection/);
    expect(isUnknownStartOutcome(unknown)).toBe(true);
  });

  it("board / sync-boost preferences are dotted rewardSystem keys, never the whole map", async () => {
    await updateRewardSystemPreferences("uid-1", { syncBoostEnabled: true, questRefreshesRemaining: undefined });
    expect(firebase.updateDoc).toHaveBeenCalledWith("users/uid-1", { "rewardSystem.syncBoostEnabled": true });
  });
});
