/**
 * The host the client parity tests run against (HARD RULE 1: the host decides).
 *
 * host-pin/src/ is a verbatim copy of the functions/src files the parity tests import (plus their
 * relative-import closure), taken from the commit the Firebase functions host is DEPLOYED from and
 * stamped with that sha and every file's git blob id in host-pin/HOST_PIN.json. It is not the
 * branch's own functions/ copy, which can lag main by any amount.
 *
 * - Re-pin after a host deploy: `node scripts/pin-host.mjs --sha <deployed sha> --note "<deploy>"`.
 * - Never edit host-pin/src by hand: hostPin.test.ts fails on any byte that differs from the manifest.
 * - HOLOCITY_HOST_ROOT=<a functions/ dir> redirects every pinned import to that checkout (vitest.config.ts)
 *   to preview a re-pin or run a known-bad control; hostPin.test.ts then fails, listing the drifted files.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOBILE_DIR = path.dirname(here);
export const PIN_DIR = path.join(here, "host-pin");
export const PIN_SRC = path.join(PIN_DIR, "src");
export const PIN_MANIFEST = path.join(PIN_DIR, "HOST_PIN.json");
export const PIN_SCHEMA = "holocity-host-pin-1";
/** How test files name a pinned host module: an import specifier through host-pin/src/, or hostSourceFile("..."). */
const PIN_SPECIFIER = /host-pin\/src\/([^'"]+)['"]|hostSourceFile\(\s*['"]([^'"]+)['"]\s*\)/g;

/** @returns {{schema: string, repo: string, sha: string, note: string, pinnedAt: string, entries: string[], files: Record<string, string>}} */
export function readPin() {
  return JSON.parse(readFileSync(PIN_MANIFEST, "utf8"));
}

/** The functions/src directory the pinned imports resolve to: the pin, or HOLOCITY_HOST_ROOT/src. */
export function resolveHostSrc(env = process.env) {
  const root = env.HOLOCITY_HOST_ROOT;
  if (!root) return PIN_SRC;
  const src = path.resolve(root, "src");
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`HOLOCITY_HOST_ROOT=${root} has no src/ directory; point it at a functions/ directory.`);
  }
  return src;
}

/** Absolute path of a host source file in the resolved host (for tests that read host bytes directly). */
export function hostSourceFile(relative) {
  return path.join(resolveHostSrc(), relative);
}

/** git's blob id for these bytes: what `git rev-parse <sha>:<path>` prints. */
export function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Every *.test.ts under mobile/src, as [absolute path, source]. */
export function testSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".test.ts")) out.push([full, readFileSync(full, "utf8")]);
    }
  };
  walk(path.join(MOBILE_DIR, "src"));
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The host modules the tests name through the pin, as functions/src-relative specifiers (sorted, unique). */
export function pinEntries(sources = testSources()) {
  const entries = new Set();
  for (const [, source] of sources) {
    for (const match of source.matchAll(PIN_SPECIFIER)) entries.add((match[1] ?? match[2]).replace(/\.ts$/, ""));
  }
  return [...entries].sort();
}

/**
 * The relative-import closure of `entries` inside one functions/src tree.
 * `read(relativePath)` returns the file's bytes, or null if the tree has no such file.
 * @returns {{files: Map<string, Buffer>, missing: string[]}}
 */
export function hostClosure(entries, read) {
  const files = new Map();
  const missing = [];
  const resolve = (base) => {
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, ".ts")]) {
      if (files.has(candidate)) return candidate;
      if (read(candidate) !== null) return candidate;
    }
    return null;
  };
  const visit = (relative) => {
    if (files.has(relative)) return;
    const bytes = read(relative);
    files.set(relative, bytes);
    if (!/\.tsx?$/.test(relative)) return;
    for (const { fileName } of ts.preProcessFile(bytes.toString("utf8"), true, true).importedFiles) {
      if (!fileName.startsWith(".")) continue;
      const target = resolve(path.posix.normalize(path.posix.join(path.posix.dirname(relative), fileName)));
      if (target === null) missing.push(`${fileName} (imported by ${relative})`);
      else visit(target);
    }
  };
  for (const entry of entries) {
    const target = resolve(entry);
    if (target === null) missing.push(`${entry} (imported by a test)`);
    else visit(target);
  }
  return { files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), missing };
}

/** A `read` for hostClosure over a directory on disk. */
export function directoryReader(srcDir) {
  return (relative) => {
    const full = path.join(srcDir, relative);
    return existsSync(full) && statSync(full).isFile() ? readFileSync(full) : null;
  };
}

/**
 * Compare a functions/src tree against the pin manifest.
 * @returns {string[]} one line per file whose bytes differ, that is missing, or that the closure now adds.
 */
export function driftFromPin(pin, read) {
  const drift = [];
  for (const [relative, blob] of Object.entries(pin.files)) {
    const bytes = read(relative);
    if (bytes === null) drift.push(`missing   ${relative}`);
    else if (gitBlobSha(bytes) !== blob) drift.push(`differs   ${relative}`);
  }
  const { files, missing } = hostClosure(pin.entries, read);
  for (const relative of files.keys()) if (!(relative in pin.files)) drift.push(`unpinned  ${relative}`);
  for (const line of missing) drift.push(`unresolved ${line}`);
  return [...new Set(drift)];
}
