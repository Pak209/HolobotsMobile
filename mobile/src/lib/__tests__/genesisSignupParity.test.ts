import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getGenesisStarterDeckGrants } from "@/lib/battleCards/catalog";
import { calculateExperience, computeLeaderboardScore, getHolobotRank, normalizeUserHolobot } from "@/lib/progression";

import * as server from "../../../../functions/src/lib/genesisSignup";

/**
 * HoloCity desktop sign-up creates its profile through the createGenesisProfile
 * callable (functions/src/lib/genesisSignup.ts). The mobile sign-up writes the
 * profile inline in AuthContext.signup. This test evaluates the mobile SOURCE
 * (the userRefData literal, createGenesisStarterHolobot and normalizeUsername)
 * with the real mobile helpers, so any edit to the mobile literal that is not
 * mirrored on the server fails here.
 */

const srcDir = path.resolve(__dirname, "../..");

function balancedBlock(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced block after ${marker}`);
}

const authSource = readFileSync(path.join(srcDir, "contexts/AuthContext.tsx"), "utf8");
const holobotsSource = readFileSync(path.join(srcDir, "config/holobots.ts"), "utf8");

const userRefDataLiteral = balancedBlock(authSource, "const userRefData = {");
const starterFunction = balancedBlock(holobotsSource, "export function createGenesisStarterHolobot(");
const starterLiteral = balancedBlock(starterFunction, "return normalizeUserHolobot({");
const normalizeMatch = /function normalizeUsername\(value: string\) \{\s*return ([^;]+);\s*\}/.exec(authSource);

type Timestamp = { __timestamp: true };
const TIMESTAMP: Timestamp = { __timestamp: true };

function mobileSignupDoc(starterHolobot: string, username: string, serverTimestamp: () => unknown = () => TIMESTAMP) {
  const normalizeUsername = new Function("value", `return ${normalizeMatch![1]};`) as (v: string) => string;
  const createGenesisStarterHolobot = new Function(
    "name",
    "normalizeUserHolobot",
    "calculateExperience",
    "getHolobotRank",
    `return normalizeUserHolobot(${starterLiteral});`,
  );
  const starterHolobotProfile = createGenesisStarterHolobot(
    starterHolobot,
    normalizeUserHolobot,
    calculateExperience,
    getHolobotRank,
  );
  const build = new Function(
    "starterDeck",
    "starterHolobotProfile",
    "normalizedUsername",
    "serverTimestamp",
    "computeLeaderboardScore",
    `return (${userRefDataLiteral});`,
  );
  return build(
    getGenesisStarterDeckGrants(),
    starterHolobotProfile,
    normalizeUsername(username),
    serverTimestamp,
    computeLeaderboardScore,
  ) as Record<string, unknown>;
}

describe("genesis sign-up client/server parity", () => {
  it("the mobile source still has the shape this test evaluates", () => {
    expect(normalizeMatch).not.toBeNull();
    expect(authSource).toContain("const starterDeck = getGenesisStarterDeckGrants();");
    expect(authSource).toContain("const starterHolobotProfile = createGenesisStarterHolobot(starterHolobot);");
    expect(authSource).toContain("const normalizedUsername = normalizeUsername(username);");
    expect(authSource).toContain('await setDoc(doc(db, "users", createdUser.uid), userRefData, { merge: true })');
  });

  it("starter choices match the mobile Genesis starters", () => {
    expect([...server.GENESIS_STARTER_CHOICES]).toEqual(["ACE", "KUMA", "SHADOW"]);
    expect(authSource).toContain('export type GenesisStarterChoice = "ACE" | "KUMA" | "SHADOW";');
  });

  it("server and mobile build identical profiles for every starter", () => {
    for (const starter of server.GENESIS_STARTER_CHOICES) {
      for (const username of ["PakPilot", "  Neo   Pilot  ", "abc"]) {
        const mobile = mobileSignupDoc(starter, username.trim());
        const desktop = server.buildGenesisSignupUserDoc(starter, username, TIMESTAMP);
        expect(Object.keys(desktop).sort()).toEqual(Object.keys(mobile).sort());
        expect(desktop).toEqual(mobile);
      }
    }
  });

  it("server validation follows the mobile form (trimmed username >= 3, Genesis starter only)", () => {
    expect(server.validateGenesisSignup("ACE", "ab")).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "   ab   ")).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "abc")).toEqual({ ok: true, starter: "ACE", username: "abc" });
    expect(server.validateGenesisSignup("HARE", "abc")).toEqual({ ok: false, reason: "invalid-starter" });
    expect(server.validateGenesisSignup("ace", "abc")).toEqual({ ok: false, reason: "invalid-starter" });
    expect(server.validateGenesisSignup("ACE", 42)).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "x".repeat(65))).toEqual({ ok: false, reason: "invalid-username" });
  });
});

/**
 * Emulator proof (opt-in): HOLOBOTS_SIGNUP_EMULATOR=1 HOLOBOTS_DESKTOP_UID=<uid created by HoloCity desktop
 * sign-up>. Creates a reference account through the MOBILE path (Firebase JS SDK Auth + the mobile
 * userRefData setDoc, through security rules) with the same username/starter, then compares both
 * users/{uid} documents field by field with the admin SDK.
 */
const emulatorProof = process.env.HOLOBOTS_SIGNUP_EMULATOR === "1";
describe.skipIf(!emulatorProof)("genesis sign-up emulator: desktop account equals a mobile account", () => {
  it("field-by-field equal except the per-account timestamps", async () => {
    const { createRequire } = await import("node:module");
    const mobileRequire = createRequire(path.resolve(__dirname, "../../../package.json"));
    const functionsRequire = createRequire(path.resolve(__dirname, "../../../../functions/package.json"));
    const { initializeApp, deleteApp } = mobileRequire("firebase/app");
    const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } = mobileRequire("firebase/auth");
    const { getFirestore, connectFirestoreEmulator, doc, setDoc, serverTimestamp, terminate } = mobileRequire("firebase/firestore");
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
    const admin = functionsRequire("firebase-admin/app");
    const adminFirestore = functionsRequire("firebase-admin/firestore");

    const desktopUid = process.env.HOLOBOTS_DESKTOP_UID!;
    const username = process.env.HOLOBOTS_SIGNUP_USERNAME ?? "Parity Pilot";
    const starter = process.env.HOLOBOTS_SIGNUP_STARTER ?? "KUMA";
    expect(desktopUid).toBeTruthy();

    const app = initializeApp({ projectId: "demo-holobots-desktop", apiKey: "emulator-key" }, "mobile-reference");
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    const email = `mobile-reference-${Date.now()}@example.test`;
    const credential = await createUserWithEmailAndPassword(auth, email, `emulator-only-${Date.now()}`);
    const mobileUid = credential.user.uid;
    // Exactly AuthContext.signup: setDoc(users/uid, userRefData, { merge: true }) as the signed-in user.
    await setDoc(doc(db, "users", mobileUid), mobileSignupDoc(starter, username.trim(), serverTimestamp), { merge: true });
    await signOut(auth);
    await terminate(db);
    await deleteApp(app);

    const adminApp = admin.initializeApp({ projectId: "demo-holobots-desktop" }, "parity-admin");
    const store = adminFirestore.getFirestore(adminApp);
    const [mobileDoc, desktopDoc] = await Promise.all([
      store.doc(`users/${mobileUid}`).get(),
      store.doc(`users/${desktopUid}`).get(),
    ]);
    expect(mobileDoc.exists).toBe(true);
    expect(desktopDoc.exists).toBe(true);
    const mobile = mobileDoc.data();
    const desktop = desktopDoc.data();
    const keys = [...new Set([...Object.keys(mobile), ...Object.keys(desktop)])].sort();
    // Firestore maps are unordered: compare with object keys sorted (array order still matters).
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
          : value;
    const rows: string[] = [];
    let mismatches = 0;
    for (const key of keys) {
      const a = mobile[key];
      const b = desktop[key];
      const bothTimestamps = a instanceof adminFirestore.Timestamp && b instanceof adminFirestore.Timestamp;
      const same = bothTimestamps || JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
      if (!same) mismatches += 1;
      rows.push(`${same ? "SAME" : "DIFF"} ${key} = ${bothTimestamps ? "<server timestamp>" : JSON.stringify(canonical(b))}${same ? "" : ` (mobile ${JSON.stringify(canonical(a))})`}`);
    }
    console.log(`mobileUid=${mobileUid} desktopUid=${desktopUid} fields=${keys.length} mismatches=${mismatches}\n${rows.join("\n")}`);
    await adminApp.delete();
    expect(mismatches).toBe(0);
  }, 30000);
});
