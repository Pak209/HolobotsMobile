import { describe, expect, it } from "vitest";

import manifest from "../runtime/atlas-manifest.json";

// Root has no @types/node, and root `tsc --noEmit` type-checks overworld/**.
// A string-typed specifier keeps TS from resolving the module (typed `any`);
// vite-node resolves the Node builtin at runtime.
type FsLike = {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
};
const fsSpecifier: string = "node:fs";
const fs = (await import(/* @vite-ignore */ fsSpecifier)) as FsLike;

type Rect = { x: number; y: number; w: number; h: number };
type Entry = { rect: Rect; out?: string; redraw?: boolean; aspectDistortion?: boolean; keyed?: boolean };
type Section = "tiles" | "props" | "buildings";

const SECTION_DIR: Record<Section, string> = { tiles: "terrain", props: "props", buildings: "buildings" };
const runtimeDir = decodeURIComponent(new URL("../runtime/", import.meta.url).pathname);
const sections = manifest as unknown as Record<Section, Record<string, Entry>>;
const entries = (section: Section) => Object.entries(sections[section] ?? {});
const pngPath = (section: Section, name: string) => `${runtimeDir}${SECTION_DIR[section]}/${name}.png`;

/** Width/height from the PNG IHDR chunk (bytes 16–23, big-endian). */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect(Array.from(bytes.subarray(0, 8))).toEqual(signature);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("atlas manifest ↔ runtime assets", () => {
  it("has three non-empty sections with pixi-safe alias names", () => {
    for (const section of ["tiles", "props", "buildings"] as const) {
      expect(entries(section).length, section).toBeGreaterThan(0);
      for (const [name] of entries(section)) expect(name, `${section}/${name}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("references only PNGs that exist on disk (and warns about orphans)", () => {
    const missing: string[] = [];
    const referenced = new Set<string>();
    for (const section of ["tiles", "props", "buildings"] as const) {
      for (const [name] of entries(section)) {
        const file = pngPath(section, name);
        referenced.add(file);
        if (!fs.existsSync(file)) missing.push(`${section}/${name}`);
      }
    }
    expect(missing, `manifest entries without a PNG: ${missing.join(", ")}`).toEqual([]);

    const orphans: string[] = [];
    for (const dir of Object.values(SECTION_DIR)) {
      for (const file of fs.readdirSync(`${runtimeDir}${dir}`)) {
        if (file.endsWith(".png") && !referenced.has(`${runtimeDir}${dir}/${file}`)) orphans.push(`${dir}/${file}`);
      }
    }
    if (orphans.length) console.warn(`[atlasManifest] PNGs not referenced by the manifest: ${orphans.join(", ")}`);
  });

  it("has positive integer rects; tiles are exactly their declared 128x128 export", () => {
    for (const section of ["tiles", "props", "buildings"] as const) {
      for (const [name, entry] of entries(section)) {
        for (const key of ["x", "y", "w", "h"] as const) {
          expect(Number.isInteger(entry.rect[key]), `${section}/${name}.rect.${key}`).toBe(true);
        }
        expect(entry.rect.w, `${section}/${name}.rect.w`).toBeGreaterThan(0);
        expect(entry.rect.h, `${section}/${name}.rect.h`).toBeGreaterThan(0);
      }
    }
    for (const [name, entry] of entries("tiles")) {
      expect(entry.out, `tiles/${name}.out`).toMatch(/^\d+x\d+$/);
      const [outW, outH] = (entry.out as string).split("x").map(Number);
      const size = pngSize(fs.readFileSync(pngPath("tiles", name)));
      expect(size, `tiles/${name} png size vs out`).toEqual({ width: outW, height: outH });
      expect(size, `tiles/${name} must be 128x128`).toEqual({ width: 128, height: 128 });
    }
  });

  it("props/buildings PNGs are valid and sized like their source rects", () => {
    // Keyed crops are expected at source-rect size; tolerate small export padding but
    // catch wrong-file mistakes (a tile exported under a prop name, etc.).
    const observed: string[] = [];
    for (const section of ["props", "buildings"] as const) {
      for (const [name, entry] of entries(section)) {
        const size = pngSize(fs.readFileSync(pngPath(section, name)));
        observed.push(`${section}/${name}: ${size.width}x${size.height} (rect ${entry.rect.w}x${entry.rect.h})`);
        const ratioW = size.width / entry.rect.w;
        const ratioH = size.height / entry.rect.h;
        expect(ratioW, `${section}/${name} width ratio`).toBeGreaterThan(0.5);
        expect(ratioW, `${section}/${name} width ratio`).toBeLessThan(2.0);
        expect(ratioH, `${section}/${name} height ratio`).toBeGreaterThan(0.5);
        expect(ratioH, `${section}/${name} height ratio`).toBeLessThan(2.0);
      }
    }
    console.info(`[atlasManifest] prop/building sizes (first 6):\n  ${observed.slice(0, 6).join("\n  ")}`);
  });

  it("reports redraw / aspectDistortion flags for CI visibility", () => {
    const flagged = (flag: "redraw" | "aspectDistortion") =>
      (["tiles", "props", "buildings"] as const)
        .flatMap((section) => entries(section).filter(([, e]) => e[flag] === true).map(([n]) => `${section}/${n}`));
    console.info(`[atlasManifest] redraw:true → ${flagged("redraw").join(", ") || "(none)"}`);
    console.info(`[atlasManifest] aspectDistortion:true → ${flagged("aspectDistortion").join(", ") || "(none)"}`);
    expect(true).toBe(true);
  });
});
