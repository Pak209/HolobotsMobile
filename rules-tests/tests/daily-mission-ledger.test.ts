import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildClientCreateDoc, buildUserDoc } from "../src/fixtures";

// 2026-10-17 critic review S2: claimDailyMission pays from users/{uid}.dailyMissionLedger,
// which only host callables write. rewardSystem stays owner-writable (quest/training starts
// in the main app and lite write it) and only carries a display mirror of the mission state.
const TODAY = "2026-10-17";
const ledger = () => ({
  arenaBattlesToday: 3,
  boosterPacksToday: 1,
  lastDailyMissionReset: TODAY,
  missionClaims: { daily_login: TODAY, arena_v2_battle: TODAY },
});

describe("daily mission ledger is server-only", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedUser(env, "alice", buildUserDoc({ dailyMissionLedger: ledger(), rewardSystem: { ...ledger(), activeQuests: [] } }));
  });

  it("denies the owner clearing, replacing, deleting or inflating the ledger", async () => {
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");
    await assertFails(updateDoc(aliceDoc, { "dailyMissionLedger.missionClaims": {} }));
    await assertFails(updateDoc(aliceDoc, { "dailyMissionLedger.missionClaims.arena_v2_battle": deleteField() }));
    await assertFails(updateDoc(aliceDoc, { dailyMissionLedger: { ...ledger(), missionClaims: {} } }));
    await assertFails(updateDoc(aliceDoc, { dailyMissionLedger: deleteField() }));
    await assertFails(updateDoc(aliceDoc, { "dailyMissionLedger.lastDailyMissionReset": "2026-10-16" }));
    await assertFails(updateDoc(aliceDoc, { "dailyMissionLedger.boosterPacksToday": 9 }));
    await assertFails(setDoc(aliceDoc, { dailyMissionLedger: { missionClaims: {} } }, { merge: true }));
  });

  it("denies a client creating a profile that already carries a ledger", async () => {
    await assertFails(setDoc(doc(authedDb(env, "bob"), "users/bob"), buildClientCreateDoc({ dailyMissionLedger: { ...ledger(), missionClaims: {} } })));
    await assertSucceeds(setDoc(doc(authedDb(env, "carol"), "users/carol"), buildClientCreateDoc()));
  });

  it("keeps the census rewardSystem writes working (quest/training starts, refresh, sync boost) and an unchanged-ledger merge", async () => {
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");
    // QuestsScreen start/refresh and TrainingScreen start/toggle send the whole normalized rewardSystem,
    // including the mirrored mission keys (zeroed on a new UTC day).
    await assertSucceeds(updateDoc(aliceDoc, {
      dailyEnergy: 40,
      rewardSystem: { arenaBattlesToday: 0, boosterPacksToday: 0, lastDailyMissionReset: "2026-10-18", missionClaims: {}, activeQuests: [{ questId: "scrapyard", endsAt: "2026-10-18T01:00:00.000Z" }] },
    }));
    await assertSucceeds(updateDoc(aliceDoc, { "rewardSystem.syncBoostEnabled": true }));
    // Clearing the mirror is allowed and inert: nothing pays from it.
    await assertSucceeds(updateDoc(aliceDoc, { "rewardSystem.missionClaims": {} }));
    await assertSucceeds(setDoc(aliceDoc, { dailyMissionLedger: ledger(), dailyEnergy: 30 }, { merge: true }));
  });
});
