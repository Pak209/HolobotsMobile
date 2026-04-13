export type SyncFitnessActivityRequest = {
  uid: string;
  date: string;
  stepsTotal: number;
  distanceMeters?: number;
  activeCalories?: number;
  workoutMinutes?: number;
  source: "healthkit";
};

export type SyncFitnessActivityResponse = {
  awardedDelta: number;
  totalSyncPoints: number;
  todaySteps: number;
};

export const STEPS_PER_SYNC_POINT = 1000;

export function calculateAwardDelta(previousStepsSynced: number, incomingStepsTotal: number) {
  const safePrevious = Math.max(0, previousStepsSynced);
  const safeIncoming = Math.max(0, incomingStepsTotal);
  const stepDelta = Math.max(0, safeIncoming - safePrevious);

  return {
    stepDelta,
    awardedDelta: Math.floor(stepDelta / STEPS_PER_SYNC_POINT),
  };
}

/*
Portable logic for the Firebase Cloud Function to add inside holobots-fun/functions/src/index.ts.

Pseudo-flow:

1. Validate auth context and request body
2. Read users/{uid} and users/{uid}/fitness_daily/{date}
3. Calculate awarded delta from cumulative step totals
4. Transactionally:
   - upsert fitness_daily/{date}
   - update users/{uid}.todaySteps
   - update users/{uid}.lastStepSync
   - increment users/{uid}.syncPoints by awardedDelta
5. Return awardedDelta, totalSyncPoints, todaySteps
*/
