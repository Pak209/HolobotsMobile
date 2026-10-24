import { describe, expect, it } from "vitest";
import { readSyncReadiness, readinessDisplayValue, readinessResultCopy } from "@/lib/readiness";

describe("read-only SYNC readiness presentation", () => {
  it("projects 20 percent of remaining each day from a host entry", () => {
    const atMs = 1_782_259_200_000;
    const entry = { milli: 100_000, atMs };
    expect(readinessDisplayValue(entry, atMs)).toBe(100);
    expect(readinessDisplayValue(entry, atMs + 86_400_000)).toBe(80);
    expect(readinessDisplayValue(entry, atMs + 2 * 86_400_000)).toBe(64);
  });

  it("rejects malformed profile data rather than presenting forged bars", () => {
    expect(readSyncReadiness({ ACE: { milli: 80_000, atMs: 1 } })?.ACE.milli).toBe(80_000);
    expect(readSyncReadiness({ ACE: { milli: 200_000, atMs: 1 } })).toBeNull();
    expect(readSyncReadiness({ ace: { milli: 80_000, atMs: 1 } })).toBeNull();
  });

  it("labels host award, inactive host and offline retry distinctly", () => {
    expect(readinessResultCopy({ holobotName: "ACE", before: 0, gained: 100, after: 100 }, true)).toContain("+100 SYNC READINESS → ACE");
    expect(readinessResultCopy(undefined, true)).toContain("not active");
    expect(readinessResultCopy(null, false)).toContain("connection");
  });
});
