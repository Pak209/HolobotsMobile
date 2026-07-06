import { describe, expect, it } from "vitest";

import {
  computeEnergyRegen,
  ENERGY_TRICKLE_INTERVAL_MINUTES,
  MAX_DAILY_STEP_ENERGY,
  STEPS_PER_BONUS_ENERGY,
} from "@/lib/energy";
import { getLocalDateKey } from "@/lib/dates";

const NOON = new Date(2026, 6, 6, 12, 0, 0);
const TODAY_KEY = getLocalDateKey(NOON);

function minutesBefore(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function baseInput(overrides: Partial<Parameters<typeof computeEnergyRegen>[0]> = {}) {
  return {
    dailyEnergy: 40,
    lastEnergyRefresh: minutesBefore(NOON, 5).toISOString(),
    maxDailyEnergy: 100,
    stepEnergyDate: TODAY_KEY,
    stepEnergyGrantedToday: 0,
    todaySteps: 0,
    ...overrides,
  };
}

describe("computeEnergyRegen", () => {
  it("fully restores energy on the first check of a new local day", () => {
    const yesterdayEvening = new Date(2026, 6, 5, 22, 30, 0);
    const result = computeEnergyRegen(
      baseInput({ dailyEnergy: 3, lastEnergyRefresh: yesterdayEvening.toISOString() }),
      NOON,
    );

    expect(result.changed).toBe(true);
    expect(result.dailyEnergy).toBe(100);
    expect(result.lastEnergyRefresh).toBe(NOON.toISOString());
  });

  it("resets when the last refresh timestamp is missing or invalid", () => {
    for (const lastEnergyRefresh of [undefined, null, "not-a-date"]) {
      const result = computeEnergyRegen(baseInput({ dailyEnergy: 10, lastEnergyRefresh }), NOON);
      expect(result.dailyEnergy).toBe(100);
      expect(result.changed).toBe(true);
    }
  });

  it("trickles one energy per full interval and keeps the remainder", () => {
    const twoIntervalsPlus = minutesBefore(NOON, ENERGY_TRICKLE_INTERVAL_MINUTES * 2 + 7);
    const result = computeEnergyRegen(
      baseInput({ dailyEnergy: 40, lastEnergyRefresh: twoIntervalsPlus.toISOString() }),
      NOON,
    );

    expect(result.dailyEnergy).toBe(42);
    // Timestamp advanced by exactly the two consumed intervals; the 7-minute
    // remainder still counts toward the next tick.
    expect(result.lastEnergyRefresh).toBe(
      new Date(twoIntervalsPlus.getTime() + 2 * ENERGY_TRICKLE_INTERVAL_MINUTES * 60 * 1000).toISOString(),
    );
  });

  it("does not trickle before a full interval has elapsed", () => {
    const result = computeEnergyRegen(
      baseInput({ dailyEnergy: 40, lastEnergyRefresh: minutesBefore(NOON, 14).toISOString() }),
      NOON,
    );

    expect(result.dailyEnergy).toBe(40);
    expect(result.changed).toBe(false);
  });

  it("caps trickle at max energy", () => {
    const result = computeEnergyRegen(
      baseInput({ dailyEnergy: 99, lastEnergyRefresh: minutesBefore(NOON, 600).toISOString() }),
      NOON,
    );

    expect(result.dailyEnergy).toBe(100);
  });

  it("grants step bonus energy at the configured rate", () => {
    const result = computeEnergyRegen(
      baseInput({ todaySteps: STEPS_PER_BONUS_ENERGY * 4 + 100 }),
      NOON,
    );

    expect(result.dailyEnergy).toBe(44);
    expect(result.stepEnergyGrantedToday).toBe(4);
  });

  it("never grants more than the daily step-energy cap", () => {
    const result = computeEnergyRegen(baseInput({ todaySteps: 1_000_000 }), NOON);

    expect(result.stepEnergyGrantedToday).toBe(MAX_DAILY_STEP_ENERGY);
    expect(result.dailyEnergy).toBe(40 + MAX_DAILY_STEP_ENERGY);
  });

  it("only grants the step delta that was not already granted today", () => {
    const result = computeEnergyRegen(
      baseInput({ stepEnergyGrantedToday: 10, todaySteps: STEPS_PER_BONUS_ENERGY * 12 }),
      NOON,
    );

    expect(result.dailyEnergy).toBe(42);
    expect(result.stepEnergyGrantedToday).toBe(12);
  });

  it("banks ungranted step eligibility while energy is full", () => {
    const atMax = computeEnergyRegen(
      baseInput({ dailyEnergy: 100, todaySteps: STEPS_PER_BONUS_ENERGY * 10 }),
      NOON,
    );

    // Nothing granted at full energy, and the grant counter did not burn.
    expect(atMax.dailyEnergy).toBe(100);
    expect(atMax.stepEnergyGrantedToday).toBe(0);

    // After spending down to 95, the banked eligibility applies.
    const afterSpend = computeEnergyRegen(
      baseInput({ dailyEnergy: 95, todaySteps: STEPS_PER_BONUS_ENERGY * 10 }),
      NOON,
    );
    expect(afterSpend.dailyEnergy).toBe(100);
    expect(afterSpend.stepEnergyGrantedToday).toBe(5);
  });

  it("resets the step counter when the day rolls over", () => {
    const result = computeEnergyRegen(
      baseInput({
        stepEnergyDate: "2026-07-05",
        stepEnergyGrantedToday: 40,
        todaySteps: STEPS_PER_BONUS_ENERGY * 2,
      }),
      NOON,
    );

    expect(result.stepEnergyDate).toBe(TODAY_KEY);
    expect(result.stepEnergyGrantedToday).toBe(2);
  });

  it("reports no change when energy is full and counters are current", () => {
    const result = computeEnergyRegen(
      baseInput({ dailyEnergy: 100, stepEnergyGrantedToday: 0, todaySteps: 100 }),
      NOON,
    );

    expect(result.changed).toBe(false);
  });
});
