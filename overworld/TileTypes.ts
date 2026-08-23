export const TILE_SIZE = 32;
export const MAP_WIDTH = 56;
export const MAP_HEIGHT = 40;

export type TileType = "grass" | "path" | "building" | "water" | "wall" | "npc" | "prop";
export type Direction = "up" | "down" | "left" | "right";
export type BuildingEventId = "arena" | "gacha" | "pvpTerminal" | "trainingLab" | "h3Core";

export interface TileEvent {
  id: BuildingEventId;
  label: string;
}

export interface Tile {
  id: string;
  type: TileType;
  walkable: boolean;
  event?: TileEvent;
}

export const TILE_COLORS: Record<TileType, number> = {
  grass: 0x1d1f24,
  path: 0x8b5a2b,
  building: 0x707070,
  water: 0x2a70c9,
  wall: 0x353535,
  npc: 0x1d1f24,
  prop: 0x1d1f24,
};

export const WALKABLE_TILE_TYPES: readonly TileType[] = ["grass", "path"];

export const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
