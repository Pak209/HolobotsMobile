import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getHolobotDisplayStats } from "@/lib/progression";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");

// lite-inventory-stats-1: the Inventory roster cards read ATK 15 / DEF 15 / SPD 15 for every bot.
describe("roster card stats are on the host displayStats scale", () => {
  const ace = { name: "ACE", level: 12, boostedAttributes: { attack: 2 } };

  it("known-bad: holobot.stats is the attribute chart scale, floored at 15 (ACE LV 12 finals 14 / 9 / 10 all clamp up)", () => {
    const config = read("../../../config/holobots.ts");
    expect(config).toContain("attack: Math.min(100, Math.max(15, finalAttack)),");
    const shown = getHolobotDisplayStats(ace.name, ace.level, ace.boostedAttributes);
    expect([shown.attack, shown.defense, shown.speed].map((value) => Math.min(100, Math.max(15, value)))).toEqual([15, 15, 15]);
  });

  it("LV 12 ACE (+2 ATK boost) reads the Training numbers, not the chart floor", () => {
    const shown = getHolobotDisplayStats(ace.name, ace.level, ace.boostedAttributes);
    expect({ attack: shown.attack, defense: shown.defense, speed: shown.speed, hp: shown.hp }).toEqual({ attack: 14, defense: 9, speed: 10, hp: 232 });
  });

  it("the card renders getHolobotDisplayStats, never holobot.stats", () => {
    const card = read("../../components/HolobotRosterCard.tsx");
    expect(card).toContain("const stats = getHolobotDisplayStats(holobot.name, holobot.level, holobot.boostedAttributes);");
    expect(card).toContain("[['ATK', stats.attack], ['DEF', stats.defense], ['SPD', stats.speed]]");
    expect(card).not.toContain("holobot.stats.");
  });
});
