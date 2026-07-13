import { describe, expect, it } from "vitest";

import {
  buildWildcardAssignUpdates,
  deriveReferralCode,
  EXTRA_REFERRAL_WILDCARDS,
  REFERRAL_MILESTONE_GACHA_TICKETS,
  REFERRAL_MILESTONE_QUALIFIED,
  GENESIS_BOTS,
  GENESIS_REFERRALS_REQUIRED,
  REFERRAL_CODE_LENGTH,
  REFERRAL_WELCOME_HOLOS,
  REFERRAL_WELCOME_WILDCARDS,
} from "@/lib/genesis";
import {
  ARENA_TIERS,
  computeArenaSettlement,
  getTierOpponentPool,
  ROOKIE_ROTATION,
} from "@/lib/arenaEconomy";

import * as serverReferrals from "../../../../functions/src/lib/referrals";
import * as serverMinting from "../../../../functions/src/lib/mintingEconomy";
import * as serverEconomy from "../../../../functions/src/lib/economy";
import { buildPackGrantUpdates, buildPackRewards, LEGENDARY_BLUEPRINT_DROP_CHANCE } from "@/lib/gacha";
import * as serverArena from "../../../../functions/src/lib/arenaEconomy";

describe("genesis client/server parity", () => {
  it("constants match", () => {
    expect(serverReferrals.GENESIS_REFERRALS_REQUIRED).toBe(GENESIS_REFERRALS_REQUIRED);
    expect(serverReferrals.EXTRA_REFERRAL_WILDCARDS).toBe(EXTRA_REFERRAL_WILDCARDS);
    expect(serverReferrals.REFERRAL_WELCOME_WILDCARDS).toBe(REFERRAL_WELCOME_WILDCARDS);
    expect(serverReferrals.REFERRAL_WELCOME_HOLOS).toBe(REFERRAL_WELCOME_HOLOS);
    expect(serverReferrals.REFERRAL_CODE_LENGTH).toBe(REFERRAL_CODE_LENGTH);
    expect([...serverReferrals.GENESIS_BOTS]).toEqual([...GENESIS_BOTS]);
  });

  it("referral codes derive identically and are self-verifying", () => {
    for (const uid of ["abc123XYZ", "Zx9qLmPill", "a1b2c3"]) {
      const code = deriveReferralCode(uid);
      expect(serverReferrals.deriveReferralCode(uid)).toBe(code);
      expect(code).toBe(uid.slice(0, REFERRAL_CODE_LENGTH).toUpperCase());
    }
  });

  it("wildcard assignment produces identical updates on both sides", () => {
    const state = { blueprints: { kuma: 3 }, wildcardBlueprints: 7 };

    const client = buildWildcardAssignUpdates(state, "KUMA", 4);
    const server = serverReferrals.buildWildcardAssignRaw(state, "KUMA", 4);

    expect(client).toEqual({ blueprints: { kuma: 7 }, wildcardBlueprints: 3 });
    expect(server!.updates).toEqual(client);
  });

  it("both sides reject over-assignment and non-positive amounts", () => {
    const state = { blueprints: {}, wildcardBlueprints: 2 };

    expect(buildWildcardAssignUpdates(state, "ACE", 3)).toBeNull();
    expect(serverReferrals.buildWildcardAssignRaw(state, "ACE", 3)).toBeNull();
    expect(buildWildcardAssignUpdates(state, "ACE", 0)).toBeNull();
    expect(serverReferrals.buildWildcardAssignRaw(state, "ACE", 0)).toBeNull();
    expect(buildWildcardAssignUpdates(state, "ACE", -1)).toBeNull();
    expect(serverReferrals.buildWildcardAssignRaw(state, "ACE", -1)).toBeNull();
  });
});

describe("genesis squad grant (server builder)", () => {
  it("mints missing Genesis bots with the celebration pack and badge", () => {
    const grant = serverReferrals.buildGenesisSquadGrantRaw(
      { holobots: [], holosTokens: 100, syncPoints: 10 },
      "referral",
    );

    expect(grant!.granted).toEqual(["KUMA", "SHADOW"]);
    expect(grant!.converted).toEqual([]);
    expect(grant!.updates.holosTokens).toBe(100 + serverReferrals.GENESIS_PACK_HOLOS);
    expect(grant!.updates.syncPoints).toBe(10 + serverReferrals.GENESIS_PACK_SYNC_POINTS);
    expect(grant!.updates.genesisBadge).toBe(true);
    expect(grant!.updates.genesisSquadClaimed).toBe("referral");

    const holobots = grant!.updates.holobots as Array<Record<string, unknown>>;
    expect(holobots.map((bot) => bot.name)).toEqual(["KUMA", "SHADOW"]);
    expect(holobots.every((bot) => bot.level === 1)).toBe(true);
  });

  it("converts already-owned Genesis bots to blueprints instead", () => {
    const grant = serverReferrals.buildGenesisSquadGrantRaw(
      {
        blueprints: { kuma: 5 },
        holobots: [{ name: "KUMA", level: 12 }],
        holosTokens: 0,
      },
      "purchase",
    );

    expect(grant!.granted).toEqual(["SHADOW"]);
    expect(grant!.converted).toEqual([
      { name: "KUMA", blueprints: serverReferrals.GENESIS_DUPLICATE_BLUEPRINTS },
    ]);
    expect((grant!.updates.blueprints as Record<string, number>).kuma).toBe(
      5 + serverReferrals.GENESIS_DUPLICATE_BLUEPRINTS,
    );
    expect(grant!.updates.genesisSquadClaimed).toBe("purchase");
    // The owned KUMA keeps its progress — only SHADOW is appended.
    const holobots = grant!.updates.holobots as Array<Record<string, unknown>>;
    expect(holobots.map((bot) => bot.name)).toEqual(["KUMA", "SHADOW"]);
    expect(holobots[0].level).toBe(12);
  });

  it("is one-shot: an already-claimed account gets nothing", () => {
    expect(
      serverReferrals.buildGenesisSquadGrantRaw({ genesisSquadClaimed: "referral" }, "purchase"),
    ).toBeNull();
  });
});

describe("rookie Genesis rotation", () => {
  const rookie = ARENA_TIERS.find((tier) => tier.id === "rookie")!;

  it("rotates only the third rookie slot, weekly, through the Genesis lineup", () => {
    const seen = new Set<string>();
    for (let week = 0; week < 6; week += 1) {
      const date = new Date(Date.UTC(2026, 6, 9) + week * 7 * 24 * 60 * 60 * 1000);
      const pool = getTierOpponentPool(rookie, date);
      expect(pool[0]).toBe(rookie.opponentPool[0]);
      expect(pool[1]).toBe(rookie.opponentPool[1]);
      expect([...ROOKIE_ROTATION]).toContain(pool[2]);
      seen.add(pool[2]);
    }
    expect([...seen].sort()).toEqual([...ROOKIE_ROTATION].sort());
  });

  it("leaves non-rookie tiers untouched", () => {
    for (const tier of ARENA_TIERS) {
      if (tier.id === "rookie") continue;
      expect(getTierOpponentPool(tier, new Date())).toEqual([...tier.opponentPool]);
    }
  });

  it("every rotated opponent settles with blueprints on both sides", () => {
    // Whatever week it is, defeating the featured rookie opponent must key
    // blueprints to that opponent on the client fallback AND the server.
    for (const featured of ROOKIE_ROTATION) {
      const input = {
        combosCompleted: 0,
        didWin: true,
        opponentName: featured,
        perfectDefenses: 0,
        tierId: "rookie" as const,
      };

      const client = computeArenaSettlement(input);
      const server = serverArena.computeArenaSettlement(input);

      expect(client!.blueprints).not.toBeNull();
      expect(server!.blueprints).toEqual(client!.blueprints);
      expect(client!.blueprints!.holobotKey).toBe(featured.toLowerCase());
    }
  });
});

describe("legendary blueprint (the 0.1% easter egg)", () => {
  it("drop chance and referral milestone constants match across sides", () => {
    expect(serverEconomy.LEGENDARY_BLUEPRINT_DROP_CHANCE).toBe(LEGENDARY_BLUEPRINT_DROP_CHANCE);
    expect(serverReferrals.REFERRAL_MILESTONE_QUALIFIED).toBe(REFERRAL_MILESTONE_QUALIFIED);
    expect(serverReferrals.REFERRAL_MILESTONE_GACHA_TICKETS).toBe(REFERRAL_MILESTONE_GACHA_TICKETS);
  });

  it("a winning egg roll produces the legendary blueprint drop on both sides", () => {
    // First roll (the egg roll) wins; the rest never do.
    let first = true;
    const makeRandom = () => {
      let mine = first;
      first = false;
      let calls = 0;
      return () => {
        calls += 1;
        return mine && calls === 1 ? 0.0004 : 0.5;
      };
    };

    const clientItems = buildPackRewards("basic", makeRandom());
    first = true;
    const serverItems = serverEconomy.buildPackRewards("basic", makeRandom());

    expect(clientItems[0].grant.type).toBe("legendary_blueprint");
    expect(clientItems[0].subtitle).toContain("ASCEND ANY HOLOBOT TO LEGENDARY");
    expect(serverItems[0].grant.type).toBe("legendary_blueprint");

    const updates = buildPackGrantUpdates({ legendaryBlueprints: 0 } as never, clientItems);
    const rawUpdates = serverEconomy.buildPackGrantUpdatesRaw({ legendaryBlueprints: 0 }, serverItems);
    expect(updates.legendaryBlueprints).toBe(1);
    expect(rawUpdates.legendaryBlueprints).toBe(1);
  });
});

describe("legendary ascension builder (server)", () => {
  it("mints an unowned bot straight at Legendary", () => {
    const result = serverMinting.buildLegendaryAscensionRaw(
      { legendaryBlueprints: 1, holobots: [] },
      "KUMA",
    );

    expect(result.outcome).toBe("minted");
    if (result.outcome === "minted") {
      const bots = result.updates.holobots as Array<Record<string, unknown>>;
      expect(bots[0].name).toBe("KUMA");
      expect(bots[0].level).toBe(41);
      expect(bots[0].rank).toBe("Legendary");
      expect(bots[0].attributePoints).toBe(40);
      expect(result.updates.legendaryBlueprints).toBe(0);
    }
  });

  it("ascends an owned lower-rank bot like a Legendary rank-up", () => {
    const result = serverMinting.buildLegendaryAscensionRaw(
      {
        legendaryBlueprints: 2,
        holobots: [{ name: "ACE", level: 12, experience: 500, rank: "Champion", attributePoints: 3 }],
      },
      "ACE",
    );

    expect(result.outcome).toBe("ascended");
    if (result.outcome === "ascended") {
      const bots = result.updates.holobots as Array<Record<string, unknown>>;
      expect(bots[0].level).toBe(41);
      expect(bots[0].rank).toBe("Legendary");
      expect(bots[0].attributePoints).toBe(43);
      expect(result.updates.legendaryBlueprints).toBe(1);
    }
  });

  it("converts an already-Legendary pick to wildcards", () => {
    const result = serverMinting.buildLegendaryAscensionRaw(
      {
        legendaryBlueprints: 1,
        wildcardBlueprints: 5,
        holobots: [{ name: "ACE", level: 41, rank: "Legendary" }],
      },
      "ACE",
    );

    expect(result.outcome).toBe("converted");
    if (result.outcome === "converted") {
      expect(result.wildcards).toBe(80);
      expect(result.updates.wildcardBlueprints).toBe(85);
      expect(result.updates.legendaryBlueprints).toBe(0);
    }
  });

  it("refuses without the item", () => {
    expect(serverMinting.buildLegendaryAscensionRaw({ holobots: [] }, "ACE").outcome).toBe("refused");
  });
});
