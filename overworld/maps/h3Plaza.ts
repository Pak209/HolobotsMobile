export type PlazaDetail = { x: number; y: number; tile: string; rotation?: 0 | 90 | 180 | 270 };
export type PlazaProp = {
  name: string; x: number; y: number;
  layer: "lowDecor" | "actors" | "foregroundOcclusion";
  offsetX?: number; offsetY?: number; blocks?: boolean;
};
export const PLAZA_OFFSET = { x: 18, y: 10 } as const;
const shift = <T extends { x: number; y: number }>(item: T): T => ({
  ...item, x: item.x + PLAZA_OFFSET.x, y: item.y + PLAZA_OFFSET.y,
});
const shiftPoint = ([x, y]: [number, number]): [number, number] => [x + PLAZA_OFFSET.x, y + PLAZA_OFFSET.y];

const cells = (rows: Array<[number, number, number]>) => rows.flatMap(([y, from, to]) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ x: from + index, y })));

const plazaCells = cells([[7, 7, 12], [8, 6, 13], [9, 6, 13], [10, 5, 14], [11, 5, 14], [12, 5, 14], [13, 6, 13], [14, 6, 14], [15, 7, 12]]);
const variants: Record<string, string> = {
  "7,9": "floor-plaza-cracked-a", "8,12": "floor-plaza-seams", "10,6": "floor-plaza-mossy",
  "12,13": "floor-plaza-cross-seam", "14,8": "floor-plaza-cracked-a", "15,11": "floor-plaza-mossy",
};

export const TILING_BASES = ["floor-plaza-a", "floor-plaza-b", "path-cyan-h-a", "path-gold-h"] as const;
export const terrain = plazaCells.map(({ x, y }, index) => shift({
  x, y, tile: variants[`${y},${x}`] ?? (index % 3 === 0 ? "floor-plaza-b" : "floor-plaza-a"),
}));

const rawDetails: PlazaDetail[] = [
  { x: 10, y: 7, tile: "path-cyan-h-a", rotation: 90 }, { x: 10, y: 8, tile: "path-cyan-h-b", rotation: 90 },
  { x: 10, y: 9, tile: "path-cyan-node-round" }, { x: 10, y: 10, tile: "path-cyan-t", rotation: 90 },
  { x: 8, y: 10, tile: "path-cyan-h-a" }, { x: 9, y: 10, tile: "path-cyan-h-b" },
  { x: 11, y: 10, tile: "path-cyan-h-a" }, { x: 12, y: 10, tile: "path-cyan-node-square" },
  { x: 13, y: 10, tile: "path-cyan-h-b" }, { x: 10, y: 14, tile: "path-cyan-node-inset" },
  { x: 7, y: 13, tile: "path-gold-end" }, { x: 8, y: 13, tile: "path-gold-h" },
  { x: 9, y: 13, tile: "path-gold-node-a" }, { x: 10, y: 13, tile: "path-gold-inlay" },
];
export const details = rawDetails.map(shift);

const rawCanals: PlazaDetail[] = [
  { x: 5, y: 12, tile: "canal-h-a" }, { x: 6, y: 12, tile: "canal-h-b" },
  { x: 7, y: 12, tile: "canal-node" },
];
export const canals = rawCanals.map(shift);

const rawProps: PlazaProp[] = [
  { name: "curb-corner-a", x: 6, y: 8, layer: "lowDecor" }, { name: "curb-straight-a", x: 8, y: 7, layer: "lowDecor" },
  { name: "curb-u-notch", x: 12, y: 7, layer: "lowDecor" }, { name: "curb-return", x: 13, y: 9, layer: "lowDecor" },
  { name: "curb-s-bend", x: 14, y: 11, layer: "lowDecor" }, { name: "curb-gold-bend", x: 13, y: 14, layer: "lowDecor" },
  { name: "curb-straight-b", x: 11, y: 15, layer: "lowDecor" }, { name: "curb-arch-cap", x: 7, y: 15, layer: "lowDecor" },
  { name: "curb-u-wide", x: 5, y: 11, layer: "lowDecor" }, { name: "stairs-wide-a", x: 10, y: 15, layer: "lowDecor" },
  { name: "planter-long", x: 6, y: 8, layer: "actors", blocks: true }, { name: "bush-flower-a", x: 6, y: 8, layer: "actors" },
  { name: "planter-u-a", x: 13, y: 8, layer: "actors", blocks: true }, { name: "shrub", x: 13, y: 8, layer: "actors" },
  { name: "tree-a", x: 6, y: 15, layer: "actors", blocks: true }, { name: "fern", x: 6, y: 15, layer: "actors" },
  { name: "tree-b", x: 13, y: 15, layer: "actors", blocks: true }, { name: "bush-flower-b", x: 13, y: 15, layer: "actors" },
  { name: "lantern-cyan-tall", x: 7, y: 10, layer: "actors", blocks: true },
  { name: "lantern-gold", x: 13, y: 10, layer: "actors", blocks: true },
  { name: "bench", x: 6, y: 14, layer: "actors", blocks: true },
  { name: "terminal-holo", x: 13, y: 12, layer: "actors", blocks: true },
  { name: "bollard-gold", x: 7, y: 14, layer: "actors", blocks: true }, { name: "bollard-gold", x: 12, y: 14, layer: "actors", blocks: true },
  { name: "crate-stone", x: 14, y: 14, layer: "actors", blocks: true }, { name: "crate-metal", x: 14, y: 14, layer: "actors", offsetX: 10 },
  { name: "crate-gold", x: 14, y: 14, layer: "foregroundOcclusion", offsetX: -9 },
  { name: "debris-holobot", x: 5, y: 10, layer: "actors", blocks: true },
];
export const props = rawProps.map(shift);

export const blocked: Array<[number, number]> = [
  ...[[5, 12], [6, 12], [7, 12]].map((point) => shiftPoint(point as [number, number])),
  ...props.filter((prop) => prop.blocks).map((prop) => [prop.x, prop.y] as [number, number]),
];

export const h3 = {
  originX: 8 + PLAZA_OFFSET.x, originY: 11 + PLAZA_OFFSET.y,
  footprint: cells([[11, 8, 11], [12, 8, 11], [13, 8, 11]])
    .map(({ x, y }) => shiftPoint([x, y])),
  doorway: shiftPoint([10, 13]),
  interaction: shiftPoint([10, 14]),
};

export const wispSpawns: Array<[number, number]> = (
  [[7, 9], [12, 9], [6, 13], [13, 13], [9, 15], [11, 8]] as Array<[number, number]>
).map(shiftPoint);
