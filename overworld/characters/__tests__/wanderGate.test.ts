import { describe, expect, it } from "vitest";

import { isWithinRadius, shouldWander } from "../interaction";

describe("Guide wander rules", () => {
  it("uses a Chebyshev radius", () => {
    const guide = { gridX: 10, gridY: 10 };
    expect(isWithinRadius(guide, { gridX: 12, gridY: 12 }, 2)).toBe(true);
    expect(isWithinRadius(guide, { gridX: 13, gridY: 10 }, 2)).toBe(false);
  });

  it("pauses nearby and waits for the resume delay after the player leaves", () => {
    const base = { dialogueOpen: false, isMoving: false, nextWanderAt: 4, resumeAt: 12 };
    expect(shouldWander({ ...base, playerNear: true, elapsed: 20 })).toBe(false);
    expect(shouldWander({ ...base, playerNear: false, elapsed: 11.99 })).toBe(false);
    expect(shouldWander({ ...base, playerNear: false, elapsed: 12 })).toBe(true);
  });

  it("never begins a step during dialogue or another step", () => {
    const base = { playerNear: false, elapsed: 20, nextWanderAt: 1, resumeAt: 0 };
    expect(shouldWander({ ...base, dialogueOpen: true, isMoving: false })).toBe(false);
    expect(shouldWander({ ...base, dialogueOpen: false, isMoving: true })).toBe(false);
  });
});
