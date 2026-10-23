import { useEffect, useRef } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { computeEnergyRegen, shouldRefreshEnergy } from "@/lib/energy";
import { refreshEnergyOnHost } from "@/lib/energyClient";

// energy-quest-server-1: regen runs on the host (refreshEnergy); this hook only decides WHEN to ask. Shared across
// every mounted screen that calls the hook, so two screens never race duplicate requests.
let inFlight: Promise<void> | null = null;
const state = { uid: null as string | null, lastCallAtMs: null as number | null, lastReplyChanged: true, nextResetAtMs: null as number | null };

const REGEN_CHECK_INTERVAL_MS = 60 * 1000;

export function useEnergyRegen() {
  const { user, profile } = useAuth();
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      return;
    }
    if (state.uid !== uid) {
      Object.assign(state, { uid, lastCallAtMs: null, lastReplyChanged: true, nextResetAtMs: null });
    }

    const check = (force: boolean) => {
      const currentProfile = profileRef.current;
      if (!currentProfile || inFlight) {
        return;
      }
      const nowMs = Date.now();
      const locallyDue = computeEnergyRegen({
        dailyEnergy: currentProfile.dailyEnergy,
        lastEnergyRefresh: currentProfile.lastEnergyRefresh,
        maxDailyEnergy: currentProfile.maxDailyEnergy,
        stepEnergyDate: currentProfile.stepEnergyDate,
        stepEnergyGrantedToday: currentProfile.stepEnergyGrantedToday,
        todaySteps: currentProfile.todaySteps,
      }, new Date(nowMs)).changed;
      if (!shouldRefreshEnergy({ force, nowMs, locallyDue, lastCallAtMs: state.lastCallAtMs, lastReplyChanged: state.lastReplyChanged, nextResetAtMs: state.nextResetAtMs })) {
        return;
      }
      state.lastCallAtMs = nowMs;
      inFlight = refreshEnergyOnHost()
        .then((reply) => {
          if (state.uid !== uid) return;
          state.lastReplyChanged = reply.changed;
          const next = new Date(reply.nextResetAt).getTime();
          state.nextResetAtMs = Number.isFinite(next) ? next : null;
        })
        .catch((error) => {
          // Offline / old host: the shown energy is the last host value; the next tick retries.
          console.warn("[Energy] refreshEnergy failed", error);
        })
        .finally(() => {
          inFlight = null;
        });
    };

    check(state.lastCallAtMs === null);
    const intervalId = setInterval(() => check(false), REGEN_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [uid]);
}
