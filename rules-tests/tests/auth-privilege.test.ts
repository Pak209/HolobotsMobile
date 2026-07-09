import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser, unauthedDb } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

describe("auth boundaries", () => {
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

  it("denies an unauthenticated getDoc of another user's document", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(getDoc(doc(unauthedDb(env), "users/alice")));
  });

  it("denies an unauthenticated setDoc of another user's document", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(setDoc(doc(unauthedDb(env), "users/alice"), buildUserDoc()));
  });

  it("allows a signed-in user to read another user's document (leaderboard reads)", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertSucceeds(getDoc(doc(authedDb(env, "bob"), "users/alice")));
  });

  it("denies a signed-in user from updating or deleting another user's document", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(
      updateDoc(doc(authedDb(env, "bob"), "users/alice"), { holosTokens: 10 }),
    );
    await assertFails(deleteDoc(doc(authedDb(env, "bob"), "users/alice")));
  });

  it("allows the owner to create, update, and delete their own document", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertSucceeds(setDoc(doc(aliceDb, "users/alice"), buildUserDoc()));
    await assertSucceeds(updateDoc(doc(aliceDb, "users/alice"), { holosTokens: 10 }));
    await assertSucceeds(deleteDoc(doc(aliceDb, "users/alice")));
  });
});

describe("privilege escalation", () => {
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

  it("denies creating a document with isDevAccount: true", async () => {
    await assertFails(
      setDoc(doc(authedDb(env, "alice"), "users/alice"), buildUserDoc({ isDevAccount: true })),
    );
  });

  it("denies flipping isDevAccount to true via update", async () => {
    await seedUser(env, "alice", buildUserDoc({ isDevAccount: false }));

    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), { isDevAccount: true }),
    );
  });

  it("allows creating and updating a document that keeps isDevAccount: false", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertSucceeds(
      setDoc(doc(aliceDb, "users/alice"), buildUserDoc({ isDevAccount: false })),
    );
    await assertSucceeds(
      updateDoc(doc(aliceDb, "users/alice"), { isDevAccount: false }),
    );
  });

  // Regression: a legacy account that already has isDevAccount: true must
  // still be able to perform normal economy writes. The original update rule
  // ran noPrivilegeEscalation() against the whole post-merge document, which
  // denied EVERY update on such accounts (real production incident: gacha,
  // marketplace, and quest claims all returned permission-denied).
  it("allows normal updates on a legacy account with isDevAccount already true", async () => {
    await seedUser(env, "alice", buildUserDoc({ isDevAccount: true }));

    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), { gachaTickets: 5 }),
    );
  });

  it("still denies flipping to true even from a legacy-true account snapshot", async () => {
    await seedUser(env, "alice", buildUserDoc({ isDevAccount: false }));

    // Explicitly writing true when the stored value is false stays denied.
    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        gachaTickets: 5,
        isDevAccount: true,
      }),
    );
  });

  it("allows a legacy-true account to keep or renounce the flag", async () => {
    await seedUser(env, "alice", buildUserDoc({ isDevAccount: true }));
    const aliceDb = authedDb(env, "alice");

    // Writing the unchanged value alongside an economy field is fine...
    await assertSucceeds(
      updateDoc(doc(aliceDb, "users/alice"), { holosTokens: 10, isDevAccount: true }),
    );
    // ...and so is turning it off.
    await assertSucceeds(
      updateDoc(doc(aliceDb, "users/alice"), { isDevAccount: false }),
    );
  });
});

describe("economy sanity caps", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedUser(env, "alice", buildUserDoc());
  });

  it("rejects holosTokens over the cap and accepts the boundary value", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { holosTokens: 100000001 }));
    await assertSucceeds(updateDoc(doc(aliceDb, "users/alice"), { holosTokens: 100000000 }));
  });

  it("rejects negative syncPoints and accepts zero", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { syncPoints: -1 }));
    await assertSucceeds(updateDoc(doc(aliceDb, "users/alice"), { syncPoints: 0 }));
  });

  it("rejects an absurd stepEnergyGrantedToday and accepts a sane value", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(
      updateDoc(doc(aliceDb, "users/alice"), { stepEnergyGrantedToday: 999999999 }),
    );
    await assertSucceeds(updateDoc(doc(aliceDb, "users/alice"), { stepEnergyGrantedToday: 40 }));
  });

  it("rejects a non-numeric dailyEnergy value", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { dailyEnergy: "lots" }));
  });

  it("rejects an over-cap gachaTickets value", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { gachaTickets: 100000001 }));
  });

  it("rejects an over-cap leaderboardScore value", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { leaderboardScore: 100000001 }));
  });
});
