import { collection, doc, getDocs, limit, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authedDb, initTestEnv, seedDoc, seedUser, unauthedDb } from "../src/helpers";
import { buildUserDoc, WEB_ENERGY_UPDATE, WEB_PROFILE_UPDATE } from "../src/fixtures";

// Replays the holobots-fun WEB app's real Firestore access patterns
// (see ../holobots-fun/src/lib/firestore.ts) against firestore.rules. The
// same Firebase project serves both the mobile and web apps, so a rules
// change that breaks these patterns is a production incident for the web app.
describe("web app write/read patterns", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
  });

  // The 2026-07-12 economy freeze DELIBERATELY breaks the web app's
  // client-side economy writes (owner decision: mobile is the product;
  // the web app must migrate to callables or sunset its economy actions).
  it("DENIES the web app's client-side economy profile update (frozen fields)", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), WEB_PROFILE_UPDATE),
    );
  });

  it("allows the owner to spend energy via the web app's updateUserEnergy write", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), WEB_ENERGY_UPDATE),
    );
  });

  it("denies another signed-in user from writing alice's energy", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(
      updateDoc(doc(authedDb(env, "bob"), "users/alice"), WEB_ENERGY_UPDATE),
    );
  });

  it("DENIES the old users-collection leaderboard query (projection replaces it)", async () => {
    await seedUser(env, "alice", buildUserDoc({ leaderboardScore: 100 }));
    await seedUser(env, "bob", buildUserDoc({ leaderboardScore: 300 }));

    const leaderboardQuery = query(
      collection(authedDb(env, "bob"), "users"),
      orderBy("leaderboardScore", "desc"),
      limit(10),
    );

    await assertFails(getDocs(leaderboardQuery));
  });

  it("serves the top-N from the /leaderboard projection (read-only)", async () => {
    await seedDoc(env, "leaderboard/alice", { username: "alice", leaderboardScore: 100 });
    await seedDoc(env, "leaderboard/bob", { username: "bob", leaderboardScore: 300 });
    await seedDoc(env, "leaderboard/carol", { username: "carol", leaderboardScore: 200 });

    const projectionQuery = query(
      collection(authedDb(env, "bob"), "leaderboard"),
      orderBy("leaderboardScore", "desc"),
      limit(10),
    );

    const snapshot = await assertSucceeds(getDocs(projectionQuery));
    expect(snapshot.docs.map((entry) => entry.data().leaderboardScore)).toEqual([300, 200, 100]);

    // Clients can never write the projection — only the mirror trigger.
    await assertFails(
      setDoc(doc(authedDb(env, "bob"), "leaderboard/bob"), { leaderboardScore: 999999 }),
    );
  });

  it("denies the leaderboard query for an unauthenticated reader", async () => {
    await seedUser(env, "alice", buildUserDoc({ leaderboardScore: 100 }));
    await seedUser(env, "bob", buildUserDoc({ leaderboardScore: 300 }));
    await seedUser(env, "carol", buildUserDoc({ leaderboardScore: 200 }));

    const leaderboardQuery = query(
      collection(unauthedDb(env), "users"),
      orderBy("leaderboardScore", "desc"),
      limit(10),
    );

    await assertFails(getDocs(leaderboardQuery));
  });

  it("rejects a web write that sets dailyEnergy above the sanity cap", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), { dailyEnergy: 100000001 }),
    );
  });
});

describe("remote app config", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("config docs are readable signed-in and never client-writable", async () => {
    await seedDoc(env, "config/appDistribution", { inviteUrl: "https://testflight.apple.com/join/x" });

    await assertSucceeds(getDocs(query(collection(authedDb(env, "alice"), "config"), limit(5))));
    await assertFails(
      setDoc(doc(authedDb(env, "alice"), "config/appDistribution"), { inviteUrl: "https://evil.example" }),
    );
  });
});
