import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { CITY_PROGRESSION_LOADING, CITY_PROGRESSION_UNAVAILABLE, type CityProgression } from "@/lite/lib/progressionHost";
import { subscribeCityProgression } from "@/lite/lib/progressionHostClient";

/**
 * The City's quest / training records for this session's account (host #145 progressionTimers), with the rewardSystem
 * run copies from the same snapshot. Tagged with the uid it was read for, so an account switch never shows the previous
 * pilot's runs. No session = UNAVAILABLE. A failed listener ends; `retry()` and coming back to the foreground start a
 * new one. `preview` is the offline QA harness only: no listener, no network.
 */
export function useCityProgression(uid?: string | null, preview?: CityProgression): CityProgression & { retry: () => void } {
  const [snapshot, setSnapshot] = useState<{ uid?: string | null; progression: CityProgression }>({ uid, progression: CITY_PROGRESSION_LOADING });
  const [attempt, setAttempt] = useState(0);
  const failed = snapshot.uid === uid && snapshot.progression.timers.status === "unavailable";
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (preview || !uid) return;
    setSnapshot({ uid, progression: CITY_PROGRESSION_LOADING });
    return subscribeCityProgression(uid, (progression) => setSnapshot({ uid, progression }));
  }, [uid, preview, attempt]);
  useEffect(() => {
    if (preview || !uid || !failed) return;
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") retry(); });
    return () => subscription.remove();
  }, [uid, preview, failed, retry]);
  const progression = preview ?? (!uid ? CITY_PROGRESSION_UNAVAILABLE : snapshot.uid === uid ? snapshot.progression : CITY_PROGRESSION_LOADING);
  return { ...progression, retry };
}
