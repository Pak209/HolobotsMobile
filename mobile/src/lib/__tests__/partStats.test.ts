import { describe, expect, it } from "vitest";

import {
  describePartBoosts,
  getEquippedPartBoosts,
  getHolobotEquippedParts,
  getPartBoosts,
  getPartStars,
  resolvePartSlot,
} from "@/lib/partStats";

describe("part identity inference", () => {
  it("reads rarity from the field or a legacy name suffix", () => {
    expect(getPartStars({ name: "Combat Mask", rarity: "legendary" })).toBe(5);
    expect(getPartStars({ name: "Quantum Core (Epic)" })).toBe(4);
    expect(getPartStars({ name: "Reinforced Plating", rarity: "rare" })).toBe(3);
    expect(getPartStars({ name: "Boxer Gloves" })).toBe(1);
  });

  it("resolves the slot from the record or name keywords", () => {
    expect(resolvePartSlot({ name: "Combat Mask" })).toBe("head");
    expect(resolvePartSlot({ name: "Plasma Cannon" })).toBe("arms");
    expect(resolvePartSlot({ name: "Quantum Core (Epic)" })).toBe("core");
    expect(resolvePartSlot({ name: "Mystery Widget" })).toBeNull();
    expect(resolvePartSlot({ name: "Mystery Widget", slot: "legs" })).toBe("legs");
  });
});

describe("boost math (2 AP-equivalents per star on the primary)", () => {
  it("scales the primary by rarity and adds the themed secondary", () => {
    // Legendary arms: +10 ATK primary, +2 SPD secondary.
    expect(getPartBoosts({ name: "Plasma Cannon", slot: "arms", rarity: "legendary" })).toEqual({
      attack: 10,
      defense: 0,
      speed: 2,
      special: 0,
      hp: 0,
    });
    // Common head: +2 SPECIAL, no secondary (floor(1/2) = 0).
    expect(getPartBoosts({ name: "Combat Mask", slot: "head", rarity: "common" })).toEqual({
      attack: 0,
      defense: 0,
      speed: 0,
      special: 2,
      hp: 0,
    });
  });

  it("HP-primary slots pay in HP units (x10 per point)", () => {
    // Epic core: 4 stars -> 8 AP primary = 80 HP, +2 SPECIAL secondary.
    expect(getPartBoosts({ name: "Quantum Core (Epic)" })).toEqual({
      attack: 0,
      defense: 0,
      speed: 0,
      special: 2,
      hp: 80,
    });
  });

  it("unresolvable parts grant nothing", () => {
    expect(getPartBoosts({ name: "Mystery Widget" })).toEqual({
      attack: 0,
      defense: 0,
      speed: 0,
      special: 0,
      hp: 0,
    });
    expect(getPartBoosts(null)).toEqual({ attack: 0, defense: 0, speed: 0, special: 0, hp: 0 });
  });
});

describe("loadout totals", () => {
  it("sums a full loadout and tolerates case-variant profile keys", () => {
    const equipped = getHolobotEquippedParts(
      {
        ace: {
          head: { name: "Combat Mask", slot: "head", rarity: "legendary" },
          arms: { name: "Plasma Cannon", slot: "arms", rarity: "rare" },
          core: { name: "Quantum Core (Epic)", slot: "core" },
        },
      },
      "ACE",
    );

    const totals = getEquippedPartBoosts(equipped);
    // head L: +10 SPC +2 DEF · arms R: +6 ATK +1 SPD · core E: +80 HP +2 SPC
    expect(totals).toEqual({ attack: 6, defense: 2, speed: 1, special: 12, hp: 80 });
  });

  it("describes boosts for pickers", () => {
    expect(describePartBoosts({ name: "Plasma Cannon", slot: "arms", rarity: "legendary" })).toBe(
      "+10 ATK · +2 SPD",
    );
    expect(describePartBoosts({ name: "Mystery Widget" })).toBe("");
  });
});
