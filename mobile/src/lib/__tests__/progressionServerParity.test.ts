import { describe, expect, it } from "vitest";

import { buildQuestClaimUpdates, buildTrainingClaimUpdates } from "@/lib/progressionClaims";
import {
  QUEST_DEFINITIONS,
  TRAINING_COURSES,
  type ActiveQuestRecord,
  type TrainingSessionRecord,
} from "@/lib/progressionSystems";
import {
  getSyncStatUpgradeCost,
  SYNC_ABILITIES,
  upgradeSyncStat,
  type SyncStatKey,
} from "@/lib/syncProgression";
import type { UserProfile } from "@/types/profile";

import * as server from "../../../../functions/src/lib/progressionEconomy";

const HOLOBOT_PARITY_FIELDS = [
  "attributePoints",
  "boostedAttributes",
  "experience",
  "level",
  "name",
  "nextLevelExp",
  "rank",
] as const;

function pickHolobotFields(holobot: unknown) {
  const source = (holobot ?? {}) as Record<string, unknown>;
  return Object.fromEntries(HOLOBOT_PARITY_FIELDS.map((field) => [field, source[field]]));
}

function playerState() {
  const shared = {
    holobots: [
      { experience: 500, level: 2, name: "ACE", nextLevelExp: 900, boostedAttributes: { attack: 5 } },
      {
        experience: 0,
        level: 1,
        name: "KUMA",
        nextLevelExp: 400,
        syncStats: { bond: 0, focus: 9, guard: 25, power: 0, tempo: 0 },
      },
    ],
    inventory: { common: 2 },
    lifetimeSyncPoints: 4200,
    prestigeCount: 0,
    rewardSystem: {
      activeQuests: [] as unknown[],
      activeTraining: null as unknown,
      arenaBattlesToday: 0,
      boosterPacksToday: 0,
      lastDailyMissionReset: "2026-07-07",
      missionClaims: {},
    },
    seasonSyncPoints: 1100,
    syncPoints: 900,
  };

  return {
    clientProfile: { ...structuredClone(shared), stats: { losses: 4, wins: 9 } } as unknown as UserProfile,
    rawDoc: { ...structuredClone(shared), losses: 4, wins: 9 } as Record<string, unknown>,
  };
}

function questRecord(overrides: Partial<ActiveQuestRecord> = {}): ActiveQuestRecord {
  const quest = QUEST_DEFINITIONS[1]; // cave_exploration
  return {
    endsAt: "2026-07-07T10:00:00.000Z",
    holobotName: "ACE",
    holobotPower: 2400,
    id: "quest_run_1",
    questId: quest.id,
    rewards: quest.rewards,
    startedAt: "2026-07-07T09:30:00.000Z",
    succeeded: true,
    ...overrides,
  };
}

describe("table parity", () => {
  it("quest economy matches QUEST_DEFINITIONS", () => {
    expect(
      server.QUEST_ECONOMY.map(({ durationMinutes, energyCost, id, recommendedPower, rewards }) => ({
        durationMinutes,
        energyCost,
        id,
        recommendedPower,
        rewards,
      })),
    ).toEqual(
      QUEST_DEFINITIONS.map(({ durationMinutes, energyCost, id, recommendedPower, rewards }) => ({
        durationMinutes,
        energyCost,
        id,
        recommendedPower,
        rewards,
      })),
    );
  });

  it("training economy matches TRAINING_COURSES (incl. the 70/140 exp rule)", () => {
    for (const course of TRAINING_COURSES) {
      const mirror = server.getTrainingCourseEconomy(course.id);
      expect(mirror).not.toBeNull();
      expect(mirror!.durationMinutes).toBe(course.durationMinutes);
      expect(mirror!.energyCost).toBe(course.energyCost);
      expect(mirror!.maxBoost).toBe(course.maxBoost);
      expect(mirror!.minBoost).toBe(course.minBoost);
      expect(mirror!.expReward).toBe(course.durationMinutes === 60 ? 140 : 70);
      expect(mirror!.statKeys.length).toBe(course.id === "balanced" ? 5 : 1);
    }
  });

  it("sync ability requirements match SYNC_ABILITIES", () => {
    expect(
      server.SYNC_ABILITY_REQUIREMENTS.map((ability) => ({ ...ability })),
    ).toEqual(
      SYNC_ABILITIES.map(({ holobot, id, primaryRequired, primaryStat, secondaryRequired, secondaryStat }) => ({
        holobot,
        id,
        primaryRequired,
        primaryStat,
        ...(secondaryStat ? { secondaryRequired, secondaryStat } : {}),
      })),
    );
  });
});

describe("quest claim", () => {
  it("success chance mirrors the client start-time formula with clamped power", () => {
    expect(server.getQuestSuccessChance(800, 1600)).toBe(0.5);
    expect(server.getQuestSuccessChance(0, 1600)).toBe(0.45); // floor
    expect(server.getQuestSuccessChance(1_000_000, 800)).toBe(0.95); // cap
    expect(server.getQuestSuccessChance(999_999_999, 800)).toBe(0.95); // power clamp
  });

  it("applies identical updates to the client claim for both outcomes", () => {
    for (const succeeded of [true, false]) {
      const { clientProfile, rawDoc } = playerState();
      const record = questRecord({ succeeded });
      (clientProfile.rewardSystem as { activeQuests: unknown[] }).activeQuests = [record];
      ((rawDoc.rewardSystem as Record<string, unknown>).activeQuests as unknown[]) = [record];

      const clientUpdates = buildQuestClaimUpdates(clientProfile, record);
      // Roll chosen so the server lands on the same outcome as the stored record.
      const serverResult = server.applyQuestClaim(rawDoc, record, succeeded ? 0 : 1)!;

      expect(serverResult.succeeded).toBe(succeeded);

      const { holobots: ch, rewardSystem: crs, ...clientRest } = clientUpdates as Record<string, unknown>;
      const { holobots: sh, rewardSystem: srs, ...serverRest } = serverResult.updates;

      expect(serverRest).toEqual(clientRest);
      expect((sh as unknown[]).map(pickHolobotFields)).toEqual((ch as unknown[]).map(pickHolobotFields));
      expect((srs as { activeQuests: unknown[] }).activeQuests).toEqual([]);
      expect((crs as { activeQuests: unknown[] }).activeQuests).toEqual([]);
    }
  });

  it("pays from the quest table even when the stored record inflates rewards", () => {
    const { rawDoc } = playerState();
    const inflated = questRecord({
      rewards: { exp: 1_000_000, itemAmount: 99, itemKey: "legendary", syncPoints: 1_000_000 },
    });
    ((rawDoc.rewardSystem as Record<string, unknown>).activeQuests as unknown[]) = [inflated];

    const result = server.applyQuestClaim(rawDoc, inflated, 0)!;
    const table = QUEST_DEFINITIONS.find((quest) => quest.id === inflated.questId)!;

    expect(result.rewards).toEqual(table.rewards);
    expect(result.updates.syncPoints).toBe(900 + table.rewards.syncPoints);
  });

  it("rejects unknown quest ids", () => {
    const { rawDoc } = playerState();
    expect(server.applyQuestClaim(rawDoc, questRecord({ questId: "bogus" as never }), 0)).toBeNull();
  });
});

describe("training claim", () => {
  function trainingRecord(overrides: Partial<TrainingSessionRecord> = {}): TrainingSessionRecord {
    return {
      courseId: "attack",
      endsAt: "2026-07-07T10:00:00.000Z",
      expReward: 70,
      holobotName: "ACE",
      startedAt: "2026-07-07T09:30:00.000Z",
      statBoosts: { attack: 14 },
      ...overrides,
    };
  }

  it("applies identical updates to the client claim for an honest record", () => {
    const { clientProfile, rawDoc } = playerState();
    const record = trainingRecord();
    (clientProfile.rewardSystem as Record<string, unknown>).activeTraining = record;
    (rawDoc.rewardSystem as Record<string, unknown>).activeTraining = record;

    const clientUpdates = buildTrainingClaimUpdates(clientProfile, record);
    const serverResult = server.applyTrainingClaim(rawDoc, record)!;

    expect((serverResult.updates.holobots as unknown[]).map(pickHolobotFields)).toEqual(
      (clientUpdates.holobots as unknown[]).map(pickHolobotFields),
    );
    expect((serverResult.updates.rewardSystem as { activeTraining: unknown }).activeTraining).toBeNull();
    expect((clientUpdates.rewardSystem as { activeTraining: unknown }).activeTraining).toBeNull();
  });

  it("clamps forged boosts to the course range and stat", () => {
    expect(
      server.clampTrainingBoosts(server.getTrainingCourseEconomy("attack")!, {
        attack: 999,
        health: 999, // off-course stat: dropped
      }),
    ).toEqual({ attack: 18 });

    expect(
      server.clampTrainingBoosts(server.getTrainingCourseEconomy("balanced")!, {
        attack: 999,
        defense: 6,
        health: -5,
        special: 7,
        speed: 8,
      }),
    ).toEqual({ attack: 8, defense: 6, health: 0, special: 7, speed: 8 });
  });

  it("pays EXP from the course table, not the stored record", () => {
    const { rawDoc } = playerState();
    const record = trainingRecord({ expReward: 1_000_000, statBoosts: { attack: 10 } });
    const result = server.applyTrainingClaim(rawDoc, record)!;
    const ace = (result.updates.holobots as Array<{ experience: number; name: string }>).find(
      (holobot) => holobot.name === "ACE",
    )!;

    expect(ace.experience).toBe(500 + 70);
  });
});

describe("sync-stat upgrade", () => {
  it("cost curve matches across the stat range", () => {
    for (let value = 0; value <= 50; value += 1) {
      expect(server.getSyncStatUpgradeCost(value)).toBe(getSyncStatUpgradeCost(value));
    }
  });

  it("applies identical updates to the client upgrade", () => {
    const { clientProfile, rawDoc } = playerState();
    const clientResult = upgradeSyncStat(clientProfile, "KUMA", "guard");
    const serverResult = server.buildSyncStatUpgrade(rawDoc, "KUMA", "guard");

    expect(server.isSyncUpgradeRefusal(serverResult)).toBe(false);
    if (server.isSyncUpgradeRefusal(serverResult)) return;

    expect(serverResult.cost).toBe(clientResult.cost);
    expect(serverResult.updates.syncPoints).toBe(clientResult.profile.syncPoints);

    const serverKuma = (serverResult.updates.holobots as Array<Record<string, unknown>>).find(
      (holobot) => holobot.name === "KUMA",
    )!;
    const clientKuma = clientResult.profile.holobots.find((holobot) => holobot.name === "KUMA")!;

    expect(serverKuma.syncStats).toEqual(clientKuma.syncStats);
    expect(serverKuma.syncLevel).toBe(clientKuma.syncLevel);
    expect(serverKuma.lifetimeSPInvested).toBe(clientKuma.lifetimeSPInvested);
    expect(serverKuma.syncAbilityUnlocks).toEqual(clientKuma.syncAbilityUnlocks);
  });

  it("unlocks abilities at the same thresholds as the client", () => {
    // guard 25 -> 26 keeps tier-1/2 KUMA abilities unlocked; parity checked above.
    // Here: crossing a threshold unlocks on both sides.
    const spreads: Array<Record<SyncStatKey, number>> = [
      { bond: 0, focus: 0, guard: 10, power: 0, tempo: 0 },
      { bond: 20, focus: 0, guard: 40, power: 0, tempo: 0 },
      { bond: 0, focus: 20, guard: 0, power: 40, tempo: 0 },
    ];

    for (const stats of spreads) {
      for (const name of ["KUMA", "ACE", "WOLF"]) {
        const clientIds = SYNC_ABILITIES.filter((ability) => ability.holobot === name)
          .filter(
            (ability) =>
              stats[ability.primaryStat] >= ability.primaryRequired &&
              (!ability.secondaryStat || stats[ability.secondaryStat] >= (ability.secondaryRequired || 0)),
          )
          .map((ability) => ability.id);

        expect(server.getUnlockedSyncAbilityIds(name, stats)).toEqual(clientIds);
      }
    }
  });

  it("refuses upgrades for the same reasons as the client", () => {
    const { clientProfile, rawDoc } = playerState();
    (clientProfile as { syncPoints?: number }).syncPoints = 10;
    rawDoc.syncPoints = 10;

    expect(() => upgradeSyncStat(clientProfile, "KUMA", "guard")).toThrow();
    const refusal = server.buildSyncStatUpgrade(rawDoc, "KUMA", "guard");
    expect(server.isSyncUpgradeRefusal(refusal)).toBe(true);
    if (server.isSyncUpgradeRefusal(refusal)) {
      expect(refusal.reason).toBe("insufficient-points");
    }

    expect(server.isSyncUpgradeRefusal(server.buildSyncStatUpgrade(rawDoc, "NOBODY", "guard"))).toBe(true);
  });
});
