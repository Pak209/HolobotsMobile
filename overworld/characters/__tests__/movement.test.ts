import { describe, expect, it } from "vitest";

import { resolveMoveIntent, type MoveIntentState } from "../movement";

describe("resolveMoveIntent", () => {
  it("turns first, waits through the window, then steps", () => {
    const state = { facing: "down" as const, turnStartedAt: null as number | null };
    expect(resolveMoveIntent(state, "right", 1_000)).toEqual({ kind: "turn" });
    const turned = { facing: "right" as const, turnStartedAt: 1_000 };
    expect(resolveMoveIntent(turned, "right", 1_119)).toEqual({ kind: "wait" });
    expect(resolveMoveIntent(turned, "right", 1_120)).toEqual({ kind: "step" });
  });

  it("steps immediately when already facing with no active window", () => {
    expect(resolveMoveIntent({ facing: "up", turnStartedAt: null }, "up", 500)).toEqual({ kind: "step" });
  });

  it("allows callers to clear the window after a step", () => {
    const state: MoveIntentState = { facing: "left", turnStartedAt: 10 };
    expect(resolveMoveIntent(state, "left", 130)).toEqual({ kind: "step" });
    state.turnStartedAt = null;
    expect(resolveMoveIntent(state, "left", 131)).toEqual({ kind: "step" });
  });
});
