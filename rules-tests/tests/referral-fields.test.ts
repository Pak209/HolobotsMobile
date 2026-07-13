import { doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

// Genesis Squad referral fields: awarded only by the growth callables and
// the fitness-sync qualification hook. The client may publish its own
// referralCode and spend wildcardBlueprints via fallbacks, but must never
// introduce or change referredBy / referrals / referralQualified /
// genesisSquadClaimed / genesisBadge.
describe("referral field protection", () => {
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

  it("denies creating a profile that already claims referral rewards", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertFails(
      setDoc(doc(aliceDb, "users/alice"), { ...buildUserDoc(), genesisBadge: true }),
    );
    await assertFails(
      setDoc(doc(aliceDb, "users/alice"), {
        ...buildUserDoc(),
        referrals: { qualified: 3, pending: 0 },
      }),
    );
    await assertFails(
      setDoc(doc(aliceDb, "users/alice"), { ...buildUserDoc(), referredBy: "someone" }),
    );
  });

  it("denies the owner introducing server-only referral fields on update", async () => {
    await seedUser(env, "alice", buildUserDoc());
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    await assertFails(updateDoc(aliceDoc, { referredBy: "bobuid" }));
    await assertFails(updateDoc(aliceDoc, { referralQualified: true }));
    await assertFails(updateDoc(aliceDoc, { "referrals.qualified": 3 }));
    await assertFails(updateDoc(aliceDoc, { genesisSquadClaimed: "referral" }));
    await assertFails(updateDoc(aliceDoc, { genesisBadge: true }));
  });

  it("denies the owner changing server-set referral fields", async () => {
    await seedUser(env, "alice", {
      ...buildUserDoc(),
      referredBy: "bobuid",
      referrals: { qualified: 1, pending: 2 },
    });
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    await assertFails(updateDoc(aliceDoc, { referredBy: "carluid" }));
    await assertFails(updateDoc(aliceDoc, { referrals: { qualified: 99, pending: 0 } }));
  });

  it("allows ordinary owner updates on a profile that has server-set referral fields", async () => {
    await seedUser(env, "alice", {
      ...buildUserDoc(),
      referredBy: "bobuid",
      referralQualified: true,
      genesisBadge: true,
      genesisSquadClaimed: "referral",
      referrals: { qualified: 4, pending: 0 },
    });

    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), { dailyEnergy: 55 }),
    );
  });

  it("allows the owner to publish their own referral code (short string only)", async () => {
    await seedUser(env, "alice", buildUserDoc());
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    await assertSucceeds(updateDoc(aliceDoc, { referralCode: "ALICE1" }));
    await assertFails(updateDoc(aliceDoc, { referralCode: "X".repeat(40) }));
    await assertFails(updateDoc(aliceDoc, { referralCode: 123 }));
  });

  it("DENIES client wildcard writes since the 2026-07-12 economy freeze", async () => {
    await seedUser(env, "alice", { ...buildUserDoc(), wildcardBlueprints: 5 });
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    await assertFails(
      updateDoc(aliceDoc, { wildcardBlueprints: 10, lastWildcardPackAt: Date.now() }),
    );
    await assertFails(updateDoc(aliceDoc, { wildcardBlueprints: -1 }));
  });
});
