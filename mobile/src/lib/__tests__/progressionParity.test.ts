import { describe, expect, it } from "vitest";

import {
  applyHolobotExperience,
  applyWorkoutCareer,
  calculateExperience,
  computeLeaderboardScore,
  getHolobotRank,
} from "@/lib/progression";
import { getSyncRank } from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";

import * as serverProgression from "../../../../functions/src/lib/progression";

function makeHolobot(overrides: Partial<UserHolobot> = {}): UserHolobot {
  return {
    experience: 0,
    level: 1,
    name: "ACE",
    nextLevelExp: calculateExperience(2),
    ...overrides,
  };
}

const COMPARED_FIELDS = ["attributePoints", "experience", "level", "nextLevelExp", "rank"] as const;

function pickCompared(holobot: Record<string, unknown>) {
  return Object.fromEntries(COMPARED_FIELDS.map((field) => [field, holobot[field]]));
}

describe("client/server progression parity", () => {
  it("calculateExperience matches for levels 1-60", () => {
    for (let level = 1; level <= 60; level += 1) {
      expect(serverProgression.calculateExperience(level)).toBe(calculateExperience(level));
    }
  });

  it("getHolobotRank matches across the level range", () => {
    for (let level = 1; level <= 60; level += 1) {
      expect(serverProgression.getHolobotRank(level)).toBe(getHolobotRank(level));
    }
  });

  it("getSyncRank thresholds match", () => {
    const samples = [0, 249, 250, 999, 1000, 2500, 4999, 5000, 9999, 10000, 11999, 12000, 24999, 25000, 49999, 50000, 120000];
    for (const lifetime of samples) {
      expect(serverProgression.getSyncRank(lifetime)).toBe(getSyncRank(lifetime));
    }
  });

  it("applyHolobotExperience produces identical level/exp/threshold results", () => {
    const cases: Array<{ exp: number; holobot: UserHolobot }> = [
      { exp: 0, holobot: makeHolobot() },
      { exp: 399, holobot: makeHolobot() },
      { exp: 400, holobot: makeHolobot() },
      { exp: 5000, holobot: makeHolobot() },
      { exp: 250, holobot: makeHolobot({ experience: 350, level: 1 }) },
      // Legacy server-shaped record (remainder exp + 1.18-scaled threshold).
      { exp: 100, holobot: makeHolobot({ experience: 50, level: 3, nextLevelExp: 139 }) },
      // Missing threshold falls back to the canonical curve.
      { exp: 1000, holobot: makeHolobot({ level: 4, nextLevelExp: 0, experience: 1600 }) },
      { exp: 100000, holobot: makeHolobot({ experience: 40000, level: 20, nextLevelExp: calculateExperience(21) }) },
    ];

    for (const testCase of cases) {
      const clientResult = applyHolobotExperience(testCase.holobot, testCase.exp);
      const serverResult = serverProgression.applyHolobotExperience(
        { ...testCase.holobot },
        testCase.exp,
      );

      expect(pickCompared(serverResult as Record<string, unknown>)).toEqual(
        pickCompared(clientResult as unknown as Record<string, unknown>),
      );
    }
  });

  it("applyHolobotExperience never lowers a level (legacy record safety)", () => {
    const legacy = makeHolobot({ experience: 12, level: 8, nextLevelExp: 361 });
    const clientResult = applyHolobotExperience(legacy, 0);
    const serverResult = serverProgression.applyHolobotExperience({ ...legacy }, 0);

    expect(clientResult.level).toBeGreaterThanOrEqual(8);
    expect(serverResult.level).toBeGreaterThanOrEqual(8);
    expect(pickCompared(serverResult as Record<string, unknown>)).toEqual(
      pickCompared(clientResult as unknown as Record<string, unknown>),
    );
  });

  it("applyWorkoutCareer matches", () => {
    const cases = [
      { holobot: makeHolobot(), update: { date: "2026-07-06", distanceMeters: 500 } },
      {
        holobot: makeHolobot({
          career: {
            activeDays: 2,
            distanceMeters: 3200,
            firstWorkoutDate: "2026-07-01",
            lastWorkoutDate: "2026-07-05",
            workouts: 4,
          },
        }),
        update: { date: "2026-07-06", distanceMeters: 1250 },
      },
      {
        holobot: makeHolobot({
          career: { activeDays: 1, distanceMeters: 100, lastWorkoutDate: "2026-07-06", workouts: 1 },
        }),
        update: { date: "2026-07-06" },
      },
    ];

    for (const testCase of cases) {
      const clientResult = applyWorkoutCareer(testCase.holobot, testCase.update);
      const serverResult = serverProgression.applyWorkoutCareer({ ...testCase.holobot }, testCase.update);

      expect(serverResult.career).toEqual(clientResult.career);
    }
  });

  it("computeLeaderboardScore matches", () => {
    const profiles = [
      {},
      { wins: 3, seasonSyncPoints: 450, prestigeCount: 0, holobots: [makeHolobot({ level: 7 })] },
      {
        wins: 40,
        seasonSyncPoints: 12500,
        prestigeCount: 2,
        holobots: [makeHolobot({ level: 31 }), makeHolobot({ level: 12, name: "KUMA" })],
      },
    ];

    for (const profile of profiles) {
      expect(serverProgression.computeLeaderboardScore(profile)).toBe(
        computeLeaderboardScore(profile as Parameters<typeof computeLeaderboardScore>[0]),
      );
    }
  });
});
