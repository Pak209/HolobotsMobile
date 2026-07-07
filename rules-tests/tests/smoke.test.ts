import { doc, getDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser, unauthedDb } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

describe("smoke: harness wiring", () => {
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

  it("denies an unauthenticated read of another user's document", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertFails(getDoc(doc(unauthedDb(env), "users/alice")));
  });

  it("allows the owner to read their own document", async () => {
    await seedUser(env, "alice", buildUserDoc());

    await assertSucceeds(getDoc(doc(authedDb(env, "alice"), "users/alice")));
  });
});
