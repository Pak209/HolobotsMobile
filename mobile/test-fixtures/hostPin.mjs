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
import { execFileSync } from "node:child_process";
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
/** The branch's own host copy. Parity tests must never load it (vitest.config.ts enforces this at load time). */
export const BRANCH_HOST_DIR = path.resolve(MOBILE_DIR, "..", "functions");
/** Where the host lives in the repo's tree. */
const HOST_TREE = "functions/src";
/** How test files name a pinned host module: an import specifier through host-pin/src/, or hostSourceFile("..."). */
const PIN_SPECIFIER = /host-pin\/src\/([^'"]+)['"]|hostSourceFile\(\s*['"]([^'"]+)['"]\s*\)/g;

/** @returns {{schema: string, repo: string, sha: string, srcTree: string, note: string, pinnedAt: string, entries: string[], files: Record<string, string>}} */
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

const git = (...args) => execFileSync("git", ["-C", MOBILE_DIR, ...args], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

/** Blob id of every file in <rev>:functions/src, keyed by functions/src-relative path; null if this clone lacks <rev>. */
export function gitHostBlobs(rev) {
  let listing;
  try { listing = git("ls-tree", "-r", "--full-tree", rev, "--", HOST_TREE).toString(); } catch { return null; }
  const blobs = new Map();
  for (const line of listing.split("\n")) {
    const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (match && match[2].startsWith(`${HOST_TREE}/`)) blobs.set(match[2].slice(HOST_TREE.length + 1), match[1]);
  }
  return blobs;
}

/** git's tree id of <rev>:functions/src; null if this clone lacks <rev>. */
export function gitHostTree(rev) {
  try { return git("rev-parse", `${rev}:${HOST_TREE}`).toString().trim(); } catch { return null; }
}

/** Pinned files that origin/main has changed since the pin; null if this clone lacks either commit. */
export function pinnedFilesChangedOn(pin, rev = "origin/main") {
  let names;
  try { names = git("diff", "--name-only", pin.sha, rev, "--", `:(top)${HOST_TREE}`).toString(); } catch { return null; }
  return names.split("\n").map((name) => name.slice(HOST_TREE.length + 1)).filter((relative) => relative in pin.files);
}

/** git's tree id for a directory on disk: what `git rev-parse <sha>:<dir>` prints when the bytes match. */
export function gitTreeSha(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const sha = gitTreeSha(full);
      if (sha !== null) entries.push({ name, mode: "40000", sha, key: `${name}/` });
    } else {
      entries.push({ name, mode: stat.mode & 0o111 ? "100755" : "100644", sha: gitBlobSha(readFileSync(full)), key: name });
    }
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, "hex")]));
  return createHash("sha1").update(`tree ${body.length}\0`).update(body).digest("hex");
}

/** Every source file under mobile/src (tests, test helpers and app code), as [absolute path, source]. */
export function codeSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.[cm]?[jt]sx?$/.test(name)) out.push([full, readFileSync(full, "utf8")]);
    }
  };
  walk(path.join(MOBILE_DIR, "src"));
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every *.test.ts under mobile/src. */
export function testSources() {
  return codeSources().filter(([file]) => file.endsWith(".test.ts"));
}

/**
 * String literals in `source` that name the branch's functions/src or functions/lib: a path such as
 * "../functions/src/x", or adjacent "functions", "src" segments as in path.join(..., "functions", "src").
 * Comments are ignored (only literals are read).
 */
export function branchHostReferences(fileName, source) {
  const found = [];
  const literal = (node) => (ts.isStringTextContainingNode(node) ? node.text : null);
  const visit = (node) => {
    const text = literal(node);
    if (text !== null && /(?:^|\/)functions\/(?:src|lib)(?:\/|$)/.test(text)) found.push(text);
    const siblings = ts.isCallExpression(node) || ts.isNewExpression(node) ? node.arguments ?? [] : ts.isArrayLiteralExpression(node) ? node.elements : [];
    for (let i = 0; i + 1 < siblings.length; i += 1) {
      if (literal(siblings[i]) === "functions" && ["src", "lib"].includes(literal(siblings[i + 1]))) found.push(`"functions", "${literal(siblings[i + 1])}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true));
  return found;
}

/** The host modules the tests name through the pin, as functions/src-relative specifiers (sorted, unique). */
export function pinEntries(sources = codeSources()) {
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
