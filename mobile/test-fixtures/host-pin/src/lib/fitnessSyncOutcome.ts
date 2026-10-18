/**
 * Server-side fitness sync award computation.
 *
 * `computeFitnessSyncOutcome` is the server mirror of the mobile app's
 * `mobile/src/lib/fitnessSync.ts` — the two must stay behaviorally identical
 * so the callable path and the client's offline-fallback transaction write
 * the same documents for the same request. The mobile parity suite
 * (`mobile/src/lib/__tests__/fitnessSyncServerParity.test.ts`) imports this
 * file directly and fails if they drift.
 *
 * `sanitizeFitnessSyncRequest` is server-only: it converts an untrusted
 * client request into one whose claimed rewards are clamped to what the
 * reported activity justifies (see shared/workoutRewardLimits — the ceiling
 * mirrors the session reward formula), enforces the daily session cap, and
 * makes the workout cooldown server-computed instead of client-supplied.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */

import {
  applyHolobotExperience,
  applyWorkoutCareer,
  computeLeaderboardScore,
  getSyncRank,
  normalizeUserHolobot,
} from "./progression";
import { clampWorkoutReward } from "../shared/workoutRewardLimits";

export const STEPS_PER_SYNC_POINT = 1000;
export const DAILY_WORKOUT_CAP = 4;
export const WORKOUT_COOLDOWN_MS = 10 * 60 * 1000;

export type SyncFitnessActivityRequest = {
  activityId?: string;
  cooldownEndsAt?: string | null;
  date: string;
  distanceMeters?: number;
  eventId?: string;
  expAwarded?: number;
  holobotName?: string;
  holosAwarded?: number;
  sessionIncrement?: number;
  stepsTotal: number;
  syncPointsAwarded?: number;
  workoutMinutes?: number;
};

export type SyncFitnessActivityResponse = {
  awardedDelta: number;
  cooldownEndsAt: string | null;
  totalHolosTokens: number;
  todaySteps: number;
  totalSyncPoints: number;
  workoutSessionsCompleted: number;
};

export type FitnessSyncOutcome = {
  alreadyProcessed: boolean;
  dailyUpdates: Record<string, unknown>;
  response: SyncFitnessActivityResponse;
  userUpdates: Record<string, unknown> | null;
};

function toIsoString(value?: { toDate?: () => Date } | string | null): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toDate?.()?.toISOString() ?? null;
}

function calculateAwardDelta(previousStepsSynced: number, incomingStepsTotal: number) {
  const safePrevious = Math.max(0, Math.floor(previousStepsSynced));
  const safeIncoming = Math.max(0, Math.floor(incomingStepsTotal));
  const stepDelta = Math.max(0, safeIncoming - safePrevious);

  return {
    awardedDelta: Math.floor(stepDelta / STEPS_PER_SYNC_POINT),
    stepDelta,
  };
}

/**
 * Convert an untrusted request into a server-trusted one:
 *
 * - claimed rewards are clamped to the session-formula ceiling;
 * - activity metrics (steps/distance/minutes) are bounded to plausible values;
 * - a session completion past the daily cap awards nothing;
 * - the cooldown is computed server-side (client value is ignored).
 */
export function sanitizeFitnessSyncRequest(
  dailyData: Record<string, unknown>,
  request: SyncFitnessActivityRequest,
  now: Date,
): SyncFitnessActivityRequest {
  const sessionIncrement = Math.min(1, Math.max(0, Math.floor(request.sessionIncrement ?? 0)));
  const previousSessionsCompleted = Math.max(0, Number(dailyData.workoutSessionsCompleted ?? 0));
  const capReached = sessionIncrement > 0 && previousSessionsCompleted >= DAILY_WORKOUT_CAP;

  const clamped = clampWorkoutReward({
    stepCount: request.stepsTotal,
    distanceMeters: request.distanceMeters,
    elapsedSeconds: Math.max(0, Math.round(request.workoutMinutes ?? 0)) * 60,
    syncPointsEarned: request.syncPointsAwarded,
    holosEarned: request.holosAwarded,
    expEarned: request.expAwarded,
  });

  const nextSessionsCompleted = Math.min(
    DAILY_WORKOUT_CAP,
    previousSessionsCompleted + sessionIncrement,
  );
  const cooldownEndsAt =
    sessionIncrement > 0 && nextSessionsCompleted < DAILY_WORKOUT_CAP
      ? new Date(now.getTime() + WORKOUT_COOLDOWN_MS).toISOString()
      : null;

  return {
    activityId: request.activityId,
    cooldownEndsAt,
    date: request.date,
    distanceMeters: clamped.distanceMeters,
    eventId: request.eventId,
    expAwarded: capReached ? 0 : request.expAwarded === undefined ? undefined : clamped.exp,
    holobotName: request.holobotName,
    holosAwarded: capReached ? 0 : request.holosAwarded === undefined ? undefined : clamped.holos,
    // When the cap is reached, force the explicit award to zero so the
    // step-delta fallback cannot re-award either.
    sessionIncrement: capReached ? 0 : sessionIncrement,
    stepsTotal: clamped.steps,
    syncPointsAwarded: capReached
      ? 0
      : request.syncPointsAwarded === undefined
        ? undefined
        : clamped.syncPoints,
    workoutMinutes: Math.round(clamped.elapsedSeconds / 60),
  };
}

/**
 * Server mirror of the mobile `computeFitnessSyncOutcome`. Keep identical.
 */
export function computeFitnessSyncOutcome(
  userData: Record<string, unknown>,
  dailyData: Record<string, unknown>,
  request: SyncFitnessActivityRequest,
): FitnessSyncOutcome {
  const activityId = request.activityId?.trim() || request.eventId?.trim() || "";
  const processedActivityIds =
    (dailyData.processedActivityIds as Record<string, true> | undefined) ?? {};
  const processedWorkoutEvents =
    (dailyData.processedWorkoutEvents as Record<string, true> | undefined) ?? {};

  if (activityId && (processedActivityIds[activityId] || processedWorkoutEvents[activityId])) {
    return {
      alreadyProcessed: true,
      dailyUpdates: {},
      response: {
        awardedDelta: 0,
        cooldownEndsAt:
          request.cooldownEndsAt ??
          toIsoString(dailyData.workoutCooldownEndsAt as { toDate?: () => Date } | string | null) ??
          null,
        totalHolosTokens: Number(userData.holosTokens ?? 0),
        todaySteps: Math.max(0, Math.floor(Number(dailyData.stepsTotal ?? request.stepsTotal ?? 0))),
        totalSyncPoints: Number(userData.syncPoints ?? 0),
        workoutSessionsCompleted: Math.max(0, Number(dailyData.workoutSessionsCompleted ?? 0)),
      },
      userUpdates: null,
    };
  }

  const previousStepsSynced = Number(dailyData.stepsSynced ?? 0);
  const currentHolosTokens = Number(userData.holosTokens ?? 0);
  const currentSyncPoints = Number(userData.syncPoints ?? 0);
  const currentLifetimeSyncPoints = Number(userData.lifetimeSyncPoints ?? 0);
  const currentSeasonSyncPoints = Number(userData.seasonSyncPoints ?? 0);
  const stepAward = calculateAwardDelta(previousStepsSynced, request.stepsTotal);
  const expAwarded = Math.max(0, Math.floor(request.expAwarded ?? 0));
  const holosAwarded = Math.max(0, Math.floor(request.holosAwarded ?? 0));
  const awardedDelta = Math.max(
    0,
    Math.floor(request.syncPointsAwarded ?? stepAward.awardedDelta),
  );

  const nextHolosTokens = currentHolosTokens + holosAwarded;
  const nextSyncPoints = currentSyncPoints + awardedDelta;
  const nextLifetimeSyncPoints = currentLifetimeSyncPoints + awardedDelta;
  const nextSeasonSyncPoints = currentSeasonSyncPoints + awardedDelta;
  const previousSessionsCompleted = Math.max(0, Number(dailyData.workoutSessionsCompleted ?? 0));
  const nextSessionsCompleted = Math.min(
    DAILY_WORKOUT_CAP,
    previousSessionsCompleted + Math.max(0, Math.floor(request.sessionIncrement ?? 0)),
  );
  const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const normalizedTargetName = request.holobotName?.trim().toUpperCase() ?? "";
  const sessionIncrementCount = Math.max(0, Math.floor(request.sessionIncrement ?? 0));
  let nextHolobots = currentHolobots;

  if ((expAwarded > 0 || sessionIncrementCount > 0) && currentHolobots.length > 0) {
    const targetIndex = currentHolobots.findIndex((rawHolobot) => {
      const holobotName =
        rawHolobot &&
        typeof rawHolobot === "object" &&
        typeof (rawHolobot as Record<string, unknown>).name === "string"
          ? ((rawHolobot as Record<string, unknown>).name as string)
          : "";
      return holobotName.trim().toUpperCase() === normalizedTargetName;
    });
    const safeTargetIndex = targetIndex >= 0 ? targetIndex : 0;

    nextHolobots = currentHolobots.map((rawHolobot, index) => {
      if (index !== safeTargetIndex) {
        return rawHolobot;
      }

      let nextHolobot = normalizeUserHolobot(rawHolobot);
      if (expAwarded > 0) {
        nextHolobot = applyHolobotExperience(nextHolobot, expAwarded);
      }
      if (sessionIncrementCount > 0) {
        nextHolobot = applyWorkoutCareer(nextHolobot, {
          date: request.date,
          distanceMeters: request.distanceMeters,
        });
      }
      return nextHolobot;
    });
  }

  const dailyUpdates: Record<string, unknown> = {
    date: request.date,
    distanceMeters: Math.max(0, Math.round(request.distanceMeters ?? 0)),
    source: "manual",
    stepsSynced: Math.max(previousStepsSynced, Math.floor(request.stepsTotal)),
    stepsTotal: Math.max(0, Math.floor(request.stepsTotal)),
    syncPointsAwarded: Number(dailyData.syncPointsAwarded ?? 0) + awardedDelta,
    processedActivityIds: activityId
      ? {
          ...processedActivityIds,
          [activityId]: true,
        }
      : processedActivityIds,
    processedWorkoutEvents: activityId
      ? {
          ...processedWorkoutEvents,
          [activityId]: true,
        }
      : processedWorkoutEvents,
    workoutCooldownEndsAt: request.cooldownEndsAt ?? null,
    workoutMinutes: Math.max(0, Math.round(request.workoutMinutes ?? 0)),
    workoutSessionsCompleted: nextSessionsCompleted,
  };

  const userUpdates: Record<string, unknown> = {
    fitnessSource: "manual",
    holosTokens: nextHolosTokens,
    holobots: nextHolobots,
    leaderboardScore: computeLeaderboardScore({
      holobots: nextHolobots,
      prestigeCount: Number(userData.prestigeCount ?? 0),
      seasonSyncPoints: nextSeasonSyncPoints,
      wins: Number(userData.wins ?? 0),
    }),
    syncPoints: nextSyncPoints,
    lifetimeSyncPoints: nextLifetimeSyncPoints,
    seasonSyncPoints: nextSeasonSyncPoints,
    syncRank: getSyncRank(nextLifetimeSyncPoints),
    todaySteps: Math.max(0, Math.floor(request.stepsTotal)),
  };

  return {
    alreadyProcessed: false,
    dailyUpdates,
    response: {
      awardedDelta,
      cooldownEndsAt: request.cooldownEndsAt ?? null,
      totalHolosTokens: nextHolosTokens,
      todaySteps: Math.max(0, Math.floor(request.stepsTotal)),
      totalSyncPoints: nextSyncPoints,
      workoutSessionsCompleted: nextSessionsCompleted,
    },
    userUpdates,
  };
}
