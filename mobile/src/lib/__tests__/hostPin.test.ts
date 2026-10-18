import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BRANCH_HOST_DIR,
  MOBILE_DIR,
  PIN_SCHEMA,
  PIN_SRC,
  branchHostReferences,
  codeSources,
  directoryReader,
  driftFromPin,
  gitBlobSha,
  gitHostBlobs,
  gitHostTree,
  hostClosure,
  pinEntries,
  pinnedFilesChangedOn,
  readPin,
  resolveHostSrc,
} from "../../../test-fixtures/hostPin.mjs";

/**
 * F5 (2026-10-17 critic): the parity tests used to import the branch's own functions/ copy, which
 * lagged the deployed host by 23 files. They now import a sha-stamped snapshot of the deployed host
 * (test-fixtures/host-pin), and these checks keep it honest.
 */
const pin = readPin();
const hostSrc = resolveHostSrc();
const overridden = hostSrc !== PIN_SRC;
console.info(
  `[host-pin] parity imports resolve to ${path.relative(MOBILE_DIR, hostSrc) || "."} ` +
    (overridden ? `(HOLOCITY_HOST_ROOT override; pin is ${pin.sha})` : `(pinned ${pin.sha}: ${pin.note})`),
);

// Not a failure: main can carry host changes that are not deployed yet. Re-pin after each host deploy.
const changedOnMain = pinnedFilesChangedOn(pin);
if (changedOnMain?.length) {
  console.warn(`[host-pin] origin/main has moved past the pin in ${changedOnMain.join(", ")}; once that host is deployed, re-pin (node scripts/pin-host.mjs --check origin/main).`);
}

function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(path.join(dir, name)).isDirectory() ? filesUnder(path.join(dir, name), relative) : [relative];
  });
}

describe("host pin: the parity tests run against the deployed host", () => {
  it("the manifest names one full commit and stamps every file", () => {
    expect(pin.schema).toBe(PIN_SCHEMA);
    expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.srcTree).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(pin.files).length).toBeGreaterThan(0);
    for (const blob of Object.values(pin.files)) expect(blob).toMatch(/^[0-9a-f]{40}$/);
  });

  it("the vendored snapshot is byte-identical to the manifest (no hand edits, no strays)", () => {
    expect(filesUnder(PIN_SRC).sort()).toEqual(Object.keys(pin.files).sort());
    expect(driftFromPin(pin, directoryReader(PIN_SRC))).toEqual([]);
  });

  it("the snapshot is exactly what mobile/src imports, plus its import closure", () => {
    expect(pinEntries()).toEqual(pin.entries);
    const { files, missing } = hostClosure(pin.entries, directoryReader(PIN_SRC));
    expect(missing).toEqual([]);
    expect([...files.keys()].sort()).toEqual(Object.keys(pin.files).sort());
  });

  it("no source under mobile/src names the branch's own functions/ copy", () => {
    const offenders = codeSources().flatMap(([file, source]) =>
      branchHostReferences(file, source).map((reference) => `${path.relative(MOBILE_DIR, file)}: ${reference}`),
    );
    expect(offenders).toEqual([]);
  });

  it("loading a module from the branch's functions/ copy is refused (vitest.config.ts)", async () => {
    const branchModule = path.join(BRANCH_HOST_DIR, "src", "lib", "progression.ts");
    await expect(import(/* @vite-ignore */ branchModule)).rejects.toThrow(/branch's own functions\/ copy/);
  });

  it("the resolved host serves exactly the pinned bytes (fails on host drift)", () => {
    const drift = driftFromPin(pin, directoryReader(hostSrc));
    expect(drift, `${hostSrc} has drifted from the pin ${pin.sha}; re-pin with scripts/pin-host.mjs`).toEqual([]);
  });

  it("the manifest matches the pinned commit's git objects", (context) => {
    const blobs = gitHostBlobs(pin.sha);
    if (blobs === null) {
      const reason = `commit ${pin.sha} is not in this clone (git fetch origin ${pin.sha}); the snapshot was still checked against the manifest`;
      if (process.env.HOLOCITY_REQUIRE_HOST_PIN_GIT === "1") throw new Error(`HOLOCITY_REQUIRE_HOST_PIN_GIT=1 but ${reason}`);
      console.warn(`[host-pin] SKIPPED git cross-check: ${reason}. HOLOCITY_REQUIRE_HOST_PIN_GIT=1 makes this a failure.`);
      return context.skip(reason);
    }
    expect(Object.fromEntries(Object.keys(pin.files).map((relative) => [relative, blobs.get(relative)]))).toEqual(pin.files);
    expect(gitHostTree(pin.sha)).toBe(pin.srcTree);
  });

  it("gitBlobSha agrees with git's blob id", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
