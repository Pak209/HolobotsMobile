import { useEffect, useRef } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { computeEnergyRegen } from "@/lib/energy";

// Shared across every mounted screen that calls the hook, so two screens
// observing the same stale profile snapshot don't race duplicate writes.
let inFlightSignature: string | null = null;

const REGEN_CHECK_INTERVAL_MS = 60 * 1000;

export function useEnergyRegen() {
  const { user, profile, updateProfile } = useAuth();
  const profileRef = useRef(profile);
  const updateProfileRef = useRef(updateProfile);

  profileRef.current = profile;
  updateProfileRef.current = updateProfile;

  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      return;
    }

    const applyRegen = () => {
      const currentProfile = profileRef.current;
      if (!currentProfile) {
        return;
      }

      const result = computeEnergyRegen({
        dailyEnergy: currentProfile.dailyEnergy,
        lastEnergyRefresh: currentProfile.lastEnergyRefresh,
        maxDailyEnergy: currentProfile.maxDailyEnergy,
        stepEnergyDate: currentProfile.stepEnergyDate,
        stepEnergyGrantedToday: currentProfile.stepEnergyGrantedToday,
        todaySteps: currentProfile.todaySteps,
      });

      if (!result.changed) {
        return;
      }

      const signature = `${uid}:${result.dailyEnergy}:${result.lastEnergyRefresh}:${result.stepEnergyDate}:${result.stepEnergyGrantedToday}`;
      if (inFlightSignature === signature) {
        return;
      }

      inFlightSignature = signature;
      void updateProfileRef
        .current({
          dailyEnergy: result.dailyEnergy,
          lastEnergyRefresh: result.lastEnergyRefresh,
          stepEnergyDate: result.stepEnergyDate,
          stepEnergyGrantedToday: result.stepEnergyGrantedToday,
        })
        .catch((error) => {
          console.error("[Energy] Failed to persist energy regeneration", error);
        })
        .finally(() => {
          if (inFlightSignature === signature) {
            inFlightSignature = null;
          }
        });
    };

    applyRegen();
    const intervalId = setInterval(applyRegen, REGEN_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [
    uid,
    profile?.dailyEnergy,
    profile?.lastEnergyRefresh,
    profile?.maxDailyEnergy,
    profile?.stepEnergyDate,
    profile?.stepEnergyGrantedToday,
    profile?.todaySteps,
  ]);
}
