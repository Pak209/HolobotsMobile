import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedDoc, unauthedDb } from "../src/helpers";
import { buildBattleRoom } from "../src/fixtures";

// pvp-room-fighters-1 (functions/src/pvp/pvpRoomFighters.ts). Host-minted PvP level snapshots live in
// pvpRoomSeats/{roomId}, which has NO match block in firestore.rules: the final default deny covers it
// and only the Admin SDK (pvpRoomFighterHost) can touch it. This suite runs against the EXISTING rules
// unchanged; it adds no rule.
const ROOM = "AbCdEfGhIjKlMnOpQrSt";
const snapshot = (level: number) => ({ holobotId: "ace", level, displayName: "ACE", tier: 0 });
const SEATS = {
  schemaVersion: "pvp-room-fighters-1",
  roomId: ROOM,
  p1: { uid: "alice", fighters: { ace: snapshot(21) } },
};

describe("pvpRoomSeats (server-only PvP level snapshots)", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedDoc(env, `battle_rooms/${ROOM}`, buildBattleRoom("alice", "bob"));
  });

  // Why the snapshot cannot live on the room: battle_rooms stays client-authored (SECURITY_AUDIT C4),
  // so a participant can write any level or "host" field there under the current rules.
  it("KNOWN-BAD first: a participant can forge a level and a host-looking field on the battle_rooms doc", async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), `battle_rooms/${ROOM}`), {
        "players.p1.level": 99,
        hostFighters: { schemaVersion: "pvp-room-fighters-1", p1: { uid: "alice", fighters: { ace: snapshot(99) } } },
      }),
    );
  });

  it("denies every client write to pvpRoomSeats: create, overwrite, nested edit and delete, by either participant", async () => {
    const alice = authedDb(env, "alice");
    const bob = authedDb(env, "bob");

    await assertFails(setDoc(doc(alice, `pvpRoomSeats/${ROOM}`), { ...SEATS, p1: { uid: "alice", fighters: { ace: snapshot(99) } } }));
    await seedDoc(env, `pvpRoomSeats/${ROOM}`, SEATS);
    await assertFails(setDoc(doc(alice, `pvpRoomSeats/${ROOM}`), SEATS));
    await assertFails(updateDoc(doc(alice, `pvpRoomSeats/${ROOM}`), { "p1.fighters.ace.level": 99 }));
    await assertFails(updateDoc(doc(bob, `pvpRoomSeats/${ROOM}`), { p2: { uid: "bob", fighters: { kuma: { holobotId: "kuma", level: 99, displayName: "KUMA", tier: 0 } } } }));
    await assertFails(deleteDoc(doc(alice, `pvpRoomSeats/${ROOM}`)));
  });

  it("denies every client read of pvpRoomSeats: participants, strangers, signed-out and collection lists", async () => {
    await seedDoc(env, `pvpRoomSeats/${ROOM}`, SEATS);

    await assertFails(getDoc(doc(authedDb(env, "alice"), `pvpRoomSeats/${ROOM}`)));
    await assertFails(getDoc(doc(authedDb(env, "bob"), `pvpRoomSeats/${ROOM}`)));
    await assertFails(getDoc(doc(authedDb(env, "carol"), `pvpRoomSeats/${ROOM}`)));
    await assertFails(getDoc(doc(unauthedDb(env), `pvpRoomSeats/${ROOM}`)));
    await assertFails(getDocs(collection(authedDb(env, "alice"), "pvpRoomSeats")));
  });
});
