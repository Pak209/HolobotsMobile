/**
 * Pak DECISIONS #46 (2026-10-03): Intro Quests. ONE data module: the step chain,
 * the reward table (producer defaults, Pak tunes) and the pure rules that read
 * them. Unity renders `status` and reports arrivals; the server owns order,
 * verification and amounts.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { BUDDY_UNITS_FIELD, BuddyInventory, readBuddyInventory, withTierDelta } from "./buddyUnits";

export const INTRO_QUEST_SCHEMA = "intro-quest-1";

export type IntroStepKind = "visit" | "capture" | "rival" | "arena" | "bonus";
export type IntroReward = { holos: number; gachaTickets: number; buddyUnitsLight: number };
export type IntroStep = {
  stepId: string;
  kind: IntroStepKind;
  /** visit steps: the destination id the client must report on arrival. "" otherwise. */
  destinationId: string;
  /** capture steps: the Holobot whose capture completes the step. "" otherwise. */
  holobotId: string;
  reward: IntroReward;
};

const r = (holos: number, gachaTickets = 0, buddyUnitsLight = 0): IntroReward => ({ holos, gachaTickets, buddyUnitsLight });

const ARENA_STEP_ID = "win_arena_battle";

/**
 * The chain, in order. Total: 750 Holos, 3 Gacha Tickets, 1 Light Buddy Unit.
 * - capture_buddy: the harbor HARE. Verified from the server-only wild roster /
 *   capture receipts, never from the client-writable `holobots` array.
 * - win_rival_battle: verified by users/{uid}.rivalWins (server-only since #43)
 *   having increased since the step became current.
 * - win_arena_battle (Pak's build 43 ruling, 2026-11-08): verified from the server-only
 *   arenaMatches/{uid}/matches records, by a `win` closed after the step became current.
 *   150 Holos and no tickets (Pak, 2026-11-08).
 */
export const INTRO_QUEST_STEPS: readonly IntroStep[] = [
  { stepId: "visit_mission_board", kind: "visit", destinationId: "mission_board", holobotId: "", reward: r(50) },
  { stepId: "visit_marketplace", kind: "visit", destinationId: "marketplace", holobotId: "", reward: r(50, 1) },
  { stepId: "visit_workshop", kind: "visit", destinationId: "workshop", holobotId: "", reward: r(75) },
  { stepId: "capture_buddy", kind: "capture", destinationId: "", holobotId: "hare", reward: r(100, 0, 1) },
  { stepId: "win_rival_battle", kind: "rival", destinationId: "", holobotId: "", reward: r(100, 1) },
  { stepId: ARENA_STEP_ID, kind: "arena", destinationId: "", holobotId: "", reward: r(150) },
  { stepId: "visit_portal", kind: "visit", destinationId: "portal_terminal", holobotId: "", reward: r(75) },
  { stepId: "chain_complete", kind: "bonus", destinationId: "", holobotId: "", reward: r(150, 1) },
];

export function introQuestTotals(): IntroReward {
  return INTRO_QUEST_STEPS.reduce((t, s) => r(t.holos + s.reward.holos, t.gachaTickets + s.reward.gachaTickets, t.buddyUnitsLight + s.reward.buddyUnitsLight), r(0));
}

export type IntroQuestErrorCode = "invalid_request" | "out_of_order" | "already_claimed" | "not_met" | "unavailable";
export class IntroQuestError extends Error {
  constructor(public code: IntroQuestErrorCode) {
    super(code);
  }
}

// ---- Stored state: introQuests/{uid} (server-only; rules deny every client read/write) ----

export type IntroClaim = { requestId: string; claimedAtMs: number; reward: IntroReward };
export type IntroQuestState = {
  schemaVersion: typeof INTRO_QUEST_SCHEMA;
  /** Index of the current (next claimable) step; INTRO_QUEST_STEPS.length when the chain is done. */
  currentIndex: number;
  /** One entry per claimed step, keyed by stepId. Exactly the steps before currentIndex. */
  claims: Record<string, IntroClaim>;
  /** When the current step became current, and rivalWins at that moment (win_rival_battle's baseline). */
  stepStartedAtMs: number;
  rivalWinsAtStepStart: number;
};

export const REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const nonNegInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** A chain that has never been started. Only an ABSENT doc means this; see readIntroQuestState. */
export function freshIntroQuestState(nowMs: number, rivalWins: number): IntroQuestState {
  return { schemaVersion: INTRO_QUEST_SCHEMA, currentIndex: 0, claims: {}, stepStartedAtMs: nowMs, rivalWinsAtStepStart: rivalWins };
}

/** Stored on the zero-reward claim that closes win_arena_battle for a pilot who finished past it before it existed. */
export const ARENA_STEP_WAIVED_REQUEST_ID = "waived_win_arena_battle";
/** The chain as it was before win_arena_battle was inserted; stored docs from then use these positions. */
const PRE_ARENA_STEP_IDS = INTRO_QUEST_STEPS.filter((s) => s.stepId !== ARENA_STEP_ID).map((s) => s.stepId);
const ARENA_STEP_INDEX = INTRO_QUEST_STEPS.findIndex((s) => s.stepId === ARENA_STEP_ID);

/**
 * Docs written before win_arena_battle existed, whose positions the insertion shifted.
 * - currentIndex <= 5: nothing shifted (the claims are the same prefix of both chains). A pilot sitting at
 *   old index 5 (visit_portal next) now has win_arena_battle next, ahead of the Portal.
 * - currentIndex 6 or 7: the pilot claimed visit_portal, past the insertion point. Recognised by holding
 *   exactly the old prefix, which no doc of the new chain can (it would hold win_arena_battle before
 *   visit_portal). The Arena step is closed for them with a zero-reward claim and the index moves up one, so
 *   the chain stays "claims = exactly the steps before currentIndex". Nothing is paid and no step reopens.
 * Pure and repeatable: status needs no write, and the next claim persists the upgraded shape.
 */
function upgradePreArenaDoc(s: Record<string, unknown>): Record<string, unknown> {
  const index = s.currentIndex, claims = s.claims;
  if (!nonNegInt(index) || index <= ARENA_STEP_INDEX || index > PRE_ARENA_STEP_IDS.length) return s;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return s;
  const keys = Object.keys(claims).sort(), expected = PRE_ARENA_STEP_IDS.slice(0, index).sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) return s;
  return { ...s, currentIndex: index + 1, claims: { ...claims, [ARENA_STEP_ID]: { requestId: ARENA_STEP_WAIVED_REQUEST_ID, claimedAtMs: 0, reward: r(0) } } };
}

/**
 * undefined (no doc) → a fresh chain. Anything present must be a fully consistent state, or this
 * throws `unavailable`: a malformed doc is never reset to fresh, so no step can be re-claimed and
 * no reward paid twice (the "missing = fresh" trap from cloud review #1). The doc is top-level and
 * server-only, so a client can neither delete nor rewrite it.
 */
export function readIntroQuestState(raw: unknown, nowMs: number, rivalWins: number): { state: IntroQuestState; fresh: boolean } {
  if (raw === undefined) return { state: freshIntroQuestState(nowMs, rivalWins), fresh: true };
  const fail = () => { throw new IntroQuestError("unavailable"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
  const s = upgradePreArenaDoc(raw as Record<string, unknown>);
  if (s.schemaVersion !== INTRO_QUEST_SCHEMA || !nonNegInt(s.currentIndex) || s.currentIndex > INTRO_QUEST_STEPS.length) fail();
  if (!nonNegInt(s.stepStartedAtMs) || !nonNegInt(s.rivalWinsAtStepStart)) fail();
  const claims = s.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) fail();
  const keys = Object.keys(claims as object).sort();
  const expected = INTRO_QUEST_STEPS.slice(0, s.currentIndex as number).map((x) => x.stepId).sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) fail();
  const seen = new Set<string>();
  for (const c of Object.values(claims as Record<string, unknown>)) {
    const claim = c as Record<string, unknown>;
    if (!claim || typeof claim !== "object" || typeof claim.requestId !== "string" || !REQUEST_ID.test(claim.requestId) || seen.has(claim.requestId) || !nonNegInt(claim.claimedAtMs)) fail();
    const rw = claim.reward as Record<string, unknown> | undefined;
    if (!rw || !nonNegInt(rw.holos) || !nonNegInt(rw.gachaTickets) || !nonNegInt(rw.buddyUnitsLight)) fail();
    seen.add(claim.requestId as string);
  }
  return { state: structuredClone(s) as unknown as IntroQuestState, fresh: false };
}

// ---- Commands ----

export type IntroCommand = { operation: "status" } | { operation: "claim"; stepId: string; requestId: string; destinationId: string };

export function validateIntroCommand(raw: unknown): IntroCommand {
  if (!raw || typeof raw !== "object") throw new IntroQuestError("invalid_request");
  const c = raw as Record<string, unknown>;
  if (c.operation === "status") return { operation: "status" };
  if (c.operation !== "claim") throw new IntroQuestError("invalid_request");
  if (typeof c.stepId !== "string" || !INTRO_QUEST_STEPS.some((s) => s.stepId === c.stepId)) throw new IntroQuestError("invalid_request");
  if (typeof c.requestId !== "string" || !REQUEST_ID.test(c.requestId)) throw new IntroQuestError("invalid_request");
  if (c.destinationId !== undefined && (typeof c.destinationId !== "string" || c.destinationId.length > 128)) throw new IntroQuestError("invalid_request");
  return { operation: "claim", stepId: c.stepId, requestId: c.requestId, destinationId: (c.destinationId as string | undefined) ?? "" };
}

// ---- Replies ----

export type IntroStepView = { stepId: string; index: number; kind: IntroStepKind; destinationId: string; claimed: boolean; claimedAtMs: number; current: boolean; reward: IntroReward };
export type IntroStatus = { currentStepId: string; complete: boolean; steps: IntroStepView[]; totalReward: IntroReward };

export function introStatus(state: IntroQuestState): IntroStatus {
  const done = state.currentIndex >= INTRO_QUEST_STEPS.length;
  // A claimed step shows what it paid, so a waived Arena step reads 0 and the total matches this pilot's chain.
  const steps = INTRO_QUEST_STEPS.map((s, index) => ({
    stepId: s.stepId,
    index,
    kind: s.kind,
    destinationId: s.destinationId,
    claimed: !!state.claims[s.stepId],
    claimedAtMs: state.claims[s.stepId]?.claimedAtMs ?? 0,
    current: index === state.currentIndex,
    reward: { ...(state.claims[s.stepId]?.reward ?? s.reward) },
  }));
  return {
    currentStepId: done ? "" : INTRO_QUEST_STEPS[state.currentIndex].stepId,
    complete: done,
    steps,
    totalReward: steps.reduce((t, s) => r(t.holos + s.reward.holos, t.gachaTickets + s.reward.gachaTickets, t.buddyUnitsLight + s.reward.buddyUnitsLight), r(0)),
  };
}

/**
 * The Holobot whose capture cannot fail right now: capture_buddy's while that step is the pilot's current step (Pak,
 * 2026-11-08, so the tutorial can't stall on a bad roll). Absent, past, or malformed intro state guarantees nothing, and a
 * malformed doc never blocks a capture.
 */
export function guaranteedCaptureHolobot(raw: unknown): string | null {
  if (raw === undefined) return null;
  try {
    const { state } = readIntroQuestState(raw, 0, 0);
    const step = INTRO_QUEST_STEPS[state.currentIndex];
    return step?.kind === "capture" ? step.holobotId : null;
  } catch (e) {
    if (e instanceof IntroQuestError) return null;
    throw e;
  }
}

export type IntroBalances = { holosTokens: number; gachaTickets: number; buddyUnits: BuddyInventory };
export type IntroClaimReply = { schemaVersion: string; stepId: string; requestId: string; alreadyProcessed: boolean; reward: IntroReward; balances: IntroBalances; status: IntroStatus };

// ---- Profile readers (malformed → unavailable; never coerced) ----

/** Economy balances (holosTokens, gachaTickets): missing = 0; any finite number >= 0 (rules' sane() allows non-integers). */
function readBalance(profile: Record<string, unknown>, field: string): number {
  const v = profile[field];
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new IntroQuestError("unavailable");
  return v;
}

export function readRivalWinsForQuest(profile: Record<string, unknown>): number {
  const v = profile.rivalWins;
  if (v === undefined) return 0;
  if (!nonNegInt(v)) throw new IntroQuestError("unavailable");
  return v;
}

function balancesOf(profile: Record<string, unknown>): { balances: IntroBalances; inventoryUpdates: Record<string, unknown> } {
  const inv = readBuddyInventory(profile);
  if (!inv) throw new IntroQuestError("unavailable");
  return { balances: { holosTokens: readBalance(profile, "holosTokens"), gachaTickets: readBalance(profile, "gachaTickets"), buddyUnits: inv.units }, inventoryUpdates: inv.updates };
}

/** Verification facts the store gathers inside the transaction (server-only sources). */
export type IntroVerification = { captured: (holobotId: string) => boolean; arenaWonSinceStepStart: boolean };

/**
 * Rules, in order: a replayed requestId returns its original ruling (writes nothing); a requestId
 * reused for another step is invalid_request; a claimed step is already_claimed; anything but the
 * current step is out_of_order; a visit must name its destination; a verified step must be met
 * (not_met). A grant pays the step's server-owned reward and makes the next step current.
 */
export function claimIntroStep(
  state: IntroQuestState,
  profile: Record<string, unknown>,
  cmd: Extract<IntroCommand, { operation: "claim" }>,
  nowMs: number,
  verify: IntroVerification,
): { state: IntroQuestState | null; userUpdates: Record<string, unknown>; reply: IntroClaimReply } {
  const { balances, inventoryUpdates } = balancesOf(profile);
  const replayOf = Object.entries(state.claims).find(([, c]) => c.requestId === cmd.requestId);
  if (replayOf) {
    if (replayOf[0] !== cmd.stepId) throw new IntroQuestError("invalid_request");
    return {
      state: null,
      userUpdates: { ...inventoryUpdates },
      reply: { schemaVersion: INTRO_QUEST_SCHEMA, stepId: cmd.stepId, requestId: cmd.requestId, alreadyProcessed: true, reward: { ...replayOf[1].reward }, balances, status: introStatus(state) },
    };
  }
  if (state.claims[cmd.stepId]) throw new IntroQuestError("already_claimed");
  const index = INTRO_QUEST_STEPS.findIndex((s) => s.stepId === cmd.stepId);
  if (index !== state.currentIndex) throw new IntroQuestError("out_of_order");
  const step = INTRO_QUEST_STEPS[index];
  if (step.kind === "visit" && cmd.destinationId !== step.destinationId) throw new IntroQuestError("invalid_request");
  if (step.kind === "capture" && !verify.captured(step.holobotId)) throw new IntroQuestError("not_met");
  if (step.kind === "arena" && !verify.arenaWonSinceStepStart) throw new IntroQuestError("not_met");
  const rivalWins = readRivalWinsForQuest(profile);
  if (step.kind === "rival" && !(rivalWins > state.rivalWinsAtStepStart)) throw new IntroQuestError("not_met");

  const reward = { ...step.reward };
  const after: IntroBalances = {
    holosTokens: balances.holosTokens + reward.holos,
    gachaTickets: balances.gachaTickets + reward.gachaTickets,
    buddyUnits: reward.buddyUnitsLight > 0 ? withTierDelta(balances.buddyUnits, "light", reward.buddyUnitsLight) : balances.buddyUnits,
  };
  if (!Number.isFinite(after.holosTokens) || !Number.isFinite(after.gachaTickets)) throw new IntroQuestError("unavailable");
  const userUpdates: Record<string, unknown> = { ...inventoryUpdates };
  if (reward.holos) userUpdates.holosTokens = after.holosTokens;
  if (reward.gachaTickets) userUpdates.gachaTickets = after.gachaTickets;
  if (reward.buddyUnitsLight) userUpdates[BUDDY_UNITS_FIELD] = { ...after.buddyUnits };
  const next: IntroQuestState = {
    ...state,
    currentIndex: index + 1,
    claims: { ...state.claims, [step.stepId]: { requestId: cmd.requestId, claimedAtMs: nowMs, reward } },
    stepStartedAtMs: nowMs,
    rivalWinsAtStepStart: rivalWins,
  };
  return {
    state: next,
    userUpdates,
    reply: { schemaVersion: INTRO_QUEST_SCHEMA, stepId: step.stepId, requestId: cmd.requestId, alreadyProcessed: false, reward, balances: after, status: introStatus(next) },
  };
}

export function introStatusReply(state: IntroQuestState, profile: Record<string, unknown>): { schemaVersion: string; status: IntroStatus; balances: IntroBalances } {
  return { schemaVersion: INTRO_QUEST_SCHEMA, status: introStatus(state), balances: balancesOf(profile).balances };
}
