import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_TIERS,
  buildMintUpdates,
  buildRankUpgradeUpdates,
  isMintRefusal,
  isRankUpgradeRefusal,
} from "@/lib/minting";
import type { UserProfile } from "@/types/profile";

import * as server from "../../../../functions/src/lib/mintingEconomy";

const HOLOBOT_PARITY_FIELDS = [
  "attributePoints",
  "boostedAttributes",
  "experience",
  "level",
  "name",
  "nextLevelExp",
  "rank",
] as const;

function pickHolobotFields(holobot: unknown) {
  const source = (holobot ?? {}) as Record<string, unknown>;
  return Object.fromEntries(HOLOBOT_PARITY_FIELDS.map((field) => [field, source[field]]));
}

function playerState() {
  const shared = {
    blueprints: { kuma: 25, shadow: 4, tora: 90 },
    holobots: [{ experience: 500, level: 12, name: "KUMA", nextLevelExp: 16900 }],
  };

  return {
    clientProfile: structuredClone(shared) as unknown as Pick<UserProfile, "blueprints" | "holobots">,
    rawDoc: structuredClone(shared) as Record<string, unknown>,
  };
}

describe("blueprint tier parity", () => {
  it("tier tables match", () => {
    expect(server.BLUEPRINT_TIERS.map((tier) => ({ ...tier }))).toEqual(
      BLUEPRINT_TIERS.map((tier) => ({ ...tier })),
    );
  });
});

describe("minting", () => {
  it("produces identical updates for a valid mint", () => {
    const { clientProfile, rawDoc } = playerState();
    const client = buildMintUpdates(clientProfile, "TORA", "Legendary");
    const srv = server.buildMintUpdates(rawDoc, "TORA", "Legendary");

    expect(isMintRefusal(client)).toBe(false);
    expect(server.isRefusal(srv)).toBe(false);
    if (isMintRefusal(client) || server.isRefusal(srv)) return;

    expect(srv.tierStartLevel).toBe(client.tierStartLevel);
    expect(srv.updates.blueprints).toEqual(client.updates.blueprints);
    expect(srv.updates.holobots.map(pickHolobotFields)).toEqual(
      client.updates.holobots.map(pickHolobotFields),
    );
  });

  it("refuses for the same reasons on both sides", () => {
    const { clientProfile, rawDoc } = playerState();

    for (const [name, tier, reason] of [
      ["SHADOW", "Common", "insufficient-blueprints"],
      ["KUMA", "Champion", "already-owned"],
      ["TORA", "Mythic", "unknown-tier"],
    ] as const) {
      const client = buildMintUpdates(clientProfile, name, tier);
      const srv = server.buildMintUpdates(rawDoc, name, tier);

      expect(isMintRefusal(client) && client.reason).toBe(reason);
      expect(server.isRefusal(srv) && srv.reason).toBe(reason);
    }
  });
});

describe("rank upgrades", () => {
  it("produces identical updates for a valid upgrade", () => {
    const { clientProfile, rawDoc } = playerState();
    const client = buildRankUpgradeUpdates(clientProfile, "KUMA", "Rare");
    const srv = server.buildRankUpgradeUpdates(rawDoc, "KUMA", "Rare");

    expect(isRankUpgradeRefusal(client)).toBe(false);
    expect(server.isRefusal(srv)).toBe(false);
    if (isRankUpgradeRefusal(client) || server.isRefusal(srv)) return;

    expect(srv.updates.blueprints).toEqual(client.updates.blueprints);
    expect(srv.updates.holobots.map(pickHolobotFields)).toEqual(
      client.updates.holobots.map(pickHolobotFields),
    );
    // Upgrade resets to the tier floor with the tier's bonus points.
    const kuma = srv.updates.holobots.map(pickHolobotFields).find((h) => h.name === "KUMA")!;
    expect(kuma.level).toBe(21);
    expect(kuma.experience).toBe(0);
  });

  it("refuses downgrades, unowned targets, and short blueprints identically", () => {
    const { clientProfile, rawDoc } = playerState();

    for (const [name, tier, reason] of [
      ["KUMA", "Champion", "tier-already-reached"], // level 12 >= start 11
      ["TORA", "Rare", "not-owned"],
      ["SHADOW", "Rare", "insufficient-blueprints"],
    ] as const) {
      const client = buildRankUpgradeUpdates(clientProfile, name, tier);
      const srv = server.buildRankUpgradeUpdates(rawDoc, name, tier);

      expect(isRankUpgradeRefusal(client) && client.reason).toBe(reason);
      expect(server.isRefusal(srv) && srv.reason).toBe(reason);
    }
  });
});

describe("energy refill", () => {
  it("consumes one refill and restores to max", () => {
    expect(
      server.buildEnergyRefillUpdates({ dailyEnergy: 5, energyRefills: 2, maxDailyEnergy: 120 }),
    ).toEqual({ dailyEnergy: 120, energyRefills: 1 });
  });

  it("defaults max energy to 100 and refuses with no refills", () => {
    expect(server.buildEnergyRefillUpdates({ dailyEnergy: 5, energyRefills: 1 })).toEqual({
      dailyEnergy: 100,
      energyRefills: 0,
    });
    expect(server.buildEnergyRefillUpdates({ dailyEnergy: 5, energyRefills: 0 })).toBeNull();
  });
});

// The two formerly-dead marketplace items, now server-consumable.
describe("rank skip (server builder)", () => {
  it("jumps to the next tier with rank-up semantics, no blueprint cost", () => {
    const result = server.buildRankSkipRaw(
      {
        rankSkips: 2,
        holobots: [{ name: "ACE", level: 12, rank: "Champion", attributePoints: 4 }],
      },
      "ACE",
    );

    expect(result.refusal).toBeNull();
    if (result.refusal === null) {
      expect(result.nextTierLabel).toBe("Rare");
      const bots = result.updates.holobots as Array<Record<string, unknown>>;
      expect(bots[0].level).toBe(21);
      expect(bots[0].rank).toBe("Rare");
      expect(bots[0].attributePoints).toBe(24);
      expect(result.updates.rankSkips).toBe(1);
    }
  });

  it("refuses at the top rank, when unowned, and without the item", () => {
    expect(
      server.buildRankSkipRaw(
        { rankSkips: 1, holobots: [{ name: "ACE", level: 41, rank: "Legendary" }] },
        "ACE",
      ).refusal,
    ).toBe("already_legendary");
    expect(
      server.buildRankSkipRaw({ rankSkips: 1, holobots: [] }, "ACE").refusal,
    ).toBe("not_owned");
    expect(
      server.buildRankSkipRaw({ holobots: [{ name: "ACE", level: 1 }] }, "ACE").refusal,
    ).toBe("no_item");
  });
});

describe("exp booster (server builder + settlement doubling)", () => {
  it("activates a 24h window and consumes the item", () => {
    const result = server.buildExpBoosterActivationRaw({ expBoosters: 2 }, 1_000_000);

    expect(result.refusal).toBeNull();
    if (result.refusal === null) {
      expect(result.activeUntil).toBe(1_000_000 + 24 * 60 * 60 * 1000);
      expect(result.updates.expBoosters).toBe(1);
      expect(result.updates.expBoosterActiveUntil).toBe(result.activeUntil);
    }
  });

  it("refuses without the item or while one is running", () => {
    expect(server.buildExpBoosterActivationRaw({}, 1_000).refusal).toBe("no_item");
    expect(
      server.buildExpBoosterActivationRaw(
        { expBoosters: 1, expBoosterActiveUntil: 2_000 },
        1_000,
      ).refusal,
    ).toBe("already_active");
  });
});
