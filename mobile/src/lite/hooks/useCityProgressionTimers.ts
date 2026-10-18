import { useEffect, useState } from "react";
import { CITY_TIMERS_LOADING, CITY_TIMERS_UNAVAILABLE, type CityTimers } from "@/lite/lib/progressionHost";
import { subscribeCityTimers } from "@/lite/lib/progressionHostClient";

/**
 * The City's quest / training records for this session's account (host #145 progressionTimers). Tagged with the uid it
 * was read for, so an account switch never shows the previous pilot's runs. No session = UNAVAILABLE.
 * `preview` is the offline QA harness only: no listener, no network.
 */
export function useCityProgressionTimers(uid?: string | null, preview?: CityTimers): CityTimers {
  const [snapshot, setSnapshot] = useState<{ uid?: string | null; timers: CityTimers }>({ uid, timers: CITY_TIMERS_LOADING });
  useEffect(() => {
    if (preview || !uid) return;
    setSnapshot({ uid, timers: CITY_TIMERS_LOADING });
    return subscribeCityTimers(uid, (timers) => setSnapshot({ uid, timers }));
  }, [uid, preview]);
  if (preview) return preview;
  if (!uid) return CITY_TIMERS_UNAVAILABLE;
  return snapshot.uid === uid ? snapshot.timers : CITY_TIMERS_LOADING;
}
