import { describe, expect, it } from "vitest";

import {
  BOOSTER_ITEM_AWARD_MAP,
  buildBoosterPurchaseUpdates,
  buildItemPurchaseUpdates,
  getMarketplacePrice,
  MARKETPLACE_BOOSTER_PRICES,
  MARKETPLACE_ITEM_NAMES,
} from "@/lib/marketplace";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const NOW = new Date("2026-07-07T15:00:00.000Z");

function richProfile(overrides: Record<string, unknown> = {}) {
  return {
    arena_deck_template_ids: [],
    arena_passes: 1,
    battle_cards: { "strike.quickJab": 2 },
    energy_refills: 0,
    exp_boosters: 0,
    gachaTickets: 3,
    holosTokens: 10_000,
    pack_history: [],
    parts: [{ name: "Core Part", slot: "core" }],
    rank_skips: 0,
    rewardSystem: {},
    ...overrides,
  };
}

describe("getMarketplacePrice", () => {
  it("prices every listed item", () => {
    expect(getMarketplacePrice("Energy Refill")).toBe(200);
    expect(getMarketplacePrice("EXP Booster")).toBe(750);
    expect(getMarketplacePrice("Rank Skip")).toBe(5000);
    expect(getMarketplacePrice("Arena Pass")).toBe(50);
    expect(getMarketplacePrice("Gacha Ticket")).toBe(100);
    expect(getMarketplacePrice("Wildcard Blueprints")).toBe(300);
  });
});

describe("buildItemPurchaseUpdates", () => {
  it("deducts the price and grants the right inventory key for every item", () => {
    const expectedKey: Record<string, string> = {
      "Arena Pass": "arena_passes",
      "EXP Booster": "exp_boosters",
      "Energy Refill": "energy_refills",
      "Gacha Ticket": "gachaTickets",
      "Rank Skip": "rank_skips",
      "Wildcard Blueprints": "wildcardBlueprints",
    };

    for (const itemName of MARKETPLACE_ITEM_NAMES) {
      const result = buildItemPurchaseUpdates(richProfile(), itemName);
      expect(result).not.toBeNull();
      expect(result!.updates.holosTokens).toBe(10_000 - getMarketplacePrice(itemName));
      expect(result!.updates[expectedKey[itemName]]).toBeDefined();
    }
  });

  it("returns null when the player cannot afford the item", () => {
    expect(buildItemPurchaseUpdates(richProfile({ holosTokens: 49 }), "Arena Pass")).toBeNull();
  });

  it("returns null for unknown items instead of charging for nothing", () => {
    expect(buildItemPurchaseUpdates(richProfile(), "Mystery Box")).toBeNull();
  });
});

describe("buildBoosterPurchaseUpdates", () => {
  it("grants a part, the tier item, and a battle card, and records history", () => {
    const result = buildBoosterPurchaseUpdates(richProfile(), "rare", {
      now: NOW,
      random: seededRandom(7),
    });

    expect(result).not.toBeNull();
    expect(result!.updates.holosTokens).toBe(10_000 - MARKETPLACE_BOOSTER_PRICES.rare);
    expect(result!.granted.itemName).toBe(BOOSTER_ITEM_AWARD_MAP.rare);
    expect(result!.updates.energy_refills).toBe(1);

    const history = result!.updates.pack_history as Array<Record<string, unknown>>;
    expect(history[0].packId).toBe("rare");
    expect((history[0].items as unknown[]).length).toBe(3);

    const parts = result!.updates.parts as Array<Record<string, unknown>>;
    expect(parts.length).toBe(2);

    const cards = result!.updates.battle_cards as Record<string, number>;
    expect(Object.values(cards).reduce((total, count) => total + count, 0)).toBe(3);
  });

  it("is deterministic for a fixed seed and clock", () => {
    const a = buildBoosterPurchaseUpdates(richProfile(), "elite", { now: NOW, random: seededRandom(42) });
    const b = buildBoosterPurchaseUpdates(richProfile(), "elite", { now: NOW, random: seededRandom(42) });
    expect(a).toEqual(b);
  });

  it("seeds arena_deck_template_ids only when the deck is empty", () => {
    const emptyDeck = buildBoosterPurchaseUpdates(richProfile(), "common", {
      now: NOW,
      random: seededRandom(1),
    });
    expect((emptyDeck!.updates.arena_deck_template_ids as string[]).length).toBeGreaterThan(0);

    const existingDeck = buildBoosterPurchaseUpdates(
      richProfile({ arena_deck_template_ids: ["strike.quickJab"] }),
      "common",
      { now: NOW, random: seededRandom(1) },
    );
    expect(existingDeck!.updates.arena_deck_template_ids).toEqual(["strike.quickJab"]);
  });

  it("returns null when the player cannot afford the booster", () => {
    expect(
      buildBoosterPurchaseUpdates(richProfile({ holosTokens: 399 }), "elite", {
        now: NOW,
        random: seededRandom(1),
      }),
    ).toBeNull();
  });
});

// GOD PACK: elite boosters only — a low roll triples the entire pack.
describe("god pack (elite boosters)", () => {
  function sequenceRandom(values: number[]) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
  }

  it("a winning god roll triples parts, moves, and the item award", () => {
    const result = buildBoosterPurchaseUpdates(richProfile(), "elite", {
      random: sequenceRandom([0.005, 0.1, 0.4, 0.7, 0.2, 0.5, 0.8, 0.3, 0.6]),
    });

    expect(result!.granted.godPack).toBe(true);
    expect(result!.granted.parts).toHaveLength(3);
    expect(result!.granted.battleCardIds).toHaveLength(3);
    expect(result!.granted.itemQuantity).toBe(3);
    // Elite's item award is EXP Booster — tripled.
    expect(result!.updates.exp_boosters).toBe(3);
    // Three parts appended on top of the one owned.
    expect((result!.updates.parts as unknown[]).length).toBe(4);
    // Price unchanged: the jackpot is free.
    expect(result!.updates.holosTokens).toBe(10_000 - result!.price);
  });

  it("a losing god roll grants the normal single set", () => {
    const result = buildBoosterPurchaseUpdates(richProfile(), "elite", {
      random: sequenceRandom([0.99, 0.1, 0.4]),
    });

    expect(result!.granted.godPack).toBe(false);
    expect(result!.granted.parts).toHaveLength(1);
    expect(result!.granted.battleCardIds).toHaveLength(1);
    expect(result!.granted.itemQuantity).toBe(1);
    expect(result!.updates.exp_boosters).toBe(1);
  });

  it("non-elite tiers never god-roll (and do not consume the roll)", () => {
    // First value would win a god roll on elite; commons must ignore it and
    // use it for the part pick instead.
    const result = buildBoosterPurchaseUpdates(richProfile(), "common", {
      random: sequenceRandom([0.005, 0.1, 0.4]),
    });

    expect(result!.granted.godPack).toBe(false);
    expect(result!.granted.parts).toHaveLength(1);
  });
});
