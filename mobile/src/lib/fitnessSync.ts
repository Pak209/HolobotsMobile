import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

const STEPS_PER_SYNC_POINT = 1000;

type SyncFitnessActivityRequest = {
  date: string;
  distanceMeters?: number;
  stepsTotal: number;
  uid: string;
  workoutMinutes?: number;
};

type SyncFitnessActivityResponse = {
  awardedDelta: number;
  todaySteps: number;
  totalSyncPoints: number;
};

function calculateAwardDelta(previousStepsSynced: number, incomingStepsTotal: number) {
  const safePrevious = Math.max(0, Math.floor(previousStepsSynced));
  const safeIncoming = Math.max(0, Math.floor(incomingStepsTotal));
  const stepDelta = Math.max(0, safeIncoming - safePrevious);

  return {
    awardedDelta: Math.floor(stepDelta / STEPS_PER_SYNC_POINT),
    stepDelta,
  };
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
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

    const userData = userSnapshot.data() ?? {};
    const dailyData = dailySnapshot.data() ?? {};

    const previousStepsSynced = Number(dailyData.stepsSynced ?? 0);
    const currentSyncPoints = Number(userData.syncPoints ?? 0);
    const { awardedDelta } = calculateAwardDelta(previousStepsSynced, request.stepsTotal);

    const nextSyncPoints = currentSyncPoints + awardedDelta;

    transaction.set(
      dailyRef,
      {
        date: request.date,
        distanceMeters: Math.max(0, Math.round(request.distanceMeters ?? 0)),
        lastSampleAt: serverTimestamp(),
        source: "manual",
        stepsSynced: Math.max(previousStepsSynced, Math.floor(request.stepsTotal)),
        stepsTotal: Math.max(0, Math.floor(request.stepsTotal)),
        syncPointsAwarded: Number(dailyData.syncPointsAwarded ?? 0) + awardedDelta,
        workoutMinutes: Math.max(0, Math.round(request.workoutMinutes ?? 0)),
      },
      { merge: true },
    );

    transaction.set(
      userRef,
      {
        fitnessSource: "manual",
        lastFitnessSyncAt: serverTimestamp(),
        lastStepSync: serverTimestamp(),
        syncPoints: nextSyncPoints,
        todaySteps: Math.max(0, Math.floor(request.stepsTotal)),
      },
      { merge: true },
    );

    return {
      awardedDelta,
      todaySteps: Math.max(0, Math.floor(request.stepsTotal)),
      totalSyncPoints: nextSyncPoints,
    };
  });
}
