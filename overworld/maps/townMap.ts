import { MAP_HEIGHT, MAP_WIDTH } from "../TileTypes";

export type TownDetail = { x: number; y: number; tile: string; rotation?: 0 | 90 | 180 | 270 };
export type TownProp = { name: string; x: number; y: number; blocks?: boolean };

const pick = (x: number, y: number, names: readonly string[]) => names[(x * 7 + y * 13) % names.length];
const inside = (x: number, y: number, left: number, top: number, right: number, bottom: number) =>
  x >= left && x <= right && y >= top && y <= bottom;

export const getBaseTile = (x: number, y: number): string => {
  if (x < 2 || y < 2 || x >= MAP_WIDTH - 2 || y >= MAP_HEIGHT - 2) {
    return pick(x, y, ["floor-tech-column", "floor-tech-panel"]);
  }
  if (inside(x, y, 3, 3, 21, 16)) {
    return pick(x, y, ["floor-plaza-b", "floor-plaza-mossy", "floor-plaza-cracked-a"]);
  }
  if (inside(x, y, 34, 3, 52, 16)) {
    return pick(x, y, ["floor-tech-plain", "floor-tech-bolted", "floor-tech-vent"]);
  }
  if (inside(x, y, 3, 23, 21, 36)) {
    return pick(x, y, ["grass-full-a", "grass-full-b", "grass-sparse-stone"]);
  }
  if (inside(x, y, 34, 23, 52, 36)) {
    return pick(x, y, ["floor-tech-slot", "floor-tech-panel", "floor-tech-plain"]);
  }
  if (x >= 27 && x <= 29 || y >= 19 && y <= 21) {
    return pick(x, y, ["floor-tech-a", "floor-tech-b"]);
  }
  return pick(x, y, ["floor-tech-a", "floor-tech-b", "floor-tech-cracked"]);
};

export const isBaseWalkable = (x: number, y: number): boolean =>
  x >= 2 && y >= 2 && x < MAP_WIDTH - 2 && y < MAP_HEIGHT - 2;

export const TOWN_DETAILS: TownDetail[] = [
  ...Array.from({ length: MAP_HEIGHT - 4 }, (_, index) => ({
    x: 28, y: index + 2, tile: index % 7 === 0 ? "path-cyan-node-inset" : "path-cyan-h-a", rotation: 90 as const,
  })),
  ...Array.from({ length: MAP_WIDTH - 4 }, (_, index) => ({
    x: index + 2, y: 20, tile: index % 9 === 0 ? "path-cyan-node-square" : "path-cyan-h-b",
  })),
  ...Array.from({ length: 9 }, (_, index) => ({ x: 19 + index, y: 12, tile: "path-gold-h" })),
];

export const TOWN_CANALS: TownDetail[] = [{ x: 44, y: 29, tile: "canal-h-c" }];

const perimeterProps: TownProp[] = [
  ...Array.from({ length: 18 }, (_, index) => ({ name: "wall-panel-framed", x: 1 + index * 3, y: 1 })),
  ...Array.from({ length: 18 }, (_, index) => ({ name: "wall-panel-framed", x: 1 + index * 3, y: MAP_HEIGHT - 2 })),
  ...Array.from({ length: 11 }, (_, index) => ({ name: "wall-panel-framed", x: 1, y: 4 + index * 3 })),
  ...Array.from({ length: 11 }, (_, index) => ({ name: "wall-panel-framed", x: MAP_WIDTH - 2, y: 4 + index * 3 })),
];

export const TOWN_PROPS: TownProp[] = [
  ...perimeterProps,
  { name: "planter-long", x: 8, y: 10, blocks: true }, { name: "planter-u-b", x: 17, y: 6, blocks: true },
  { name: "lantern-gold", x: 12, y: 14, blocks: true },
  { name: "crate-metal", x: 41, y: 8, blocks: true }, { name: "crate-stone", x: 42, y: 8, blocks: true },
  { name: "terminal-holo", x: 47, y: 12, blocks: true }, { name: "lantern-cyan-tall", x: 37, y: 6, blocks: true },
  { name: "tree-a", x: 8, y: 29, blocks: true }, { name: "tree-b", x: 15, y: 32, blocks: true },
  { name: "planter-box-a", x: 18, y: 27, blocks: true }, { name: "bush-flower-c", x: 18, y: 27 },
  { name: "curb-straight-a", x: 43, y: 28 }, { name: "curb-straight-b", x: 45, y: 28 },
  { name: "bench", x: 48, y: 32, blocks: true }, { name: "bollard-gold", x: 40, y: 32, blocks: true },
];

export const TOWN_BLOCKED: Array<[number, number]> = TOWN_PROPS
  .filter((prop) => prop.blocks).map(({ x, y }) => [x, y]);
