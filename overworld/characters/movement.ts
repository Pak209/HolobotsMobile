import type { Direction } from "../TileTypes";

export type MoveIntentState = { facing: Direction; turnStartedAt: number | null };
export type MoveIntent = { kind: "turn" } | { kind: "wait" } | { kind: "step" };

export const resolveMoveIntent = (
  state: MoveIntentState,
  pressed: Direction,
  nowMs: number,
  turnWindowMs = 120,
): MoveIntent => {
  if (pressed !== state.facing) return { kind: "turn" };
  if (state.turnStartedAt !== null && nowMs - state.turnStartedAt < turnWindowMs) return { kind: "wait" };
  return { kind: "step" };
};
