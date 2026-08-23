import { describe, expect, it } from "vitest";

import { TileMap, getEntrancePosition } from "../../TileMap";
import { buildMapDescriptor, decodeWalkableMask, encodeWalkableMask } from "../mapDescriptor";

describe("map descriptor", () => {
  it("round-trips every static walkability cell", () => {
    const map = new TileMap();
    const encoded = encodeWalkableMask((x, y) => map.isWalkable(x, y), map.width, map.height);
    const decoded = decodeWalkableMask(encoded, map.width, map.height);
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      expect(decoded[y][x], `${x},${y}`).toBe(map.isWalkable(x, y));
    }
  });

  it("includes all five POIs and stays below one kilobyte", () => {
    const descriptor = buildMapDescriptor(new TileMap());
    const expected = {
      arena: { x: 28, y: 15 }, gacha: { x: 22, y: 20 }, trainingLab: { x: 33, y: 20 },
      pvpTerminal: { x: 33, y: 23 }, h3Core: { x: 28, y: 24 },
    } as const;
    for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(getEntrancePosition(id)).toEqual(expected[id]);
      expect(descriptor.pois).toContainEqual({ id, ...expected[id] });
    }
    expect(JSON.stringify(descriptor).length).toBeLessThan(1024);
  });
});
