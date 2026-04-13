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

const BUILDINGS: BuildingPlacement[] = [
  {
    x: 8,
    y: 2,
    width: 4,
    height: 3,
    event: { id: "arena", label: "Arena" },
  },
  {
    x: 2,
    y: 7,
    width: 4,
    height: 3,
    event: { id: "deckBuilder", label: "Deck Builder" },
  },
  {
    x: 14,
    y: 7,
    width: 4,
    height: 3,
    event: { id: "trainingLab", label: "Training Lab" },
  },
  {
    x: 14,
    y: 14,
    width: 4,
    height: 3,
    event: { id: "pvpTerminal", label: "PvP Terminal" },
  },
];

const buildBaseMap = (): Tile[][] => {
  const tiles = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => createTile(x, y, "grass")),
  );

  for (let x = 0; x < MAP_WIDTH; x += 1) {
    setTile(tiles, x, 0, "wall");
    setTile(tiles, x, MAP_HEIGHT - 1, "wall");
  }

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    setTile(tiles, 0, y, "wall");
    setTile(tiles, MAP_WIDTH - 1, y, "wall");
  }

  fillRect(tiles, 9, 1, 2, 18, "path");
  fillRect(tiles, 2, 10, 16, 2, "path");
  fillRect(tiles, 6, 8, 8, 4, "path");
  fillRect(tiles, 3, 10, 3, 2, "path");
  fillRect(tiles, 14, 10, 3, 2, "path");
  fillRect(tiles, 14, 12, 3, 2, "path");
  fillRect(tiles, 7, 5, 6, 1, "path");
  fillRect(tiles, 7, 6, 6, 1, "path");
  fillRect(tiles, 3, 16, 8, 2, "path");

  fillRect(tiles, 1, 16, 2, 3, "water");
  fillRect(tiles, 17, 16, 2, 3, "water");
  fillRect(tiles, 1, 1, 2, 2, "water");
  fillRect(tiles, 17, 1, 2, 2, "water");

  for (const building of BUILDINGS) {
    fillRect(tiles, building.x, building.y, building.width, building.height, "building");
  }

  return tiles;
};

const getEntrancePosition = (eventId: BuildingEventId): { x: number; y: number } => {
  switch (eventId) {
    case "arena":
      return { x: 10, y: 5 };
    case "deckBuilder":
      return { x: 4, y: 10 };
    case "trainingLab":
      return { x: 15, y: 10 };
    case "pvpTerminal":
      return { x: 15, y: 13 };
    default:
      return { x: 0, y: 0 };
  }
};

export class TileMap {
  readonly width = MAP_WIDTH;
  readonly height = MAP_HEIGHT;
  readonly tileSize = TILE_SIZE;
  readonly tiles: Tile[][];

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
    return this.getTile(x, y)?.walkable ?? false;
  }

  getInteractionTile(x: number, y: number): Tile | undefined {
    const tile = this.getTile(x, y);
    return tile?.event ? tile : undefined;
  }

  getBuildingPlacements(): readonly BuildingPlacement[] {
    return BUILDINGS;
  }

  private isWithinBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private applyEntrances(): void {
    for (const building of BUILDINGS) {
      const entrance = getEntrancePosition(building.event.id);
      setTile(this.tiles, entrance.x, entrance.y, "path", building.event);
    }
  }
}
