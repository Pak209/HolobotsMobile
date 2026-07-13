/**
 * One-off backfill: projects every existing users/{uid} document into the
 * /leaderboard/{uid} collection (same fields as the mirrorLeaderboardEntry
 * trigger, which only fires on future writes). Idempotent — safe to re-run.
 *
 * Usage (from functions/):
 *   node scripts/backfill-leaderboard.mjs --key <service-account.json>
 */
import { existsSync } from "node:fs";
import process from "node:process";

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "holobots-24046";
const args = process.argv.slice(2);
const keyFlagIndex = args.indexOf("--key");
const keyPath = keyFlagIndex !== -1 ? args[keyFlagIndex + 1] : process.env.GOOGLE_APPLICATION_CREDENTIALS;
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!usingEmulator && (!keyPath || !existsSync(keyPath))) {
  console.error("Pass --key <service-account.json> (console → Service accounts → Generate new private key).");
  process.exit(1);
}

initializeApp(usingEmulator ? { projectId: PROJECT_ID } : { credential: cert(keyPath), projectId: PROJECT_ID });
const db = getFirestore();

function projectEntry(uid, data) {
  const holobots = Array.isArray(data.holobots) ? data.holobots : [];
  const highestHolobotLevel = holobots.reduce(
    (highest, holobot) => Math.max(highest, Number(holobot?.level || 0)),
    0,
  );
  return {
    username: String(data.username || `pilot_${uid.slice(0, 8)}`),
    leaderboardScore: Number(data.leaderboardScore || 0),
    wins: Number(data.wins || 0),
    prestigeCount: Number(data.prestigeCount || 0),
    highestHolobotLevel,
    syncRank: String(data.syncRank || "Rookie"),
    genesisBadge: Boolean(data.genesisBadge),
  };
}

const users = await db.collection("users").get();
let written = 0;
for (const doc of users.docs) {
  await db.doc(`leaderboard/${doc.id}`).set(projectEntry(doc.id, doc.data()), { merge: false });
  written += 1;
}
console.log(`Projected ${written} user(s) into /leaderboard.`);
process.exit(0);
