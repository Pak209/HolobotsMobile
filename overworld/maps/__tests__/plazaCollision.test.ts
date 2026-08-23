import { describe, expect, it, vi } from "vitest";

import manifest from "../../assets/runtime/atlas-manifest.json";
import { triggerBuildingEvent, type BuildingCallbacks } from "../../Interactions";
import { TileMap, getEntrancePosition } from "../../TileMap";
import type { BuildingEventId } from "../../TileTypes";
import { blocked, canals, details, h3, props, terrain, TILING_BASES } from "../h3Plaza";
import { AMBIENT_NPCS, GUIDE } from "../npcs";

const reachable = (map: TileMap, start: [number, number]): Set<string> => {
  const seen = new Set([start.join(",")]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next: [number, number] = [x + dx, y + dy];
      const key = next.join(",");
      if (!seen.has(key) && map.isWalkable(...next)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen;
};

describe("H3 plaza collision", () => {
  it("keeps every building entrance and the guide reachable", () => {
    const map = new TileMap();
    map.setOccupant(GUIDE.npcId, GUIDE.x, GUIDE.y);
    for (const npc of AMBIENT_NPCS) map.setOccupant(npc.id, npc.home.x, npc.home.y);
    const seen = reachable(map, [28, 20]);
    for (const id of ["arena", "gacha", "trainingLab", "pvpTerminal", "h3Core"] as BuildingEventId[]) {
      const { x, y } = getEntrancePosition(id);
      expect(seen.has(`${x},${y}`), id).toBe(true);
    }
    expect(map.isWalkable(GUIDE.x, GUIDE.y)).toBe(false);
    expect(seen.has(`${GUIDE.x},${GUIDE.y + 1}`)).toBe(true);
  });

  it("blocks the H3 body and every solid prop, but not its doorway", () => {
    const map = new TileMap();
    for (const [x, y] of h3.footprint) {
      expect(map.isWalkable(x, y), `${x},${y}`).toBe(x === h3.doorway[0] && y === h3.doorway[1]);
    }
    for (const [x, y] of blocked) expect(map.isWalkable(x, y), `${x},${y}`).toBe(false);
  });

  it("references existing assets and repeatable tiles are not marked redraw", () => {
    for (const name of terrain.map((item) => item.tile).concat(details.map((item) => item.tile), canals.map((item) => item.tile))) {
      expect(manifest.tiles[name as keyof typeof manifest.tiles], name).toBeDefined();
    }
    for (const { name } of props) expect(manifest.props[name as keyof typeof manifest.props], name).toBeDefined();
    for (const name of TILING_BASES) expect(manifest.tiles[name].redraw, name).toBe(false);
  });

  it("routes all five building events through their callbacks", () => {
    const callbacks: BuildingCallbacks = {
      enterArena: vi.fn(), enterH3Core: vi.fn(), openGacha: vi.fn(),
      openPvPTerminal: vi.fn(), openTraining: vi.fn(),
    };
    for (const id of ["arena", "h3Core", "gacha", "pvpTerminal", "trainingLab"] as BuildingEventId[]) {
      triggerBuildingEvent({ id, label: id }, callbacks);
    }
    for (const callback of Object.values(callbacks)) expect(callback).toHaveBeenCalledOnce();
  });
});
