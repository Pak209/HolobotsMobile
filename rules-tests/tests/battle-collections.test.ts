import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedDoc, unauthedDb } from "../src/helpers";
import { BATTLE_POOL_ENTRY, BATTLE_ROOM_DOC } from "../src/fixtures";

// Covers firestore.rules:
//   - match /battle_pool_entries/{uid}  (lines ~109-112)
//   - match /battle_rooms/{roomId}      (lines ~119-132)
//   - final default-deny catch-all      (lines ~135-137)
describe("battle_pool_entries / battle_rooms / default deny", () => {
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

  describe("battle_pool_entries", () => {
    it("allows the owner to create, update, and delete their own entry", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(setDoc(doc(alice, "battle_pool_entries/alice"), { ...BATTLE_POOL_ENTRY }));
      await assertSucceeds(
        updateDoc(doc(alice, "battle_pool_entries/alice"), { rank: "Champion" }),
      );
      await assertSucceeds(deleteDoc(doc(alice, "battle_pool_entries/alice")));
    });

    it("denies a non-owner from writing to another user's entry", async () => {
      await seedDoc(env, "battle_pool_entries/alice", { ...BATTLE_POOL_ENTRY });
      const bob = authedDb(env, "bob");

      await assertFails(setDoc(doc(bob, "battle_pool_entries/alice"), { ...BATTLE_POOL_ENTRY }));
      await assertFails(deleteDoc(doc(bob, "battle_pool_entries/alice")));
    });

    it("allows any signed-in user to read the pool but denies unauthenticated reads", async () => {
      await seedDoc(env, "battle_pool_entries/alice", { ...BATTLE_POOL_ENTRY });

      await assertSucceeds(getDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice")));
      await assertFails(getDoc(doc(unauthedDb(env), "battle_pool_entries/alice")));
    });
  });

  describe("battle_rooms", () => {
    it("allows the host to create a room with hostId matching their own uid", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(
        setDoc(doc(alice, "battle_rooms/room1"), { ...BATTLE_ROOM_DOC, hostId: "alice" }),
      );
    });

    it("denies creating a room with hostId set to someone else's uid", async () => {
      const bob = authedDb(env, "bob");

      await assertFails(
        setDoc(doc(bob, "battle_rooms/room2"), { ...BATTLE_ROOM_DOC, hostId: "alice" }),
      );
    });

    it("allows creating a room with no hostId field (defaults to the caller's uid)", async () => {
      // request.resource.data.get('hostId', request.auth.uid) == request.auth.uid
      // falls back to the caller's own uid when hostId is absent, so a doc
      // with no hostId field at all passes the create check trivially.
      const bob = authedDb(env, "bob");
      const { hostId: _hostId, ...roomWithoutHostId } = BATTLE_ROOM_DOC;

      await assertSucceeds(setDoc(doc(bob, "battle_rooms/room3"), { ...roomWithoutHostId }));
    });

    it("allows participants (hostId/guestId) to update, denies non-participants", async () => {
      await seedDoc(env, "battle_rooms/room4", { ...BATTLE_ROOM_DOC, hostId: "alice", guestId: "bob" });

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "bob"), "battle_rooms/room4"), { status: "finished" }),
      );

      await seedDoc(env, "battle_rooms/room5", { ...BATTLE_ROOM_DOC, hostId: "alice", guestId: "bob" });
      await assertFails(
        updateDoc(doc(authedDb(env, "carol"), "battle_rooms/room5"), { status: "finished" }),
      );
    });

    it("allows participants recorded via p1/p2 to update the room", async () => {
      await seedDoc(env, "battle_rooms/room6", { ...BATTLE_ROOM_DOC, p1: "carol", p2: "bob" });

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "carol"), "battle_rooms/room6"), { status: "finished" }),
      );
    });

    it("allows only the host to delete the room", async () => {
      await seedDoc(env, "battle_rooms/room7", { ...BATTLE_ROOM_DOC, hostId: "alice", guestId: "bob" });
      await assertSucceeds(deleteDoc(doc(authedDb(env, "alice"), "battle_rooms/room7")));

      await seedDoc(env, "battle_rooms/room8", { ...BATTLE_ROOM_DOC, hostId: "alice", guestId: "bob" });
      await assertFails(deleteDoc(doc(authedDb(env, "bob"), "battle_rooms/room8")));
    });
  });

  describe("default deny catch-all", () => {
    it("denies writes and reads to an unmatched collection", async () => {
      const alice = authedDb(env, "alice");

      await assertFails(setDoc(doc(alice, "some_random_collection/doc1"), { a: 1 }));

      await seedDoc(env, "another_unknown_collection/doc1", { a: 1 });
      await assertFails(getDoc(doc(alice, "another_unknown_collection/doc1")));
    });
  });
});
