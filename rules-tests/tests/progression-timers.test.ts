import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

// 2026-10-17 critic review S3 (host-economy-hardening-2): claimQuestRun / claimTrainingSession validate
// elapsed time and power against users/{uid}.progressionTimers, which only startQuestRun /
// startTrainingSession write. rewardSystem (the clients' display copy) stays owner-writable.
const STARTED = Date.UTC(2026, 9, 17, 12, 0, 0);
const timers = () => ({
  schemaVersion: "progression-timers-1",
  quests: {
    qr_request_0001: { runId: "qr_request_0001", questId: "abandoned_fortress", holobotName: "ACE", holobotPower: 900, energyCost: 30, startedAtMs: STARTED, endsAtMs: STARTED + 240 * 60 * 1000 },
  },
  training: { runId: "tr_request_0002", courseId: "attack", holobotName: "ACE", statBoosts: { attack: 12 }, expReward: 70, energyCost: 10, startedAtMs: STARTED, endsAtMs: STARTED + 30 * 60 * 1000 },
});

describe("progression timers are server-only", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedUser(env, "alice", buildUserDoc({ progressionTimers: timers(), rewardSystem: { activeQuests: [], activeTraining: null } }));
  });

  it("denies the owner back-dating, forging, replacing or deleting a start record", async () => {
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.quests.qr_request_0001.startedAtMs": 0 }));
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.quests.qr_request_0001.endsAtMs": STARTED }));
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.quests.qr_request_0001.holobotPower": 50000 }));
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.training.statBoosts.attack": 18 }));
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.quests.qr_forged_000001": { ...timers().quests.qr_request_0001, runId: "qr_forged_000001", startedAtMs: 0, endsAtMs: 240 * 60 * 1000 } }));
    await assertFails(updateDoc(aliceDoc, { progressionTimers: { ...timers(), quests: {} } }));
    await assertFails(updateDoc(aliceDoc, { progressionTimers: deleteField() }));
    await assertFails(setDoc(aliceDoc, { progressionTimers: { training: null } }, { merge: true }));
  });

  // training-reward-replay-proof-1: the claim ledger (progressionTimers.claimed) is read before every payout; a client
  // that could delete or rewrite an entry could replay a paid run.
  it("denies the owner writing, deleting or forging the claim ledger", async () => {
    const claimed = { [`t:attack:ACE:${STARTED}`]: { kind: "training", source: "legacy", runId: "", subject: "attack", holobotName: "ACE", startedAtMs: STARTED, claimedAtMs: STARTED + 30 * 60 * 1000 } };
    await seedUser(env, "alice", buildUserDoc({ progressionTimers: { ...timers(), claimed }, rewardSystem: { activeQuests: [], activeTraining: null } }));
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.claimed": {} }));
    await assertFails(updateDoc(aliceDoc, { "progressionTimers.claimed": deleteField() }));
    await assertFails(updateDoc(aliceDoc, { [`progressionTimers.claimed.t:attack:ACE:${STARTED}`]: deleteField() }));
    await assertFails(updateDoc(aliceDoc, { [`progressionTimers.claimed.t:attack:ACE:${STARTED}.claimedAtMs`]: 0 }));
    await assertFails(updateDoc(aliceDoc, { progressionTimers: timers() }));
    await assertFails(setDoc(aliceDoc, { progressionTimers: { claimed: {} } }, { merge: true }));
    await assertFails(setDoc(doc(authedDb(env, "dave"), "users/dave"), buildUserDoc({ progressionTimers: { schemaVersion: "progression-timers-1", quests: {}, training: null, claimed } })));
    // The display copy stays the owner's: restoring a paid run there is allowed (the host replays it, pays nothing).
    await assertSucceeds(updateDoc(aliceDoc, { "rewardSystem.activeTraining": { courseId: "attack", holobotName: "ACE", statBoosts: { attack: 12 }, expReward: 70, startedAt: new Date(STARTED).toISOString(), endsAt: new Date(STARTED + 30 * 60 * 1000).toISOString() } }));
  });

  it("denies a client creating a profile that already carries start records", async () => {
    await assertFails(setDoc(doc(authedDb(env, "bob"), "users/bob"), buildUserDoc({ progressionTimers: timers() })));
    await assertSucceeds(setDoc(doc(authedDb(env, "carol"), "users/carol"), buildUserDoc()));
  });

  it("keeps the census rewardSystem / dailyEnergy writes working and an unchanged-timers merge", async () => {
    const aliceDoc = doc(authedDb(env, "alice"), "users/alice");
    // Legacy QuestsScreen / TrainingScreen starts still write rewardSystem + dailyEnergy; inert without a server record.
    await assertSucceeds(updateDoc(aliceDoc, {
      dailyEnergy: 40,
      rewardSystem: { activeQuests: [{ id: "quest_legacy", questId: "forest_patrol", endsAt: "2026-01-01T00:00:00.000Z" }], activeTraining: null },
    }));
    await assertSucceeds(updateDoc(aliceDoc, { "rewardSystem.syncBoostEnabled": true }));
    await assertSucceeds(setDoc(aliceDoc, { progressionTimers: timers(), dailyEnergy: 30 }, { merge: true }));
  });
});
