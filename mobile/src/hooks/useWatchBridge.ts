import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, NativeEventEmitter, NativeModules, Platform } from "react-native";

import { db, functions, httpsCallable } from "@/config/firebase";
import { getLocalDateKey, watchDailyWorkoutState } from "@/lib/fitnessSync";

const { WatchBridgeModule } = NativeModules;
const syncWatchWorkoutRewards = httpsCallable<
  { workouts: WatchWorkoutEvent[] },
  {
    processedCount: number;
    // Optional for compatibility with a not-yet-redeployed function.
    results?: Array<{
      workoutId: string;
      alreadyProcessed: boolean;
      capped: boolean;
      syncPoints: number;
      holos: number;
      exp: number;
    }>;
    sessionsCompleted: number;
    sessionsRemaining: number;
    totalSyncPoints: number;
  }
>(functions, "syncWatchWorkoutRewards");

type WatchWorkoutEvent = {
  workoutId: string;
  date: string;
  distanceMeters: number;
  elapsedSeconds: number;
  expEarned: number;
  hasReplyHandler: boolean;
  holobotName: string;
  holosEarned: number;
  stepCount: number;
  syncPointsEarned: number;
  type: "watchWorkoutComplete";
};

type WatchRewardsSyncState = {
  canSync: boolean;
  dismissPendingRewardsPrompt: () => void;
  error: string | null;
  pendingCount: number;
  pendingTotals: {
    exp: number;
    holos: number;
    syncPoints: number;
  };
  processPendingWatchWorkouts: () => Promise<void>;
  processing: boolean;
  visible: boolean;
};

type WatchWorkoutPresence = {
  device?: string;
  expiresAtMs?: number;
  startedAtMs?: number;
  workoutActive?: boolean;
};

/**
 * True while the watch reports a live Sync workout (soft cross-device
 * lock). Presence is self-expiring — sessions are a fixed 5 minutes —
 * so a dead watch can never leave the phone blocked.
 */
export function useWatchWorkoutPresence(): boolean {
  const [presence, setPresence] = useState<WatchWorkoutPresence | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const canUseBridge = Platform.OS === "ios" && !!WatchBridgeModule;

  useEffect(() => {
    if (!canUseBridge) return;

    if (typeof WatchBridgeModule.getWatchWorkoutPresence === "function") {
      void WatchBridgeModule.getWatchWorkoutPresence()
        .then((initial: WatchWorkoutPresence | null) => {
          if (initial) setPresence(initial);
        })
        .catch(() => {});
    }

    const emitter = new NativeEventEmitter(WatchBridgeModule);
    const sub = emitter.addListener("watchWorkoutPresence", (event: WatchWorkoutPresence) => {
      setPresence(event ?? null);
    });
    return () => sub.remove();
  }, [canUseBridge]);

  const active = !!presence?.workoutActive && Number(presence?.expiresAtMs || 0) > now;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, [active]);

  return active;
}

export function useWatchBridge(
  userId: string | null | undefined,
  ownedHolobotNames: string[],
) : WatchRewardsSyncState {
  const [pendingWatchWorkouts, setPendingWatchWorkouts] = useState<WatchWorkoutEvent[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedWhilePending, setDismissedWhilePending] = useState(false);

  const canUseBridge = Platform.OS === "ios" && !!WatchBridgeModule && !!userId;
  const processedWorkoutIds = useMemo(() => new Set<string>(), []);
  // Lets the live-event handler (declared first) call the claim flow
  // (declared later) without a circular useCallback dependency.
  const processPendingWatchWorkoutsRef = useRef<(() => Promise<void>) | null>(null);

  const refreshPendingWatchWorkouts = useCallback(async () => {
    if (!canUseBridge) {
      setPendingWatchWorkouts([]);
      return [];
    }
    if (typeof WatchBridgeModule.getPendingWatchWorkouts !== "function") {
      setPendingWatchWorkouts([]);
      return [];
    }

    const events = (await WatchBridgeModule.getPendingWatchWorkouts()) as
      | WatchWorkoutEvent[]
      | null
      | undefined;
    const normalizedEvents = Array.isArray(events)
      ? events.filter((event): event is WatchWorkoutEvent => !!event?.workoutId)
      : [];
    setPendingWatchWorkouts(normalizedEvents);
    return normalizedEvents;
  }, [canUseBridge]);

  const processWorkoutEvent = useCallback(async (event: WatchWorkoutEvent) => {
    const workoutId = event.workoutId?.trim();
    if (!workoutId) return;
    if (processedWorkoutIds.has(workoutId)) return;
    setDismissedWhilePending(false);
    await refreshPendingWatchWorkouts();
    // The watch is literally waiting on a reply handler for this workout —
    // sync NOW so its rewards screen and session counter update in seconds,
    // instead of parking the payout behind a manual claim tap in the app.
    // (On failure the event stays queued and the claim prompt remains the
    // fallback.)
    await processPendingWatchWorkoutsRef.current?.();
  }, [processedWorkoutIds, refreshPendingWatchWorkouts, userId]);

  const processPendingWatchWorkouts = useCallback(async () => {
    if (!canUseBridge) return;

    setProcessing(true);
    setError(null);

    try {
      const events = await refreshPendingWatchWorkouts();
      if (!events.length) {
        setDismissedWhilePending(false);
        return;
      }

      const unsyncedEvents = events.filter((event) => {
        const workoutId = event.workoutId?.trim();
        return !!workoutId && !processedWorkoutIds.has(workoutId);
      });

      if (!unsyncedEvents.length) {
        setDismissedWhilePending(false);
        return;
      }

      unsyncedEvents.forEach((event) => {
        const workoutId = event.workoutId?.trim();
        if (workoutId) {
          processedWorkoutIds.add(workoutId);
        }
      });

      const result = await syncWatchWorkoutRewards({ workouts: unsyncedEvents });

      for (const event of unsyncedEvents) {
        const workoutId = event.workoutId?.trim();
        if (!workoutId) continue;

        // Relay what the server ACTUALLY paid (clamped, capped, or zero on a
        // replay) — not the watch's own claimed numbers. Older deployed
        // functions without per-workout results fall back to the claim.
        const awarded = result.data.results?.find((entry) => entry.workoutId === workoutId);

        if (typeof WatchBridgeModule.sendRewardsToWatch === "function") {
          WatchBridgeModule.sendRewardsToWatch(workoutId, {
            exp: awarded ? awarded.exp : event.expEarned,
            holos: awarded ? awarded.holos : event.holosEarned,
            sessionsCompleted: result.data.sessionsCompleted,
            sessionsRemaining: result.data.sessionsRemaining,
            syncPoints: awarded ? awarded.syncPoints : event.syncPointsEarned,
            totalSyncPoints: result.data.totalSyncPoints,
          });
        }

        if (typeof WatchBridgeModule.ackWatchWorkout === "function") {
          WatchBridgeModule.ackWatchWorkout(workoutId);
        }
      }

      await refreshPendingWatchWorkouts();
      setDismissedWhilePending(false);
    } catch (syncError) {
      const events = await refreshPendingWatchWorkouts().catch(() => []);
      if (Array.isArray(events)) {
        events.forEach((event) => {
          const workoutId = event.workoutId?.trim();
          if (workoutId) {
            processedWorkoutIds.delete(workoutId);
          }
        });
      }
      const message =
        syncError instanceof Error ? syncError.message : "We couldn't sync watch rewards yet.";
      setError(message);
      console.warn("[WatchBridge] processPendingWatchWorkouts failed:", syncError);
    } finally {
      setProcessing(false);
    }
  }, [canUseBridge, refreshPendingWatchWorkouts]);

  processPendingWatchWorkoutsRef.current = processPendingWatchWorkouts;

  useEffect(() => {
    if (!canUseBridge) {
      setPendingWatchWorkouts([]);
      setProcessing(false);
      setError(null);
      setDismissedWhilePending(false);
      return;
    }

    void refreshPendingWatchWorkouts().catch((loadError: unknown) => {
      console.warn("[WatchBridge] initial pending workout load failed:", loadError);
    });
  }, [canUseBridge, refreshPendingWatchWorkouts]);

  useEffect(() => {
    if (!canUseBridge) return;
    const emitter = new NativeEventEmitter(WatchBridgeModule);
    const sub = emitter.addListener("watchWorkoutComplete", (event: WatchWorkoutEvent) => {
      setDismissedWhilePending(false);
      void processWorkoutEvent(event).catch((liveError: unknown) => {
        console.warn("[WatchBridge] live watch workout sync failed:", liveError);
      });
    });

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setDismissedWhilePending(false);
        void refreshPendingWatchWorkouts().catch((loadError: unknown) => {
          console.warn("[WatchBridge] foreground pending workout load failed:", loadError);
        });
      }
    });

    const pollId = setInterval(() => {
      if (AppState.currentState === "active") {
        void refreshPendingWatchWorkouts().catch((loadError: unknown) => {
          console.warn("[WatchBridge] polling pending workout load failed:", loadError);
        });
      }
    }, 3000);

    return () => {
      sub.remove();
      appStateSub.remove();
      clearInterval(pollId);
    };
  }, [canUseBridge, processWorkoutEvent, refreshPendingWatchWorkouts]);

  // Push the authoritative daily workout counts to the watch whenever the
  // server's fitness_daily doc changes (phone workouts, watch claims, quick
  // refills all land there) — otherwise the watch's X/4 drifts from reality.
  useEffect(() => {
    if (!canUseBridge) return;
    if (typeof WatchBridgeModule.syncDailySessionState !== "function") return;

    const dateKey = getLocalDateKey();
    return watchDailyWorkoutState(db, userId as string, dateKey, (state) => {
      WatchBridgeModule.syncDailySessionState({
        dailyDate: dateKey,
        sessionsCompleted: state.sessionsCompleted,
        sessionsRemaining: Math.max(0, 4 - state.sessionsCompleted),
      });
    });
  }, [canUseBridge, userId]);

  useEffect(() => {
    if (Platform.OS !== "ios" || !WatchBridgeModule) return;
    if (!userId) return;
    if (typeof WatchBridgeModule.syncOwnedHolobots !== "function") return;

    const normalizedNames = Array.from(
      new Set(
        ownedHolobotNames
          .map((name) => name.trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    WatchBridgeModule.syncOwnedHolobots(normalizedNames);
  }, [ownedHolobotNames, userId]);

  const pendingTotals = useMemo(
    () =>
      pendingWatchWorkouts.reduce(
        (totals, workout) => ({
          exp: totals.exp + Math.max(0, workout.expEarned || 0),
          holos: totals.holos + Math.max(0, workout.holosEarned || 0),
          syncPoints: totals.syncPoints + Math.max(0, workout.syncPointsEarned || 0),
        }),
        { exp: 0, holos: 0, syncPoints: 0 },
      ),
    [pendingWatchWorkouts],
  );

  return {
    canSync: canUseBridge,
    dismissPendingRewardsPrompt: () => setDismissedWhilePending(true),
    error,
    pendingCount: pendingWatchWorkouts.length,
    pendingTotals,
    processPendingWatchWorkouts,
    processing,
    visible: canUseBridge && pendingWatchWorkouts.length > 0 && !dismissedWhilePending,
  };
}
