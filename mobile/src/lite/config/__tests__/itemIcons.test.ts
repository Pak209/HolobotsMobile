import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../assets/items", () => ({
  itemIcons: { "item.arena_pass": 11, item_holo_pack: 12, item_training_booster: 13, "clothing.Ace_Visor": 14 },
  ITEM_ICON_COUNT: 4,
}));
import { getItemIcon } from "../itemIcons";

describe("HoloUI item lookup", () => {
  it("resolves host ids and existing catalog labels", () => {
    expect(getItemIcon("item.gacha_ticket")).toBe(12);
    expect(getItemIcon("  Arena Pass  ")).toBe(11);
    expect(getItemIcon("EXP Booster")).toBe(13);
  });
  it("supports the mixed source filename conventions", () => {
    expect(getItemIcon("item.holo_pack")).toBe(12);
    expect(getItemIcon("clothing.ace_visor")).toBe(14);
  });
  it("returns no art for unknown or inherited object properties", () => {
    for (const id of ["missing.item", "constructor", "__proto__", "toString", "hasOwnProperty"]) expect(getItemIcon(id)).toBeNull();
  });
});
