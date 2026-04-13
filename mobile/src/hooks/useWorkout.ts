import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";

import { db } from "@/config/firebase";
import { getLocalDateKey, syncFitnessActivity } from "@/lib/fitnessSync";

const TOTAL_WORKOUT_SECONDS = 20 * 60;
const MAX_SYNC_POINTS = 225;
const BASE_HOLOS_PER_KM = 12;
const BASE_EXP_PER_KM = 280;

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

function useLiveWorkout(userId?: string | null) {
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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const syncCurrentActivity = async (reason: "pause" | "complete") => {
    if (!userId) {
      setSyncState("idle");
      setSyncMessage("Sign in to sync rewards.");
      return;
    }

    const date = getLocalDateKey();
    const currentState = stateRef.current;
    const stepsTotal = Math.max(
      currentState.todayStepCount,
      todayStepsAtStartRef.current + currentState.stepCount,
    );

    if (stepsTotal <= 0 && currentState.distanceKm <= 0 && currentState.elapsedSeconds <= 0) {
      return;
    }

    if (lastSyncedDateRef.current === date && stepsTotal <= lastSyncedStepsRef.current) {
      setSyncState("synced");
      setSyncMessage(`Workout ${reason === "pause" ? "paused" : "completed"} and already synced.`);
      return;
    }

    try {
      setSyncState("syncing");
      setSyncMessage(reason === "pause" ? "Syncing paused workout..." : "Syncing completed workout...");

      const result = await syncFitnessActivity(db, {
        date,
        distanceMeters: currentState.distanceKm * 1000,
        stepsTotal,
        uid: userId,
        workoutMinutes: Math.max(1, Math.round(currentState.elapsedSeconds / 60)),
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
    } catch (error) {
      setSyncState("idle");
      setSyncMessage("Workout saved locally. Sync will retry later.");
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
          elapsedOffsetSecondsRef.current = TOTAL_WORKOUT_SECONDS;
          void syncCurrentActivity("complete");
          return {
            ...current,
            elapsedSeconds: TOTAL_WORKOUT_SECONDS,
            isRunning: false,
            speedKmh: 0,
          };
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

  const toggleRunning = async () => {
    if (state.isRunning) {
      stopLiveTracking();
      elapsedOffsetSecondsRef.current = state.elapsedSeconds;
      setState((current) => ({
        ...current,
        isRunning: false,
        speedKmh: 0,
      }));
      void syncCurrentActivity("pause");
      return;
    }

    await startLiveTracking();
  };

  const resetWorkout = () => {
    stopLiveTracking();
    startTimestampRef.current = null;
    elapsedOffsetSecondsRef.current = 0;
    setState({
      distanceKm: 0,
      elapsedSeconds: 0,
      isRunning: false,
      speedKmh: 0,
      stepCount: 0,
      todayStepCount: 0,
    });
    setSyncState("idle");
    setSyncMessage(userId ? "Workout reset." : "Workout reset. Sign in to sync rewards.");
    setLastSyncedAt(null);
    todayStepsAtStartRef.current = 0;
    lastSyncedDateRef.current = null;
    lastSyncedStepsRef.current = 0;
  };

  const progress = clamp(state.elapsedSeconds / TOTAL_WORKOUT_SECONDS, 0, 1);
  const remainingSeconds = Math.max(TOTAL_WORKOUT_SECONDS - state.elapsedSeconds, 0);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const stepBonus = Math.floor(state.stepCount / 25);
  const syncPointsReward = Math.min(MAX_SYNC_POINTS, Math.round(progress * MAX_SYNC_POINTS) + stepBonus);

  return {
    ...state,
    expReward: Math.round(state.distanceKm * BASE_EXP_PER_KM),
    holosReward: Math.round(state.distanceKm * BASE_HOLOS_PER_KM),
    liveSpeedKmh: state.isRunning ? state.speedKmh : 0,
    lastSyncedAt,
    permissionState,
    progress,
    remainingMinutes,
    stepCount: state.stepCount,
    syncPointsReward,
    syncMessage,
    syncState,
    toggleRunning,
    resetWorkout,
  };
}

export function useWorkout(userId?: string | null) {
  return useLiveWorkout(userId);
}
