// Detect the true cell rects in the AI concept atlases by scanning for the
// flat dark gutter/margin pixels, instead of assuming a uniform lattice.
// Emits overworld/assets/reference/terrain-grid.json and an indexed contact
// sheet at /tmp/terrain-indexed.png for naming.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = process.argv[2] ?? join(ROOT, "overworld/assets/reference/holocity-terrain-tileset-reference.png");
const OUTJSON = process.argv[3] ?? join(ROOT, "overworld/assets/reference/terrain-grid.json");
const CONTACT = process.argv[4] ?? "/tmp/terrain-indexed.png";

const isDark = (r, g, b) => Math.max(r, g, b) < 36 && Math.max(r, g, b) - Math.min(r, g, b) < 14;

const { data, info } = await sharp(SHEET).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const darkFracRow = (y, x0, x1) => {
  let d = 0; for (let x = x0; x < x1; x++) { const i = (y * W + x) * C; if (isDark(data[i], data[i + 1], data[i + 2])) d++; }
  return d / (x1 - x0);
};
const darkFracCol = (x, y0, y1) => {
  let d = 0; for (let y = y0; y < y1; y++) { const i = (y * W + x) * C; if (isDark(data[i], data[i + 1], data[i + 2])) d++; }
  return d / (y1 - y0);
};

// 1) horizontal bands: rows that are ≥97% dark across full width are gutters
const rowDark = Array.from({ length: H }, (_, y) => darkFracRow(y, 0, W) >= 0.97);
const bands = [];
let start = null;
for (let y = 0; y < H; y++) {
  if (!rowDark[y] && start === null) start = y;
  if ((rowDark[y] || y === H - 1) && start !== null) {
    const end = rowDark[y] ? y : y + 1;
    if (end - start >= 40) bands.push({ y0: start, y1: end });
    start = null;
  }
}
// 2) cells within each band: columns ≥95% dark inside the band are gutters
const grid = [];
for (const band of bands) {
  const colDark = Array.from({ length: W }, (_, x) => darkFracCol(x, band.y0, band.y1) >= 0.95);
  const cells = [];
  let s = null;
  for (let x = 0; x < W; x++) {
    if (!colDark[x] && s === null) s = x;
    if ((colDark[x] || x === W - 1) && s !== null) {
      const e = colDark[x] ? x : x + 1;
      if (e - s >= 30) cells.push({ x0: s, x1: e });
      s = null;
    }
  }
  grid.push({ ...band, cells });
}
writeFileSync(OUTJSON, JSON.stringify(grid, null, 1));
console.log(grid.map((b, i) => `band ${i}: y ${b.y0}-${b.y1} (${b.y1 - b.y0}px), ${b.cells.length} cells [${b.cells.map(c => c.x1 - c.x0).join(",")}]`).join("\n"));

// 3) indexed contact sheet: each detected cell scaled to 96px, labeled r-c
const size = 96, cols = Math.max(...grid.map(b => b.cells.length));
const comps = [];
for (let r = 0; r < grid.length; r++) {
  for (let c = 0; c < grid[r].cells.length; c++) {
    const cell = grid[r].cells[c];
    const w = cell.x1 - cell.x0, h = grid[r].y1 - grid[r].y0;
    const buf = await sharp(SHEET).extract({ left: cell.x0, top: grid[r].y0, width: w, height: h })
      .resize(size, size, { kernel: "nearest", fit: "contain", background: "#333" }).png().toBuffer();
    const label = Buffer.from(`<svg width="${size}" height="${size}"><text x="4" y="14" font-size="13" fill="#ff5" font-family="monospace">${r}-${c}</text></svg>`);
    comps.push({ input: buf, left: c * size, top: r * size });
    comps.push({ input: label, left: c * size, top: r * size });
  }
}
await sharp({ create: { width: cols * size, height: grid.length * size, channels: 4, background: "#111" } })
  .composite(comps).png().toFile(CONTACT);
console.log(`indexed contact -> ${CONTACT}`);
