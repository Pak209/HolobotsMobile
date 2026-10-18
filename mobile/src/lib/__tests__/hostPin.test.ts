import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOBILE_DIR,
  PIN_SCHEMA,
  PIN_SRC,
  directoryReader,
  driftFromPin,
  gitBlobSha,
  hostClosure,
  pinEntries,
  readPin,
  resolveHostSrc,
  testSources,
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
try {
  const ahead = execFileSync("git", ["-C", MOBILE_DIR, "diff", "--name-only", pin.sha, "origin/main", "--", "functions/src"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\n")
    .map((line) => line.replace(/^functions\/src\//, ""))
    .filter((relative) => relative in pin.files);
  if (ahead.length) {
    console.warn(`[host-pin] origin/main has moved past the pin in ${ahead.join(", ")}; once that host is deployed, re-pin (node scripts/pin-host.mjs --check origin/main).`);
  }
} catch {
  // No origin/main or no pinned commit in this clone (a shallow CI checkout); the checks below still run.
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
    expect(Object.keys(pin.files).length).toBeGreaterThan(0);
    for (const blob of Object.values(pin.files)) expect(blob).toMatch(/^[0-9a-f]{40}$/);
  });

  it("the vendored snapshot is byte-identical to the manifest (no hand edits, no strays)", () => {
    expect(filesUnder(PIN_SRC).sort()).toEqual(Object.keys(pin.files).sort());
    expect(driftFromPin(pin, directoryReader(PIN_SRC))).toEqual([]);
  });

  it("the snapshot is exactly what the tests import, plus its import closure", () => {
    expect(pinEntries()).toEqual(pin.entries);
    const { files, missing } = hostClosure(pin.entries, directoryReader(PIN_SRC));
    expect(missing).toEqual([]);
    expect([...files.keys()]).toEqual(Object.keys(pin.files).sort());
  });

  it("no test reaches the branch's own functions/ copy", () => {
    const offenders = testSources()
      .filter(([, source]) => /["'](?:\.\.\/)+functions\/(?:src|lib)\//.test(source))
      .map(([file]) => path.relative(MOBILE_DIR, file));
    expect(offenders).toEqual([]);
  });

  it("the resolved host serves exactly the pinned bytes (fails on host drift)", () => {
    const drift = driftFromPin(pin, directoryReader(hostSrc));
    expect(drift, `${hostSrc} has drifted from the pin ${pin.sha}; re-pin with scripts/pin-host.mjs`).toEqual([]);
  });

  it("the manifest matches the pinned commit's git objects, when this clone has them", (context) => {
    let tree: string;
    try {
      tree = execFileSync("git", ["-C", MOBILE_DIR, "ls-tree", "-r", "--full-tree", pin.sha, "--", "functions/src"], { encoding: "utf8" });
    } catch {
      const reason = `commit ${pin.sha} is not in this clone (git fetch origin ${pin.sha}); content was still checked against the manifest`;
      console.warn(`[host-pin] SKIPPED git cross-check: ${reason}.`);
      return context.skip(reason);
    }
    const blobs = Object.fromEntries(
      tree.split("\n").flatMap((line) => {
        const match = /^\d+ blob ([0-9a-f]{40})\tfunctions\/src\/(.+)$/.exec(line);
        return match && match[2] in pin.files ? [[match[2], match[1]]] : [];
      }),
    );
    expect(blobs).toEqual(pin.files);
  });

  it("gitBlobSha agrees with git's blob id", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
