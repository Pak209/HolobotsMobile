import { afterEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ cleanups: [] as (() => void)[], calls: vi.fn(), stateWrites: vi.fn() }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, harness.stateWrites],
  useEffect: (effect: () => (() => void) | undefined) => { const cleanup = effect(); if (cleanup) harness.cleanups.push(cleanup); },
  useRef: (value: unknown) => ({ current: value }), useCallback: (value: unknown) => value,
}));
vi.mock("react-native", () => ({ AppState: {} }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("@/config/firebase", () => ({ functions: {}, httpsCallable: () => harness.calls }));
import { publishRivalCooldown, useCityRivalCooldowns } from "../useRivalStatus";
import { cityRivalCooldownEnd } from "@/lib/cityHub";
afterEach(() => { harness.cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); });
it("reads only this pilot's refusal clocks, expires them, and keeps fixtures isolated", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const end = cityRivalCooldownEnd({ details: { rejectionCode: "rival_cooldown", retryAfterMs: 2500 } }, Date.now())!;
  publishRivalCooldown("pilot-one", "CV1_RivalA", end);
  publishRivalCooldown("pilot-two", "CV1_RivalB", 90000);
  expect(useCityRivalCooldowns("pilot-one")).toEqual({ CV1_RivalA: "00:03" });
  harness.stateWrites.mockClear();
  publishRivalCooldown("pilot-one", "CV1_RivalA", end);
  expect(harness.stateWrites.mock.calls.some(([value]) => typeof value === "function" && value(1) === 2)).toBe(true);
  expect(useCityRivalCooldowns("pilot-two")).toEqual({ CV1_RivalB: "01:29" });
  expect(useCityRivalCooldowns("pilot-one", true)).toEqual({});
  expect(useCityRivalCooldowns()).toEqual({});
  vi.setSystemTime(3500);
  expect(useCityRivalCooldowns("pilot-one")).toEqual({});
  expect(harness.calls).not.toHaveBeenCalled();
});
it("cleans up the countdown timer when the hub leaves", () => {
  vi.useFakeTimers(); useCityRivalCooldowns("pilot-three");
  expect(vi.getTimerCount()).toBe(1);
  harness.cleanups.splice(0).forEach(cleanup => cleanup());
  expect(vi.getTimerCount()).toBe(0);
});
