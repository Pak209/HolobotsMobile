import { describe, expect, it } from "vitest";

import { computeFitnessSyncOutcome as mobileCompute } from "@/lib/fitnessSync";

import {
  computeFitnessSyncOutcome as serverCompute,
  DAILY_WORKOUT_CAP,
  sanitizeFitnessSyncRequest,
  WORKOUT_COOLDOWN_MS,
} from "../../../../functions/src/lib/fitnessSyncOutcome";

const NOW = new Date("2026-07-07T12:00:00.000Z");

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    holosTokens: 120,
    syncPoints: 900,
    lifetimeSyncPoints: 4200,
    seasonSyncPoints: 1100,
    prestigeCount: 0,
    wins: 3,
    holobots: [
      {
        experience: 500,
        level: 2,
        name: "ACE",
        nextLevelExp: 900,
        career: { activeDays: 2, distanceMeters: 3200, lastWorkoutDate: "2026-07-05", workouts: 4 },
      },
      { experience: 0, level: 1, name: "KUMA", nextLevelExp: 400 },
    ],
    ...overrides,
  };
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    activityId: "workout_123",
    date: "2026-07-07",
    distanceMeters: 800,
    expAwarded: 224,
    holobotName: "ACE",
    holosAwarded: 9,
    sessionIncrement: 1,
    stepsTotal: 4200,
    syncPointsAwarded: 245,
    workoutMinutes: 5,
    uid: "alice",
    ...overrides,
  };
}

const HOLOBOT_PARITY_FIELDS = [
  "attributePoints",
  "career",
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

function expectOutcomeParity(
  userData: Record<string, unknown>,
  dailyData: Record<string, unknown>,
  request: ReturnType<typeof baseRequest>,
) {
  const mobile = mobileCompute(userData, dailyData, request as never);
  const server = serverCompute(userData, dailyData, request as never);

  expect(server.alreadyProcessed).toBe(mobile.alreadyProcessed);
  expect(server.response).toEqual(mobile.response);
  expect(server.dailyUpdates).toEqual(mobile.dailyUpdates);

  if (mobile.userUpdates === null || server.userUpdates === null) {
    expect(server.userUpdates).toBe(mobile.userUpdates);
    return;
  }

  const { holobots: mobileHolobots, ...mobileScalars } = mobile.userUpdates;
  const { holobots: serverHolobots, ...serverScalars } = server.userUpdates;

  expect(serverScalars).toEqual(mobileScalars);
  expect((serverHolobots as unknown[]).map(pickHolobotFields)).toEqual(
    (mobileHolobots as unknown[]).map(pickHolobotFields),
  );
}

describe("client/server fitness sync outcome parity", () => {
  it("matches on a fresh-day session completion with explicit awards", () => {
    expectOutcomeParity(baseUser(), {}, baseRequest());
  });

  it("matches on a step-delta pause sync without explicit awards", () => {
    expectOutcomeParity(
      baseUser(),
      { stepsSynced: 2000, stepsTotal: 2000, workoutSessionsCompleted: 1 },
      baseRequest({
        activityId: undefined,
        expAwarded: undefined,
        holosAwarded: undefined,
        sessionIncrement: undefined,
        stepsTotal: 5321,
        syncPointsAwarded: undefined,
      }),
    );
  });

  it("matches on an already-processed activity id (idempotent replay)", () => {
    expectOutcomeParity(
      baseUser(),
      {
        processedActivityIds: { workout_123: true },
        stepsTotal: 4200,
        syncPointsAwarded: 245,
        workoutSessionsCompleted: 2,
      },
      baseRequest(),
    );
  });

  it("matches when the named holobot is unknown (falls back to the first)", () => {
    expectOutcomeParity(baseUser(), {}, baseRequest({ holobotName: "NOTABOT" }));
  });
});

describe("sanitizeFitnessSyncRequest", () => {
  it("preserves an honest session completion and computes the cooldown server-side", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      { workoutSessionsCompleted: 1 },
      baseRequest() as never,
      NOW,
    );

    expect(sanitized.syncPointsAwarded).toBe(245);
    expect(sanitized.expAwarded).toBe(224);
    expect(sanitized.holosAwarded).toBe(9);
    expect(sanitized.sessionIncrement).toBe(1);
    expect(sanitized.stepsTotal).toBe(4200);
    expect(sanitized.cooldownEndsAt).toBe(new Date(NOW.getTime() + WORKOUT_COOLDOWN_MS).toISOString());
  });

  it("clamps an over-claimed reward to the session-formula ceiling", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      {},
      baseRequest({
        distanceMeters: 400,
        expAwarded: 1_000_000,
        holosAwarded: 1_000_000,
        stepsTotal: 500,
        syncPointsAwarded: 1_000_000,
      }) as never,
      NOW,
    );

    // Ceiling: 225 base + floor(500/25) = 245 SP; floor(0.4km*12) = 4 holos;
    // floor(0.4km*280) = 112 exp.
    expect(sanitized.syncPointsAwarded).toBe(245);
    expect(sanitized.holosAwarded).toBe(4);
    expect(sanitized.expAwarded).toBe(112);
  });

  it("awards nothing for a session completion past the daily cap", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      { workoutSessionsCompleted: DAILY_WORKOUT_CAP },
      baseRequest() as never,
      NOW,
    );

    expect(sanitized.syncPointsAwarded).toBe(0);
    expect(sanitized.expAwarded).toBe(0);
    expect(sanitized.holosAwarded).toBe(0);
    expect(sanitized.sessionIncrement).toBe(0);
    expect(sanitized.cooldownEndsAt).toBeNull();
  });

  it("sets no cooldown after the final capped session", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      { workoutSessionsCompleted: DAILY_WORKOUT_CAP - 1 },
      baseRequest() as never,
      NOW,
    );

    expect(sanitized.sessionIncrement).toBe(1);
    expect(sanitized.cooldownEndsAt).toBeNull();
  });

  it("keeps the step-delta fallback when no explicit award is claimed, with bounded steps", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      {},
      baseRequest({
        expAwarded: undefined,
        holosAwarded: undefined,
        sessionIncrement: undefined,
        stepsTotal: 10_000_000,
        syncPointsAwarded: undefined,
      }) as never,
      NOW,
    );

    expect(sanitized.syncPointsAwarded).toBeUndefined();
    expect(sanitized.expAwarded).toBeUndefined();
    expect(sanitized.holosAwarded).toBeUndefined();
    expect(sanitized.stepsTotal).toBe(60000);
    expect(sanitized.cooldownEndsAt).toBeNull();
  });

  it("clamps sessionIncrement to at most one per call", () => {
    const sanitized = sanitizeFitnessSyncRequest(
      { workoutSessionsCompleted: 0 },
      baseRequest({ sessionIncrement: 99 }) as never,
      NOW,
    );

    expect(sanitized.sessionIncrement).toBe(1);
  });
});
