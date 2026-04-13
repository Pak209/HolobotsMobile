# Firebase Fitness Sync Contract

This contract is the shared backend shape between the native iOS app and `holobots-fun`.

## Goals

- The iOS app is the system of record for fitness capture.
- Firebase is the system of record for synced daily totals and awarded Sync Points.
- `holobots.fun` only reads backend fitness state and displays it.
- Sync Point awarding is server-authoritative to avoid client-side double-counting.

## Firestore additions

### `users/{uid}`

Add:

- `syncPoints: number`
- `todaySteps: number`
- `lastStepSync: Timestamp | null`
- `lastFitnessSyncAt: Timestamp | null`
- `fitnessSource: "healthkit" | "manual" | null`

### `users/{uid}/fitness_daily/{yyyy-mm-dd}`

Document shape:

```ts
{
  date: "2026-04-03",
  stepsTotal: 8421,
  stepsSynced: 8421,
  distanceMeters: 6123,
  activeCalories: 481,
  workoutMinutes: 37,
  syncPointsAwarded: 8,
  lastSampleAt: Timestamp,
  source: "healthkit"
}
```

## Sync function

Add a callable or HTTPS Cloud Function named `syncFitnessActivity`.

Request:

```ts
{
  date: string;
  stepsTotal: number;
  distanceMeters?: number;
  activeCalories?: number;
  workoutMinutes?: number;
  source: "healthkit";
}
```

Response:

```ts
{
  awardedDelta: number;
  totalSyncPoints: number;
  todaySteps: number;
}
```

## Awarding rules

- Use cumulative daily totals from HealthKit, not per-event increments.
- Compute `stepDelta = max(0, incoming.stepsTotal - existing.stepsSynced)`.
- Award only on the unsynced delta.
- Suggested default: `1000 steps = 1 Sync Point`.
- Persist the new cumulative total after awarding.

## Why this shape

- Replays are safe.
- Background sync is idempotent.
- The web app can subscribe to one user document and display current totals immediately.
- Historical daily records remain available for streaks, rewards, and audits.
