/** Terminal presentation only. Settlement and completed battle state remain untouched. */
export const KO_RESULT_HOLD_MS = 2000;
export type TerminalPresentation = { id: string; defeated: readonly string[] };
/** Clock comes from foreground GL frames. A pause cannot consume the final-pose hold. */
export class KoPresentationGate {
  private id: string | null = null;
  private readyAt: number | null = null;
  private notified = false;
  get finalPoseSince(): number | null { return this.readyAt; }
  reset(): void { this.id = null; this.readyAt = null; this.notified = false; }
  advance(id: string | null, clockMs: number, finalPoseRendered: boolean): boolean {
    if (id !== this.id) { this.id = id; this.readyAt = null; this.notified = false; }
    if (id === null || this.notified) return false;
    if (!finalPoseRendered) { this.readyAt = null; return false; }
    this.readyAt ??= clockMs;
    if (clockMs - this.readyAt < KO_RESULT_HOLD_MS) return false;
    this.notified = true;
    return true;
  }
}

/** A downed active fighter is not a terminal team battle. Only the settled overall status arms the hold. */
export function shouldHoldResult(status: string, battleId: string, seenId: string | null, completedId: string | null): boolean {
  return status === 'completed' && seenId === battleId && completedId !== battleId;
}
