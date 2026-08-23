import { BUILDINGS, TileMap, getEntrancePosition } from "../TileMap";

export type MapDescriptor = {
  width: number;
  height: number;
  walkable: string;
  pois: Array<{ id: string; x: number; y: number }>;
};

export const encodeWalkableMask = (
  isWalkable: (x: number, y: number) => boolean,
  width: number,
  height: number,
): string => {
  const bytes = new Uint8Array(Math.ceil((width * height) / 8));
  for (let index = 0; index < width * height; index += 1) {
    if (isWalkable(index % width, Math.floor(index / width))) bytes[index >> 3] |= 1 << (7 - (index & 7));
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const decodeWalkableMask = (encoded: string, width: number, height: number): boolean[][] => {
  const binary = atob(encoded);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const index = y * width + x;
    return (binary.charCodeAt(index >> 3) & (1 << (7 - (index & 7)))) !== 0;
  }));
};

export const buildMapDescriptor = (_tileMap: TileMap): MapDescriptor => {
  const staticMap = new TileMap();
  return {
    width: staticMap.width,
    height: staticMap.height,
    walkable: encodeWalkableMask((x, y) => staticMap.isWalkable(x, y), staticMap.width, staticMap.height),
    pois: BUILDINGS.map(({ event }) => ({ id: event.id, ...getEntrancePosition(event.id) })),
  };
};
