import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser, unauthedDb } from "../src/helpers";
import {
  buildUserDoc,
  ENERGY_REGEN_UPDATE,
  FITNESS_DAILY_UPDATES,
  FITNESS_USER_UPDATES,
  GACHA_GRANT_UPDATE,
  SIGNUP_USER_DOC,
} from "../src/fixtures";

// Replays the mobile app's real Firestore write patterns against firestore.rules.
// If any "owner succeeds" assertion below fails, deploying the current rules
// would break the shipping app — do not weaken these tests to compensate.
describe("mobile write replay", () => {
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

  describe("signup (AuthContext.tsx setDoc merge:true)", () => {
    it("allows the owner to create their own user doc via setDoc merge", async () => {
      await assertSucceeds(
        setDoc(doc(authedDb(env, "alice"), "users/alice"), SIGNUP_USER_DOC, { merge: true }),
      );
    });

    it("denies another authenticated user from writing to alice's user doc", async () => {
      await assertFails(
        setDoc(doc(authedDb(env, "bob"), "users/alice"), SIGNUP_USER_DOC, { merge: true }),
      );
    });
  });

  describe("fitness sync (server-authoritative since the 2026-07-12 freeze)", () => {
    it("DENIES the old client-side fitness reward write (holosTokens is frozen)", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(
        setDoc(doc(authedDb(env, "alice"), "users/alice"), FITNESS_USER_UPDATES, { merge: true }),
      );
    });

    it("DENIES even the owner writing fitness_daily (server-only since 2026-07-13)", async () => {
      // The sync callables trust workoutSessionsCompleted from this doc for
      // the daily reward cap — a client write could dodge it.
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(
        setDoc(
          doc(authedDb(env, "alice"), "users/alice/fitness_daily/2026-07-06"),
          FITNESS_DAILY_UPDATES,
          { merge: true },
        ),
      );
    });

    it("still allows the owner to READ their fitness_daily doc", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertSucceeds(getDoc(doc(authedDb(env, "alice"), "users/alice/fitness_daily/2026-07-06")));
    });

    it("still allows owner writes to OTHER subcollections", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertSucceeds(
        setDoc(doc(authedDb(env, "alice"), "users/alice/settings/prefs"), { theme: "dark" }),
      );
    });

    it("denies another authenticated user from writing alice's fitness_daily doc", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(
        setDoc(
          doc(authedDb(env, "bob"), "users/alice/fitness_daily/2026-07-06"),
          FITNESS_DAILY_UPDATES,
          { merge: true },
        ),
      );
    });

    it("denies another authenticated user from reading alice's fitness_daily doc", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(getDoc(doc(authedDb(env, "bob"), "users/alice/fitness_daily/2026-07-06")));
    });
  });

  describe("energy regen (profile.ts updateDoc)", () => {
    it("allows the owner to update energy fields including a Timestamp", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertSucceeds(updateDoc(doc(authedDb(env, "alice"), "users/alice"), ENERGY_REGEN_UPDATE));
    });
  });

  describe("gacha grant (server-authoritative since the 2026-07-12 freeze)", () => {
    it("DENIES the old client-side gacha grant write (loot fields are frozen)", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(updateDoc(doc(authedDb(env, "alice"), "users/alice"), GACHA_GRANT_UPDATE));
    });
  });

  describe("unauthenticated", () => {
    it("denies an unauthenticated setDoc to a fitness_daily subcollection doc", async () => {
      await seedUser(env, "alice", buildUserDoc());

      await assertFails(
        setDoc(
          doc(unauthedDb(env), "users/alice/fitness_daily/2026-07-06"),
          FITNESS_DAILY_UPDATES,
          { merge: true },
        ),
      );
    });
  });
});
