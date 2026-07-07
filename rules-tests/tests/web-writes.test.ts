import { collection, doc, getDocs, limit, orderBy, query, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authedDb, initTestEnv, seedUser, unauthedDb } from "../src/helpers";
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

  it("allows the owner to apply the web app's profile update field mapping", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertSucceeds(
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

  it("supports the web leaderboard query (top-N by leaderboardScore) for a signed-in user", async () => {
    await seedUser(env, "alice", buildUserDoc({ leaderboardScore: 100 }));
    await seedUser(env, "bob", buildUserDoc({ leaderboardScore: 300 }));
    await seedUser(env, "carol", buildUserDoc({ leaderboardScore: 200 }));

    const leaderboardQuery = query(
      collection(authedDb(env, "bob"), "users"),
      orderBy("leaderboardScore", "desc"),
      limit(10),
    );

    const snapshot = await assertSucceeds(getDocs(leaderboardQuery));

    expect(snapshot.docs).toHaveLength(3);
    expect(snapshot.docs.map((d) => d.data().leaderboardScore)).toEqual([300, 200, 100]);
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
