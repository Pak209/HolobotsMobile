import { DocumentData, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  applyHolobotExperience,
  applyWorkoutCareer,
  computeLeaderboardScore,
  getSyncRank,
} from "../lib/progression";
import { RawWorkoutRewardInput, clampWorkoutReward } from "../shared/workoutRewardLimits";

const DAILY_WORKOUT_CAP = 4;

// Maximum number of workout events accepted in a single sync call (anti-DoS /
// anti mass-write). A device can never legitimately buffer more than a handful.
const MAX_WORKOUTS_PER_CALL = 25;

type WatchWorkoutPayload = RawWorkoutRewardInput & {
  workoutId?: unknown;
  date?: unknown;
  holobotName?: unknown;
};

type WorkoutRewardResult = {
  alreadyProcessed: boolean;
  totalSyncPoints: number;
  workoutSessionsCompleted: number;
};

async function persistWatchWorkoutReward(
  uid: string,
  workout: WatchWorkoutPayload,
): Promise<WorkoutRewardResult> {
  const activityId = typeof workout.workoutId === "string" ? workout.workoutId.trim() : "";
  const date =
    typeof workout.date === "string" && workout.date
      ? workout.date
      : new Date().toISOString().slice(0, 10);
  const dailyRef = db.doc(`users/${uid}/fitness_daily/${date}`);
  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, dailySnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(dailyRef),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData: DocumentData = userSnapshot.data() || {};
    const dailyData: DocumentData = dailySnapshot.data() || {};
    const processedActivityIds = dailyData.processedActivityIds || {};
    const processedWorkoutEvents = dailyData.processedWorkoutEvents || {};

    if (activityId && (processedActivityIds[activityId] || processedWorkoutEvents[activityId])) {
      return {
        alreadyProcessed: true,
        totalSyncPoints: Number(userData.syncPoints || 0),
        workoutSessionsCompleted: Math.max(0, Number(dailyData.workoutSessionsCompleted || 0)),
      };
    }

    const clampedReward = clampWorkoutReward(workout);
    const awardedSyncPoints = clampedReward.syncPoints;
    const awardedHolos = clampedReward.holos;
    const awardedExp = clampedReward.exp;
    const previousSessionsCompleted = Math.max(0, Number(dailyData.workoutSessionsCompleted || 0));
    const nextSessionsCompleted = Math.min(DAILY_WORKOUT_CAP, previousSessionsCompleted + 1);

    const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
    const normalizedTargetName =
      typeof workout.holobotName === "string" ? workout.holobotName.trim().toUpperCase() : "";
    let nextHolobots = currentHolobots;

    if (currentHolobots.length > 0) {
      const targetIndex = currentHolobots.findIndex((rawHolobot) => {
        const holobotName =
          rawHolobot && typeof rawHolobot === "object" && typeof (rawHolobot as Record<string, unknown>).name === "string"
            ? ((rawHolobot as Record<string, unknown>).name as string)
            : "";
        return holobotName.trim().toUpperCase() === normalizedTargetName;
      });
      const safeTargetIndex = targetIndex >= 0 ? targetIndex : 0;

      nextHolobots = currentHolobots.map((rawHolobot, index) => {
        if (index !== safeTargetIndex) {
          return rawHolobot;
        }

        let nextHolobot: unknown = rawHolobot;
        if (awardedExp > 0) {
          nextHolobot = applyHolobotExperience(nextHolobot, awardedExp);
        }
        // Every processed watch workout counts toward the companion career.
        return applyWorkoutCareer(nextHolobot, {
          date,
          distanceMeters: clampedReward.distanceMeters,
        });
      });
    }

    const nextSyncPoints = Math.max(0, Number(userData.syncPoints || 0)) + awardedSyncPoints;
    const nextLifetimeSyncPoints =
      Math.max(0, Number(userData.lifetimeSyncPoints || 0)) + awardedSyncPoints;
    const nextSeasonSyncPoints =
      Math.max(0, Number(userData.seasonSyncPoints || 0)) + awardedSyncPoints;
    const nextHolosTokens = Math.max(0, Number(userData.holosTokens || 0)) + awardedHolos;

    transaction.set(dailyRef, {
      date,
      distanceMeters: clampedReward.distanceMeters,
      lastSampleAt: FieldValue.serverTimestamp(),
      processedActivityIds: activityId
        ? { ...processedActivityIds, [activityId]: true }
        : processedActivityIds,
      processedWorkoutEvents: activityId
        ? { ...processedWorkoutEvents, [activityId]: true }
        : processedWorkoutEvents,
      source: "watch",
      stepsTotal: Math.max(
        Math.max(0, Number(dailyData.stepsTotal || 0)),
        clampedReward.steps,
      ),
      syncPointsAwarded: Number(dailyData.syncPointsAwarded || 0) + awardedSyncPoints,
      workoutMinutes: Math.max(0, Math.round(clampedReward.elapsedSeconds / 60)),
      workoutSessionsCompleted: nextSessionsCompleted,
    }, { merge: true });

    transaction.set(userRef, {
      fitnessSource: "watch",
      holobots: nextHolobots,
      holosTokens: nextHolosTokens,
      lastFitnessSyncAt: FieldValue.serverTimestamp(),
      lastStepSync: FieldValue.serverTimestamp(),
      leaderboardScore: computeLeaderboardScore({
        holobots: nextHolobots,
        prestigeCount: Number(userData.prestigeCount || 0),
        seasonSyncPoints: nextSeasonSyncPoints,
        wins: Number(userData.wins || 0),
      }),
      lifetimeSyncPoints: nextLifetimeSyncPoints,
      seasonSyncPoints: nextSeasonSyncPoints,
      syncPoints: nextSyncPoints,
      syncRank: getSyncRank(nextLifetimeSyncPoints),
      todaySteps: clampedReward.steps,
    }, { merge: true });

    return {
      alreadyProcessed: false,
      totalSyncPoints: nextSyncPoints,
      workoutSessionsCompleted: nextSessionsCompleted,
    };
  });
}

export const syncWatchWorkoutRewards = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync watch rewards.");
  }

  const workouts: unknown[] = Array.isArray(request.data?.workouts) ? request.data.workouts : [];
  if (!workouts.length) {
    return {
      processedCount: 0,
      sessionsCompleted: 0,
      sessionsRemaining: DAILY_WORKOUT_CAP,
      totalSyncPoints: 0,
    };
  }

  if (workouts.length > MAX_WORKOUTS_PER_CALL) {
    throw new HttpsError(
      "invalid-argument",
      `Too many workouts in one sync (max ${MAX_WORKOUTS_PER_CALL}).`,
    );
  }

  if (!workouts.every((workout) => workout && typeof workout === "object")) {
    throw new HttpsError("invalid-argument", "Malformed workout payload.");
  }

  let latestResult: WorkoutRewardResult = {
    alreadyProcessed: false,
    totalSyncPoints: 0,
    workoutSessionsCompleted: 0,
  };
  let processedCount = 0;

  for (const workout of workouts) {
    const result = await persistWatchWorkoutReward(uid, workout as WatchWorkoutPayload);
    latestResult = result;
    if (!result.alreadyProcessed) {
      processedCount += 1;
    }
  }

  return {
    processedCount,
    sessionsCompleted: latestResult.workoutSessionsCompleted,
    sessionsRemaining: Math.max(0, DAILY_WORKOUT_CAP - latestResult.workoutSessionsCompleted),
    totalSyncPoints: latestResult.totalSyncPoints,
  };
});
