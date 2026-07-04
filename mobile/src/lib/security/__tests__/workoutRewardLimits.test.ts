import { describe, expect, it } from 'vitest';

import {
  clampWorkoutReward,
  MAX_SESSION_EXP,
  MAX_SESSION_HOLOS,
  MAX_SESSION_SYNC_POINTS,
} from '../workoutRewardLimits';

describe('clampWorkoutReward', () => {
  it('pays honest rewards that are justified by reported activity', () => {
    // 8000 steps -> 8 sync points; 5km -> 60 holos, 1400 exp.
    const result = clampWorkoutReward({
      stepCount: 8000,
      distanceMeters: 5000,
      elapsedSeconds: 1800,
      syncPointsEarned: 8,
      holosEarned: 60,
      expEarned: 1400,
    });

    expect(result.syncPoints).toBe(8);
    expect(result.holos).toBe(60);
    expect(result.exp).toBe(1400);
  });

  it('caps a fabricated payout to what the activity justifies (regression: H1)', () => {
    const result = clampWorkoutReward({
      stepCount: 1000, // justifies only 1 sync point
      distanceMeters: 500, // 0.5km -> 6 holos, 140 exp
      elapsedSeconds: 60,
      syncPointsEarned: 1_000_000,
      holosEarned: 1_000_000,
      expEarned: 1_000_000,
    });

    expect(result.syncPoints).toBe(1);
    expect(result.holos).toBe(6);
    expect(result.exp).toBe(140);
  });

  it('never exceeds absolute per-session ceilings even with huge reported activity', () => {
    const result = clampWorkoutReward({
      stepCount: 10_000_000,
      distanceMeters: 10_000_000,
      elapsedSeconds: 10_000_000,
      syncPointsEarned: 10_000_000,
      holosEarned: 10_000_000,
      expEarned: 10_000_000,
    });

    expect(result.syncPoints).toBe(MAX_SESSION_SYNC_POINTS);
    expect(result.holos).toBe(MAX_SESSION_HOLOS);
    expect(result.exp).toBe(MAX_SESSION_EXP);
  });

  it('rejects negative, NaN, Infinity and non-numeric inputs', () => {
    const result = clampWorkoutReward({
      stepCount: -5000,
      distanceMeters: Number.NaN,
      elapsedSeconds: Number.POSITIVE_INFINITY,
      syncPointsEarned: -1,
      holosEarned: 'lots' as unknown as number,
      expEarned: undefined,
    });

    expect(result.syncPoints).toBe(0);
    expect(result.holos).toBe(0);
    expect(result.exp).toBe(0);
    expect(result.steps).toBe(0);
    expect(result.distanceMeters).toBe(0);
    expect(result.elapsedSeconds).toBe(0);
  });

  it('lets a client under-report but never over-report', () => {
    const result = clampWorkoutReward({
      stepCount: 20000, // justifies 20 sync points
      distanceMeters: 3000,
      elapsedSeconds: 1200,
      syncPointsEarned: 5, // client claims fewer
      holosEarned: 10,
      expEarned: 100,
    });

    expect(result.syncPoints).toBe(5);
    expect(result.holos).toBe(10);
    expect(result.exp).toBe(100);
  });
});
