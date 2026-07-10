import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedDoc, unauthedDb } from "../src/helpers";
import { buildBattleRoom, buildPoolEntry } from "../src/fixtures";

// Covers firestore.rules:
//   - match /battle_pool_entries/{entryId}
//   - match /battle_rooms/{roomId}
//   - final default-deny catch-all
//
// All seeds use the REAL client shapes (see fixtures.ts). The original suite
// seeded top-level hostId/guestId fields no client ever wrote, so the old
// rules passed their tests while denying every real PvP write in production.
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
    it("allows creating a uid-keyed entry describing yourself (mobile client shape)", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(setDoc(doc(alice, "battle_pool_entries/alice"), buildPoolEntry("alice")));
    });

    it("allows creating an auto-ID entry describing yourself (web client shape)", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(addDoc(collection(alice, "battle_pool_entries"), buildPoolEntry("alice")));
    });

    it("denies creating an entry that describes another user", async () => {
      const bob = authedDb(env, "bob");

      await assertFails(setDoc(doc(bob, "battle_pool_entries/bob"), buildPoolEntry("alice")));
      await assertFails(setDoc(doc(bob, "battle_pool_entries/alice"), buildPoolEntry("alice")));
    });

    it("allows the owner (by userId field) to update and delete their entry", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));
      const alice = authedDb(env, "alice");

      await assertSucceeds(updateDoc(doc(alice, "battle_pool_entries/alice"), { isActive: false }));
      await assertSucceeds(deleteDoc(doc(alice, "battle_pool_entries/alice")));
    });

    // BUG C regression: matchmaking must be able to CLAIM an opponent's
    // active entry (flip isActive + stamp roomId, nothing else). The old
    // rules were owner-only on update, which denied the claim and — combined
    // with auto-ID creates being keyed against {uid} — made matchmaking
    // impossible under the deployed rules.
    it("allows a searcher to claim another player's active entry", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice"), {
          isActive: false,
          roomId: "room-1",
        }),
      );
    });

    it("denies claiming an entry that is already claimed or inactive", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice", { isActive: false, roomId: "room-1" }));

      await assertFails(
        updateDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice"), {
          isActive: false,
          roomId: "room-2",
        }),
      );
    });

    it("denies a claim that touches anything beyond isActive + roomId", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));

      await assertFails(
        updateDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice"), {
          isActive: false,
          roomId: "room-1",
          holobotStats: { attack: 1 },
        }),
      );
    });

    it("denies a claim that deactivates an entry without stamping a roomId", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));

      await assertFails(
        updateDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice"), { isActive: false }),
      );
    });

    it("denies a non-owner from deleting another user's entry", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));

      await assertFails(deleteDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice")));
    });

    it("allows any signed-in user to read the pool but denies unauthenticated reads", async () => {
      await seedDoc(env, "battle_pool_entries/alice", buildPoolEntry("alice"));

      await assertSucceeds(getDoc(doc(authedDb(env, "bob"), "battle_pool_entries/alice")));
      await assertFails(getDoc(doc(unauthedDb(env), "battle_pool_entries/alice")));
    });
  });

  describe("battle_rooms", () => {
    it("allows creating a waiting room where the creator is p1 (createRoom shape)", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(setDoc(doc(alice, "battle_rooms/room1"), buildBattleRoom("alice", "")));
    });

    it("allows creating an active room with both players when the creator is p1 (matchmaking shape)", async () => {
      const alice = authedDb(env, "alice");

      await assertSucceeds(setDoc(doc(alice, "battle_rooms/room2"), buildBattleRoom("alice", "bob")));
    });

    it("denies creating a room the caller is not a player in", async () => {
      const carol = authedDb(env, "carol");

      await assertFails(setDoc(doc(carol, "battle_rooms/room3"), buildBattleRoom("alice", "bob")));
    });

    // BUG B regression: participants are identified by players.p1.uid /
    // players.p2.uid — the only shape either client writes. The old rule
    // checked top-level hostId/guestId/p1/p2 fields that never existed, so
    // EVERY real participant update (heartbeat, stamina regen, playCard,
    // join) was PERMISSION_DENIED and live PvP was fully bricked.
    it("allows p1 to update a realistically-shaped room", async () => {
      await seedDoc(env, "battle_rooms/room4", buildBattleRoom("alice", "bob"));

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "alice"), "battle_rooms/room4"), {
          "players.p1.stamina": 6,
          currentTurn: 1,
        }),
      );
    });

    it("allows p2 to update a realistically-shaped room", async () => {
      await seedDoc(env, "battle_rooms/room5", buildBattleRoom("alice", "bob"));

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "bob"), "battle_rooms/room5"), {
          "players.p2.isConnected": true,
        }),
      );
    });

    it("denies a non-participant from updating the room", async () => {
      await seedDoc(env, "battle_rooms/room6", buildBattleRoom("alice", "bob"));

      await assertFails(
        updateDoc(doc(authedDb(env, "carol"), "battle_rooms/room6"), { status: "completed" }),
      );
    });

    it("allows a joiner to fill the empty p2 slot of a waiting room", async () => {
      await seedDoc(env, "battle_rooms/room7", buildBattleRoom("alice", ""));

      await assertSucceeds(
        updateDoc(doc(authedDb(env, "bob"), "battle_rooms/room7"), {
          "players.p2.uid": "bob",
          "players.p2.username": "bob",
          status: "active",
        }),
      );
    });

    it("denies taking over an occupied p2 slot", async () => {
      await seedDoc(env, "battle_rooms/room8", buildBattleRoom("alice", "bob"));

      await assertFails(
        updateDoc(doc(authedDb(env, "carol"), "battle_rooms/room8"), {
          "players.p2.uid": "carol",
        }),
      );
    });

    it("allows a participant to delete the room, denies strangers", async () => {
      await seedDoc(env, "battle_rooms/room9", buildBattleRoom("alice", "bob"));
      await assertFails(deleteDoc(doc(authedDb(env, "carol"), "battle_rooms/room9")));
      await assertSucceeds(deleteDoc(doc(authedDb(env, "alice"), "battle_rooms/room9")));
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
