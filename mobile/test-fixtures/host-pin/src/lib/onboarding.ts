/**
 * DECISIONS #72.3–#72.5 (Pak 2026-10-18) + HolobotsUnity Documentation/HANDOFFS/2026-10-18-onboarding-design-brief.md
 * Part C: the HoloCity onboarding spine. The host owns the step (hard rule 1); Unity reads it from the
 * desktopAccountSnapshot reply and presents. The step is a progress pointer: it grants nothing, so a client ack
 * of a presentation beat cannot cheat anything. The one rule it gates is the D1 mentor duel (rivalBattleStore),
 * which only ever makes a fight SOFTER, and only until the first rival settle.
 *
 * Stored at users/{uid}.onboarding = {step, skipped, stepAt} (server-only: firestore.rules). Top-level, NOT inside
 * storyFlags: the snapshot rewrites storyFlags to its four known keys, and Unity's TournamentBracketReplies rejects
 * unknown storyFlags keys.
 *
 *   step  id           completes on
 *   0     arrive       client ack (moved 3 m)
 *   1     companion    client ack (first deploy)
 *   2     first_walk   client ack (within 6 m of Kaz)
 *   3     mentor_duel  HOST: the first rival settle (any outcome); never a client ack
 *   4     market       HOST: the first vendor purchase; or ack skip-forward, host-checked: Holos < the cheapest kit
 *   5     repair       HOST: first workshop heal or healing-item use; or ack skip-forward, host-checked: no squad bot hurt
 *   6     goal         client ack (HOLOZONES tab opened / gathering seen)
 *   7     done         the spine is retired
 *
 * A profile with no `onboarding` field (every account created before this lane) reads as returning: step 7,
 * skipped, stepAt null, and nothing is written for it. createGenesisProfile starts new accounts at step 0.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { readTravelSquad } from "../acquisition/captureOwnership";
import { HEALING_ITEMS } from "./repairItems";

export const ONBOARDING_FIELD = "onboarding";
export const ONBOARDING_SCHEMA = "onboarding-1";
/** Stable lowercase ids, index = step. Display copy lives in Unity's dialogue library (ob_* rows). */
export const ONBOARDING_STEP_IDS = ["arrive", "companion", "first_walk", "mentor_duel", "market", "repair", "goal", "done"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];
export const ONBOARDING_DONE_STEP = 7;
/** D1: the mentor rule holds while step <= this and the account has not skipped. */
export const ONBOARDING_MENTOR_LAST_STEP = 3;
/** Beats a client ack may complete outright (presentation beats: they grant nothing). */
export const ONBOARDING_ACK_STEPS: readonly number[] = [0, 1, 2, 6];
/** Beats a client ack may skip forward only when the host sees the trigger cannot happen (brief C2 "Retry"). */
export const ONBOARDING_SKIP_FORWARD_STEPS: readonly number[] = [4, 5];
/** Step 4 skip-forward: nothing at the kit stall is affordable. */
export const ONBOARDING_MARKET_MIN_PRICE = Math.min(...HEALING_ITEMS.map((item) => item.price));

export type OnboardingState = { step: number; skipped: boolean; stepAt: number | null };
export type OnboardingView = OnboardingState & { schemaVersion: typeof ONBOARDING_SCHEMA; stepId: OnboardingStepId };
export type OnboardingIntent = { advance: number } | { skip: true };
export type OnboardingEvent = "rival_settle" | "vendor_purchase" | "repair";

export class OnboardingError extends Error {
  constructor(public code: "invalid_request" | "not_eligible" | "unavailable") {
    super(code);
  }
}

/** Accounts with no stored field: veterans never see the spine. */
export function returningOnboarding(): OnboardingState {
  return { step: ONBOARDING_DONE_STEP, skipped: true, stepAt: null };
}

/** createGenesisProfile: a brand-new account starts at the arrival beat. */
export function genesisOnboarding(nowMs: number): OnboardingState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new OnboardingError("unavailable");
  return { step: 0, skipped: false, stepAt: nowMs };
}

/** Missing = returning (skipped). Malformed = unavailable (the snapshot fails closed, as for storyFlags). */
export function readOnboarding(raw: unknown): OnboardingState {
  if (raw === undefined) return returningOnboarding();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OnboardingError("unavailable");
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 3 || !["step", "skipped", "stepAt"].every((k) => keys.includes(k))) throw new OnboardingError("unavailable");
  const { step, skipped, stepAt } = r;
  if (typeof step !== "number" || !Number.isSafeInteger(step) || step < 0 || step > ONBOARDING_DONE_STEP) throw new OnboardingError("unavailable");
  if (typeof skipped !== "boolean" || (skipped && step !== ONBOARDING_DONE_STEP)) throw new OnboardingError("unavailable");
  if (stepAt !== null && (typeof stepAt !== "number" || !Number.isSafeInteger(stepAt) || stepAt < 0)) throw new OnboardingError("unavailable");
  return { step, skipped, stepAt: stepAt as number | null };
}

/** The reply object on every desktop-account version (Schemas/onboarding-1.json). */
export function onboardingView(state: OnboardingState): OnboardingView {
  return { schemaVersion: ONBOARDING_SCHEMA, step: state.step, stepId: ONBOARDING_STEP_IDS[state.step], skipped: state.skipped, stepAt: state.stepAt };
}

/** `{advance: 1..7}` or `{skip: true}`, nothing else. */
export function validateOnboardingIntent(raw: unknown): OnboardingIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OnboardingError("invalid_request");
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 1) throw new OnboardingError("invalid_request");
  if (keys[0] === "skip" && r.skip === true) return { skip: true };
  if (keys[0] === "advance" && typeof r.advance === "number" && Number.isSafeInteger(r.advance) && r.advance >= 1 && r.advance <= ONBOARDING_DONE_STEP) return { advance: r.advance };
  throw new OnboardingError("invalid_request");
}

/** Host check for a step-4 / step-5 skip-forward ack: the beat's trigger cannot happen right now. */
function skipForwardAllowed(profile: Record<string, unknown>, step: number): boolean {
  if (step === 4) {
    const holos = profile.holosTokens ?? 0;
    if (typeof holos !== "number" || !Number.isFinite(holos) || holos < 0) throw new OnboardingError("unavailable");
    return holos < ONBOARDING_MARKET_MIN_PRICE;
  }
  if (step === 5) {
    let squad: string[];
    try { squad = readTravelSquad(profile).holobotIds; } catch { throw new OnboardingError("unavailable"); }
    const vitals = profile.holobotVitals;
    if (vitals === undefined) return true;
    if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) throw new OnboardingError("unavailable");
    return squad.every((id) => {
      const v = (vitals as Record<string, { currentHealth?: unknown; maxHealth?: unknown }>)[id];
      if (v === undefined) return true; // no ledger row = fresh (rivalHealth.issueVitals reads it the same way)
      if (!v || typeof v.currentHealth !== "number" || typeof v.maxHealth !== "number") throw new OnboardingError("unavailable");
      return v.currentHealth >= v.maxHealth;
    });
  }
  return false;
}

/**
 * The snapshot's `ackOnboarding` intent. Monotonic and idempotent: an advance to a step already reached (or a
 * skip / advance on a retired or skipped account) returns the state unchanged; only `step + 1` moves it, and only
 * from an ack beat or a host-checked skip-forward beat. Step 3 (the mentor duel) never advances on a client ack.
 */
export function acknowledgeOnboarding(profile: Record<string, unknown>, intent: OnboardingIntent, nowMs: number): OnboardingState {
  const state = readOnboarding(profile[ONBOARDING_FIELD]);
  if (state.skipped || state.step === ONBOARDING_DONE_STEP) return state;
  if ("skip" in intent) return { step: ONBOARDING_DONE_STEP, skipped: true, stepAt: nowMs };
  if (intent.advance <= state.step) return state;
  if (intent.advance !== state.step + 1) throw new OnboardingError("not_eligible");
  const allowed = ONBOARDING_ACK_STEPS.includes(state.step)
    || (ONBOARDING_SKIP_FORWARD_STEPS.includes(state.step) && skipForwardAllowed(profile, state.step));
  if (!allowed) throw new OnboardingError("not_eligible");
  return { step: intent.advance, skipped: false, stepAt: nowMs };
}

const EVENT_RULES: Record<OnboardingEvent, { from: readonly number[]; to: number }> = {
  rival_settle: { from: [0, 1, 2, 3], to: 4 },
  vendor_purchase: { from: [4], to: 5 },
  repair: { from: [5], to: 6 },
};

/**
 * Host-observed advance, spread into the same transaction's users/{uid} update: `{onboarding}` or `{}`.
 * Never blocks the host operation it rides on: a missing, skipped, retired or malformed pointer is `{}`.
 * rival_settle: any first-time rival settle at steps 0–3 (the mentor duel is the first fight; a pilot who walks
 * past the presentation beats straight to Kaz still completes it). vendor_purchase / repair: only at their own beat,
 * so a purchase before the mentor duel never skips it.
 */
export function onboardingAfterEvent(profile: Record<string, unknown>, event: OnboardingEvent, nowMs: number): Record<string, unknown> {
  let state: OnboardingState;
  try { state = readOnboarding(profile[ONBOARDING_FIELD]); } catch { return {}; }
  const rule = EVENT_RULES[event];
  if (state.skipped || !rule.from.includes(state.step)) return {};
  return { [ONBOARDING_FIELD]: { step: rule.to, skipped: false, stepAt: nowMs } };
}

/** D1: true while the account is in the onboarding spine at or before the mentor duel. Malformed = false. */
export function onboardingMentorActive(profile: Record<string, unknown>): boolean {
  try {
    const state = readOnboarding(profile[ONBOARDING_FIELD]);
    return !state.skipped && state.step <= ONBOARDING_MENTOR_LAST_STEP;
  } catch {
    return false;
  }
}
