/**
 * Fails (exit 1) if any listed byte-identical file (functions/src/shared/, plus
 * src/lib/battleSettlement.ts and src/lib/rivalTierStats.ts) has drifted from its canonical twin in the
 * mobile package. Runs as part of `npm run build`, so a
 * drifted copy can never be deployed. See the header comment in
 * src/shared/workoutRewardLimits.ts for why these files are duplicated.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const functionsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SHARED_FILES = [
  {
    functionsCopy: "src/shared/workoutRewardLimits.ts",
    mobileCopy: "../mobile/src/lib/security/workoutRewardLimits.ts",
  },
  {
    // DECISIONS #53-1: the one battle XP table (arena, rival, beast).
    functionsCopy: "src/lib/battleSettlement.ts",
    mobileCopy: "../mobile/src/lib/battleSettlement.ts",
  },
  {
    // DECISIONS #53 amendment 1: rival tier t = WOLF's battle stats at level 1 + 4t.
    functionsCopy: "src/lib/rivalTierStats.ts",
    mobileCopy: "../mobile/src/lib/rivalTierStats.ts",
  },
];

let failed = false;

for (const { functionsCopy, mobileCopy } of SHARED_FILES) {
  const functionsPath = path.join(functionsDir, functionsCopy);
  const mobilePath = path.join(functionsDir, mobileCopy);

  let functionsContent;
  let mobileContent;
  try {
    functionsContent = readFileSync(functionsPath, "utf8");
    mobileContent = readFileSync(mobilePath, "utf8");
  } catch (error) {
    console.error(`check:shared — could not read a shared file: ${error.message}`);
    failed = true;
    continue;
  }

  if (functionsContent !== mobileContent) {
    console.error(
      `check:shared — DRIFT DETECTED between:\n` +
        `  ${functionsPath}\n  ${mobilePath}\n` +
        `These must stay byte-identical. Copy the intended version over the stale one.`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`check:shared — ${SHARED_FILES.length} shared file(s) in sync.`);
