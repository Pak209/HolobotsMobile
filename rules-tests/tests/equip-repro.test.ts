import { doc, updateDoc, Timestamp } from "firebase/firestore";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { authedDb, initTestEnv, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

// Regression for the 2026-07-18 device report: "Equip failed — Missing or
// insufficient permissions" on a fresh account right after gacha. Root
// cause was the rules EVALUATION BUDGET (1000 expressions/request): the
// per-field frozen chain's cost grew with every populated field, so real
// accounts were denied on every client write while thin fixtures passed.
// These tests replay client writes against a deliberately FAT account doc;
// if they fail, the rules are over budget again — do not thin the fixture.
describe("client writes on a mature (fat) account doc", () => {
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

  const holobot = (name: string, level: number) => ({
    name,
    level,
    experience: level * 120,
    nextLevelExp: level * 200,
    rank: "Champion",
    attributePoints: 3,
    boostedAttributes: { attack: 2, defense: 1, health: 4, speed: 1 },
    syncStats: { power: 3, guard: 2, tempo: 1, focus: 2, bond: 4 },
    syncAbilityUnlocks: ["first_wind"],
    combatKit: { slots: ["strike.tempoThrust", "defense.guardUp", "combo.chainBurst", "finisher.tacticalOverride"] },
    moveProgress: { "strike.tempoThrust": { rank: 1 } },
    career: {
      workouts: 14,
      distanceMeters: 52000,
      activeDays: 9,
      firstWorkoutDate: "2026-07-01",
      lastWorkoutDate: "2026-07-18",
    },
  });

  const part = (index: number) => ({
    name: `Part ${index}`,
    rarity: index % 3 === 0 ? "rare" : "common",
    slot: ["head", "torso", "arms", "legs", "core"][index % 5],
  });

  const FAT_ACCOUNT = buildUserDoc({
    holobots: [holobot("ACE", 12), holobot("KUMA", 8), holobot("SHADOW", 5), holobot("HARE", 3)],
    parts: Array.from({ length: 12 }, (_, index) => part(index)),
    packHistory: Array.from({ length: 6 }, (_, index) => ({
      id: `gacha_basic_${1752000000000 + index}`,
      items: [{ name: `Part ${index}`, rarity: "common" }],
      openedAt: new Date().toISOString(),
      packId: "basic",
    })),
    blueprints: { ace: 12, kuma: 30, shadow: 5, hare: 40 },
    equippedParts: {
      ACE: { head: { name: "Part 0", rarity: "rare", slot: "head" } },
    },
    inventory: {},
    rewardSystem: {
      boosterPacksOpenedToday: 2,
      arenaBattlesToday: 3,
      dailyMissions: { workout: true, arena: false },
    },
    battle_cards: { "strike.tempoThrust": 1, "combo.chainBurst": 2, "defense.guardUp": 1 },
    referredBy: "referrer-uid",
    referralCode: "ALICE1",
    referralQualified: true,
    genesisSquadClaimed: "referral",
    genesisBadge: true,
    wildcardBlueprints: 7,
    legendaryBlueprints: 1,
    holosTokens: 2450,
    gachaTickets: 3,
    syncPoints: 1200,
    lifetimeSyncPoints: 9800,
    seasonSyncPoints: 4100,
    leaderboardScore: 5889,
    wins: 21,
    losses: 6,
    todaySteps: 8421,
    prestigeCount: 1,
    lastWildcardPackAt: Date.now(),
    expBoosterActiveUntil: Date.now() + 3600000,
    lastFitnessSyncAt: Timestamp.fromDate(new Date()),
    lastStepSync: Timestamp.fromDate(new Date()),
    fitnessSource: "watch",
  });

  it("allows equipping a part (the exact failing device write)", async () => {
    await seedUser(env, "alice", FAT_ACCOUNT);
    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        equippedParts: {
          ACE: { head: { name: "Combat Mask", rarity: "rare", slot: "head" } },
        },
      }),
    );
  });

  it("allows energy regen writes", async () => {
    await seedUser(env, "alice", FAT_ACCOUNT);
    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        dailyEnergy: 80,
        lastEnergyRefresh: Timestamp.fromDate(new Date()),
      }),
    );
  });

  it("allows attribute-point spends on holobots", async () => {
    await seedUser(env, "alice", FAT_ACCOUNT);
    const nextHolobots = (FAT_ACCOUNT.holobots as Array<Record<string, unknown>>).map(
      (entry, index) =>
        index === 0
          ? { ...entry, attributePoints: 2, boostedAttributes: { attack: 3, defense: 1, health: 4, speed: 1 } }
          : entry,
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        holobots: nextHolobots,
        leaderboardScore: 5900,
      }),
    );
  });

  it("still denies changing a frozen economy field on the fat doc", async () => {
    await seedUser(env, "alice", FAT_ACCOUNT);
    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        holosTokens: 999999,
      }),
    );
  });

  it("still denies flipping referral/genesis fields on the fat doc", async () => {
    await seedUser(env, "alice", FAT_ACCOUNT);
    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        referralQualified: false,
        referrals: 99,
      }),
    );
  });

  it("denies deleting a frozen field (stricter than the old rules)", async () => {
    const { deleteField } = await import("firebase/firestore");
    await seedUser(env, "alice", FAT_ACCOUNT);
    await assertFails(
      updateDoc(doc(authedDb(env, "alice"), "users/alice"), {
        parts: deleteField(),
      }),
    );
  });
});
