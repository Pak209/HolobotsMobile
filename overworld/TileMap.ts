import {
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_SIZE,
  WALKABLE_TILE_TYPES,
  type BuildingEventId,
  type Tile,
  type TileEvent,
  type TileType,
} from "./TileTypes";
import { PLAZA_OFFSET, blocked, h3, terrain } from "./maps/h3Plaza";
import { TOWN_BLOCKED, isBaseWalkable } from "./maps/townMap";

export interface BuildingPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  event: TileEvent;
}

const createTile = (x: number, y: number, type: TileType, event?: TileEvent): Tile => ({
  id: `${x},${y}`,
  type,
  walkable: WALKABLE_TILE_TYPES.includes(type),
  event,
});

const setTile = (tiles: Tile[][], x: number, y: number, type: TileType, event?: TileEvent): void => {
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
    return;
  }

  tiles[y][x] = createTile(x, y, type, event);
};

const fillRect = (
  tiles: Tile[][],
  x: number,
  y: number,
  width: number,
  height: number,
  type: TileType,
  event?: TileEvent,
): void => {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setTile(tiles, col, row, type, event);
    }
  }
};

export const BUILDINGS: BuildingPlacement[] = [
  {
    x: 8 + PLAZA_OFFSET.x,
    y: 2 + PLAZA_OFFSET.y,
    width: 4,
    height: 3,
    event: { id: "arena", label: "Arena" },
  },
  {
    x: 2 + PLAZA_OFFSET.x,
    y: 7 + PLAZA_OFFSET.y,
    width: 4,
    height: 3,
    event: { id: "gacha", label: "Gacha Hangar" },
  },
  {
    x: 14 + PLAZA_OFFSET.x,
    y: 7 + PLAZA_OFFSET.y,
    width: 4,
    height: 3,
    event: { id: "trainingLab", label: "Training Lab" },
  },
  {
    x: 14 + PLAZA_OFFSET.x,
    y: 14 + PLAZA_OFFSET.y,
    width: 4,
    height: 3,
    event: { id: "pvpTerminal", label: "PvP Terminal" },
  },
  {
    x: h3.originX,
    y: h3.originY,
    width: 4,
    height: 3,
    event: { id: "h3Core", label: "H3 Core" },
  },
];

const buildBaseMap = (): Tile[][] => {
  const tiles = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => createTile(x, y, isBaseWalkable(x, y) ? "path" : "wall")),
  );

  for (const building of BUILDINGS) {
    fillRect(tiles, building.x, building.y, building.width, building.height, "building");
  }

  for (const cell of terrain) {
    setTile(tiles, cell.x, cell.y, "path");
  }

  for (const [x, y] of h3.footprint) {
    setTile(tiles, x, y, "building");
  }
  setTile(tiles, h3.doorway[0], h3.doorway[1], "path");

  for (const [x, y] of blocked) {
    setTile(tiles, x, y, "prop");
  }
  for (const [x, y] of TOWN_BLOCKED) setTile(tiles, x, y, "prop");

  return tiles;
};

export const getEntrancePosition = (eventId: BuildingEventId): { x: number; y: number } => {
  switch (eventId) {
    case "arena":
      return { x: 10 + PLAZA_OFFSET.x, y: 5 + PLAZA_OFFSET.y };
    case "gacha":
      return { x: 4 + PLAZA_OFFSET.x, y: 10 + PLAZA_OFFSET.y };
    case "trainingLab":
      return { x: 15 + PLAZA_OFFSET.x, y: 10 + PLAZA_OFFSET.y };
    case "pvpTerminal":
      return { x: 15 + PLAZA_OFFSET.x, y: 13 + PLAZA_OFFSET.y };
    case "h3Core":
      return { x: h3.interaction[0], y: h3.interaction[1] };
    default:
      return { x: 0, y: 0 };
  }
};

export class TileMap {
  readonly width = MAP_WIDTH;
  readonly height = MAP_HEIGHT;
  readonly tileSize = TILE_SIZE;
  readonly tiles: Tile[][];
  readonly occupants = new Set<string>();
  private readonly occupantPositions = new Map<string, string>();

  constructor() {
    this.tiles = buildBaseMap();
    this.applyEntrances();
  }

  get pixelWidth(): number {
    return this.width * this.tileSize;
  }

  get pixelHeight(): number {
    return this.height * this.tileSize;
  }

  getTile(x: number, y: number): Tile | undefined {
    if (!this.isWithinBounds(x, y)) {
      return undefined;
    }

    return this.tiles[y][x];
  }

  isWalkable(x: number, y: number): boolean {
    return (this.getTile(x, y)?.walkable ?? false) && !this.occupants.has(`${x},${y}`);
  }

  setOccupant(id: string, x: number, y: number): void {
    this.clearOccupant(id);
    const key = `${x},${y}`;
    this.occupantPositions.set(id, key);
    this.occupants.add(key);
  }

  clearOccupant(id: string): void {
    const key = this.occupantPositions.get(id);
    if (key) this.occupants.delete(key);
    this.occupantPositions.delete(id);
  }

  isWithinBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getInteractionTile(x: number, y: number): Tile | undefined {
    const tile = this.getTile(x, y);
    return tile?.event ? tile : undefined;
  }

  getBuildingPlacements(): readonly BuildingPlacement[] {
    return BUILDINGS;
  }

  private applyEntrances(): void {
    for (const building of BUILDINGS) {
      const entrance = getEntrancePosition(building.event.id);
      setTile(this.tiles, entrance.x, entrance.y, "path", building.event);
    }
  }
}
