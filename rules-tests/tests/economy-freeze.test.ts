import { doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

// The 2026-07-12 economy freeze: currency, items, loot, and fitness-derived
// stats are paid only by the callables. The owner keeps write access to the
// gameplay-state fields legit client paths still use.
describe("economy field freeze", () => {
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

  it("denies the owner raising every frozen currency/item field", async () => {
    await seedUser(env, "alice", buildUserDoc());
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    await assertFails(updateDoc(aliceDoc, { holosTokens: 1 }));
    await assertFails(updateDoc(aliceDoc, { syncPoints: 1 }));
    await assertFails(updateDoc(aliceDoc, { lifetimeSyncPoints: 1 }));
    await assertFails(updateDoc(aliceDoc, { seasonSyncPoints: 1 }));
    await assertFails(updateDoc(aliceDoc, { gachaTickets: 1 }));
    await assertFails(updateDoc(aliceDoc, { arenaPassses: 1 }));
    await assertFails(updateDoc(aliceDoc, { expBoosters: 1 }));
    await assertFails(updateDoc(aliceDoc, { energyRefills: 1 }));
    await assertFails(updateDoc(aliceDoc, { rankSkips: 1 }));
    await assertFails(updateDoc(aliceDoc, { wins: 99 }));
    await assertFails(updateDoc(aliceDoc, { losses: 0 - 0 + 5 }));
    await assertFails(updateDoc(aliceDoc, { blueprints: { ace: 999 } }));
    await assertFails(updateDoc(aliceDoc, { parts: [{ name: "Forged Part", slot: "core" }] }));
    await assertFails(updateDoc(aliceDoc, { packHistory: [{ id: "forged" }] }));
    await assertFails(updateDoc(aliceDoc, { todaySteps: 60000 }));
    await assertFails(updateDoc(aliceDoc, { syncRank: "Legend" }));
  });

  it("still allows the gameplay-state writes legit client paths use", async () => {
    await seedUser(env, "alice", buildUserDoc());
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");

    // Quest/training starts + energy regen.
    await assertSucceeds(updateDoc(aliceDoc, { dailyEnergy: 40 }));
    // Attribute-point spends rewrite holobots (and recompute leaderboardScore).
    await assertSucceeds(
      updateDoc(aliceDoc, {
        holobots: [{ name: "ACE", level: 1, experience: 0, rank: "Rookie", attributePoints: 9 }],
        leaderboardScore: 12,
      }),
    );
    // Mission/quest state, deck building, part equips.
    await assertSucceeds(updateDoc(aliceDoc, { rewardSystem: { arenaBattlesToday: 1 } }));
    await assertSucceeds(updateDoc(aliceDoc, { arena_deck_template_ids: ["strike.quickJab"] }));
    await assertSucceeds(updateDoc(aliceDoc, { battle_cards: { "strike.quickJab": 2 } }));
    await assertSucceeds(updateDoc(aliceDoc, { equippedParts: {} }));
  });

  it("an unchanged frozen field passing through a merge is fine", async () => {
    await seedUser(env, "alice", { ...buildUserDoc(), holosTokens: 500 });
    const aliceDb = authedDb(env, "alice");

    // setDoc merge with the SAME holosTokens value (post-merge equality).
    await assertSucceeds(
      setDoc(doc(aliceDb, "users/alice"), { dailyEnergy: 10, holosTokens: 500 }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(aliceDb, "users/alice"), { dailyEnergy: 10, holosTokens: 501 }, { merge: true }),
    );
  });

  it("signup creates pass, but pre-loaded creates fail", async () => {
    const aliceDb = authedDb(env, "alice");

    await assertSucceeds(setDoc(doc(aliceDb, "users/alice"), buildUserDoc()));

    const richDb = authedDb(env, "mallory");
    await assertFails(
      setDoc(doc(richDb, "users/mallory"), { ...buildUserDoc(), holosTokens: 99999 }),
    );
    await assertFails(
      setDoc(doc(richDb, "users/mallory"), { ...buildUserDoc(), blueprints: { ace: 80 } }),
    );
  });
});
