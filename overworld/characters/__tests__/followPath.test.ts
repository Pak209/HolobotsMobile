import { describe, expect, it } from "vitest";

import { sampleDelayed } from "../followPath";

describe("sampleDelayed", () => {
  it("interpolates the recorded position at the delayed timestamp", () => {
    const history = [{ x: 0, y: 0, time: 0 }, { x: 32, y: 0, time: 400 }, { x: 32, y: 32, time: 800 }];
    expect(sampleDelayed(history, 1000, 400)).toEqual({ x: 32, y: 16, time: 600 });
  });

  it("clamps to the oldest and newest samples", () => {
    const history = [{ x: 2, y: 3, time: 100 }, { x: 8, y: 9, time: 200 }];
    expect(sampleDelayed(history, 100, 400)).toBe(history[0]);
    expect(sampleDelayed(history, 1000, 400)).toBe(history[1]);
  });
});
