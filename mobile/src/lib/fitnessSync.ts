import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import {
  applyHolobotExperience,
  applyWorkoutCareer,
  computeLeaderboardScore,
  normalizeUserHolobot,
} from "@/lib/progression";
import { getSyncRank } from "@/lib/syncProgression";

export { getLocalDateKey } from "@/lib/dates";

const STEPS_PER_SYNC_POINT = 1000;
const DAILY_WORKOUT_CAP = 4;

type SyncFitnessActivityRequest = {
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
  uid: string;
  workoutMinutes?: number;
};

type SyncFitnessActivityResponse = {
  awardedDelta: number;
  cooldownEndsAt: string | null;
  totalHolosTokens: number;
  todaySteps: number;
  totalSyncPoints: number;
  workoutSessionsCompleted: number;
};

export type DailyWorkoutState = {
  cooldownEndsAt: string | null;
  sessionsCompleted: number;
};

export type FitnessSyncOutcome = {
  alreadyProcessed: boolean;
  dailyUpdates: Record<string, unknown>;
  response: SyncFitnessActivityResponse;
  userUpdates: Record<string, unknown> | null;
};

function toIsoString(value?: { toDate?: () => Date } | string | null) {
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
 * Pure reward computation for a fitness sync. Given the current user and
 * daily documents plus the incoming request, returns the document updates
 * and the response payload. The Firestore transaction only reads, calls
 * this, and writes — keeping every awarding rule unit-testable.
 */
export function computeFitnessSyncOutcome(
  userData: Record<string, unknown>,
  dailyData: Record<string, unknown>,
  request: SyncFitnessActivityRequest,
): FitnessSyncOutcome {
  const activityId = request.activityId?.trim() || request.eventId?.trim() || "";
  const processedActivityIds = (dailyData.processedActivityIds as Record<string, true> | undefined) ?? {};
  const processedWorkoutEvents = (dailyData.processedWorkoutEvents as Record<string, true> | undefined) ?? {};

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
  const currentHolobots = Array.isArray(userData.holobots)
    ? (userData.holobots as Parameters<typeof normalizeUserHolobot>[0][])
    : [];
  const normalizedTargetName = request.holobotName?.trim().toUpperCase() ?? "";
  const sessionIncrementCount = Math.max(0, Math.floor(request.sessionIncrement ?? 0));
  let nextHolobots = currentHolobots;

  if ((expAwarded > 0 || sessionIncrementCount > 0) && currentHolobots.length > 0) {
    const targetIndex = currentHolobots.findIndex((rawHolobot) => {
      const holobotName =
        typeof (rawHolobot as { name?: unknown })?.name === "string"
          ? String((rawHolobot as { name?: unknown }).name)
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
      holobots: nextHolobots as Parameters<typeof computeLeaderboardScore>[0]["holobots"],
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

export async function getDailyWorkoutState(
  db: Firestore,
  uid: string,
  date: string,
): Promise<DailyWorkoutState> {
  const dailyRef = doc(db, "users", uid, "fitness_daily", date);
  const snapshot = await getDoc(dailyRef);
  const data = snapshot.data() ?? {};

  return {
    cooldownEndsAt: toIsoString(data.workoutCooldownEndsAt),
    sessionsCompleted: Math.min(
      DAILY_WORKOUT_CAP,
      Math.max(0, Number(data.workoutSessionsCompleted ?? 0)),
    ),
  };
}

export async function unlockDailyWorkoutRefill(
  db: Firestore,
  uid: string,
  date: string,
): Promise<DailyWorkoutState> {
  const dailyRef = doc(db, "users", uid, "fitness_daily", date);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(dailyRef);
    const data = snapshot.data() ?? {};

    const nextState = {
      cooldownEndsAt: null,
      sessionsCompleted: Math.min(
        DAILY_WORKOUT_CAP,
        Math.max(0, Number(data.workoutSessionsCompleted ?? 0)),
      ),
    };

    transaction.set(
      dailyRef,
      {
        lastSampleAt: serverTimestamp(),
        workoutCooldownEndsAt: null,
      },
      { merge: true },
    );

    return nextState;
  });
}

export async function syncFitnessActivity(
  db: Firestore,
  request: SyncFitnessActivityRequest,
): Promise<SyncFitnessActivityResponse> {
  const userRef = doc(db, "users", request.uid);
  const dailyRef = doc(db, "users", request.uid, "fitness_daily", request.date);

  return runTransaction(db, async (transaction) => {
    const [userSnapshot, dailySnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(dailyRef),
    ]);

    const outcome = computeFitnessSyncOutcome(
      userSnapshot.data() ?? {},
      dailySnapshot.data() ?? {},
      request,
    );

    if (outcome.alreadyProcessed || !outcome.userUpdates) {
      return outcome.response;
    }

    transaction.set(
      dailyRef,
      {
        ...outcome.dailyUpdates,
        lastSampleAt: serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(
      userRef,
      {
        ...outcome.userUpdates,
        lastFitnessSyncAt: serverTimestamp(),
        lastStepSync: serverTimestamp(),
      },
      { merge: true },
    );

    return outcome.response;
  });
}
