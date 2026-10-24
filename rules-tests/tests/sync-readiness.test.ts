import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

const readiness = { ACE: { milli: 80_000, atMs: 1_782_259_200_000 } };

describe("syncReadiness is a protected top-level host field", () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await seedUser(env, "alice", buildUserDoc({ syncReadiness: readiness }));
  });

  it("refuses owner create, replace, nested gain and deletion", async () => {
    const alice = doc(authedDb(env, "alice"), "users/alice");
    await assertFails(setDoc(doc(authedDb(env, "mallory"), "users/mallory"), buildUserDoc({ syncReadiness: readiness })));
    await assertFails(updateDoc(alice, { syncReadiness: { ACE: { milli: 100_000, atMs: 1_782_259_200_000 } } }));
    await assertFails(updateDoc(alice, { "syncReadiness.ACE.milli": 100_000 }));
    await assertFails(updateDoc(alice, { syncReadiness: deleteField() }));
  });

  it("permits unrelated owner updates and unchanged full-profile merge", async () => {
    const alice = doc(authedDb(env, "alice"), "users/alice");
    await assertSucceeds(updateDoc(alice, { dailyEnergy: 40 }));
    await assertSucceeds(setDoc(alice, { syncReadiness: readiness, dailyEnergy: 39 }, { merge: true }));
  });
});
