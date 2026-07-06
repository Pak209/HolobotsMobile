import { getLocalDateKey } from "@/lib/dates";

export const ENERGY_TRICKLE_INTERVAL_MINUTES = 15;
export const STEPS_PER_BONUS_ENERGY = 250;
export const MAX_DAILY_STEP_ENERGY = 40;

const TRICKLE_INTERVAL_MS = ENERGY_TRICKLE_INTERVAL_MINUTES * 60 * 1000;

export type EnergyRegenInput = {
  dailyEnergy: number;
  lastEnergyRefresh?: string | null;
  maxDailyEnergy: number;
  stepEnergyDate?: string | null;
  stepEnergyGrantedToday?: number;
  todaySteps?: number;
};

export type EnergyRegenResult = {
  changed: boolean;
  dailyEnergy: number;
  lastEnergyRefresh: string;
  stepEnergyDate: string;
  stepEnergyGrantedToday: number;
};

function parseTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure energy regeneration. Three layers, applied in order:
 *
 * 1. Daily reset — energy returns to max the first time the game is opened
 *    on a new local calendar day.
 * 2. Trickle — +1 energy per full 15 minutes since the last refresh,
 *    up to max. The refresh timestamp only advances by whole consumed
 *    intervals so partial intervals are never lost.
 * 3. Step bonus — +1 energy per 250 of today's synced steps, up to 40 per
 *    day, up to max. Ungranted eligibility carries within the day, so steps
 *    walked while at full energy still count after energy is spent.
 */
export function computeEnergyRegen(input: EnergyRegenInput, now = new Date()): EnergyRegenResult {
  const nowMs = now.getTime();
  const todayKey = getLocalDateKey(now);
  const max = Math.max(1, Math.floor(input.maxDailyEnergy || 100));
  const startingEnergy = Math.max(0, Math.floor(input.dailyEnergy || 0));

  let energy = startingEnergy;
  let lastRefreshMs = parseTimestamp(input.lastEnergyRefresh);
  let didReset = false;

  if (lastRefreshMs === null || lastRefreshMs > nowMs) {
    // Missing or clock-skewed timestamp: settle on "refreshed now" without
    // granting anything beyond the daily reset below.
    lastRefreshMs = nowMs;
    didReset = true;
    energy = Math.max(energy, max);
  } else if (getLocalDateKey(new Date(lastRefreshMs)) !== todayKey) {
    didReset = true;
    energy = Math.max(energy, max);
    lastRefreshMs = nowMs;
  } else if (energy < max) {
    const elapsedIntervals = Math.floor((nowMs - lastRefreshMs) / TRICKLE_INTERVAL_MS);
    const granted = Math.min(elapsedIntervals, max - energy);

    if (granted > 0) {
      energy += granted;
      lastRefreshMs += granted * TRICKLE_INTERVAL_MS;
    }
  }

  const grantedToday =
    input.stepEnergyDate === todayKey ? Math.max(0, Math.floor(input.stepEnergyGrantedToday || 0)) : 0;
  const stepEligibility = Math.min(
    Math.floor(Math.max(0, input.todaySteps || 0) / STEPS_PER_BONUS_ENERGY),
    MAX_DAILY_STEP_ENERGY,
  );
  const stepBonus = Math.min(Math.max(0, stepEligibility - grantedToday), Math.max(0, max - energy));

  if (stepBonus > 0) {
    energy += stepBonus;
  }

  const nextGrantedToday = grantedToday + stepBonus;
  const changed =
    energy !== startingEnergy ||
    didReset ||
    input.stepEnergyDate !== todayKey ||
    nextGrantedToday !== Math.max(0, Math.floor(input.stepEnergyGrantedToday || 0));

  return {
    changed,
    dailyEnergy: energy,
    lastEnergyRefresh: new Date(lastRefreshMs).toISOString(),
    stepEnergyDate: todayKey,
    stepEnergyGrantedToday: nextGrantedToday,
  };
}
