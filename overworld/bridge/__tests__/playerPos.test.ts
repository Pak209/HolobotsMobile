import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTrailingThrottle } from "../throttle";

type Position = { x: number; y: number; facing: string };

describe("PLAYER_POS throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a leading and last trailing position for rapid changes", () => {
    const sends = vi.fn();
    const throttle = createTrailingThrottle<Position>(sends, 150, {
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id), now: () => Date.now(),
    });
    for (let index = 0; index < 10; index += 1) {
      throttle.push({ x: index, y: 1, facing: "right" });
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(60);
    expect(sends).toHaveBeenCalledTimes(2);
    expect(sends).toHaveBeenLastCalledWith({ x: 9, y: 1, facing: "right" });
  });

  it("does not send when no position change is reported", () => {
    const sends = vi.fn();
    createTrailingThrottle(sends, 150);
    vi.advanceTimersByTime(500);
    expect(sends).not.toHaveBeenCalled();
  });

  it("dispose cancels a pending trailing position", () => {
    const sends = vi.fn();
    const throttle = createTrailingThrottle(sends, 150, {
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id), now: () => Date.now(),
    });
    throttle.push({ x: 0, y: 0, facing: "down" });
    throttle.push({ x: 1, y: 0, facing: "right" });
    throttle.dispose(); vi.advanceTimersByTime(200);
    expect(sends).toHaveBeenCalledTimes(1);
  });
});
