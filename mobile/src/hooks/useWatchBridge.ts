import { useEffect } from "react";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import { db } from "@/config/firebase";
import { getLocalDateKey, syncFitnessActivity } from "@/lib/fitnessSync";

const { WatchBridgeModule } = NativeModules;

type WatchWorkoutEvent = {
  date: string;
  distanceMeters: number;
  elapsedSeconds: number;
  expEarned: number;
  hasReplyHandler: boolean;
  holosEarned: number;
  stepCount: number;
  syncPointsEarned: number;
  type: "watchWorkoutComplete";
};

export function useWatchBridge(userId: string | null | undefined) {
  useEffect(() => {
    if (Platform.OS !== "ios" || !WatchBridgeModule) return;
    if (!userId) return;

    const emitter = new NativeEventEmitter(WatchBridgeModule);
    const sub = emitter.addListener(
      "watchWorkoutComplete",
      async (event: WatchWorkoutEvent) => {
        try {
          const workoutDate = event.date || getLocalDateKey();
          const result = await syncFitnessActivity(db, {
            cooldownEndsAt: undefined,
            date: workoutDate,
            distanceMeters: event.distanceMeters,
            holosAwarded: event.holosEarned,
            sessionIncrement: 1,
            stepsTotal: event.stepCount,
            syncPointsAwarded: event.syncPointsEarned,
            uid: userId,
            workoutMinutes: Math.max(1, Math.round(event.elapsedSeconds / 60)),
          });

          const rewards = {
            exp: event.expEarned,
            holos: event.holosEarned,
            sessionsCompleted: result.workoutSessionsCompleted,
            sessionsRemaining: Math.max(0, 4 - result.workoutSessionsCompleted),
            syncPoints: event.syncPointsEarned,
            totalSyncPoints: result.totalSyncPoints,
          };

          if (typeof WatchBridgeModule.sendRewardsToWatch === "function") {
            WatchBridgeModule.sendRewardsToWatch(workoutDate, rewards);
          }
        } catch (error) {
          console.warn("[WatchBridge] syncFitnessActivity failed:", error);
        }
      },
    );

    return () => sub.remove();
  }, [userId]);
}
