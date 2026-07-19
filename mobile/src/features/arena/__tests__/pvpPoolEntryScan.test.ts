import { describe, expect, it, vi } from "vitest";

// Only the react-native leaf is stubbed (Flow syntax breaks vitest); the
// battle-stats logic is re-exported REAL from its pure home so this scan
// exercises the actual buildPlayerFighter → buildPvpFighterDoc path.
vi.mock("@/config/holobots", async () => {
  const progression = await vi.importActual<typeof import("@/lib/progression")>("@/lib/progression");
  return {
    getHolobotBattleStats: progression.getHolobotBattleStats,
    getHolobotFullImageSource: () => "test://avatar",
  };
});

import { buildPvpFighterDoc } from "@/features/arena/pvpBattle";

function findUndefinedPaths(value: unknown, path: string, found: string[]): void {
  if (value === undefined) {
    found.push(path || "<root>");
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUndefinedPaths(item, `${path}[${index}]`, found));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    findUndefinedPaths(child, path ? `${path}.${key}` : key, found);
  }
}

describe("pvp pool entry payload", () => {
  // Regression: the stock finisher template carried an explicit
  // `battleTier: undefined` key, and Firestore rejects setDoc payloads
  // containing undefined anywhere — quick match failed for every fresh
  // account. The fighter doc must serialize clean for a bare profile.
  it("contains no undefined values for a fresh low-level profile", () => {
    const fighter = buildPvpFighterDoc(
      "testuid123",
      "Pilot",
      { name: "ACE", level: 2, experience: 10, nextLevelExp: 200 } as never,
      {} as never,
    );

    const found: string[] = [];
    findUndefinedPaths(fighter, "fighter", found);
    expect(found).toEqual([]);
  });
});
