import { describe, expect, it } from "vitest";

import { computeFitnessSyncOutcome } from "@/lib/fitnessSync";
import { calculateExperience } from "@/lib/progression";

function makeHolobot(name: string, overrides: Record<string, unknown> = {}) {
  return {
    experience: 0,
    level: 1,
    name,
    nextLevelExp: calculateExperience(2),
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-06",
    stepsTotal: 0,
    uid: "user-1",
    ...overrides,
  } as Parameters<typeof computeFitnessSyncOutcome>[2];
}

describe("computeFitnessSyncOutcome", () => {
  it("awards one sync point per 1000 unsynced steps", () => {
    const outcome = computeFitnessSyncOutcome(
      { syncPoints: 10, lifetimeSyncPoints: 10, seasonSyncPoints: 10 },
      { stepsSynced: 2000 },
      makeRequest({ stepsTotal: 5400 }),
    );

    expect(outcome.response.awardedDelta).toBe(3);
    expect(outcome.response.totalSyncPoints).toBe(13);
    expect(outcome.userUpdates?.lifetimeSyncPoints).toBe(13);
    expect(outcome.userUpdates?.seasonSyncPoints).toBe(13);
    expect(outcome.dailyUpdates.stepsSynced).toBe(5400);
  });

  it("never awards for steps that were already synced", () => {
    const outcome = computeFitnessSyncOutcome(
      { syncPoints: 5 },
      { stepsSynced: 8000 },
      makeRequest({ stepsTotal: 6000 }),
    );

    expect(outcome.response.awardedDelta).toBe(0);
    // High-water mark is preserved so a replay cannot re-earn.
    expect(outcome.dailyUpdates.stepsSynced).toBe(8000);
  });

  it("prefers an explicit session award over the step delta", () => {
    const outcome = computeFitnessSyncOutcome(
      { syncPoints: 0 },
      { stepsSynced: 0 },
      makeRequest({ stepsTotal: 500, syncPointsAwarded: 245 }),
    );

    expect(outcome.response.awardedDelta).toBe(245);
    expect(outcome.response.totalSyncPoints).toBe(245);
  });

  it("is idempotent for an already-processed activity id", () => {
    const outcome = computeFitnessSyncOutcome(
      { syncPoints: 300, holosTokens: 40 },
      { processedActivityIds: { "workout-abc": true }, stepsTotal: 4000, workoutSessionsCompleted: 2 },
      makeRequest({ activityId: "workout-abc", stepsTotal: 9000, syncPointsAwarded: 245 }),
    );

    expect(outcome.alreadyProcessed).toBe(true);
    expect(outcome.userUpdates).toBeNull();
    expect(outcome.response.awardedDelta).toBe(0);
    expect(outcome.response.totalSyncPoints).toBe(300);
    expect(outcome.response.workoutSessionsCompleted).toBe(2);
  });

  it("records a new activity id so replays are ignored", () => {
    const outcome = computeFitnessSyncOutcome(
      {},
      {},
      makeRequest({ activityId: "workout-xyz", stepsTotal: 100 }),
    );

    expect(
      (outcome.dailyUpdates.processedActivityIds as Record<string, true>)["workout-xyz"],
    ).toBe(true);
  });

  it("persists workout EXP and Holos to the named holobot", () => {
    const outcome = computeFitnessSyncOutcome(
      {
        holobots: [makeHolobot("ACE"), makeHolobot("KUMA")],
        holosTokens: 12,
      },
      {},
      makeRequest({ expAwarded: 450, holobotName: "kuma", holosAwarded: 30, stepsTotal: 100 }),
    );

    const holobots = outcome.userUpdates?.holobots as Array<Record<string, unknown>>;
    expect(holobots[0].experience).toBe(0);
    expect(holobots[1].experience).toBe(450);
    expect(holobots[1].level).toBe(2);
    expect(outcome.response.totalHolosTokens).toBe(42);
    expect(outcome.userUpdates?.holosTokens).toBe(42);
  });

  it("falls back to the first holobot when the target name is unknown", () => {
    const outcome = computeFitnessSyncOutcome(
      { holobots: [makeHolobot("ACE"), makeHolobot("KUMA")] },
      {},
      makeRequest({ expAwarded: 100, holobotName: "NOT-A-BOT", stepsTotal: 100 }),
    );

    const holobots = outcome.userUpdates?.holobots as Array<Record<string, unknown>>;
    expect(holobots[0].experience).toBe(100);
    expect(holobots[1].experience).toBe(0);
  });

  it("caps daily workout sessions at four", () => {
    const outcome = computeFitnessSyncOutcome(
      {},
      { workoutSessionsCompleted: 4 },
      makeRequest({ sessionIncrement: 1, stepsTotal: 100 }),
    );

    expect(outcome.response.workoutSessionsCompleted).toBe(4);
    expect(outcome.dailyUpdates.workoutSessionsCompleted).toBe(4);
  });

  it("derives the sync rank from the unified lifetime thresholds", () => {
    const outcome = computeFitnessSyncOutcome(
      { lifetimeSyncPoints: 990 },
      {},
      makeRequest({ stepsTotal: 0, syncPointsAwarded: 20 }),
    );

    expect(outcome.userUpdates?.lifetimeSyncPoints).toBe(1010);
    expect(outcome.userUpdates?.syncRank).toBe("Walker");
  });

  it("clamps negative reward inputs to zero", () => {
    const outcome = computeFitnessSyncOutcome(
      { holosTokens: 10, syncPoints: 10, holobots: [makeHolobot("ACE")] },
      {},
      makeRequest({ expAwarded: -50, holosAwarded: -5, stepsTotal: 100, syncPointsAwarded: -9 }),
    );

    expect(outcome.response.awardedDelta).toBe(0);
    expect(outcome.response.totalHolosTokens).toBe(10);
    const holobots = outcome.userUpdates?.holobots as Array<Record<string, unknown>>;
    expect(holobots[0].experience).toBe(0);
  });
});
