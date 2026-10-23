import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authedDb, initTestEnvWithRules, readRulesText, seedUser } from "../src/helpers";
import { buildClientCreateDoc, buildUserDoc } from "../src/fixtures";

// holobots-write-lockdown-1 (Pak 2026-10-23, "yes, lock it down"). users/{uid}.holobots
// (stats / levels / XP / attributes / sync stats) and the remaining economy-relevant fields
// were client-writable; a modified client could level its own bots. The client may now
// change ONLY firestore.rules clientWritableKeys(). Known-bad control: the same tamper
// writes SUCCEED against the pre-lockdown rule shape (derived below), so a pass here is the
// lockdown, not a write the emulator would have refused anyway.

const ACE = {
  name: "ACE", level: 3, experience: 950, nextLevelExp: 1600, rank: "Starter", attributePoints: 1,
  boostedAttributes: { attack: 2 }, syncStats: { bond: 0, focus: 0, guard: 0, power: 4, tempo: 0 }, syncAbilityUnlocks: [],
};
const SEEDED = buildUserDoc({
  holobots: [ACE],
  equippedParts: { ACE: { head: { id: "p1", name: "Combat Mask", rarity: "rare", slot: "head" } } },
  parts: [{ id: "p1", name: "Combat Mask", rarity: "rare", slot: "head" }],
  prestigeCount: 0,
  maxDailyEnergy: 100,
  dailyEnergy: 60,
  attributeBoostRequestIds: ["boost_1"],
});

// Every tamper the old rules let through, one write each.
const TAMPERS: Array<[string, Record<string, unknown>]> = [
  ["holobots: level / XP", { holobots: [{ ...ACE, level: 50, experience: 9999999 }] }],
  ["holobots: attribute points", { holobots: [{ ...ACE, attributePoints: 99 }] }],
  ["holobots: boosted stats", { holobots: [{ ...ACE, boostedAttributes: { attack: 500, defense: 500 } }] }],
  ["holobots: sync stats", { holobots: [{ ...ACE, syncStats: { bond: 50, focus: 50, guard: 50, power: 50, tempo: 50 } }] }],
  ["holobots: equip a locked ability", { holobots: [{ ...ACE, equippedSyncAbilityId: "forged" }] }],
  ["holobots: add a bot", { holobots: [ACE, { name: "SHADOW", level: 40 }] }],
  ["holobots: delete", { holobots: deleteField() }],
  ["equippedParts: forged legendary", { equippedParts: { ACE: { core: { id: "x", name: "Forged Core", rarity: "legendary", slot: "core" } } } }],
  ["battle_cards", { battle_cards: { "finisher.tacticalOverride": 99 } }],
  ["arena_deck_template_ids", { arena_deck_template_ids: ["finisher.tacticalOverride"] }],
  ["starter_deck_claimed", { starter_deck_claimed: false }],
  ["inventory", { inventory: { legendary: 50 } }],
  ["leaderboardScore", { leaderboardScore: 99999999 }],
  ["prestigeCount", { prestigeCount: 10 }],
  ["asyncBattleTickets", { asyncBattleTickets: 999 }],
  ["lastAsyncTicketRefresh", { lastAsyncTicketRefresh: new Date(0) }],
  ["maxDailyEnergy", { maxDailyEnergy: 100000000 }],
  ["attributeBoostRequestIds (replay ledger)", { attributeBoostRequestIds: [] }],
  ["any other key (username)", { username: "renamed" }],
  ["any new key", { someFutureField: 1 }],
];

/** The pre-lockdown rule shape: no allowlist, no energy cap, the 2026-07-12 frozen list only. */
function preLockdownRules(): string {
  const rules = readRulesText();
  const weakened = rules
    .replace("        && onlyClientWritableKeysChanged(request.resource.data, resource.data)\n", "")
    .replace("        && energyNotInflated(request.resource.data, resource.data)\n", "")
    .replace(/,\n\s*\/\/ holobots-write-lockdown-1: the roster[\s\S]*?'energyTimeZoneChangedAt'\n/, "\n");
  expect(weakened).not.toEqual(rules);
  expect(weakened).not.toContain("onlyClientWritableKeysChanged(request.resource.data");
  expect(weakened).not.toContain("'attributeBoostRequestIds'");
  return weakened;
}

describe("holobots write lockdown", () => {
  let env: RulesTestEnvironment;
  let legacy: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnvWithRules(readRulesText(), "demo-write-lockdown");
    legacy = await initTestEnvWithRules(preLockdownRules(), "demo-write-lockdown-legacy");
  });
  afterAll(async () => {
    await env?.cleanup();
    await legacy?.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await legacy.clearFirestore();
  });

  it.each(TAMPERS)("denies the client tamper: %s", async (_name, write) => {
    await seedUser(env, "alice", SEEDED);
    await assertFails(updateDoc(doc(authedDb(env, "alice"), "users/alice"), write));
    await assertFails(setDoc(doc(authedDb(env, "alice"), "users/alice"), write, { merge: true }));
  });

  it("known-bad control: the old rule shape ALLOWED every one of those tampers", async () => {
    for (const [name, write] of TAMPERS) {
      await seedUser(legacy, "alice", SEEDED);
      await assertSucceeds(updateDoc(doc(authedDb(legacy, "alice"), "users/alice"), write)).catch((error) => {
        throw new Error(`${name}: ${String(error)}`);
      });
    }
    // ...and the energy inflation the new cap blocks.
    await seedUser(legacy, "alice", SEEDED);
    await assertSucceeds(updateDoc(doc(authedDb(legacy, "alice"), "users/alice"), { dailyEnergy: 100000000 }));
  });

  it("allows the cosmetic / settings writes (exact keys) and the rewardSystem writes", async () => {
    await seedUser(env, "alice", SEEDED);
    const alice = doc(authedDb(env, "alice"), "users/alice");
    await assertSucceeds(updateDoc(alice, { syncDistanceUnit: "mi" }));
    await assertSucceeds(updateDoc(alice, { syncDistanceUnit: "km" }));
    await assertFails(updateDoc(alice, { syncDistanceUnit: "furlongs" }));
    await assertSucceeds(updateDoc(alice, { referralCode: "ALICE1" }));
    await assertFails(updateDoc(alice, { referralCode: "X".repeat(13) }));
    await assertSucceeds(updateDoc(alice, { presenceOptOut: true }));
    await assertSucceeds(updateDoc(alice, { rewardSystem: { syncBoostEnabled: true } }));
    await assertSucceeds(updateDoc(alice, { "rewardSystem.questRefreshesUsed": 1 }));
    // energy-quest-server-1: the energy fields left the allowlist (energy-server-only.test.ts).
    await assertFails(updateDoc(alice, { dailyEnergy: 80, lastEnergyRefresh: new Date(), stepEnergyDate: "2026-10-23", stepEnergyGrantedToday: 4 }));
    // A cosmetic key riding along with a locked one denies the whole write.
    await assertFails(updateDoc(alice, { syncDistanceUnit: "mi", holobots: [{ ...ACE, level: 9 }] }));
  });

  it("a full-profile merge with every locked field UNCHANGED still passes", async () => {
    await seedUser(env, "alice", SEEDED);
    await assertSucceeds(setDoc(doc(authedDb(env, "alice"), "users/alice"), { ...SEEDED, referralCode: "RC61" }, { merge: true }));
  });

  it("client create: only clientCreateKeys(); never holobots, cards, items or a full energy overfill", async () => {
    const bob = doc(authedDb(env, "bob"), "users/bob");
    await assertFails(setDoc(bob, buildClientCreateDoc({ holobots: [ACE] })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ battle_cards: { "strike.quickJab": 1 } })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ inventory: {} })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ leaderboardScore: 0 })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ username: "bob" })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ dailyEnergy: 101 })));
    await assertFails(setDoc(bob, buildClientCreateDoc({ isDevAccount: true })));
    await assertSucceeds(setDoc(bob, buildClientCreateDoc()));
  });
});
