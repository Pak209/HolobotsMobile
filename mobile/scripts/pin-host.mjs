// Vendors the deployed host's functions/src files that the parity tests import into
// mobile/test-fixtures/host-pin (see test-fixtures/hostPin.mjs). Reads git objects only, never a
// working tree, so the snapshot is exactly <sha>:functions/src. No network: fetch the sha first.
//
//   node scripts/pin-host.mjs --sha <deployed sha> --note "<what is deployed from it>"   re-pin
//   node scripts/pin-host.mjs --check                 exit 1 unless the snapshot is byte-identical to the pinned sha
//   node scripts/pin-host.mjs --check origin/main     exit 1 if the host at that ref has drifted from the pin
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MOBILE_DIR, PIN_MANIFEST, PIN_SCHEMA, PIN_SRC, directoryReader, driftFromPin, gitBlobSha, gitHostBlobs, gitHostTree, hostClosure,
  pinEntries, readPin,
} from "../test-fixtures/hostPin.mjs";

const git = (...args) => execFileSync("git", ["-C", MOBILE_DIR, ...args], { maxBuffer: 1 << 28 });
const fail = (message) => { console.error(`pin-host: ${message}`); process.exit(1); };

function commitOf(rev) {
  try { return git("rev-parse", "--verify", "--quiet", `${rev}^{commit}`).toString().trim(); }
  catch { return fail(`${rev} is not a commit in this clone; run \`git fetch origin ${rev}\` first.`); }
}

/** A hostClosure reader over <sha>:functions/src, from git objects. */
function gitReader(sha) {
  const blobs = gitHostBlobs(sha);
  if (!blobs || blobs.size === 0) fail(`${sha} has no functions/src.`);
  const cache = new Map();
  return (relative) => {
    if (!blobs.has(relative)) return null;
    if (!cache.has(relative)) cache.set(relative, git("cat-file", "blob", blobs.get(relative)));
    return cache.get(relative);
  };
}

function report(drift, against) {
  if (drift.length === 0) { console.log(`pin-host: OK, the pinned files are byte-identical at ${against}.`); return; }
  console.error(`pin-host: DRIFT, ${drift.length} pinned file(s) differ at ${against}:\n  ${drift.join("\n  ")}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : ""); };

if (flag("--check") !== undefined) {
  const pin = readPin();
  const entries = pinEntries();
  if (entries.join() !== pin.entries.join()) {
    fail(`the tests now import ${entries.filter((e) => !pin.entries.includes(e)).join(", ") || "fewer host modules"} outside the pin; re-pin.`);
  }
  report(driftFromPin(pin, directoryReader(PIN_SRC)), "the vendored snapshot (vs HOST_PIN.json)");
  const rev = flag("--check") || pin.sha;
  if (rev === pin.sha && gitHostTree(commitOf(pin.sha)) !== pin.srcTree) fail(`HOST_PIN.json srcTree ${pin.srcTree} is not ${pin.sha}:functions/src.`);
  report(driftFromPin(pin, gitReader(commitOf(rev))), rev === pin.sha ? `the pinned commit ${pin.sha}` : `${rev} (${commitOf(rev)})`);
} else if (flag("--sha")) {
  const sha = commitOf(flag("--sha"));
  const entries = pinEntries();
  const { files, missing } = hostClosure(entries, gitReader(sha));
  if (missing.length) fail(`${sha} cannot serve every pinned import:\n  ${missing.join("\n  ")}`);
  rmSync(PIN_SRC, { recursive: true, force: true });
  const blobs = {};
  for (const [relative, bytes] of files) {
    mkdirSync(path.dirname(path.join(PIN_SRC, relative)), { recursive: true });
    writeFileSync(path.join(PIN_SRC, relative), bytes);
    blobs[relative] = gitBlobSha(bytes);
  }
  const manifest = {
    schema: PIN_SCHEMA,
    repo: "Pak209/HolobotsMobile",
    sha,
    srcTree: gitHostTree(sha),
    note: flag("--note") || `functions/src at ${flag("--sha")}`,
    pinnedAt: new Date().toLocaleDateString("sv"),
    entries,
    files: blobs,
  };
  writeFileSync(PIN_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`pin-host: pinned ${files.size} files from ${sha} (${entries.length} test entry points).`);
} else {
  fail("usage: --sha <deployed sha> [--note <text>] | --check [<rev>]");
}
