import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());

vi.mock("@/config/firebase", () => ({
  functions: {},
  httpsCallable: (_functions: unknown, name: string) => {
    if (name !== "boostHolobotAttribute") return vi.fn();
    return callable;
  },
}));

import { boostHolobotAttributeAuthoritative, makeAttributeBoostRequestId } from "@/lib/progressionClient";

const holobot = { experience: 0, level: 2, name: "ACE", nextLevelExp: 900, attributePoints: 0, boostedAttributes: { attack: 1 } };

describe("boostHolobotAttributeAuthoritative (DECISIONS #53-2)", () => {
  beforeEach(() => callable.mockReset());

  it("sends {holobotName, attribute, requestId} and returns the authoritative holobot", async () => {
    callable.mockResolvedValueOnce({ data: { applied: true, holobot } });
    const result = await boostHolobotAttributeAuthoritative("ACE", "attack", "boost_test_1");
    expect(callable).toHaveBeenCalledWith({ attribute: "attack", holobotName: "ACE", requestId: "boost_test_1" });
    expect(result).toEqual({ applied: true, holobot });
  });

  it("generates a server-valid request id per call", async () => {
    callable.mockResolvedValue({ data: { applied: true, holobot } });
    await boostHolobotAttributeAuthoritative("ACE", "health");
    await boostHolobotAttributeAuthoritative("ACE", "health");
    const [first, second] = callable.mock.calls.map((call) => (call[0] as { requestId: string }).requestId);
    expect(first).not.toBe(second);
    for (let i = 0; i < 50; i += 1) {
      expect(makeAttributeBoostRequestId()).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    }
  });

  it("a replayed request id resolves without an error", async () => {
    callable.mockResolvedValueOnce({ data: { applied: false, holobot, reason: "already_processed" } });
    await expect(boostHolobotAttributeAuthoritative("ACE", "speed", "dup")).resolves.toMatchObject({ applied: false });
  });

  it("typed refusals surface as readable errors", async () => {
    callable.mockResolvedValueOnce({ data: { applied: false, holobot, reason: "no_attribute_points" } });
    await expect(boostHolobotAttributeAuthoritative("ACE", "defense")).rejects.toThrow(/no attribute points/);
  });

  it("availability failures become the needs-a-connection message; server rejections pass through", async () => {
    callable.mockRejectedValueOnce({ code: "functions/unavailable" });
    await expect(boostHolobotAttributeAuthoritative("ACE", "attack")).rejects.toThrow(/needs a connection/);
    const rejection = { code: "functions/failed-precondition", details: { rejectionCode: "not_owned" } };
    callable.mockRejectedValueOnce(rejection);
    await expect(boostHolobotAttributeAuthoritative("WOLF", "attack")).rejects.toBe(rejection);
  });
});
