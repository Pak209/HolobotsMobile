/**
 * One-off data-hygiene migration: canonicalize `blueprints` map keys on
 * every users/{uid} document to toHolobotKey form (trimmed, lowercased,
 * spaces → hyphens), merging case/spacing variants by summing their counts.
 *
 * Why: legacy web-app writes left mixed-case keys ("ACE" next to "ace").
 * The mobile app and all server callables read/write only the canonical
 * key, so variant balances are invisible to players — and the Genesis
 * wildcard/duplicate-conversion paths would deposit next to them. Merging
 * can only INCREASE what players see; no data is discarded.
 *
 * Usage (from functions/):
 *   node scripts/migrate-blueprint-keys.mjs                  # dry run, prints the diff
 *   node scripts/migrate-blueprint-keys.mjs --apply          # writes the merges
 *   node scripts/migrate-blueprint-keys.mjs --key sa.json    # explicit service-account key
 *
 * Credentials: a service-account key via --key or the
 * GOOGLE_APPLICATION_CREDENTIALS env var (Firebase console → Project
 * settings → Service accounts → Generate new private key). Not needed when
 * FIRESTORE_EMULATOR_HOST is set (emulator).
 */
import { existsSync } from "node:fs";
import process from "node:process";

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "holobots-24046";
const PAGE_SIZE = 200;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keyFlagIndex = args.indexOf("--key");
const keyPath =
  keyFlagIndex !== -1 ? args[keyFlagIndex + 1] : process.env.GOOGLE_APPLICATION_CREDENTIALS;

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!usingEmulator && !keyPath) {
  console.error(
    "No credentials. Pass --key <service-account.json> or set GOOGLE_APPLICATION_CREDENTIALS.\n" +
      "(Firebase console → Project settings → Service accounts → Generate new private key.)",
  );
  process.exit(1);
}
if (!usingEmulator && !existsSync(keyPath)) {
  console.error(`Service-account key not found at: ${keyPath}`);
  process.exit(1);
}

initializeApp(
  usingEmulator ? { projectId: PROJECT_ID } : { credential: cert(keyPath), projectId: PROJECT_ID },
);
const db = getFirestore();

/** Mirror of toHolobotKey in functions/src/lib/mintingEconomy.ts. */
function toHolobotKey(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Returns the canonicalized blueprints map, or null when the document
 * already uses canonical keys everywhere (nothing to do).
 */
function canonicalizeBlueprints(blueprints) {
  if (!blueprints || typeof blueprints !== "object" || Array.isArray(blueprints)) {
    return null;
  }

  let changed = false;
  const merged = {};
  for (const [key, value] of Object.entries(blueprints)) {
    const canonical = toHolobotKey(key);
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      console.warn(`  ! skipping non-numeric count ${JSON.stringify(value)} under "${key}"`);
      merged[key] = value;
      continue;
    }
    if (canonical !== key || canonical in merged) {
      changed = true;
    }
    merged[canonical] = (merged[canonical] || 0) + amount;
  }

  return changed ? merged : null;
}

async function run() {
  let scanned = 0;
  let toMigrate = 0;
  let migrated = 0;
  let lastDoc = null;

  for (;;) {
    let query = db.collection("users").orderBy("__name__").limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const page = await query.get();
    if (page.empty) {
      break;
    }

    for (const doc of page.docs) {
      scanned += 1;
      const merged = canonicalizeBlueprints(doc.data().blueprints);
      if (!merged) {
        continue;
      }

      toMigrate += 1;
      console.log(`users/${doc.id}`);
      console.log(`  before: ${JSON.stringify(doc.data().blueprints)}`);
      console.log(`  after:  ${JSON.stringify(merged)}`);

      if (apply) {
        // Re-read inside a transaction so a concurrent economy write (arena
        // settlement, gacha) between page fetch and now can't be clobbered.
        await db.runTransaction(async (transaction) => {
          const fresh = await transaction.get(doc.ref);
          const freshMerged = canonicalizeBlueprints(fresh.data()?.blueprints);
          if (freshMerged) {
            transaction.update(doc.ref, { blueprints: freshMerged });
          }
        });
        migrated += 1;
      }
    }

    lastDoc = page.docs[page.docs.length - 1];
  }

  console.log("");
  console.log(`Scanned ${scanned} user document(s); ${toMigrate} need merging.`);
  if (apply) {
    console.log(`Applied ${migrated} merge(s).`);
  } else if (toMigrate > 0) {
    console.log("Dry run only — re-run with --apply to write the merges above.");
  } else {
    console.log("Nothing to migrate.");
  }
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
