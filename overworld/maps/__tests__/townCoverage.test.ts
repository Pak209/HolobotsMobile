import { describe, expect, it } from "vitest";

import manifest from "../../assets/runtime/atlas-manifest.json";
import { TileMap } from "../../TileMap";
import { MAP_HEIGHT, MAP_WIDTH } from "../../TileTypes";
import { decodeWalkableMask, encodeWalkableMask } from "../../bridge/mapDescriptor";
import { getBaseTile, isBaseWalkable } from "../townMap";

describe("town terrain coverage", () => {
  it("resolves every 56x40 cell to a manifest terrain texture", () => {
    const offenders: string[] = [];
    for (let y = 0; y < MAP_HEIGHT; y += 1) for (let x = 0; x < MAP_WIDTH; x += 1) {
      const name = getBaseTile(x, y);
      if (!manifest.tiles[name as keyof typeof manifest.tiles]) offenders.push(`${x},${y}:${name}`);
    }
    expect({ dimensions: [MAP_WIDTH, MAP_HEIGHT], offenders }).toEqual({ dimensions: [56, 40], offenders: [] });
  });

  it("keeps the two-tile perimeter ring blocked", () => {
    for (let x = 0; x < MAP_WIDTH; x += 1) for (const y of [0, 1, MAP_HEIGHT - 2, MAP_HEIGHT - 1]) {
      expect(isBaseWalkable(x, y), `${x},${y}`).toBe(false);
    }
    for (let y = 0; y < MAP_HEIGHT; y += 1) for (const x of [0, 1, MAP_WIDTH - 2, MAP_WIDTH - 1]) {
      expect(isBaseWalkable(x, y), `${x},${y}`).toBe(false);
    }
  });

  it("round-trips the expanded collision grid", () => {
    const map = new TileMap();
    const encoded = encodeWalkableMask((x, y) => map.isWalkable(x, y), map.width, map.height);
    const decoded = decodeWalkableMask(encoded, map.width, map.height);
    expect(decoded).toHaveLength(40);
    expect(decoded[0]).toHaveLength(56);
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      expect(decoded[y][x], `${x},${y}`).toBe(map.isWalkable(x, y));
    }
  });
});
