import { describe, expect, it } from "vitest";

import {
  ARENA_TIERS,
  buildArenaEntryUpdates,
  buildArenaSettlementUpdates,
  computeArenaSettlement,
  getArenaBaseRewards,
  getArenaBlueprintAmount,
  type ArenaSettlementInput,
  type ArenaTierId,
} from "@/lib/arenaEconomy";
import { ArenaCombatEngine } from "@/features/arena/combatEngine";
import type { BattleState } from "@/types/arena";

import * as serverArena from "../../../../functions/src/lib/arenaEconomy";

const NOW = new Date("2026-07-07T18:00:00.000Z");

const SETTLEMENT_CASES: ArenaSettlementInput[] = [
  { combosCompleted: 0, didWin: true, opponentName: "HARE", perfectDefenses: 0, tierId: "rookie" },
  { combosCompleted: 3, didWin: true, opponentName: "KUMA", perfectDefenses: 2, tierId: "challenger" },
  { combosCompleted: 1, didWin: false, opponentName: "TORA", perfectDefenses: 4, tierId: "elite" },
  { combosCompleted: 9, didWin: true, opponentName: "ERA", perfectDefenses: 7, tierId: "legend" },
  // Off-pool opponent: no blueprints even on a win.
  { combosCompleted: 2, didWin: true, opponentName: "ACE", perfectDefenses: 1, tierId: "rookie" },
  // Absurd counts get clamped.
  { combosCompleted: 9999, didWin: true, opponentName: "WAKE", perfectDefenses: 9999, tierId: "rookie" },
];

function playerState() {
  const shared = {
    blueprints: { hare: 5 },
    holobots: [
      { experience: 500, level: 2, name: "ACE", nextLevelExp: 900 },
      { experience: 0, level: 1, name: "KUMA", nextLevelExp: 400 },
    ],
    holosTokens: 1_000,
    rewardSystem: { lastDailyMissionReset: "2026-07-07", arenaBattlesToday: 1, boosterPacksToday: 0, missionClaims: {} },
    syncPoints: 400,
  };

  return {
    clientProfile: { ...shared, arena_passes: 2, stats: { losses: 4, wins: 9 } },
    rawDoc: { ...shared, arenaPassses: 2, losses: 4, wins: 9 },
  };
}

const HOLOBOT_PARITY_FIELDS = ["attributePoints", "experience", "level", "name", "nextLevelExp", "rank"] as const;

function pickHolobotFields(holobot: unknown) {
  const source = (holobot ?? {}) as Record<string, unknown>;
  return Object.fromEntries(HOLOBOT_PARITY_FIELDS.map((field) => [field, source[field]]));
}

describe("arena tier table parity", () => {
  it("economy fields match for every tier", () => {
    expect(
      serverArena.ARENA_TIERS.map(({ entryFeeHolos, id, opponentLevel, opponentPool }) => ({
        entryFeeHolos,
        id,
        opponentLevel,
        opponentPool,
      })),
    ).toEqual(
      ARENA_TIERS.map(({ entryFeeHolos, id, opponentLevel, opponentPool }) => ({
        entryFeeHolos,
        id,
        opponentLevel,
        opponentPool,
      })),
    );
  });

  it("base rewards and blueprint amounts match", () => {
    for (const tier of ARENA_TIERS) {
      expect(serverArena.getArenaBaseRewards(tier)).toEqual(getArenaBaseRewards(tier));
      expect(serverArena.getArenaBlueprintAmount(tier)).toBe(getArenaBlueprintAmount(tier));
    }
  });
});

describe("settlement parity", () => {
  it("client and server settlements match on every case", () => {
    for (const input of SETTLEMENT_CASES) {
      expect(serverArena.computeArenaSettlement(input)).toEqual(computeArenaSettlement(input));
    }
    expect(serverArena.computeArenaSettlement({ ...SETTLEMENT_CASES[0], tierId: "nope" as ArenaTierId })).toBeNull();
  });

  it("replicates ArenaCombatEngine.calculateActualRewards from performance counts", () => {
    for (const input of SETTLEMENT_CASES.slice(0, 5)) {
      const tier = ARENA_TIERS.find((candidate) => candidate.id === input.tierId)!;
      const base = getArenaBaseRewards(tier);
      const opponentInPool = tier.opponentPool.includes(input.opponentName);

      // Synthetic battle state carrying the same information the engine uses.
      const state = {
        actionHistory: [
          ...Array.from({ length: input.perfectDefenses }, () => ({ perfectDefense: true })),
          ...Array.from({ length: input.combosCompleted }, () => ({ triggeredCombo: true })),
        ],
        player: { holobotId: "player-1" },
        potentialRewards: {
          exp: base.exp,
          holos: base.holos,
          syncPoints: base.syncPoints,
          blueprintRewards: opponentInPool
            ? [{ amount: getArenaBlueprintAmount(tier), holobotKey: input.opponentName.toLowerCase() }]
            : undefined,
        },
      } as unknown as BattleState;

      const engine = ArenaCombatEngine.calculateActualRewards(
        state,
        input.didWin ? "player-1" : "opponent-1",
      );
      const settlement = computeArenaSettlement(input)!;

      expect(settlement.exp).toBe(engine.exp);
      expect(settlement.syncPoints).toBe(engine.syncPoints);
      expect(settlement.holos).toBe(engine.holos || 0);
      expect(settlement.blueprints).toEqual(
        input.didWin && engine.blueprintRewards?.length
          ? { amount: engine.blueprintRewards[0].amount, holobotKey: engine.blueprintRewards[0].holobotKey }
          : null,
      );
    }
  });
});

describe("entry charge parity", () => {
  it("token and pass charges match through the raw translation", () => {
    const { clientProfile, rawDoc } = playerState();

    for (const tier of ARENA_TIERS) {
      expect(serverArena.buildArenaEntryUpdatesRaw(rawDoc, tier.id, "tokens")).toEqual(
        buildArenaEntryUpdates(clientProfile as never, tier.id, "tokens"),
      );
    }
    expect(serverArena.buildArenaEntryUpdatesRaw(rawDoc, "rookie", "pass")).toEqual(
      buildArenaEntryUpdates(clientProfile as never, "rookie", "pass"),
    );
  });

  it("both sides refuse unaffordable entries and unknown tiers", () => {
    const { clientProfile, rawDoc } = playerState();
    (clientProfile as Record<string, unknown>).holosTokens = 10;
    (rawDoc as Record<string, unknown>).holosTokens = 10;
    (clientProfile as Record<string, unknown>).arena_passes = 0;
    (rawDoc as Record<string, unknown>).arenaPassses = 0;

    expect(buildArenaEntryUpdates(clientProfile as never, "rookie", "tokens")).toBeNull();
    expect(serverArena.buildArenaEntryUpdatesRaw(rawDoc, "rookie", "tokens")).toBeNull();
    expect(buildArenaEntryUpdates(clientProfile as never, "rookie", "pass")).toBeNull();
    expect(serverArena.buildArenaEntryUpdatesRaw(rawDoc, "rookie", "pass")).toBeNull();
    expect(buildArenaEntryUpdates(clientProfile as never, "bogus", "tokens")).toBeNull();
    expect(serverArena.buildArenaEntryUpdatesRaw(rawDoc, "bogus", "tokens")).toBeNull();
  });
});

describe("settlement write parity", () => {
  it("produces identical document updates for wins and losses", () => {
    for (const input of SETTLEMENT_CASES) {
      const { clientProfile, rawDoc } = playerState();
      const client = buildArenaSettlementUpdates(clientProfile as never, "ACE", input, NOW);
      const server = serverArena.buildArenaSettlementUpdatesRaw(rawDoc, "ACE", input, NOW);

      expect(client).not.toBeNull();
      expect(server).not.toBeNull();
      expect(server!.settlement).toEqual(client!.settlement);

      const { holobots: clientHolobots, ...clientRest } = client!.updates;
      const { holobots: serverHolobots, ...serverRest } = server!.updates;

      expect(serverRest).toEqual(clientRest);
      expect((serverHolobots as unknown[]).map(pickHolobotFields)).toEqual(
        (clientHolobots as unknown[]).map(pickHolobotFields),
      );
    }
  });
});

describe("exp booster doubling in settlements", () => {
  it("doubles EXP while the window is active, both sides identically", () => {
    const input = {
      combosCompleted: 0,
      didWin: true,
      opponentName: "HARE",
      perfectDefenses: 0,
      tierId: "rookie" as const,
    };
    const holobots = [{ name: "ACE", level: 10, experience: 0, nextLevelExp: 1000, rank: "Champion" }];
    const NOW_MS = NOW.getTime();

    const base = buildArenaSettlementUpdates(
      { holobots, stats: { wins: 0, losses: 0 } } as never,
      "ACE",
      input,
      NOW,
    );
    const boosted = buildArenaSettlementUpdates(
      { holobots, stats: { wins: 0, losses: 0 }, expBoosterActiveUntil: NOW_MS + 1000 } as never,
      "ACE",
      input,
      NOW,
    );
    const boostedRaw = serverArena.buildArenaSettlementUpdatesRaw(
      { holobots, expBoosterActiveUntil: NOW_MS + 1000 },
      "ACE",
      input,
      NOW,
    );
    const expired = buildArenaSettlementUpdates(
      { holobots, stats: { wins: 0, losses: 0 }, expBoosterActiveUntil: NOW_MS - 1000 } as never,
      "ACE",
      input,
      NOW,
    );

    const expOf = (updates: Record<string, unknown>) =>
      (updates.holobots as Array<{ experience: number }>)[0].experience;

    expect(expOf(boosted!.updates)).toBe(expOf(base!.updates) * 2);
    expect(expOf(boostedRaw!.updates)).toBe(expOf(boosted!.updates));
    expect(expOf(expired!.updates)).toBe(expOf(base!.updates));
  });
});
