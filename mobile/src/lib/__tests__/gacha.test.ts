import { describe, expect, it } from "vitest";

import {
  buildPackGrantUpdates,
  buildPackRewards,
  GACHA_PACKS,
  rollPackRarity,
  type GachaGrantedItem,
} from "@/lib/gacha";

function sequenceRandom(values: number[]) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

function makeItem(overrides: Partial<GachaGrantedItem> & Pick<GachaGrantedItem, "grant">): GachaGrantedItem {
  return {
    id: "item-1",
    label: "Energy Refill",
    rarity: "common",
    subtitle: "Drop 1 of 3",
    ...overrides,
  };
}

describe("rollPackRarity", () => {
  it("maps roll thresholds for the basic pack", () => {
    expect(rollPackRarity("basic", 0.0)).toBe("common");
    expect(rollPackRarity("basic", 0.4)).toBe("common");
    expect(rollPackRarity("basic", 0.41)).toBe("rare");
    expect(rollPackRarity("basic", 0.75)).toBe("epic");
    expect(rollPackRarity("basic", 0.96)).toBe("legendary");
  });

  it("elite packs never drop commons", () => {
    for (const roll of [0, 0.1, 0.42, 0.5, 0.72, 0.9, 1]) {
      expect(rollPackRarity("elite", roll)).not.toBe("common");
    }
  });
});

describe("buildPackRewards", () => {
  it("returns the guaranteed item count for each pack", () => {
    for (const pack of GACHA_PACKS) {
      expect(buildPackRewards(pack.id, sequenceRandom([0.5]))).toHaveLength(pack.guaranteed);
    }
  });

  it("every revealed item carries a concrete grant", () => {
    const items = buildPackRewards("elite", sequenceRandom([0.1, 0.3, 0.5, 0.7, 0.9]));

    for (const item of items) {
      expect(["part", "consumable", "blueprints"]).toContain(item.grant.type);
      if (item.grant.type === "blueprints") {
        expect(item.grant.amount).toBeGreaterThan(0);
        expect(item.grant.holobotKey).toMatch(/^[a-z]+$/);
        expect(item.subtitle).toContain(item.grant.holobotKey.toUpperCase());
      }
    }
  });

  it("is deterministic for a fixed random sequence", () => {
    const first = buildPackRewards("basic", sequenceRandom([0.2, 0.4, 0.6]));
    const second = buildPackRewards("basic", sequenceRandom([0.2, 0.4, 0.6]));

    expect(first.map((item) => [item.label, item.rarity, item.grant])).toEqual(
      second.map((item) => [item.label, item.rarity, item.grant]),
    );
  });
});

describe("buildPackGrantUpdates", () => {
  it("grants consumables on top of existing balances", () => {
    const updates = buildPackGrantUpdates(
      { arena_passes: 2, energy_refills: 0, exp_boosters: 5 },
      [
        makeItem({ grant: { type: "consumable", key: "energy_refills" } }),
        makeItem({ grant: { type: "consumable", key: "energy_refills" } }),
        makeItem({ grant: { type: "consumable", key: "arena_passes" } }),
      ],
    );

    expect(updates.energy_refills).toBe(2);
    expect(updates.arena_passes).toBe(3);
    expect(updates.exp_boosters).toBeUndefined();
  });

  it("appends parts with their slot and rarity", () => {
    const updates = buildPackGrantUpdates(
      { parts: [{ name: "Boxer Gloves", slot: "arms" }] },
      [
        makeItem({
          grant: { type: "part", name: "Combat Mask", slot: "head" },
          label: "Combat Mask",
          rarity: "epic",
        }),
      ],
    );

    expect(updates.parts).toHaveLength(2);
    expect(updates.parts?.[1]).toEqual({ name: "Combat Mask", rarity: "epic", slot: "head" });
  });

  it("accumulates blueprint grants per holobot", () => {
    const updates = buildPackGrantUpdates(
      { blueprints: { kuma: 4 } },
      [
        makeItem({ grant: { type: "blueprints", amount: 2, holobotKey: "kuma" } }),
        makeItem({ grant: { type: "blueprints", amount: 5, holobotKey: "ace" } }),
      ],
    );

    expect(updates.blueprints).toEqual({ ace: 5, kuma: 6 });
  });

  it("returns an empty object when there is nothing to grant", () => {
    expect(buildPackGrantUpdates({}, [])).toEqual({});
  });
});
