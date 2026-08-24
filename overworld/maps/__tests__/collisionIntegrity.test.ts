import { describe, expect, it } from "vitest";

import { BUILDINGS, TileMap } from "../../TileMap";
import { MAP_HEIGHT, MAP_WIDTH } from "../../TileTypes";
import { canals, h3, props } from "../h3Plaza";
import { TOWN_BLOCKED, isBaseWalkable } from "../townMap";

const key = (x: number, y: number) => `${x},${y}`;
const perimeter = (): string[] => {
  const cells: string[] = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) for (let x = 0; x < MAP_WIDTH; x += 1) {
    if (!isBaseWalkable(x, y)) cells.push(key(x, y));
  }
  return cells;
};

const visualBlockers = (): Set<string> => {
  const result = new Set(perimeter());
  for (const prop of props) if (prop.blocks) result.add(key(prop.x, prop.y));
  for (const canal of canals) result.add(key(canal.x, canal.y));
  for (const [x, y] of TOWN_BLOCKED) result.add(key(x, y));
  for (const building of BUILDINGS) {
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) result.add(key(x, y));
    }
  }
  result.delete(key(h3.doorway[0], h3.doorway[1]));
  return result;
};

describe("collision ↔ visual integrity", () => {
  it("blocks every visual blocker and explains every static blocked tile", () => {
    const map = new TileMap(); const explained = visualBlockers();
    const missing: string[] = []; const unexplained: string[] = [];
    for (const cell of explained) {
      const [x, y] = cell.split(",").map(Number);
      if (map.isWalkable(x, y)) missing.push(cell);
    }
    for (let y = 0; y < MAP_HEIGHT; y += 1) for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (!map.isWalkable(x, y) && !explained.has(key(x, y))) unexplained.push(key(x, y));
    }
    expect(missing, `visual blockers left walkable: ${missing.join(" ")}`).toEqual([]);
    expect(unexplained, `blocked without visual source: ${unexplained.join(" ")}`).toEqual([]);
  });

  it.each([[24, 19], [24, 20], [24, 21], [26, 19], [27, 19]] as const)(
    "keeps unobstructed band cell %i,%i walkable",
    (x, y) => expect(new TileMap().isWalkable(x, y)).toBe(true),
  );

  it("pins the device-reported band to visible blockers", () => {
    const blockers = visualBlockers();
    expect(blockers.has("25,20")).toBe(true); // cyan lantern
    expect(blockers.has("25,22")).toBe(true); // canal
    expect(blockers.has("26,21")).toBe(true); // H3 footprint
    expect(blockers.has("24,22")).toBe(true); // canal
    expect(blockers.has("24,24")).toBe(true); // bench
    expect(blockers.has("25,23")).toBe(false); // ambient occupant, not static collision
  });
});
