import { describe, expect, it } from "vitest";

import { getBattleCardRarityTable, getRandomBattleCardGrant } from "@/lib/battleCards/catalog";
import {
  buildPackGrantUpdates,
  buildPackRewards,
  GACHA_PACKS,
  rollPackRarity,
  type GachaPackId,
} from "@/lib/gacha";
import {
  buildBoosterPurchaseUpdates,
  buildItemPurchaseUpdates,
  buildPartPurchaseUpdates,
  getMarketplacePrice,
  MARKETPLACE_BOOSTER_PRICES,
  MARKETPLACE_ITEM_NAMES,
  MARKETPLACE_PART_CATALOG,
  type MarketplaceBoosterId,
} from "@/lib/marketplace";

import * as serverEconomy from "../../../../functions/src/lib/economy";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const NOW = new Date("2026-07-07T16:30:00.000Z");

/**
 * The client emits mapped profile keys that updateUserProfile translates on
 * write; the server emits raw Firestore names directly. This is that mapping
 * (mirror of mobile/src/lib/profile.ts updateUserProfile).
 */
const CLIENT_TO_RAW_KEYS: Record<string, string> = {
  arena_passes: "arenaPassses",
  energy_refills: "energyRefills",
  exp_boosters: "expBoosters",
  pack_history: "packHistory",
  rank_skips: "rankSkips",
};

function translateToRaw(updates: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [CLIENT_TO_RAW_KEYS[key] ?? key, value]),
  );
}

/** One underlying player state, in both client-mapped and raw-doc shapes. */
function playerState() {
  const shared = {
    arena_deck_template_ids: [] as string[],
    battle_cards: { "strike.quickJab": 2 },
    blueprints: { kuma: 3 },
    gachaTickets: 20,
    holosTokens: 10_000,
    parts: [{ name: "Core Part", slot: "core" }],
    rewardSystem: { lastDailyMissionReset: "2026-07-07", boosterPacksToday: 1, arenaBattlesToday: 0, missionClaims: {} },
  };

  return {
    clientProfile: {
      ...shared,
      arena_passes: 1,
      energy_refills: 0,
      exp_boosters: 0,
      pack_history: [] as Array<Record<string, unknown>>,
      rank_skips: 0,
    },
    rawDoc: {
      ...shared,
      arenaPassses: 1,
      energyRefills: 0,
      expBoosters: 0,
      packHistory: [] as Array<Record<string, unknown>>,
      rankSkips: 0,
    },
  };
}

function stripIds(items: Array<Record<string, unknown>>) {
  return items.map(({ id: _id, ...rest }) => rest);
}

describe("gacha client/server parity", () => {
  it("pack tables match", () => {
    expect(serverEconomy.GACHA_PACKS.map(({ guaranteed, id, price }) => ({ guaranteed, id, price }))).toEqual(
      GACHA_PACKS.map(({ guaranteed, id, price }) => ({ guaranteed, id, price })),
    );
  });

  it("rarity rolls match across the roll space for every pack", () => {
    for (const pack of GACHA_PACKS) {
      for (let roll = 0; roll <= 100; roll += 1) {
        expect(serverEconomy.rollPackRarity(pack.id, roll / 100)).toBe(
          rollPackRarity(pack.id, roll / 100),
        );
      }
    }
  });

  it("identical seeds produce identical pack contents and grants", () => {
    for (const packId of ["basic", "premium", "elite"] as GachaPackId[]) {
      for (const seed of [1, 99, 4242]) {
        const clientItems = buildPackRewards(packId, seededRandom(seed));
        const serverItems = serverEconomy.buildPackRewards(packId, seededRandom(seed));

        expect(stripIds(serverItems as never)).toEqual(stripIds(clientItems as never));

        const { clientProfile, rawDoc } = playerState();
        const clientUpdates = buildPackGrantUpdates(clientProfile as never, clientItems);
        const serverUpdates = serverEconomy.buildPackGrantUpdatesRaw(rawDoc, serverItems);

        expect(serverUpdates).toEqual(translateToRaw(clientUpdates as Record<string, unknown>));
      }
    }
  });
});

describe("battle card pool parity", () => {
  it("the server rarity table matches the mobile catalog exactly", () => {
    expect(serverEconomy.BATTLE_CARD_RARITIES).toEqual(getBattleCardRarityTable());
  });

  it("seeded card grants match for every booster tier", () => {
    for (const packId of ["common", "champion", "rare", "elite"]) {
      for (const seed of [3, 77, 512]) {
        expect(serverEconomy.getRandomBattleCardGrant(packId, seededRandom(seed))).toEqual(
          getRandomBattleCardGrant(packId, seededRandom(seed)),
        );
      }
    }
  });
});

describe("marketplace client/server parity", () => {
  it("price tables match", () => {
    for (const itemName of [...MARKETPLACE_ITEM_NAMES, "Async Ticket", "Blueprint", "Unknown Thing"]) {
      expect(serverEconomy.getMarketplacePrice(itemName)).toBe(getMarketplacePrice(itemName));
    }
    expect(serverEconomy.MARKETPLACE_BOOSTER_PRICES).toEqual(MARKETPLACE_BOOSTER_PRICES);
  });

  it("item purchases produce raw-translated identical updates", () => {
    for (const itemName of MARKETPLACE_ITEM_NAMES) {
      const { clientProfile, rawDoc } = playerState();
      // Pin `now` on both sides: the wildcard pack stamps lastWildcardPackAt
      // from it, and two default new Date() calls can straddle a millisecond.
      const client = buildItemPurchaseUpdates(clientProfile as never, itemName, NOW);
      const server = serverEconomy.buildItemPurchaseUpdatesRaw(rawDoc, itemName, NOW);

      expect(client).not.toBeNull();
      expect(server).not.toBeNull();
      expect(server!.price).toBe(client!.price);
      expect(server!.updates).toEqual(translateToRaw(client!.updates));
    }
  });

  it("the weekly wildcard pack grants, throttles, and reopens identically", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const { clientProfile, rawDoc } = playerState();

    const clientFresh = buildItemPurchaseUpdates(clientProfile as never, "Wildcard Blueprints", NOW);
    const serverFresh = serverEconomy.buildItemPurchaseUpdatesRaw(rawDoc, "Wildcard Blueprints", NOW);
    expect(clientFresh!.updates.wildcardBlueprints).toBe(5);
    expect(clientFresh!.updates.lastWildcardPackAt).toBe(NOW.getTime());
    expect(serverFresh!.updates).toEqual(translateToRaw(clientFresh!.updates));

    // Bought 3 days ago: throttled on both sides.
    const throttledState = { lastWildcardPackAt: NOW.getTime() - 3 * dayMs, wildcardBlueprints: 5 };
    expect(
      buildItemPurchaseUpdates({ ...clientProfile, ...throttledState } as never, "Wildcard Blueprints", NOW),
    ).toBeNull();
    expect(
      serverEconomy.buildItemPurchaseUpdatesRaw({ ...rawDoc, ...throttledState }, "Wildcard Blueprints", NOW),
    ).toBeNull();

    // Bought 8 days ago: available again, balance accumulates.
    const reopenedState = { lastWildcardPackAt: NOW.getTime() - 8 * dayMs, wildcardBlueprints: 5 };
    const clientAgain = buildItemPurchaseUpdates(
      { ...clientProfile, ...reopenedState } as never,
      "Wildcard Blueprints",
      NOW,
    );
    const serverAgain = serverEconomy.buildItemPurchaseUpdatesRaw(
      { ...rawDoc, ...reopenedState },
      "Wildcard Blueprints",
      NOW,
    );
    expect(clientAgain!.updates.wildcardBlueprints).toBe(10);
    expect(serverAgain!.updates).toEqual(translateToRaw(clientAgain!.updates));
  });

  it("legendary gacha drops are wildcards and accumulate identically", () => {
    // Sweep seeds so at least one legendary appears; every legendary
    // blueprint grant must be the assignable wildcard type on both sides.
    let wildcardsSeen = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const clientItems = buildPackRewards("elite", seededRandom(seed));
      const serverItems = serverEconomy.buildPackRewards("elite", seededRandom(seed));
      expect(stripIds(serverItems as never)).toEqual(stripIds(clientItems as never));

      for (const item of clientItems) {
        if (item.grant.type === "wildcard_blueprints") {
          wildcardsSeen += 1;
          expect(item.rarity).toBe("legendary");
          expect(item.subtitle).toContain("WILDCARD");
          expect(item.subtitle).toContain("any Holobot");
        }
        if (item.rarity === "legendary" && item.grant.type === "blueprints") {
          throw new Error("legendary blueprint drop was not a wildcard");
        }
      }

      const { clientProfile, rawDoc } = playerState();
      const clientUpdates = buildPackGrantUpdates(clientProfile as never, clientItems);
      const serverUpdates = serverEconomy.buildPackGrantUpdatesRaw(rawDoc, serverItems);
      expect(serverUpdates).toEqual(translateToRaw(clientUpdates as Record<string, unknown>));
    }
    expect(wildcardsSeen).toBeGreaterThan(0);
  });

  it("part catalogs match and purchases produce identical updates", () => {
    expect(serverEconomy.MARKETPLACE_PART_CATALOG).toEqual(MARKETPLACE_PART_CATALOG);

    for (const offer of MARKETPLACE_PART_CATALOG) {
      const { clientProfile, rawDoc } = playerState();
      const client = buildPartPurchaseUpdates(clientProfile as never, offer.id);
      const server = serverEconomy.buildPartPurchaseUpdatesRaw(rawDoc, offer.id);

      expect(client).not.toBeNull();
      expect(server).not.toBeNull();
      expect(server!.price).toBe(client!.price);
      expect(server!.part).toEqual(client!.part);
      // holosTokens and parts use identical raw names on both sides.
      expect(server!.updates).toEqual(client!.updates);
    }
  });

  it("both sides reject an unknown part id", () => {
    const { clientProfile, rawDoc } = playerState();

    expect(buildPartPurchaseUpdates(clientProfile as never, "part.doesNotExist")).toBeNull();
    expect(serverEconomy.buildPartPurchaseUpdatesRaw(rawDoc, "part.doesNotExist")).toBeNull();
  });

  it("both sides refuse an unaffordable purchase", () => {
    const { clientProfile, rawDoc } = playerState();
    (clientProfile as Record<string, unknown>).holosTokens = 10;
    (rawDoc as Record<string, unknown>).holosTokens = 10;

    expect(buildItemPurchaseUpdates(clientProfile as never, "Arena Pass")).toBeNull();
    expect(serverEconomy.buildItemPurchaseUpdatesRaw(rawDoc, "Arena Pass")).toBeNull();
    expect(buildBoosterPurchaseUpdates(clientProfile as never, "common", { now: NOW })).toBeNull();
    expect(serverEconomy.buildBoosterPurchaseUpdatesRaw(rawDoc, "common", { now: NOW })).toBeNull();
    expect(buildPartPurchaseUpdates(clientProfile as never, "part.combatMask")).toBeNull();
    expect(serverEconomy.buildPartPurchaseUpdatesRaw(rawDoc, "part.combatMask")).toBeNull();
  });

  it("booster purchases produce raw-translated identical updates and grants", () => {
    for (const packId of ["common", "champion", "rare", "elite"] as MarketplaceBoosterId[]) {
      for (const seed of [11, 222]) {
        const { clientProfile, rawDoc } = playerState();
        const client = buildBoosterPurchaseUpdates(clientProfile as never, packId, {
          now: NOW,
          random: seededRandom(seed),
        });
        const server = serverEconomy.buildBoosterPurchaseUpdatesRaw(rawDoc, packId, {
          now: NOW,
          random: seededRandom(seed),
        });

        expect(client).not.toBeNull();
        expect(server).not.toBeNull();
        expect(server!.granted).toEqual(client!.granted);
        expect(server!.updates).toEqual(translateToRaw(client!.updates));
      }
    }
  });
});
