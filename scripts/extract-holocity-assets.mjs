// Extract + normalize HoloCity runtime sprites from the AI concept atlases.
// Non-destructive: reference sheets are never modified.
//
// Cell rects come from measured gutter detection (scripts/measure-holocity-sheet.mjs
// -> overworld/assets/reference/{terrain,buildings}-grid.json), NOT a fixed
// lattice — the AI sheets have irregular gutters and margins. Names below are
// assigned to measured (band, cell) indices after visual inspection of the
// indexed contact sheets.
//
// Outputs (overworld/assets/runtime/):
//   terrain/<name>.png   opaque ground tiles, 128x128 nearest (near-square sources)
//   props/<name>.png     keyed (dark backdrop -> alpha) + tight-trimmed
//   buildings/<name>.png keyed + tight-trimmed landmark sprites
//   atlas-manifest.json  explicit source rects, sizes, and redraw flags
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "overworld", "assets", "reference");
const OUT = join(ROOT, "overworld", "assets", "runtime");
const TERRAIN = join(REF, "holocity-terrain-tileset-reference.png");
const BUILDINGS = join(REF, "holocity-buildings-reference.png");
const TGRID = JSON.parse(readFileSync(join(REF, "terrain-grid.json"), "utf8"));
const BGRID = JSON.parse(readFileSync(join(REF, "buildings-grid.json"), "utf8"));

// kind: tile = opaque 128x128; prop = keyed+trim. redraw flags pieces that need
// hand-normalization later for perfectly seamless tiling.
const T = (r, c, kind, extra = {}) => ({ r, c, kind, ...extra });
const NAMES = {
  // band 0 — light plaza stone
  "floor-plaza-a": T(0, 0, "tile"), "floor-plaza-b": T(0, 1, "tile"),
  "floor-plaza-cracked-a": T(0, 2, "tile"), "floor-plaza-seams": T(0, 3, "tile"),
  "floor-plaza-cross-seam": T(0, 4, "tile"), "floor-plaza-mossy": T(0, 5, "tile"),
  "floor-plaza-glass-inlay": T(0, 6, "tile", { redraw: true }),
  "floor-plaza-sparkle": T(0, 7, "tile"), "floor-plaza-inlay-gold": T(0, 8, "tile"),
  // band 1 — dark technology flooring
  "floor-tech-a": T(1, 0, "tile"), "floor-tech-b": T(1, 1, "tile"),
  "floor-tech-cracked": T(1, 2, "tile"), "floor-tech-slot": T(1, 3, "tile"),
  "floor-tech-panel": T(1, 4, "tile"), "floor-tech-column": T(1, 5, "tile"),
  "floor-tech-plain": T(1, 6, "tile"), "floor-tech-bolted": T(1, 7, "tile"),
  "floor-tech-vent": T(1, 8, "tile"),
  // band 2 — cyan circuit paths (on dark floor)
  "path-cyan-h-a": T(2, 0, "tile"), "path-cyan-h-b": T(2, 1, "tile"),
  "path-cyan-corner": T(2, 2, "tile"), "path-cyan-t": T(2, 3, "tile"),
  "path-cyan-cross-a": T(2, 4, "tile"), "path-cyan-cross-b": T(2, 5, "tile"),
  "path-cyan-node-square": T(2, 6, "tile"), "path-cyan-node-round": T(2, 7, "tile"),
  "path-cyan-node-inset": T(2, 8, "tile"),
  // band 3 — gold guidance lines (on light stone)
  "path-gold-h": T(3, 0, "tile"), "path-gold-end": T(3, 1, "tile"),
  "path-gold-corner": T(3, 2, "tile"), "path-gold-t": T(3, 3, "tile"),
  "path-gold-cross-a": T(3, 4, "tile"), "path-gold-cross-b": T(3, 5, "tile"),
  "path-gold-node-a": T(3, 6, "tile"), "path-gold-node-b": T(3, 7, "tile"),
  "path-gold-inlay": T(3, 8, "tile"),
  // band 4 — curbs / low boundary walls (overlay pieces, keyed)
  "curb-straight-a": T(4, 0, "prop"), "curb-straight-b": T(4, 1, "prop"),
  "curb-corner-a": T(4, 2, "prop"), "curb-straight-c": T(4, 3, "prop"),
  "curb-u-notch": T(4, 4, "prop"), "curb-u-wide": T(4, 5, "prop"),
  "curb-return": T(4, 6, "prop"), "curb-s-bend": T(4, 7, "prop", { redraw: true }),
  "curb-gold-bend": T(4, 8, "prop"), "curb-arch-cap": T(4, 9, "prop"),
  // band 5 — stairs / ramps / railed edges (overlay pieces)
  "stairs-wide-a": T(5, 0, "prop"), "stairs-wide-b": T(5, 1, "prop"),
  "stairs-post": T(5, 2, "prop"), "stairs-railed-a": T(5, 3, "prop"),
  "stairs-railed-b": T(5, 4, "prop"), "stairs-railed-c": T(5, 5, "prop"),
  "ramp-gold": T(5, 6, "prop"), "stairs-narrow": T(5, 7, "prop"),
  "wall-panel-framed": T(5, 8, "prop"),
  // band 6 — holographic water / data canals (near-square strips; keep opaque)
  "canal-h-a": T(6, 0, "tile", { redraw: true }), "canal-h-b": T(6, 1, "tile", { redraw: true }),
  "canal-h-c": T(6, 2, "tile", { redraw: true }), "canal-bend": T(6, 3, "tile", { redraw: true }),
  "canal-t": T(6, 4, "tile", { redraw: true }), "canal-cross-a": T(6, 5, "tile", { redraw: true }),
  "canal-cross-b": T(6, 6, "tile", { redraw: true }), "canal-node": T(6, 7, "tile", { redraw: true }),
  "canal-joint": T(6, 8, "tile", { redraw: true }), "canal-pool": T(6, 9, "tile", { redraw: true }),
  // band 7 — grass + transitions (0-5 tiles), planters (6-9 props)
  "grass-full-a": T(7, 0, "tile"), "grass-full-b": T(7, 1, "tile"),
  "grass-path-worn": T(7, 2, "tile"), "grass-edge-stone": T(7, 3, "tile"),
  "grass-tuft-stone": T(7, 4, "tile"), "grass-sparse-stone": T(7, 5, "tile"),
  "planter-long": T(7, 6, "prop"), "planter-u-a": T(7, 7, "prop"),
  "planter-u-b": T(7, 8, "prop"), "planter-corner": T(7, 9, "prop"),
  // band 8 — vegetation props
  "bush-flower-a": T(8, 0, "prop"), "bush-flower-b": T(8, 1, "prop"),
  "shrub": T(8, 2, "prop"), "fern": T(8, 3, "prop"),
  "bush-flower-c": T(8, 4, "prop"), "tree-a": T(8, 5, "prop"),
  "tree-b": T(8, 6, "prop"), "vine-hanging": T(8, 7, "prop"),
  "planter-box-a": T(8, 8, "prop"), "planter-box-b": T(8, 9, "prop"),
  // band 9 — plaza props
  "lantern-cyan-tall": T(9, 0, "prop"), "lantern-gold": T(9, 1, "prop"),
  "terminal-holo": T(9, 2, "prop"), "signpost": T(9, 3, "prop"),
  "bench": T(9, 4, "prop"), "pillar-cyan": T(9, 5, "prop"),
  "bollard-gold": T(9, 6, "prop"), "crate-stone": T(9, 7, "prop"),
  "crate-metal": T(9, 8, "prop"), "crate-gold": T(9, 9, "prop"),
  "debris-holobot": T(9, 10, "prop"),
  // band 10 — special pieces
  "data-wisp": T(10, 0, "prop"), "grate": T(10, 1, "prop"),
  "glass-panel": T(10, 2, "prop"), "pad-target-round": T(10, 3, "prop"),
  "wall-long-planted": T(10, 4, "prop"), "wall-diagonal": T(10, 5, "prop"),
  "wall-corner-curved": T(10, 6, "prop"),
};

const BUILDING_NAMES = {
  "h3-core-sanctuary": [0, 0], "arena-colosseum": [0, 1],
  "gacha-shrine": [1, 0], "story-archive": [1, 1],
  "holobot-workshop": [2, 0], "pilot-supply-shop": [2, 1],
  "residential-hub": [3, 0], "transit-gate": [3, 1],
};

async function keyBackground(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 36 && max - min < 14) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
}

const rectOf = (grid, r, c) => {
  const band = grid[r], cell = band?.cells?.[c];
  if (!cell) throw new Error(`no measured cell at band ${r} cell ${c}`);
  return { x: cell.x0, y: band.y0, w: cell.x1 - cell.x0, h: band.y1 - band.y0 };
};

async function run() {
  for (const d of ["terrain", "props", "buildings"]) mkdirSync(join(OUT, d), { recursive: true });
  const manifest = { generated: "extract-holocity-assets.mjs (measured grid)", tiles: {}, props: {}, buildings: {} };

  for (const [name, spec] of Object.entries(NAMES)) {
    const rect = rectOf(TGRID, spec.r, spec.c);
    if (spec.kind === "tile") {
      await sharp(TERRAIN).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
        .resize(128, 128, { kernel: "nearest", fit: "fill" }).png()
        .toFile(join(OUT, "terrain", `${name}.png`));
      manifest.tiles[name] = { rect, out: "128x128", aspectDistortion: Math.abs(rect.w - rect.h) > 10, redraw: !!spec.redraw };
    } else {
      const crop = await sharp(TERRAIN).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png().toBuffer();
      const keyed = await keyBackground(crop);
      await keyed.trim({ threshold: 8 }).toFile(join(OUT, "props", `${name}.png`));
      manifest.props[name] = { rect, keyed: true, redraw: !!spec.redraw };
    }
  }
  for (const [name, [r, c]] of Object.entries(BUILDING_NAMES)) {
    const rect = rectOf(BGRID, r, c);
    const crop = await sharp(BUILDINGS).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png().toBuffer();
    const keyed = await keyBackground(crop);
    await keyed.trim({ threshold: 8 }).toFile(join(OUT, "buildings", `${name}.png`));
    manifest.buildings[name] = { rect, keyed: true };
  }
  writeFileSync(join(OUT, "atlas-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`extracted ${Object.keys(manifest.tiles).length} tiles, ${Object.keys(manifest.props).length} props, ${Object.keys(manifest.buildings).length} buildings`);
}
run().catch((e) => { console.error(e); process.exit(1); });
