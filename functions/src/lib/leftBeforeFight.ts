/**
 * no-loss-before-fight (Pak 2026-11-11): leaving a live (input-log) duel during its 3-2-1 countdown, before the fight clock has stepped
 * a single tick, cancels the fight with NO loss. The phone says so with one extra field on the call it already sends to leave
 * (rival / Guild Court `forfeit`, Arena `cancel`): `leftBeforeFight: true`, sent only when its runtime stepped zero ticks.
 *
 * The host cannot see the phone's clock, so the claim is bounded here: it is honoured only within LEFT_BEFORE_FIGHT_WINDOW_MS of the
 * fight's issue (the rival battle's / court run's issuedAtMs; the Arena match's startedAtMs, which is when its fight is handed to
 * the stage). Later than that the same call is the ordinary forfeit loss. A request without the field is exactly today's forfeit.
 * A timed-out fight stays a loss whatever is sent (the expiry sweeps run first and the closure helpers refuse an expired fight).
 */

/** The request field (rival / court `forfeit`, Arena `cancel`). Only the literal `true` is accepted; any other value is invalid_request. */
export const LEFT_BEFORE_FIGHT_FIELD = 'leftBeforeFight' as const;
/** How long after the fight's issue a "left before FIGHT" claim is honoured. Producer pick (60 s: the versus card, the first-duel
 * control hints and the ~3 s countdown with margin); Pak may tune. */
export const LEFT_BEFORE_FIGHT_WINDOW_MS = 60_000;
/** The closure name a cancelled fight is stored and answered with (rival settlement.closedBy, court run closedBy). The Arena stores
 * its refund receipt (outcome 'cancelled_before_start') with `leftBeforeFight: true` instead. */
export const LEFT_BEFORE_FIGHT_CLOSED_BY = 'left_before_fight' as const;

/** The field as sent: true, absent (false), or malformed (null: the caller answers invalid_request). */
export function readLeftBeforeFight(raw: unknown): boolean | null {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[LEFT_BEFORE_FIGHT_FIELD] : undefined;
  if (v === undefined) return false;
  return v === true ? true : null;
}

/** Is a claim made at `nowMs` inside the window that opened at `fightIssuedAtMs`? (A missing or future issue time never is.) */
export function leftBeforeFightInWindow(fightIssuedAtMs: unknown, nowMs: number): boolean {
  return typeof fightIssuedAtMs === 'number' && Number.isFinite(fightIssuedAtMs) && Number.isFinite(nowMs)
    && nowMs >= fightIssuedAtMs && nowMs - fightIssuedAtMs <= LEFT_BEFORE_FIGHT_WINDOW_MS;
}
