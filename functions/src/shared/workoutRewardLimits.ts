/**
 * Canonical server-side reward limits for fitness / watch workout syncs.
 *
 * The Holobots economy is otherwise client-authoritative (see SECURITY_AUDIT.md).
 * The `syncWatchWorkoutRewards` Cloud Function is the one server-blessed reward
 * path, so it MUST NOT trust client-supplied reward amounts blindly. This module
 * is the single source of truth for how a raw (attacker-controllable) workout
 * payload is clamped to a plausible reward before it is persisted.
 *
 * The ceilings mirror the session reward formula the watch actually uses
 * (`RewardCalculator` in WorkoutPayload.swift and `calculateRewards` in
 * mobile/src/hooks/useWorkout.ts): base session points + a step bonus + a
 * per-km milestone bonus. Keep all three in sync when rebalancing.
 *
 * The equivalent file is kept byte-identical at
 * `functions/src/shared/workoutRewardLimits.ts` (enforced by
 * `functions/scripts/check-shared-parity.mjs` on every functions build).
 */

export type RawWorkoutRewardInput = {
  stepCount?: unknown;
  distanceMeters?: unknown;
  elapsedSeconds?: unknown;
  syncPointsEarned?: unknown;
  holosEarned?: unknown;
  expEarned?: unknown;
};

export type ClampedWorkoutReward = {
  syncPoints: number;
  holos: number;
  exp: number;
  steps: number;
  distanceMeters: number;
  elapsedSeconds: number;
};

// Session reward formula constants (must match the watch/phone reward math).
export const BASE_SESSION_SYNC_POINTS = 225;
export const SESSION_STEP_BONUS_DIVISOR = 25;
export const SYNC_POINTS_PER_KM_MILESTONE = 100;
export const HOLOS_PER_KM = 12;
export const EXP_PER_KM = 280;

// Absolute per-session ceilings (a single workout can never legitimately exceed
// these regardless of reported steps/distance). ~60k steps and ~42km (marathon).
export const MAX_SESSION_SYNC_POINTS = 2000;
export const MAX_SESSION_HOLOS = 500;
export const MAX_SESSION_EXP = 12000;
export const MAX_SESSION_STEPS = 60000;
export const MAX_SESSION_DISTANCE_METERS = 60000;
export const MAX_SESSION_ELAPSED_SECONDS = 12 * 60 * 60; // 12h

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.floor(n);
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(0, value), max);
}

/**
 * Convert an untrusted workout payload into the maximum reward it could
 * legitimately justify, then clamp the client's claimed reward to that ceiling.
 *
 * The reward paid is `min(claimed, derivedFromActivity, absoluteCap)`. A client
 * can under-report but never over-report.
 */
export function clampWorkoutReward(input: RawWorkoutRewardInput): ClampedWorkoutReward {
  const steps = clamp(toNonNegativeInt(input.stepCount), MAX_SESSION_STEPS);
  const distanceMeters = clamp(toNonNegativeInt(input.distanceMeters), MAX_SESSION_DISTANCE_METERS);
  const elapsedSeconds = clamp(toNonNegativeInt(input.elapsedSeconds), MAX_SESSION_ELAPSED_SECONDS);

  const distanceKm = distanceMeters / 1000;

  // Ceiling justified by the reported (already-clamped) activity, mirroring
  // the session formula: base + steps/25 + 100 per full km.
  const syncPointsCeiling = Math.min(
    BASE_SESSION_SYNC_POINTS +
      Math.floor(steps / SESSION_STEP_BONUS_DIVISOR) +
      Math.floor(distanceKm) * SYNC_POINTS_PER_KM_MILESTONE,
    MAX_SESSION_SYNC_POINTS,
  );
  const holosCeiling = Math.min(Math.floor(distanceKm * HOLOS_PER_KM), MAX_SESSION_HOLOS);
  const expCeiling = Math.min(Math.floor(distanceKm * EXP_PER_KM), MAX_SESSION_EXP);

  const claimedSyncPoints = toNonNegativeInt(input.syncPointsEarned);
  const claimedHolos = toNonNegativeInt(input.holosEarned);
  const claimedExp = toNonNegativeInt(input.expEarned);

  return {
    syncPoints: Math.min(claimedSyncPoints, syncPointsCeiling),
    holos: Math.min(claimedHolos, holosCeiling),
    exp: Math.min(claimedExp, expCeiling),
    steps,
    distanceMeters,
    elapsedSeconds,
  };
}
