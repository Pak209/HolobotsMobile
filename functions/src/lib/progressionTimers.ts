/**
 * Server-side quest / training start records (critic review 2026-10-17 S3, host-economy-hardening-2).
 *
 * Before: the main app and lite started quests and training by writing users/{uid}.rewardSystem.activeQuests /
 * activeTraining themselves (QuestsScreen / TrainingScreen; rewardSystem is owner-writable), and claimQuestRun /
 * claimTrainingSession trusted that record's endsAt, holobotPower and the client's own dailyEnergy debit. A forged
 * endsAt in the past claimed instantly, without limit.
 *
 * Now: startQuestRun / startTrainingSession (callables) validate the start, debit dailyEnergy and write a record into
 * the SERVER-ONLY users/{uid}.progressionTimers (firestore.rules protectedFieldsUntouched + absent on create) stamped
 * with the host clock; the claim validates elapsed time against startedAtMs + the table duration and uses the
 * recorded quest / holobot / power / boosts. The rewardSystem entries the callables also write are a DISPLAY copy.
 *
 * Grace path for in-flight legacy clients: a claim with no server record falls back to the client-written rewardSystem
 * record ONLY when the function environment has HOLOCITY_LEGACY_QUEST_TIMERS=1 (exactly "1"); default off.
 *
 * Exactly once (training-reward-replay-proof-1): every paid claim, host or legacy, is recorded in the server-only claim
 * ledger progressionTimers.claimed, which is read before any payout. A restored, resurrected or second-device copy, a
 * retry or a reinstall replays the stored receipt and pays nothing; a legacy run whose start precedes a claim it could
 * not have coexisted with (one training slot; one quest per holobot; 3 quest slots) is refused not_started_on_host.
 * A forged never-started legacy run is therefore held to the legitimate rate; only turning the flag off removes it.
 *
 * dailyEnergy is server-only since energy-quest-server-1: the start callables regenerate it (lib/energyRegen.ts, the
 * account's local-midnight reset on the host clock) before the energy check, and refreshEnergy applies it on demand.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import {
  getHolobotPowerScore,
  getQuestEconomy,
  getTrainingCourseEconomy,
  MAX_CLAIMED_HOLOBOT_POWER,
  type StoredQuestRecord,
  type StoredTrainingRecord,
} from "./progressionEconomy";

export const PROGRESSION_TIMERS_FIELD = "progressionTimers";
export const PROGRESSION_TIMERS_SCHEMA = "progression-timers-1";
/** Same slot count the clients enforce (QuestsScreen "Quest Slots Full"). */
export const MAX_ACTIVE_QUESTS = 3;
export const LEGACY_QUEST_TIMERS_FLAG = "HOLOCITY_LEGACY_QUEST_TIMERS";

export type TimerErrorCode =
  | "invalid_request"
  | "request_conflict"
  | "unknown_quest"
  | "unknown_course"
  | "unknown_holobot"
  | "holobot_busy"
  | "quest_slots_full"
  | "training_active"
  | "not_enough_energy"
  | "not_started_on_host"
  | "not_complete"
  | "not_active"
  | "unavailable";

export class TimerError extends Error {
  constructor(public code: TimerErrorCode) {
    super(code);
  }
}

const fail = (code: TimerErrorCode): never => {
  throw new TimerError(code);
};

export type QuestTimer = {
  runId: string;
  questId: string;
  holobotName: string;
  holobotPower: number;
  energyCost: number;
  startedAtMs: number;
  endsAtMs: number;
};

export type TrainingTimer = {
  runId: string;
  courseId: string;
  holobotName: string;
  statBoosts: Record<string, number>;
  expReward: number;
  energyCost: number;
  startedAtMs: number;
  endsAtMs: number;
};

/**
 * training-reward-replay-proof-1: one paid run in the server-only claim ledger (progressionTimers.claimed), keyed by
 * claimKey(kind, questId | courseId, holobot, startedAtMs). Written by every paying claim (host or legacy) and read
 * BEFORE any payout, so a run pays exactly once however a stale client copy of rewardSystem comes back; a replay
 * returns this receipt instead. startedAtMs is the host clock for a host run and, for a legacy run, endsAt minus the
 * table duration (the client's own endsAt, the field the claim already trusts).
 */
export type ClaimedRun = {
  kind: "quest" | "training";
  source: "host" | "legacy";
  /** The qr_ / tr_ run id (host) or the client's quest id (legacy quest); "" for a legacy training (it has none). */
  runId: string;
  /** questId / courseId. */
  subject: string;
  /** Upper-case. */
  holobotName: string;
  startedAtMs: number;
  /** Host clock. */
  claimedAtMs: number;
  /** Quests only: the outcome rolled at the claim (the replay receipt). */
  succeeded?: boolean;
};

export type ProgressionTimers = {
  schemaVersion: typeof PROGRESSION_TIMERS_SCHEMA;
  quests: Record<string, QuestTimer>;
  training: TrainingTimer | null;
  /** Present once anything was claimed; the most recent MAX_CLAIMED_RUNS by claimedAtMs. */
  claimed?: Record<string, ClaimedRun>;
};

/** Claim-ledger size cap (most recent kept). */
export const MAX_CLAIMED_RUNS = 60;
/** Device-clock tolerance when a legacy (client-clock) start is compared with a host-clock claim time. */
export const LEGACY_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** A training claim with nothing to pay this soon after the last training claim replays that claim's receipt. */
export const TRAINING_REPLAY_WINDOW_MS = 15 * 60 * 1000;

type Data = Record<string, unknown>;
const object = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x);
const whole = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const RUN_ID = /^(qr|tr)_[A-Za-z0-9_-]{8,80}$/;

/** True only for exactly "1" (the HOLOCITY_* convention). */
export function legacyQuestTimersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LEGACY_QUEST_TIMERS_FLAG] === "1";
}

function minutes(n: number) {
  return n * 60 * 1000;
}

function questTimer(raw: unknown, id: string): QuestTimer {
  if (!object(raw) || raw.runId !== id || !RUN_ID.test(id) || !id.startsWith("qr_")
    || typeof raw.questId !== "string" || !getQuestEconomy(raw.questId)
    || typeof raw.holobotName !== "string" || !raw.holobotName
    || !whole(raw.holobotPower) || raw.holobotPower > MAX_CLAIMED_HOLOBOT_POWER
    || !whole(raw.energyCost) || !whole(raw.startedAtMs) || !whole(raw.endsAtMs)
    || raw.endsAtMs !== raw.startedAtMs + minutes(getQuestEconomy(raw.questId)!.durationMinutes)) return fail("unavailable");
  return raw as QuestTimer;
}

function trainingTimer(raw: unknown): TrainingTimer {
  const course = object(raw) && typeof raw.courseId === "string" ? getTrainingCourseEconomy(raw.courseId) : null;
  if (!object(raw) || !course || typeof raw.runId !== "string" || !RUN_ID.test(raw.runId) || !raw.runId.startsWith("tr_")
    || typeof raw.holobotName !== "string" || !raw.holobotName
    || !object(raw.statBoosts) || Object.keys(raw.statBoosts).some((k) => !course.statKeys.includes(k))
    || course.statKeys.some((k) => !whole((raw.statBoosts as Data)[k]) || ((raw.statBoosts as Data)[k] as number) > course.maxBoost)
    || raw.expReward !== course.expReward || !whole(raw.energyCost)
    || !whole(raw.startedAtMs) || !whole(raw.endsAtMs) || raw.endsAtMs !== raw.startedAtMs + minutes(course.durationMinutes)) return fail("unavailable");
  return raw as TrainingTimer;
}

/** Validates the stored server-only record; absent = empty. Malformed fails closed (unavailable). */
export function readProgressionTimers(raw: unknown): ProgressionTimers {
  if (raw === undefined) return { schemaVersion: PROGRESSION_TIMERS_SCHEMA, quests: {}, training: null };
  if (!object(raw) || raw.schemaVersion !== PROGRESSION_TIMERS_SCHEMA || !object(raw.quests) || (raw.training !== null && !object(raw.training))) return fail("unavailable");
  const quests: Record<string, QuestTimer> = {};
  for (const [id, entry] of Object.entries(raw.quests)) quests[id] = questTimer(entry, id);
  if (Object.keys(quests).length > MAX_ACTIVE_QUESTS) return fail("unavailable");
  const timers: ProgressionTimers = { schemaVersion: PROGRESSION_TIMERS_SCHEMA, quests, training: raw.training === null ? null : trainingTimer(raw.training) };
  if (raw.claimed !== undefined) {
    if (!object(raw.claimed) || Object.keys(raw.claimed).length > MAX_CLAIMED_RUNS) return fail("unavailable");
    const claimed: Record<string, ClaimedRun> = {};
    for (const [key, entry] of Object.entries(raw.claimed)) {
      const run = claimedRun(entry);
      if (key !== claimKeyOf(run)) return fail("unavailable");
      claimed[key] = run;
    }
    timers.claimed = claimed;
  }
  return timers;
}

export function claimKey(kind: ClaimedRun["kind"], subject: string, holobotName: unknown, startedAtMs: number): string {
  return `${kind === "quest" ? "q" : "t"}:${subject}:${typeof holobotName === "string" ? holobotName.trim().toUpperCase() : ""}:${startedAtMs}`;
}

const claimKeyOf = (run: ClaimedRun) => claimKey(run.kind, run.subject, run.holobotName, run.startedAtMs);

function claimedRun(raw: unknown): ClaimedRun {
  if (!object(raw) || (raw.kind !== "quest" && raw.kind !== "training") || (raw.source !== "host" && raw.source !== "legacy")
    || typeof raw.runId !== "string" || raw.runId.length > 120 || typeof raw.subject !== "string"
    || !(raw.kind === "quest" ? getQuestEconomy(raw.subject) : getTrainingCourseEconomy(raw.subject))
    || typeof raw.holobotName !== "string" || raw.holobotName !== raw.holobotName.trim().toUpperCase()
    || !whole(raw.startedAtMs) || !whole(raw.claimedAtMs)
    || (raw.kind === "quest" ? typeof raw.succeeded !== "boolean" : raw.succeeded !== undefined)) return fail("unavailable");
  return raw as ClaimedRun;
}

/** The ledger with `run` added, capped to the most recent MAX_CLAIMED_RUNS by claim time. */
export function withClaimedRun(timers: ProgressionTimers, run: ClaimedRun): ProgressionTimers {
  const entries = Object.entries({ ...(timers.claimed ?? {}), [claimKeyOf(run)]: run })
    .sort(([ka, a], [kb, b]) => b.claimedAtMs - a.claimedAtMs || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .slice(0, MAX_CLAIMED_RUNS);
  return { ...timers, claimed: Object.fromEntries(entries) };
}

const claimedRuns = (timers: ProgressionTimers, kind: ClaimedRun["kind"]) => Object.values(timers.claimed ?? {}).filter((r) => r.kind === kind);

function rewardSystemOf(profile: Data): Data {
  return object(profile.rewardSystem) ? profile.rewardSystem : {};
}

/** The one stored holobot with this name (case-insensitive). */
function ownedHolobot(profile: Data, holobotName: string): Data & { name: string } {
  const key = holobotName.trim().toUpperCase();
  const found = (Array.isArray(profile.holobots) ? profile.holobots : []).filter(
    (h: unknown) => object(h) && typeof h.name === "string" && h.name.trim().toUpperCase() === key,
  ) as Array<Data & { name: string }>;
  if (!key || found.length !== 1) return fail("unknown_holobot");
  return found[0];
}

function energy(profile: Data, cost: number): number {
  const stored = profile.dailyEnergy ?? 0;
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) return fail("unavailable");
  if (stored < cost) return fail("not_enough_energy");
  return Math.max(0, stored - cost);
}

export type StartCommand = { requestId: string; holobotName: string; questId?: string; courseId?: string };

export function readStartCommand(raw: unknown, kind: "quest" | "training"): StartCommand {
  const idKey = kind === "quest" ? "questId" : "courseId";
  if (!object(raw) || Object.keys(raw).some((k) => !["requestId", "holobotName", idKey].includes(k))
    || typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)
    || typeof raw.holobotName !== "string" || !raw.holobotName.trim() || raw.holobotName.length > 40
    || typeof raw[idKey] !== "string") return fail("invalid_request");
  return raw as StartCommand;
}

/** The questRun view returned by startQuestRun. */
export function questRunView(t: QuestTimer) {
  return { id: t.runId, questId: t.questId, holobotName: t.holobotName, holobotPower: t.holobotPower,
    startedAt: new Date(t.startedAtMs).toISOString(), endsAt: new Date(t.endsAtMs).toISOString(), startedAtMs: t.startedAtMs, endsAtMs: t.endsAtMs };
}

export function trainingView(t: TrainingTimer) {
  return { id: t.runId, courseId: t.courseId, holobotName: t.holobotName, statBoosts: t.statBoosts, expReward: t.expReward,
    startedAt: new Date(t.startedAtMs).toISOString(), endsAt: new Date(t.endsAtMs).toISOString(), startedAtMs: t.startedAtMs, endsAtMs: t.endsAtMs };
}

/**
 * startQuestRun. Idempotent per requestId (run id qr_<requestId>): a replay of a still-active run returns it and writes
 * nothing; a different quest / holobot under the same requestId is request_conflict.
 */
export function buildQuestStart(profile: Data, raw: unknown, nowMs: number) {
  const c = readStartCommand(raw, "quest");
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const runId = `qr_${c.requestId}`;
  const existing = timers.quests[runId];
  if (existing) {
    if (existing.questId !== c.questId || existing.holobotName.toUpperCase() !== c.holobotName.trim().toUpperCase()) return fail("request_conflict");
    return { alreadyProcessed: true, run: existing, updates: null };
  }
  const quest = getQuestEconomy(c.questId!) ?? fail("unknown_quest");
  const holobot = ownedHolobot(profile, c.holobotName);
  const runs = Object.values(timers.quests);
  if (runs.some((r) => r.holobotName.toUpperCase() === holobot.name.toUpperCase())) return fail("holobot_busy");
  if (runs.length >= MAX_ACTIVE_QUESTS) return fail("quest_slots_full");
  const dailyEnergy = energy(profile, quest.energyCost);
  const holobotPower = Math.min(MAX_CLAIMED_HOLOBOT_POWER, Math.max(0, getHolobotPowerScore(holobot as { name: string })));
  const run: QuestTimer = { runId, questId: quest.id, holobotName: holobot.name, holobotPower, energyCost: quest.energyCost, startedAtMs: nowMs, endsAtMs: nowMs + minutes(quest.durationMinutes) };
  questTimer(run, runId);
  const rewardSystem = rewardSystemOf(profile);
  const display = { id: runId, questId: quest.id, holobotName: holobot.name, holobotPower, rewards: quest.rewards,
    startedAt: new Date(run.startedAtMs).toISOString(), endsAt: new Date(run.endsAtMs).toISOString() };
  return {
    alreadyProcessed: false,
    run,
    updates: {
      dailyEnergy,
      [PROGRESSION_TIMERS_FIELD]: { ...timers, quests: { ...timers.quests, [runId]: run } },
      rewardSystem: { ...rewardSystem, activeQuests: [...(Array.isArray(rewardSystem.activeQuests) ? rewardSystem.activeQuests : []).filter((q) => !(object(q) && q.id === runId)), display] },
    },
  };
}

/**
 * startTrainingSession. One active session per account (as the clients enforce). The stat boost is rolled HERE
 * (roll in [0, 1)) and recorded; the client's own roll is never read. Idempotent per requestId (tr_<requestId>).
 */
export function buildTrainingStart(profile: Data, raw: unknown, nowMs: number, roll: number) {
  const c = readStartCommand(raw, "training");
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const runId = `tr_${c.requestId}`;
  if (timers.training?.runId === runId) {
    if (timers.training.courseId !== c.courseId || timers.training.holobotName.toUpperCase() !== c.holobotName.trim().toUpperCase()) return fail("request_conflict");
    return { alreadyProcessed: true, run: timers.training, updates: null };
  }
  const course = getTrainingCourseEconomy(c.courseId!) ?? fail("unknown_course");
  const holobot = ownedHolobot(profile, c.holobotName);
  if (timers.training) return fail("training_active");
  if (!(typeof roll === "number" && roll >= 0 && roll < 1)) return fail("unavailable");
  const dailyEnergy = energy(profile, course.energyCost);
  const boost = course.minBoost + Math.floor(roll * (course.maxBoost - course.minBoost + 1));
  const statBoosts = Object.fromEntries(course.statKeys.map((k) => [k, boost]));
  const run: TrainingTimer = { runId, courseId: course.id, holobotName: holobot.name, statBoosts, expReward: course.expReward, energyCost: course.energyCost, startedAtMs: nowMs, endsAtMs: nowMs + minutes(course.durationMinutes) };
  trainingTimer(run);
  const display = { courseId: course.id, holobotName: holobot.name, statBoosts, expReward: course.expReward,
    startedAt: new Date(run.startedAtMs).toISOString(), endsAt: new Date(run.endsAtMs).toISOString() };
  return {
    alreadyProcessed: false,
    run,
    updates: { dailyEnergy, [PROGRESSION_TIMERS_FIELD]: { ...timers, training: run }, rewardSystem: { ...rewardSystemOf(profile), activeTraining: display } },
  };
}

function legacyEndsAtMs(record: { endsAt?: unknown }): number {
  return new Date(String(record.endsAt || "")).getTime();
}

function legacyEndsAtOk(record: { endsAt?: unknown }, nowMs: number): boolean {
  const endsAtMs = legacyEndsAtMs(record);
  return Number.isFinite(endsAtMs) && endsAtMs <= nowMs;
}

/**
 * Legacy training (client timers): one slot per account, and the original app can start a session only once the
 * previous one is claimed (or overwrite a finished, unclaimed one), so a legitimate session starts after every earlier
 * training claim. A session that "started" before one (a restored copy, a backdated forgery) is refused.
 */
function legacyTrainingStartOk(timers: ProgressionTimers, startedAtMs: number): boolean {
  return claimedRuns(timers, "training").every((r) => r.claimedAtMs - LEGACY_CLOCK_SKEW_MS <= startedAtMs);
}

/**
 * Legacy quests: the original app sends a holobot on one quest at a time and holds at most MAX_ACTIVE_QUESTS, each
 * busy from its start to its claim. So the holobot's earlier legacy quests were all claimed before this one started,
 * and over [start, now] fewer than MAX_ACTIVE_QUESTS other legacy quests were running at any instant. Host-started
 * runs are not counted (lite lets a City run and a legacy run overlap; host runs are timed on the host anyway).
 */
function legacyQuestStartOk(timers: ProgressionTimers, holobotName: string, startedAtMs: number): boolean {
  const busy = claimedRuns(timers, "quest")
    .filter((r) => r.source === "legacy" && r.claimedAtMs - LEGACY_CLOCK_SKEW_MS > startedAtMs)
    .map((r) => ({ name: r.holobotName, from: Math.max(startedAtMs, r.startedAtMs), to: r.claimedAtMs - LEGACY_CLOCK_SKEW_MS }));
  if (busy.some((r) => r.name === holobotName)) return false;
  const peak = Math.max(0, ...busy.map((a) => busy.filter((b) => b.from <= a.from && a.from < b.to).length));
  return peak + 1 <= MAX_ACTIVE_QUESTS;
}

export type ClaimReplay = { source: "replay"; prior: ClaimedRun; displayUpdates: Data };

export type QuestClaimPayout = {
  record: StoredQuestRecord;
  source: "host" | "legacy";
  /** The server-record removal alone; settleQuestClaim adds the ledger entry once the outcome is rolled. */
  timerUpdates: Data;
  nextTimers: ProgressionTimers;
  claim: Omit<ClaimedRun, "succeeded" | "claimedAtMs"> | null;
};

export type TrainingClaimPayout = {
  record: StoredTrainingRecord;
  source: "host" | "legacy";
  /** The server-record removal alone; settleTrainingClaim adds the ledger entry. */
  timerUpdates: Data;
  nextTimers: ProgressionTimers;
  claim: Omit<ClaimedRun, "succeeded" | "claimedAtMs"> | null;
};

/** The progressionTimers write for a paid quest claim: server record removed, the run in the ledger with its outcome. */
export function settleQuestClaim(payout: QuestClaimPayout, succeeded: boolean, nowMs: number): Data {
  return { [PROGRESSION_TIMERS_FIELD]: payout.claim ? withClaimedRun(payout.nextTimers, { ...payout.claim, claimedAtMs: nowMs, succeeded }) : payout.nextTimers };
}

/** The progressionTimers write for a paid training claim. */
export function settleTrainingClaim(payout: TrainingClaimPayout, nowMs: number): Data {
  return { [PROGRESSION_TIMERS_FIELD]: payout.claim ? withClaimedRun(payout.nextTimers, { ...payout.claim, claimedAtMs: nowMs }) : payout.nextTimers };
}

function legacyQuestKey(record: Data): string | null {
  const quest = typeof record.questId === "string" ? getQuestEconomy(record.questId) : null;
  const startedAtMs = legacyEndsAtMs(record) - (quest ? minutes(quest.durationMinutes) : 0);
  return quest && whole(startedAtMs) ? claimKey("quest", quest.id, record.holobotName, startedAtMs) : null;
}

function legacyTrainingKey(record: Data): string | null {
  const course = typeof record.courseId === "string" ? getTrainingCourseEconomy(record.courseId) : null;
  const startedAtMs = legacyEndsAtMs(record) - (course ? minutes(course.durationMinutes) : 0);
  return course && whole(startedAtMs) ? claimKey("training", course.id, record.holobotName, startedAtMs) : null;
}

/**
 * The record a quest claim pays from. A server record wins; with none, the client-written rewardSystem record is used
 * only when `legacyTimers` (HOLOCITY_LEGACY_QUEST_TIMERS=1). Before either pays, the claim ledger is read: a run
 * already paid (by run id, or by its identity for a restored / resurrected copy) is a replay of its stored receipt,
 * on either flag, and its stale display copy is pruned.
 */
export function resolveQuestClaim(profile: Data, questRunId: string, nowMs: number, legacyTimers: boolean): QuestClaimPayout | ClaimReplay {
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const run = Object.hasOwn(timers.quests, questRunId) ? timers.quests[questRunId] : undefined;
  if (run) {
    if (nowMs < run.endsAtMs) return fail("not_complete");
    const { [questRunId]: _claimed, ...rest } = timers.quests;
    const nextTimers = { ...timers, quests: rest };
    return {
      record: { id: run.runId, questId: run.questId, holobotName: run.holobotName, holobotPower: run.holobotPower },
      source: "host",
      timerUpdates: { [PROGRESSION_TIMERS_FIELD]: nextTimers },
      nextTimers,
      claim: { kind: "quest", source: "host", runId: run.runId, subject: run.questId, holobotName: run.holobotName.trim().toUpperCase(), startedAtMs: run.startedAtMs },
    };
  }
  const rewardSystem = rewardSystemOf(profile);
  const activeQuests = Array.isArray(rewardSystem.activeQuests) ? rewardSystem.activeQuests : [];
  const record = activeQuests.find((entry) => object(entry) && entry.id === questRunId) as Data | undefined;
  const key = record ? legacyQuestKey(record) : null;
  const prior = claimedRuns(timers, "quest").find((r) => r.runId === questRunId) ?? (key ? timers.claimed?.[key] : undefined);
  if (prior) {
    const kept = activeQuests.filter((entry) => !(object(entry) && (entry.id === questRunId || legacyQuestKey(entry) === claimKeyOf(prior))));
    return { source: "replay", prior, displayUpdates: kept.length === activeQuests.length ? {} : { "rewardSystem.activeQuests": kept } };
  }
  if (!legacyTimers) return fail("not_started_on_host");
  if (!record) return fail("not_active");
  // A qr_ run is only ever host-started; with its server record gone it was claimed already (or never existed).
  if (questRunId.startsWith("qr_")) return fail("not_active");
  if (!legacyEndsAtOk(record, nowMs)) return fail("not_complete");
  const holobotName = typeof record.holobotName === "string" ? record.holobotName.trim().toUpperCase() : "";
  const startedAtMs = key ? Number(key.slice(key.lastIndexOf(":") + 1)) : 0;
  if (key && !legacyQuestStartOk(timers, holobotName, startedAtMs)) return fail("not_started_on_host");
  return {
    record: record as StoredQuestRecord,
    source: "legacy",
    timerUpdates: {},
    nextTimers: timers,
    // No key = unknown quest: applyQuestClaim refuses it before anything is written.
    claim: key ? { kind: "quest", source: "legacy", runId: questRunId, subject: String(record.questId), holobotName, startedAtMs } : null,
  };
}

/** The record a training claim pays from (same precedence, flag and ledger as resolveQuestClaim). */
export function resolveTrainingClaim(profile: Data, nowMs: number, legacyTimers: boolean): TrainingClaimPayout | ClaimReplay {
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  if (timers.training) {
    const run = timers.training;
    if (nowMs < run.endsAtMs) return fail("not_complete");
    const nextTimers = { ...timers, training: null };
    return {
      record: { courseId: run.courseId, holobotName: run.holobotName, statBoosts: run.statBoosts, expReward: run.expReward },
      source: "host",
      timerUpdates: { [PROGRESSION_TIMERS_FIELD]: nextTimers },
      nextTimers,
      claim: { kind: "training", source: "host", runId: run.runId, subject: run.courseId, holobotName: run.holobotName.trim().toUpperCase(), startedAtMs: run.startedAtMs },
    };
  }
  const raw = rewardSystemOf(profile).activeTraining;
  const record = object(raw) ? raw : null;
  const key = record ? legacyTrainingKey(record) : null;
  const prior = key ? timers.claimed?.[key] : undefined;
  if (prior) return { source: "replay", prior, displayUpdates: { "rewardSystem.activeTraining": null } };
  if (legacyTimers && record) {
    if (!legacyEndsAtOk(record, nowMs)) return fail("not_complete");
    const startedAtMs = key ? Number(key.slice(key.lastIndexOf(":") + 1)) : 0;
    if (key && !legacyTrainingStartOk(timers, startedAtMs)) return fail("not_started_on_host");
    return {
      record: record as StoredTrainingRecord,
      source: "legacy",
      timerUpdates: {},
      nextTimers: timers,
      claim: key ? { kind: "training", source: "legacy", runId: "", subject: String(record.courseId), holobotName: typeof record.holobotName === "string" ? record.holobotName.trim().toUpperCase() : "", startedAtMs } : null,
    };
  }
  // Nothing to pay: a retry right after a claim (reply lost) replays that claim's receipt.
  const last = claimedRuns(timers, "training").sort((a, b) => b.claimedAtMs - a.claimedAtMs)[0];
  if (last && nowMs - last.claimedAtMs <= TRAINING_REPLAY_WINDOW_MS) return { source: "replay", prior: last, displayUpdates: {} };
  if (!legacyTimers) return fail("not_started_on_host");
  return fail("not_active");
}
