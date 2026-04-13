# Holobots.fun Integration Work

This is the concrete work needed inside the `holobots-fun` repo to consume the mobile app.

## 1. Extend the runtime user model

Update:

- `src/types/user.ts`
- `src/lib/firestore.ts`

Add these fields to `UserProfile` and Firestore mapping:

- `syncPoints?: number`
- `todaySteps?: number`
- `lastStepSync?: string`
- `lastFitnessSyncAt?: string`
- `fitnessSource?: "healthkit" | "manual" | null`

Current issue:

- `src/lib/firestore.ts` already writes `syncPoints`
- but `mapFirestoreToUserProfile()` does not expose it
- and there is no mapping for `todaySteps` or `lastStepSync`

## 2. Update Firestore profile writes

`updateUserProfile()` should accept and persist:

- `todaySteps`
- `lastStepSync`
- `lastFitnessSyncAt`
- `fitnessSource`

## 3. Add a live mobile fitness hook

Create a hook like:

- `src/hooks/useMobileFitness.ts`

Responsibilities:

- subscribe to `users/{uid}`
- expose `todaySteps`, `syncPoints`, `lastStepSync`
- derive loading/error states

## 4. Update `/sync`

Current file:

- `src/pages/Sync.tsx`

Changes:

- keep Quests and Training tabs
- replace the static mobile notice with a live mobile-sync card when mobile data exists
- show:
  - today steps
  - current Sync Points
  - last sync time

## 5. Replace local-only fitness assumptions

Current local-only logic lives in:

- `src/stores/syncPointsStore.ts`
- `src/components/fitness/SyncPointsDashboard.tsx`

Required direction:

- keep local store only for temporary UI state if needed
- move daily totals and spendable Sync Points to backend-derived data
- use Firestore as the source of truth for mobile-earned Sync Points

## 6. Preserve Training as a separate mechanic

Training should remain a gameplay action.

Recommended split:

- HealthKit steps -> backend-awarded Sync Points
- Training tab -> explicit gameplay/training rewards and bonding

That keeps mobile fitness and in-app training from overwriting each other.
