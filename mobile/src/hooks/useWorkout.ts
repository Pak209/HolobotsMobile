import { useEffect, useRef, useState } from "react";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";

import { db } from "@/config/firebase";
import {
  getLocalDateKey,
  watchDailyWorkoutState,
} from "@/lib/fitnessSync";
import {
  clearWorkoutCooldownAuthoritative,
  syncFitnessActivityAuthoritative,
} from "@/lib/fitnessSyncClient";

export type DistanceUnit = "km" | "mi";
export type WorkoutRewardOptions = {
  /** Multiplier applied to EXP rewards (e.g. sync boost). Defaults to 1. */
  expMultiplier?: number;
  /** Holobot that receives workout EXP and career credit. */
  holobotName?: string;
};
export type WorkoutCompletionResult = {
  cooldownEndsAt: string | null;
  cumulativeDistanceKm: number;
  distanceKm: number;
  displayDistance: number;
  displayUnit: DistanceUnit;
  expReward: number;
  holosReward: number;
  id: string;
  /** True when rewards were persisted by the sync transaction. */
  rewardsPersisted: boolean;
  sessionsCompleted: number;
  sessionsRemaining: number;
  syncPointBoostCount: number;
  syncPointBoostReward: number;
  syncPointsReward: number;
  totalSyncPoints: number | null;
  workoutMinutes: number;
};

const TOTAL_WORKOUT_SECONDS = 5 * 60;
const DAILY_TOTAL_MINUTES = 20;
const MAX_DAILY_SESSION_CAP = 4;
const WORKOUT_COOLDOWN_MS = 10 * 60 * 1000;
const BASE_SESSION_SYNC_POINTS = 225;
const BASE_HOLOS_PER_KM = 12;
const BASE_EXP_PER_KM = 280;
const UNIT_SYNC_POINT_BOOST = 100;
const KM_TO_MILES = 0.621371;

type LiveWorkoutState = {
  distanceKm: number;
  elapsedSeconds: number;
  isRunning: boolean;
  speedKmh: number;
  stepCount: number;
  todayStepCount: number;
};

type PermissionState = "idle" | "granted" | "denied";
type SyncState = "idle" | "syncing" | "synced" | "error";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Presence lock staleness bound: session remainder + this grace. */
const PRESENCE_GRACE_MS = 60 * 1000;

/**
 * Tell the watch whether this phone is mid-workout (soft cross-device
 * lock). Self-expiring by timestamp so a killed app never leaves the
 * watch blocked. No-op off iOS or when the native bridge is absent.
 */
function broadcastPhoneWorkoutPresence(active: boolean, remainingSeconds = 0) {
  const bridge = NativeModules.WatchBridgeModule;
  if (Platform.OS !== "ios" || typeof bridge?.syncWorkoutPresence !== "function") {
    return;
  }
  const now = Date.now();
  bridge.syncWorkoutPresence({
    device: "phone",
    workoutActive: active,
    startedAtMs: now,
    expiresAtMs: now + Math.max(0, remainingSeconds) * 1000 + PRESENCE_GRACE_MS,
  });
}

function getDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadius = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lonDelta = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getTodayStepCount() {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);

  try {
    const result = await Pedometer.getStepCountAsync(start, end);
    return Math.max(0, result.steps ?? 0);
  } catch {
    return 0;
  }
}

function getDisplayDistance(distanceKm: number, unitPreference: DistanceUnit) {
  return unitPreference === "mi" ? distanceKm * KM_TO_MILES : distanceKm;
}

function getCooldownRemainingMs(cooldownEndsAt: string | null, now: number) {
  if (!cooldownEndsAt) {
    return 0;
  }

  const endsAtMs = new Date(cooldownEndsAt).getTime();
  if (!Number.isFinite(endsAtMs)) {
    return 0;
  }

  return Math.max(0, endsAtMs - now);
}

function calculateRewards(
  sessionDistanceKm: number,
  cumulativeDistanceKm: number,
  elapsedSeconds: number,
  stepCount: number,
  unitPreference: DistanceUnit,
  rewardedBoostCount: number,
  expMultiplier = 1,
) {
  const progress = clamp(elapsedSeconds / TOTAL_WORKOUT_SECONDS, 0, 1);
  const syncPointBoostCount = Math.floor(getDisplayDistance(cumulativeDistanceKm, unitPreference));
  const newBoostCount = Math.max(0, syncPointBoostCount - rewardedBoostCount);
  const distanceBonus = newBoostCount * UNIT_SYNC_POINT_BOOST;
  const stepBonus = Math.floor(stepCount / 25);
  const safeExpMultiplier = Number.isFinite(expMultiplier) && expMultiplier > 0 ? expMultiplier : 1;

  return {
    expReward: Math.max(0, Math.round(sessionDistanceKm * BASE_EXP_PER_KM * safeExpMultiplier)),
    holosReward: Math.max(0, Math.round(sessionDistanceKm * BASE_HOLOS_PER_KM)),
    newSyncPointBoostCount: newBoostCount,
    syncPointBoostCount,
    syncPointBoostReward: distanceBonus,
    syncPointsReward: Math.max(0, Math.round(progress * BASE_SESSION_SYNC_POINTS) + stepBonus + distanceBonus),
  };
}

function useLiveWorkout(
  userId?: string | null,
  unitPreference: DistanceUnit = "km",
  rewardOptions?: WorkoutRewardOptions,
) {
  const [state, setState] = useState<LiveWorkoutState>({
    distanceKm: 0,
    elapsedSeconds: 0,
    isRunning: false,
    speedKmh: 0,
    stepCount: 0,
    todayStepCount: 0,
  });
  const [permissionState, setPermissionState] = useState<PermissionState>("idle");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("Sign in to sync rewards.");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [completionResult, setCompletionResult] = useState<WorkoutCompletionResult | null>(null);
  const completionSyncArgsRef = useRef<{
    snapshot: LiveWorkoutState;
    extras: Parameters<typeof syncCurrentActivity>[2];
  } | null>(null);
  const [carryoverDistanceKm, setCarryoverDistanceKm] = useState(0);
  const [rewardedBoostCount, setRewardedBoostCount] = useState(0);

  const startTimestampRef = useRef<number | null>(null);
  const elapsedOffsetSecondsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const pedometerSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const previousCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const stateRef = useRef(state);
  const todayStepsAtStartRef = useRef(0);
  const lastSyncedDateRef = useRef<string | null>(null);
  const lastSyncedStepsRef = useRef(0);
  const sessionsCompletedRef = useRef(0);
  const completionLockRef = useRef(false);
  const cooldownEndsAtRef = useRef<string | null>(null);
  const carryoverDistanceKmRef = useRef(0);
  const rewardedBoostCountRef = useRef(0);
  const rewardOptionsRef = useRef(rewardOptions);

  rewardOptionsRef.current = rewardOptions;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    sessionsCompletedRef.current = sessionsCompleted;
  }, [sessionsCompleted]);

  useEffect(() => {
    cooldownEndsAtRef.current = cooldownEndsAt;
  }, [cooldownEndsAt]);

  useEffect(() => {
    carryoverDistanceKmRef.current = carryoverDistanceKm;
  }, [carryoverDistanceKm]);

  useEffect(() => {
    rewardedBoostCountRef.current = rewardedBoostCount;
  }, [rewardedBoostCount]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Live daily-state subscription: watch workouts land on the same
  // fitness_daily doc, so the phone's session count / cooldown must track
  // server writes made by OTHER devices, not just this hook's own syncs.
  useEffect(() => {
    if (!userId) {
      setCooldownEndsAt(null);
      setSessionsCompleted(0);
      return;
    }

    return watchDailyWorkoutState(db, userId, getLocalDateKey(), (nextState) => {
      setCooldownEndsAt(nextState.cooldownEndsAt);
      setSessionsCompleted(nextState.sessionsCompleted);
    });
  }, [userId]);

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      locationSubscriptionRef.current?.remove();
      pedometerSubscriptionRef.current?.remove();
    };
  }, []);

  const stopLiveTracking = () => {
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = null;
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    pedometerSubscriptionRef.current?.remove();
    pedometerSubscriptionRef.current = null;
    previousCoordsRef.current = null;
  };

  const syncCurrentActivity = async (
    snapshot: LiveWorkoutState,
    reason: "pause" | "complete",
    extras?: {
      activityId?: string;
      cooldownEndsAt?: string | null;
      expAwarded?: number;
      holobotName?: string;
      holosAwarded?: number;
      sessionIncrement?: number;
      syncPointsAwarded?: number;
    },
  ) => {
    if (!userId) {
      setSyncState("idle");
      setSyncMessage("Sign in to sync rewards.");
      return null;
    }

    const date = getLocalDateKey();
    const stepsTotal = Math.max(
      snapshot.todayStepCount,
      todayStepsAtStartRef.current + snapshot.stepCount,
    );

    if (stepsTotal <= 0 && snapshot.distanceKm <= 0 && snapshot.elapsedSeconds <= 0) {
      return null;
    }

    const hasExplicitSyncReward = extras?.syncPointsAwarded !== undefined;
    if (
      !hasExplicitSyncReward &&
      lastSyncedDateRef.current === date &&
      stepsTotal <= lastSyncedStepsRef.current
    ) {
      setSyncState("synced");
      setSyncMessage(`Workout ${reason === "pause" ? "paused" : "completed"} and already synced.`);
      return null;
    }

    try {
      setSyncState("syncing");
      setSyncMessage(reason === "pause" ? "Syncing paused workout..." : "Syncing completed workout...");

      const result = await syncFitnessActivityAuthoritative({
        activityId: extras?.activityId,
        cooldownEndsAt: extras?.cooldownEndsAt,
        date,
        distanceMeters: snapshot.distanceKm * 1000,
        expAwarded: extras?.expAwarded,
        holobotName: extras?.holobotName,
        holosAwarded: extras?.holosAwarded,
        sessionIncrement: extras?.sessionIncrement,
        stepsTotal,
        syncPointsAwarded: extras?.syncPointsAwarded,
        uid: userId,
        workoutMinutes: Math.max(1, Math.round(snapshot.elapsedSeconds / 60)),
      });

      lastSyncedDateRef.current = date;
      lastSyncedStepsRef.current = result.todaySteps;
      setLastSyncedAt(Date.now());
      setSyncState("synced");
      setSyncMessage(
        result.awardedDelta > 0
          ? `Synced ${result.awardedDelta} new Sync Points.`
          : "Workout synced. No new Sync Points yet.",
      );
      setState((current) => ({
        ...current,
        todayStepCount: result.todaySteps,
      }));
      setCooldownEndsAt(result.cooldownEndsAt);
      setSessionsCompleted(result.workoutSessionsCompleted);
      return result;
    } catch {
      setSyncState("error");
      setSyncMessage(
        reason === "complete"
          ? "Cloud sync failed. Tap COLLECT to retry when you're back online."
          : "Cloud sync failed. Steps will sync with your next workout update.",
      );
      return null;
    }
  };

  /**
   * COLLECT retry (bake bug 2 follow-through): when the completion sync
   * failed or timed out, re-send the SAME payload — idempotent by
   * activityId — and flip the completion result to persisted on success.
   */
  const retryCompletionSync = async (): Promise<boolean> => {
    const args = completionSyncArgsRef.current;
    if (!args) {
      return false;
    }

    const result = await syncCurrentActivity(args.snapshot, "complete", args.extras);
    if (result == null) {
      return false;
    }

    setCompletionResult((current) =>
      current
        ? {
            ...current,
            cooldownEndsAt: result.cooldownEndsAt,
            rewardsPersisted: true,
            sessionsCompleted: result.workoutSessionsCompleted,
            sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - result.workoutSessionsCompleted),
            totalSyncPoints: result.totalSyncPoints,
          }
        : current,
    );
    return true;
  };

  const requestPermissions = async () => {
    const [locationPermission, pedometerPermission] = await Promise.all([
      Location.requestForegroundPermissionsAsync(),
      Pedometer.requestPermissionsAsync(),
    ]);

    const granted =
      locationPermission.granted &&
      (pedometerPermission.granted || pedometerPermission.status === "undetermined");

    setPermissionState(granted ? "granted" : "denied");
    if (!granted) {
      setSyncMessage("Allow location and motion access to start a workout.");
    }
    return granted;
  };

  const startLiveTracking = async () => {
    const cooldownRemainingMs = getCooldownRemainingMs(cooldownEndsAtRef.current, Date.now());

    if (sessionsCompletedRef.current >= MAX_DAILY_SESSION_CAP) {
      setSyncMessage("Daily Sync workout limit reached. Come back tomorrow.");
      return;
    }

    if (cooldownRemainingMs > 0) {
      setSyncMessage("Workout cooling down. Use Quick Refill or wait for the timer to end.");
      return;
    }

    const granted = permissionState === "granted" || (await requestPermissions());
    if (!granted) {
      return;
    }

    const todaySteps = await getTodayStepCount();
    todayStepsAtStartRef.current = todaySteps;
    setState((current) => ({
      ...current,
      todayStepCount: Math.max(current.todayStepCount, todaySteps),
    }));
    setSyncMessage(userId ? "Workout running..." : "Workout running. Sign in to sync rewards.");
    completionLockRef.current = false;
    broadcastPhoneWorkoutPresence(
      true,
      TOTAL_WORKOUT_SECONDS - elapsedOffsetSecondsRef.current,
    );

    startTimestampRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setState((current) => {
        const elapsedSinceStart = startTimestampRef.current
          ? (Date.now() - startTimestampRef.current) / 1000
          : 0;
        const nextElapsed = Math.min(
          elapsedOffsetSecondsRef.current + elapsedSinceStart,
          TOTAL_WORKOUT_SECONDS,
        );

        if (nextElapsed >= TOTAL_WORKOUT_SECONDS) {
          stopLiveTracking();
          startTimestampRef.current = null;
          elapsedOffsetSecondsRef.current = TOTAL_WORKOUT_SECONDS;
          const completedSnapshot: LiveWorkoutState = {
            ...current,
            elapsedSeconds: TOTAL_WORKOUT_SECONDS,
            isRunning: false,
            speedKmh: 0,
          };
          stateRef.current = completedSnapshot;
          void finishWorkout("complete", completedSnapshot);
          return completedSnapshot;
        }

        return {
          ...current,
          elapsedSeconds: nextElapsed,
          isRunning: true,
        };
      });
    }, 1000);

    locationSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 1,
        timeInterval: 1000,
      },
      (location) => {
        setState((current) => {
          const coords = location.coords;
          const nextCoords = {
            latitude: coords.latitude,
            longitude: coords.longitude,
          };

          let nextDistanceKm = current.distanceKm;
          if (previousCoordsRef.current) {
            nextDistanceKm += getDistanceMeters(previousCoordsRef.current, nextCoords) / 1000;
          }
          previousCoordsRef.current = nextCoords;

          return {
            ...current,
            distanceKm: nextDistanceKm,
            speedKmh: Math.max(0, (coords.speed ?? 0) * 3.6),
          };
        });
      },
    );

    const pedometerAvailable = await Pedometer.isAvailableAsync();
    if (pedometerAvailable) {
      pedometerSubscriptionRef.current = Pedometer.watchStepCount((result) => {
        setState((current) => ({
          ...current,
          stepCount: result.steps,
          todayStepCount: Math.max(current.todayStepCount, todayStepsAtStartRef.current + result.steps),
        }));
      });
    }
  };

  const finishWorkout = async (
    reason: "complete" | "finish-now",
    snapshotOverride?: LiveWorkoutState,
  ) => {
    if (completionLockRef.current) {
      return;
    }

    const currentState = snapshotOverride ?? stateRef.current;
    if (currentState.elapsedSeconds <= 0 && currentState.distanceKm <= 0 && currentState.stepCount <= 0) {
      setSyncMessage("Start a workout first.");
      return;
    }

    completionLockRef.current = true;
    stopLiveTracking();
    startTimestampRef.current = null;
    broadcastPhoneWorkoutPresence(false);

    const finalElapsedSeconds =
      reason === "complete"
        ? TOTAL_WORKOUT_SECONDS
        : clamp(Math.round(currentState.elapsedSeconds), 1, TOTAL_WORKOUT_SECONDS);

    elapsedOffsetSecondsRef.current = finalElapsedSeconds;

    const finalSnapshot: LiveWorkoutState = {
      ...currentState,
      elapsedSeconds: finalElapsedSeconds,
      isRunning: false,
      speedKmh: 0,
    };

    stateRef.current = finalSnapshot;
    setState(finalSnapshot);

    const cumulativeDistanceKm = carryoverDistanceKmRef.current + finalSnapshot.distanceKm;
    const rewards = calculateRewards(
      finalSnapshot.distanceKm,
      cumulativeDistanceKm,
      finalSnapshot.elapsedSeconds,
      finalSnapshot.stepCount,
      unitPreference,
      rewardedBoostCountRef.current,
      rewardOptionsRef.current?.expMultiplier,
    );
    const nextSessionsCompleted = Math.min(MAX_DAILY_SESSION_CAP, sessionsCompletedRef.current + 1);
    const nextCooldownEndsAt =
      nextSessionsCompleted >= MAX_DAILY_SESSION_CAP
        ? null
        : new Date(Date.now() + WORKOUT_COOLDOWN_MS).toISOString();
    const completionId = `workout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Kept for COLLECT retries: the activityId makes the server sync
    // idempotent, so re-sending the identical payload can never double-pay.
    completionSyncArgsRef.current = {
      snapshot: finalSnapshot,
      extras: {
        activityId: completionId,
        cooldownEndsAt: nextCooldownEndsAt,
        expAwarded: rewards.expReward,
        holobotName: rewardOptionsRef.current?.holobotName,
        holosAwarded: rewards.holosReward,
        sessionIncrement: 1,
        syncPointsAwarded: rewards.syncPointsReward,
      },
    };

    try {
      const result = await syncCurrentActivity(finalSnapshot, "complete", completionSyncArgsRef.current.extras);

      const resolvedSessionsCompleted =
        result?.workoutSessionsCompleted ??
        nextSessionsCompleted;
      const resolvedCooldownEndsAt =
        result?.cooldownEndsAt ??
        nextCooldownEndsAt;

      setSessionsCompleted(resolvedSessionsCompleted);
      setCooldownEndsAt(resolvedCooldownEndsAt);
      sessionsCompletedRef.current = resolvedSessionsCompleted;
      setCompletionResult({
        ...rewards,
        cooldownEndsAt: resolvedCooldownEndsAt,
        cumulativeDistanceKm,
        distanceKm: finalSnapshot.distanceKm,
        displayDistance: getDisplayDistance(cumulativeDistanceKm, unitPreference),
        displayUnit: unitPreference,
        id: completionId,
        rewardsPersisted: result != null,
        sessionsCompleted: resolvedSessionsCompleted,
        sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - resolvedSessionsCompleted),
        totalSyncPoints: result?.totalSyncPoints ?? null,
        workoutMinutes: Math.max(1, Math.round(finalSnapshot.elapsedSeconds / 60)),
      });
      setSyncMessage("Workout complete. Rewards ready.");
    } finally {
      completionLockRef.current = false;
    }
  };

  const toggleRunning = async () => {
    if (state.isRunning) {
      stopLiveTracking();
      startTimestampRef.current = null;
      elapsedOffsetSecondsRef.current = state.elapsedSeconds;
      const pausedSnapshot = {
        ...stateRef.current,
        elapsedSeconds: state.elapsedSeconds,
        isRunning: false,
        speedKmh: 0,
      };
      stateRef.current = pausedSnapshot;
      setState((current) => ({
        ...current,
        isRunning: false,
        speedKmh: 0,
      }));
      broadcastPhoneWorkoutPresence(false);
      void syncCurrentActivity(pausedSnapshot, "pause");
      return;
    }

    await startLiveTracking();
  };

  const resetWorkout = () => {
    stopLiveTracking();
    startTimestampRef.current = null;
    elapsedOffsetSecondsRef.current = 0;
    completionLockRef.current = false;
    broadcastPhoneWorkoutPresence(false);
    setState({
      distanceKm: 0,
      elapsedSeconds: 0,
      isRunning: false,
      speedKmh: 0,
      stepCount: 0,
      todayStepCount: 0,
    });
    setCompletionResult(null);
    setCarryoverDistanceKm(0);
    carryoverDistanceKmRef.current = 0;
    setRewardedBoostCount(0);
    rewardedBoostCountRef.current = 0;
    setSyncState("idle");
    setSyncMessage(userId ? "Workout reset." : "Workout reset. Sign in to sync rewards.");
    setLastSyncedAt(null);
    todayStepsAtStartRef.current = 0;
    lastSyncedDateRef.current = null;
    lastSyncedStepsRef.current = 0;
  };

  const continueQuickRefillChain = () => {
    const completedDistanceKm = completionResult?.distanceKm ?? stateRef.current.distanceKm;
    const nextCarryoverDistanceKm = carryoverDistanceKmRef.current + completedDistanceKm;
    const nextRewardedBoostCount = completionResult?.syncPointBoostCount ?? rewardedBoostCountRef.current;

    stopLiveTracking();
    startTimestampRef.current = null;
    elapsedOffsetSecondsRef.current = 0;
    completionLockRef.current = false;
    setState({
      distanceKm: 0,
      elapsedSeconds: 0,
      isRunning: false,
      speedKmh: 0,
      stepCount: 0,
      todayStepCount: stateRef.current.todayStepCount,
    });
    setCarryoverDistanceKm(nextCarryoverDistanceKm);
    carryoverDistanceKmRef.current = nextCarryoverDistanceKm;
    setRewardedBoostCount(nextRewardedBoostCount);
    rewardedBoostCountRef.current = nextRewardedBoostCount;
    setCompletionResult(null);
    setSyncState("idle");
    setSyncMessage("Quick Refill ready. Distance chain carried into the next workout.");
  };

  const unlockQuickRefill = async () => {
    if (sessionsCompletedRef.current >= MAX_DAILY_SESSION_CAP) {
      setSyncMessage("Daily Sync workout limit reached. Come back tomorrow.");
      return;
    }

    if (getCooldownRemainingMs(cooldownEndsAt, Date.now()) <= 0) {
      setSyncMessage("No cooldown is active right now.");
      return;
    }

    if (!userId) {
      setCooldownEndsAt(null);
      setSyncMessage("Quick Refill used. Your next workout is ready now.");
      return;
    }

    try {
      setCooldownEndsAt(null);
      cooldownEndsAtRef.current = null;
      const nextState = await clearWorkoutCooldownAuthoritative(userId, getLocalDateKey());
      setCooldownEndsAt(nextState.cooldownEndsAt);
      cooldownEndsAtRef.current = nextState.cooldownEndsAt;
      setSessionsCompleted(nextState.sessionsCompleted);
      sessionsCompletedRef.current = nextState.sessionsCompleted;
      setSyncMessage("Quick Refill used. Your next workout is ready now.");
    } catch {
      setSyncMessage("Quick Refill failed. Please try again.");
    }
  };

  const progress = clamp(state.elapsedSeconds / TOTAL_WORKOUT_SECONDS, 0, 1);
  const remainingSeconds = Math.max(TOTAL_WORKOUT_SECONDS - state.elapsedSeconds, 0);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const cooldownRemainingMs = getCooldownRemainingMs(cooldownEndsAt, now);
  const cooldownRemainingMinutes = Math.ceil(cooldownRemainingMs / 60000);
  const stackedDistanceKm = carryoverDistanceKm + state.distanceKm;
  const rewards = calculateRewards(
    state.distanceKm,
    stackedDistanceKm,
    state.elapsedSeconds,
    state.stepCount,
    unitPreference,
    rewardedBoostCount,
    rewardOptions?.expMultiplier,
  );

  return {
    ...state,
    canQuickRefill: cooldownRemainingMs > 0 && sessionsCompleted < MAX_DAILY_SESSION_CAP,
    clearCompletionResult: () => setCompletionResult(null),
    completionResult,
    retryCompletionSync,
    cooldownEndsAt,
    cooldownRemainingMinutes,
    displayDistanceKm: stackedDistanceKm,
    expReward: rewards.expReward,
    finishWorkoutNow: () => void finishWorkout("finish-now"),
    holosReward: rewards.holosReward,
    liveSpeedKmh: state.isRunning ? state.speedKmh : 0,
    isCooldownActive: cooldownRemainingMs > 0,
    lastSyncedAt,
    permissionState,
    progress,
    remainingMinutes,
    resetWorkout,
    continueQuickRefillChain,
    sessionsCompleted,
    sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - sessionsCompleted),
    syncMessage,
    syncPointBoostCount: rewards.syncPointBoostCount,
    syncPointBoostReward: rewards.syncPointBoostReward,
    syncPointsReward: rewards.syncPointsReward,
    syncState,
    toggleRunning,
    totalWorkoutMinutes: DAILY_TOTAL_MINUTES,
    totalWorkoutSeconds: TOTAL_WORKOUT_SECONDS,
    unlockQuickRefill,
  };
}

export function useWorkout(
  userId?: string | null,
  unitPreference: DistanceUnit = "km",
  rewardOptions?: WorkoutRewardOptions,
) {
  return useLiveWorkout(userId, unitPreference, rewardOptions);
}
