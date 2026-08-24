import { describe, expect, it } from "vitest";

import { TileMap } from "../../TileMap";
import { computeCompanionSpawn } from "../followPath";

describe("computeCompanionSpawn", () => {
  it("places the follower on a nearby walkable tile at the real town spawn", () => {
    const map = new TileMap();
    const player = { gridX: 28, gridY: 20, direction: "down" as const };
    const spawn = computeCompanionSpawn(player, (x, y) => map.isWalkable(x, y));
    expect(map.isWalkable(spawn.x, spawn.y)).toBe(true);
    expect(Math.max(Math.abs(spawn.x - player.gridX), Math.abs(spawn.y - player.gridY))).toBeLessThanOrEqual(2);
  });

  it("falls back to the player's tile when every adjacent tile is blocked", () => {
    expect(computeCompanionSpawn(
      { gridX: 28, gridY: 20, direction: "down" },
      () => false,
    )).toEqual({ x: 28, y: 20 });
  });
});
