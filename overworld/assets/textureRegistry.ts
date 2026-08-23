import { Assets, Texture, TextureSource } from "pixi.js";

import manifest from "./runtime/atlas-manifest.json";

export const SOURCE_CELL_PX = 110;
export const TILE_SCALE = 32 / 128;
export const PROP_SCALE = 32 / SOURCE_CELL_PX;

type AssetKind = "tiles" | "props" | "buildings";
const KINDS = ["tiles", "props", "buildings"] as const satisfies readonly AssetKind[];

const assetUrls = import.meta.glob("./runtime/**/*.png", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const directoryFor = (kind: AssetKind): string => kind === "tiles" ? "terrain" : kind;

export interface TextureRegistry {
  readonly TILE_SCALE: number;
  readonly PROP_SCALE: number;
  tile(name: string): Texture;
  prop(name: string): Texture;
  building(name: string): Texture;
  has(name: string): boolean;
}

export async function loadTextureRegistry(): Promise<TextureRegistry> {
  TextureSource.defaultOptions.scaleMode = "nearest";
  const textures = new Map<string, Texture>();

  await Promise.all(KINDS.flatMap((kind) =>
    Object.keys(manifest[kind]).map(async (name) => {
      const path = `./runtime/${directoryFor(kind)}/${name}.png`;
      const src = assetUrls[path];
      if (!src) throw new Error(`[TextureRegistry] Missing bundled asset: ${path}`);
      const texture = await Assets.load<Texture>({ alias: `holocity:${kind}:${name}`, src });
      texture.source.scaleMode = "nearest";
      textures.set(`${kind}:${name}`, texture);
    })));

  const get = (kind: AssetKind, name: string): Texture => {
    const texture = textures.get(`${kind}:${name}`);
    if (!texture) throw new Error(`[TextureRegistry] Missing ${kind} texture: ${name}`);
    return texture;
  };

  return {
    TILE_SCALE,
    PROP_SCALE,
    tile: (name) => get("tiles", name),
    prop: (name) => get("props", name),
    building: (name) => get("buildings", name),
    has: (name) => [...textures.keys()].some((key) => key.endsWith(`:${name}`)),
  };
}
