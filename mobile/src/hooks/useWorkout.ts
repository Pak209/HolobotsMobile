import { useEffect, useRef, useState } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";

import { db, doc, onSnapshot } from "@/config/firebase";
import {
  getDailyWorkoutState,
  getLocalDateKey,
  syncFitnessActivity,
  unlockDailyWorkoutRefill,
} from "@/lib/fitnessSync";

export type DistanceUnit = "km" | "mi";
export type WorkoutCompletionResult = {
  cooldownEndsAt: string | null;
  cumulativeDistanceKm: number;
  distanceKm: number;
  displayDistance: number;
  displayUnit: DistanceUnit;
  expReward: number;
  holosReward: number;
  id: string;
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
const { WatchBridgeModule } = NativeModules;

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
type PendingWatchWorkoutEvent = {
  date?: string;
  sessionsCompleted?: number;
  workoutId?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
) {
  const progress = clamp(elapsedSeconds / TOTAL_WORKOUT_SECONDS, 0, 1);
  const syncPointBoostCount = Math.floor(getDisplayDistance(cumulativeDistanceKm, unitPreference));
  const newBoostCount = Math.max(0, syncPointBoostCount - rewardedBoostCount);
  const distanceBonus = newBoostCount * UNIT_SYNC_POINT_BOOST;
  const stepBonus = Math.floor(stepCount / 25);

  return {
    expReward: Math.max(0, Math.round(sessionDistanceKm * BASE_EXP_PER_KM)),
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
  playerRankExpMultiplier = 1,
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
  const [pendingWatchSessionsCompleted, setPendingWatchSessionsCompleted] = useState(0);
  const [completionResult, setCompletionResult] = useState<WorkoutCompletionResult | null>(null);
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
  const pendingWatchSessionsCompletedRef = useRef(0);
  const completionLockRef = useRef(false);
  const cooldownEndsAtRef = useRef<string | null>(null);
  const carryoverDistanceKmRef = useRef(0);
  const rewardedBoostCountRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    sessionsCompletedRef.current = sessionsCompleted;
  }, [sessionsCompleted]);

  useEffect(() => {
    pendingWatchSessionsCompletedRef.current = pendingWatchSessionsCompleted;
  }, [pendingWatchSessionsCompleted]);

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

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setCooldownEndsAt(null);
      setSessionsCompleted(0);
      return () => {
        cancelled = true;
      };
    }

    void getDailyWorkoutState(db, userId, getLocalDateKey())
      .then((nextState) => {
        if (cancelled) return;
        setCooldownEndsAt(nextState.cooldownEndsAt);
        setSessionsCompleted(nextState.sessionsCompleted);
      })
      .catch(() => {
        if (cancelled) return;
        setCooldownEndsAt(null);
        setSessionsCompleted(0);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const dailyRef = doc(db, "users", userId, "fitness_daily", getLocalDateKey());
    const unsubscribe = onSnapshot(
      dailyRef,
      (snapshot) => {
        const data = snapshot.data() ?? {};
        const nextCooldownEndsAt =
          typeof data.workoutCooldownEndsAt === "string"
            ? data.workoutCooldownEndsAt
            : data.workoutCooldownEndsAt?.toDate?.()?.toISOString?.() ?? null;
        const nextSessionsCompleted = Math.min(
          MAX_DAILY_SESSION_CAP,
          Math.max(0, Number(data.workoutSessionsCompleted ?? 0)),
        );

        setCooldownEndsAt(nextCooldownEndsAt);
        setSessionsCompleted(nextSessionsCompleted);
        cooldownEndsAtRef.current = nextCooldownEndsAt;
        sessionsCompletedRef.current = nextSessionsCompleted;
        const reconciledSessionsCompleted = Math.max(
          nextSessionsCompleted,
          pendingWatchSessionsCompletedRef.current,
        );

        if (
          Platform.OS === "ios" &&
          WatchBridgeModule &&
          typeof WatchBridgeModule.syncWorkoutSessionState === "function"
        ) {
          WatchBridgeModule.syncWorkoutSessionState({
            cooldownEndsAt: nextCooldownEndsAt,
            expMultiplier: playerRankExpMultiplier,
            sessionsCompleted: reconciledSessionsCompleted,
            sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - reconciledSessionsCompleted),
          });
        }
      },
      () => undefined,
    );

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void getDailyWorkoutState(db, userId, getLocalDateKey())
        .then((nextState) => {
          setCooldownEndsAt(nextState.cooldownEndsAt);
          setSessionsCompleted(nextState.sessionsCompleted);
          cooldownEndsAtRef.current = nextState.cooldownEndsAt;
          sessionsCompletedRef.current = nextState.sessionsCompleted;
          const reconciledSessionsCompleted = Math.max(
            nextState.sessionsCompleted,
            pendingWatchSessionsCompletedRef.current,
          );
          if (
            Platform.OS === "ios" &&
            WatchBridgeModule &&
            typeof WatchBridgeModule.syncWorkoutSessionState === "function"
          ) {
            WatchBridgeModule.syncWorkoutSessionState({
              cooldownEndsAt: nextState.cooldownEndsAt,
              expMultiplier: playerRankExpMultiplier,
              sessionsCompleted: reconciledSessionsCompleted,
              sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - reconciledSessionsCompleted),
            });
          }
        })
        .catch(() => undefined);
    });

    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, [playerRankExpMultiplier, userId]);

  useEffect(() => {
    if (
      Platform.OS !== "ios" ||
      !WatchBridgeModule ||
      typeof WatchBridgeModule.getPendingWatchWorkouts !== "function"
    ) {
      setPendingWatchSessionsCompleted(0);
      pendingWatchSessionsCompletedRef.current = 0;
      return;
    }

    let cancelled = false;
    const refreshPendingWatchWorkoutState = async () => {
      try {
        const events = (await WatchBridgeModule.getPendingWatchWorkouts()) as
          | PendingWatchWorkoutEvent[]
          | null
          | undefined;
        if (cancelled) return;

        const today = getLocalDateKey();
        const todayEvents = Array.isArray(events)
          ? events.filter((event) => event?.workoutId && event.date === today)
          : [];
        const highestReportedCompletion = todayEvents.reduce(
          (highest, event) => Math.max(highest, Math.floor(Number(event.sessionsCompleted ?? 0))),
          0,
        );
        const optimisticCompletion = todayEvents.length > 0
          ? Math.min(
              MAX_DAILY_SESSION_CAP,
              Math.max(
                highestReportedCompletion,
                sessionsCompletedRef.current + todayEvents.length,
              ),
            )
          : 0;

        setPendingWatchSessionsCompleted(optimisticCompletion);
        pendingWatchSessionsCompletedRef.current = optimisticCompletion;

        if (typeof WatchBridgeModule.syncWorkoutSessionState === "function") {
          const reconciledSessionsCompleted = Math.max(
            sessionsCompletedRef.current,
            optimisticCompletion,
          );
          WatchBridgeModule.syncWorkoutSessionState({
            cooldownEndsAt: cooldownEndsAtRef.current,
            expMultiplier: playerRankExpMultiplier,
            sessionsCompleted: reconciledSessionsCompleted,
            sessionsRemaining: Math.max(0, MAX_DAILY_SESSION_CAP - reconciledSessionsCompleted),
          });
        }
      } catch {
        if (cancelled) return;
        setPendingWatchSessionsCompleted(0);
        pendingWatchSessionsCompletedRef.current = 0;
      }
    };

    void refreshPendingWatchWorkoutState();
    const intervalId = setInterval(() => {
      if (AppState.currentState === "active") {
        void refreshPendingWatchWorkoutState();
      }
    }, 3000);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshPendingWatchWorkoutState();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [playerRankExpMultiplier]);

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
      cooldownEndsAt?: string | null;
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

      const result = await syncFitnessActivity(db, {
        cooldownEndsAt: extras?.cooldownEndsAt,
        date,
        distanceMeters: snapshot.distanceKm * 1000,
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
      setSyncMessage("Workout saved locally. Sync will retry later.");
      return null;
    }
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
    const reconciledSessionsCompleted = Math.max(
      sessionsCompletedRef.current,
      pendingWatchSessionsCompletedRef.current,
    );

    if (reconciledSessionsCompleted >= MAX_DAILY_SESSION_CAP) {
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
    );
    const nextSessionsCompleted = Math.min(MAX_DAILY_SESSION_CAP, sessionsCompletedRef.current + 1);
    const nextCooldownEndsAt =
      nextSessionsCompleted >= MAX_DAILY_SESSION_CAP
        ? null
        : new Date(Date.now() + WORKOUT_COOLDOWN_MS).toISOString();

    try {
      const result = await syncCurrentActivity(finalSnapshot, "complete", {
        cooldownEndsAt: nextCooldownEndsAt,
        sessionIncrement: 1,
        syncPointsAwarded: rewards.syncPointsReward,
      });

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
        id: `${Date.now()}`,
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
    const reconciledSessionsCompleted = Math.max(
      sessionsCompletedRef.current,
      pendingWatchSessionsCompletedRef.current,
    );

    if (reconciledSessionsCompleted >= MAX_DAILY_SESSION_CAP) {
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
      const nextState = await unlockDailyWorkoutRefill(db, userId, getLocalDateKey());
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
  const reconciledSessionsCompleted = Math.max(sessionsCompleted, pendingWatchSessionsCompleted);
  const reconciledSessionsRemaining = Math.max(0, MAX_DAILY_SESSION_CAP - reconciledSessionsCompleted);
  const stackedDistanceKm = carryoverDistanceKm + state.distanceKm;
  const rewards = calculateRewards(
    state.distanceKm,
    stackedDistanceKm,
    state.elapsedSeconds,
    state.stepCount,
    unitPreference,
    rewardedBoostCount,
  );

  return {
    ...state,
    canQuickRefill: cooldownRemainingMs > 0 && reconciledSessionsCompleted < MAX_DAILY_SESSION_CAP,
    clearCompletionResult: () => setCompletionResult(null),
    completionResult,
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
    sessionsCompleted: reconciledSessionsCompleted,
    sessionsRemaining: reconciledSessionsRemaining,
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
  playerRankExpMultiplier = 1,
) {
  return useLiveWorkout(userId, unitPreference, playerRankExpMultiplier);
}
