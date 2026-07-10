import { doc, setDoc, type Firestore } from "firebase/firestore";
import { assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// BUG A regression: this imports the REAL mobile matchmaking transaction
// (mobile/src/lib/pvpMatchmaking.ts) and runs it against the emulator with
// rules enforced. Requires the firebase dedupe entries in vitest.config.ts
// so the mobile module and the test share one SDK instance.
import {
  claimOpponentAndCreateRoom,
  type MatchmakingClaim,
} from "../../mobile/src/lib/pvpMatchmaking";
import { authedDb, initTestEnv } from "../src/helpers";
import { buildBattleRoom, buildPoolEntry } from "../src/fixtures";

function roomFor(p1Uid: string) {
  return (roomId: string, opponent: { userId: string }) =>
    ({ roomId, ...buildBattleRoom(p1Uid, opponent.userId) }) as never;
}

function claimedRoomId(claim: MatchmakingClaim): string | null {
  return claim.outcome === "candidateGone" ? null : claim.roomId;
}

describe("matchmaking claim transaction", () => {
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

  async function enterPool(db: Firestore, uid: string) {
    await assertSucceeds(setDoc(doc(db, `battle_pool_entries/${uid}`), buildPoolEntry(uid)));
  }

  // The original flow (addDoc -> getDocs -> setDoc, no transaction) let two
  // simultaneous searchers each find the other and each create their OWN
  // room — the observed two-device desync where HP/stamina/cards never
  // matched because the players were literally in different rooms.
  it("two players claiming each other simultaneously end up in ONE shared room", async () => {
    const alice = authedDb(env, "alice") as unknown as Firestore;
    const bob = authedDb(env, "bob") as unknown as Firestore;
    await enterPool(alice, "alice");
    await enterPool(bob, "bob");

    const [aliceClaim, bobClaim] = await Promise.all([
      claimOpponentAndCreateRoom(alice, "alice", "bob", roomFor("alice")),
      claimOpponentAndCreateRoom(bob, "bob", "alice", roomFor("bob")),
    ]);

    expect([aliceClaim.outcome, bobClaim.outcome].sort()).toEqual(["alreadyMatched", "created"]);
    expect(claimedRoomId(aliceClaim)).toBe(claimedRoomId(bobClaim));
    expect(claimedRoomId(aliceClaim)).toBeTruthy();

    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const rooms = await admin.collection("battle_rooms").get();
      expect(rooms.size).toBe(1);
      expect(rooms.docs[0].id).toBe(claimedRoomId(aliceClaim));

      for (const uid of ["alice", "bob"]) {
        const entry = (await admin.doc(`battle_pool_entries/${uid}`).get()).data();
        expect(entry?.isActive).toBe(false);
        expect(entry?.roomId).toBe(claimedRoomId(aliceClaim));
      }
    });
  });

  it("claiming an opponent someone else already took reports candidateGone", async () => {
    const alice = authedDb(env, "alice") as unknown as Firestore;
    const bob = authedDb(env, "bob") as unknown as Firestore;
    const carol = authedDb(env, "carol") as unknown as Firestore;
    await enterPool(alice, "alice");
    await enterPool(bob, "bob");
    await enterPool(carol, "carol");

    const carolClaim = await claimOpponentAndCreateRoom(carol, "carol", "bob", roomFor("carol"));
    expect(carolClaim.outcome).toBe("created");

    const aliceClaim = await claimOpponentAndCreateRoom(alice, "alice", "bob", roomFor("alice"));
    expect(aliceClaim.outcome).toBe("candidateGone");

    await env.withSecurityRulesDisabled(async (context) => {
      const rooms = await context.firestore().collection("battle_rooms").get();
      expect(rooms.size).toBe(1);
    });
  });
});
