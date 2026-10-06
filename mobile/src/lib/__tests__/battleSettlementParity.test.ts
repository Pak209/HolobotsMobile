import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARENA_TIERS,
  computeArenaSettlement,
  getArenaBaseRewards,
  type ArenaSettlementInput,
  type ArenaTierId,
} from "@/lib/arenaEconomy";
import * as client from "@/lib/battleSettlement";

import * as serverArena from "../../../../functions/src/lib/arenaEconomy";
import * as server from "../../../../functions/src/lib/battleSettlement";

/**
 * DECISIONS #53-1: one battle XP table. The client and server copies of
 * battleSettlement.ts are byte-identical, and the arena settlement still
 * produces exactly the numbers of the pre-extraction formula (kept below,
 * verbatim from arenaEconomy.ts before 2026-10-06, as the reference).
 */

// ---- Pre-extraction reference (verbatim copy of the 2026-10-05 arena math) ----
const LEGACY_MAX_PERFORMANCE_EVENTS = 25;

function legacyGetArenaBaseRewards(tier: { id: string; entryFeeHolos: number }) {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  const multiplier = 1 + Math.max(0, tierIndex) * 0.45;

  return {
    exp: Math.floor(95 * multiplier),
    holos: tier.entryFeeHolos * 2,
    syncPoints: Math.floor(35 * multiplier),
  };
}

function legacyComputeArenaSettlement(input: ArenaSettlementInput) {
  const tier = ARENA_TIERS.find((candidate) => candidate.id === input.tierId) ?? null;
  if (!tier) {
    return null;
  }

  const base = legacyGetArenaBaseRewards(tier);

  if (!input.didWin) {
    return {
      blueprints: null,
      exp: Math.floor(base.exp * 0.3),
      holos: 0,
      syncPoints: Math.floor(base.syncPoints * 0.2),
    };
  }

  const perfectDefenses = Math.min(
    LEGACY_MAX_PERFORMANCE_EVENTS,
    Math.max(0, Math.floor(input.perfectDefenses || 0)),
  );
  const combos = Math.min(LEGACY_MAX_PERFORMANCE_EVENTS, Math.max(0, Math.floor(input.combosCompleted || 0)));
  const performanceBonus = 1 + perfectDefenses * 0.05 + combos * 0.1;
  const normalizedOpponent = input.opponentName?.trim().toUpperCase() ?? "";
  const acceptedPool =
    tier.id === "rookie" ? [...tier.opponentPool, "KUMA", "SHADOW"] : [...tier.opponentPool];
  const opponentInPool = acceptedPool.includes(normalizedOpponent);

  return {
    blueprints: opponentInPool
      ? { amount: [5, 10, 15, 20][Math.max(0, ARENA_TIERS.indexOf(tier))] ?? 5, holobotKey: normalizedOpponent.toLowerCase() }
      : null,
    exp: Math.floor(base.exp * performanceBonus),
    holos: base.holos,
    syncPoints: Math.floor(base.syncPoints * performanceBonus),
  };
}
// -------------------------------------------------------------------------------

const COUNTS = [0, 1, 2, 3, 4.7, 7, 9, 12, 24, 25, 26, 40, 9999, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const OPPONENTS = ["HARE", "WAKE", "GAMA", "KUMA", "SHADOW", "TSUIN", "TORA", "KEN", "KURAI", "ACE", "WOLF", "ERA", " hare ", "", "NOPE"];

function arenaGrid(): ArenaSettlementInput[] {
  const cases: ArenaSettlementInput[] = [];
  for (const tier of ARENA_TIERS) {
    for (const didWin of [true, false]) {
      for (const perfectDefenses of COUNTS) {
        for (const combosCompleted of COUNTS) {
          for (const opponentName of didWin ? OPPONENTS : ["HARE"]) {
            cases.push({ combosCompleted, didWin, opponentName, perfectDefenses, tierId: tier.id });
          }
        }
      }
    }
  }
  return cases;
}

describe("battleSettlement byte-identical pair", () => {
  it("mobile and functions copies are byte-identical", () => {
    const mobileCopy = readFileSync(path.resolve(__dirname, "../battleSettlement.ts"), "utf8");
    const functionsCopy = readFileSync(
      path.resolve(__dirname, "../../../../functions/src/lib/battleSettlement.ts"),
      "utf8",
    );
    expect(functionsCopy).toBe(mobileCopy);
  });

  it("client and server agree for every kind, tier, outcome and count", () => {
    for (const kind of client.BATTLE_KINDS) {
      for (let tier = -2; tier <= 20; tier += 1) {
        for (const didWin of [true, false]) {
          for (const perfectDefenses of COUNTS) {
            for (const combosCompleted of [0, 3, 25, 9999, Number.NaN]) {
              const input = { combosCompleted, didWin, kind, perfectDefenses, tier };
              expect(server.computeBattleSettlement(input)).toEqual(client.computeBattleSettlement(input));
            }
          }
        }
      }
    }
  });
});

describe("one table for every battle kind (DECISIONS #53-1)", () => {
  it("published numbers: win 95/137/180/223, loss 28/41/54/66 at tiers 0-3", () => {
    const wins = [0, 1, 2, 3].map((tier) => client.computeBattleSettlement({ didWin: true, kind: "rival", tier })!.exp);
    const losses = [0, 1, 2, 3].map((tier) => client.computeBattleSettlement({ didWin: false, kind: "rival", tier })!.exp);
    expect(wins).toEqual([95, 137, 180, 223]);
    expect(losses).toEqual([28, 41, 54, 66]);
    // Rival tiers keep climbing past the arena's four.
    expect(client.computeBattleSettlement({ didWin: true, kind: "rival", tier: 9 })!.exp).toBe(479);
  });

  it("kind never changes the numbers", () => {
    for (let tier = 0; tier <= 12; tier += 1) {
      for (const didWin of [true, false]) {
        const [arena, rival, beast] = client.BATTLE_KINDS.map((kind) => {
          const { kind: _kind, ...numbers } = client.computeBattleSettlement({
            combosCompleted: 2,
            didWin,
            kind,
            perfectDefenses: 3,
            tier,
          })!;
          return numbers;
        });
        expect(rival).toEqual(arena);
        expect(beast).toEqual(arena);
      }
    }
  });

  it("unknown kinds are refused; bad tiers read as tier 0", () => {
    expect(client.computeBattleSettlement({ didWin: true, kind: "pvp" as never, tier: 1 })).toBeNull();
    expect(server.computeBattleSettlement({ didWin: true, kind: "pvp" as never, tier: 1 })).toBeNull();
    for (const tier of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(client.computeBattleSettlement({ didWin: true, kind: "beast", tier })!.exp).toBe(95);
    }
    expect(client.computeBattleSettlement({ didWin: true, kind: "beast", tier: 2.9 })!.exp).toBe(180);
  });

  it("EXP Booster doubles only while the window is open", () => {
    const now = 1_800_000_000_000;
    expect(client.applyExpBooster(137, now + 1, now)).toBe(274);
    expect(client.applyExpBooster(137, now, now)).toBe(137);
    expect(client.applyExpBooster(137, undefined, now)).toBe(137);
    expect(server.applyExpBooster(137, now + 1, now)).toBe(274);
  });
});

describe("arena settlement unchanged by the extraction", () => {
  it("client and server computeArenaSettlement equal the pre-extraction formula on the whole grid", () => {
    const grid = arenaGrid();
    expect(grid.length).toBeGreaterThan(5000);
    for (const input of grid) {
      const legacy = legacyComputeArenaSettlement(input);
      expect(computeArenaSettlement(input)).toEqual(legacy);
      expect(serverArena.computeArenaSettlement(input)).toEqual(legacy);
    }
    const bogus = { ...grid[0], tierId: "bogus" as ArenaTierId };
    expect(computeArenaSettlement(bogus)).toBeNull();
    expect(serverArena.computeArenaSettlement(bogus)).toBeNull();
  });

  it("base rewards equal the pre-extraction formula for every tier and an unknown tier", () => {
    for (const tier of [...ARENA_TIERS, { entryFeeHolos: 70, id: "nope" as ArenaTierId }]) {
      expect(getArenaBaseRewards(tier)).toEqual(legacyGetArenaBaseRewards(tier));
      expect(serverArena.getArenaBaseRewards(tier)).toEqual(legacyGetArenaBaseRewards(tier));
    }
  });
});
